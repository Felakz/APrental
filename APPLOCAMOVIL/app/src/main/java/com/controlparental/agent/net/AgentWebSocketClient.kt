package com.controlparental.agent.net

import android.os.Handler
import android.os.Looper
import android.util.Log
import okhttp3.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class AgentWebSocketClient(
    private var serverUrl: String = "wss://control-parental-honor.onrender.com/ws",
    private val agentKey: String = "xiqjtUg1F39TlvYdVRDA8SzCMQELo5nh",
    private val deviceName: String = "Honor 400 (telefono)",
    private val listener: Listener
) : WebSocketListener() {

    interface Listener {
        fun onConnected()
        fun onDisconnected()
        fun onLiveRequest(requestId: String)
        fun onLiveStop()
        fun onCommand(command: String, params: JSONObject)
        fun onTap(x: Int, y: Int)
        fun onSwipe(x1: Int, y1: Int, x2: Int, y2: Int, duration: Int)
        fun onText(text: String)
        fun onKey(key: String)
        fun onBlockedAppsUpdated(apps: List<String>)
    }

    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    private var webSocket: WebSocket? = null
    private var isConnected = false
    private var isRunning = false
    private val handler = Handler(Looper.getMainLooper())
    private var reconnectDelayMs = 3000L

    fun setServerUrl(url: String) {
        this.serverUrl = url
    }

    fun start() {
        isRunning = true
        connect()
    }

    fun stop() {
        isRunning = false
        handler.removeCallbacksAndMessages(null)
        webSocket?.close(1000, "Cierre voluntario")
        webSocket = null
        isConnected = false
    }

    @Synchronized
    private fun connect() {
        if (!isRunning) return
        try {
            val request = Request.Builder().url(serverUrl).build()
            webSocket = client.newWebSocket(request, this)
            Log.i("AgentWsClient", "Iniciando conexion WebSocket hacia $serverUrl")
        } catch (e: Exception) {
            Log.e("AgentWsClient", "Error creando conexion WS: ${e.message}")
            scheduleReconnect()
        }
    }

    fun send(json: JSONObject): Boolean {
        val ws = webSocket
        if (ws != null && isConnected) {
            return ws.send(json.toString())
        }
        return false
    }

    override fun onOpen(webSocket: WebSocket, response: Response) {
        Log.i("AgentWsClient", "WebSocket abierto. Enviando agent.hello...")
        val hello = JSONObject().apply {
            put("type", "agent.hello")
            put("agentKey", agentKey)
            put("deviceName", deviceName)
        }
        webSocket.send(hello.toString())
    }

    override fun onMessage(webSocket: WebSocket, text: String) {
        try {
            val json = JSONObject(text)
            val type = json.optString("type")
            when (type) {
                "agent.welcome" -> {
                    isConnected = true
                    reconnectDelayMs = 3000L
                    Log.i("AgentWsClient", "Registrado exitosamente como agente.")
                    listener.onConnected()

                    // Leer lista inicial de apps bloqueadas si el server la envio
                    val blockedArr = json.optJSONArray("blockedApps")
                    if (blockedArr != null) {
                        val list = mutableListOf<String>()
                        for (i in 0 until blockedArr.length()) list.add(blockedArr.getString(i))
                        listener.onBlockedAppsUpdated(list)
                    }
                }
                "live.request" -> {
                    val reqId = json.optString("requestId", "")
                    listener.onLiveRequest(reqId)
                }
                "live.stop" -> {
                    listener.onLiveStop()
                }
                "ping" -> {
                    val pong = JSONObject().apply { put("type", "pong") }
                    webSocket.send(pong.toString())
                }
                "input.tap" -> {
                    val x = json.optInt("x", 0)
                    val y = json.optInt("y", 0)
                    listener.onTap(x, y)
                }
                "input.swipe" -> {
                    val x1 = json.optInt("x1", 0)
                    val y1 = json.optInt("y1", 0)
                    val x2 = json.optInt("x2", 0)
                    val y2 = json.optInt("y2", 0)
                    val duration = json.optInt("duration", 200)
                    listener.onSwipe(x1, y1, x2, y2, duration)
                }
                "input.text" -> {
                    val txt = json.optString("text", "")
                    listener.onText(txt)
                }
                "input.key" -> {
                    val k = json.optString("key", "")
                    listener.onKey(k)
                }
                "config.blockedApps" -> {
                    val arr = json.optJSONArray("apps") ?: JSONArray()
                    val list = mutableListOf<String>()
                    for (i in 0 until arr.length()) list.add(arr.getString(i))
                    listener.onBlockedAppsUpdated(list)
                }
                "command" -> {
                    val cmd = json.optString("command", "")
                    val params = json.optJSONObject("params") ?: JSONObject()
                    listener.onCommand(cmd, params)
                }
            }
        } catch (e: Exception) {
            Log.e("AgentWsClient", "Error parseando mensaje WS: ${e.message}")
        }
    }

    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
        Log.w("AgentWsClient", "WebSocket cerrando (code=$code, reason=$reason)")
    }

    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        Log.w("AgentWsClient", "WebSocket cerrado.")
        isConnected = false
        listener.onDisconnected()
        scheduleReconnect()
    }

    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        Log.e("AgentWsClient", "Fallo de conexion WebSocket: ${t.message}")
        isConnected = false
        listener.onDisconnected()
        scheduleReconnect()
    }

    private fun scheduleReconnect() {
        if (!isRunning) return
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({
            Log.i("AgentWsClient", "Reintentando conexion...")
            connect()
        }, reconnectDelayMs)
        reconnectDelayMs = (reconnectDelayMs * 1.5).toLong().coerceAtMost(30000L)
    }
}
