package com.controlparental.agent.services

import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build
import android.util.Log
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*

class UsageStatsMonitor(
    private val context: Context,
    private val onUsageUpdate: (JSONObject) -> Unit
) {
    private var isRunning = false
    private var lastQueryTimeMs: Long = 0L
    private val previousStats = mutableMapOf<String, Long>()

    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    fun start() {
        if (isRunning) return
        isRunning = true
        lastQueryTimeMs = System.currentTimeMillis()
        Log.i("UsageStatsMonitor", "Monitoreo de uso de apps iniciado")
    }

    fun stop() {
        isRunning = false
        Log.i("UsageStatsMonitor", "Monitoreo de uso de apps detenido")
    }

    fun queryAndReport() {
        if (!isRunning) return
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return

        try {
            val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return
            val now = System.currentTimeMillis()
            val startTime = lastQueryTimeMs

            val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, startTime, now)
            if (stats.isNullOrEmpty()) {
                Log.w("UsageStatsMonitor", "Sin datos de uso (permiso PACKAGE_USAGE_STATS requerido)")
                return
            }

            for (stat in stats) {
                val app = stat.packageName
                if (app == "com.controlparental.agent") continue

                val currentTotalMs = stat.totalTimeInForeground
                val prevTotalMs = previousStats[app] ?: 0L
                val deltaMs = currentTotalMs - prevTotalMs

                if (deltaMs > 1000) {
                    val usageJson = JSONObject().apply {
                        put("type", "appusage")
                        put("app", app)
                        put("durationMs", deltaMs)
                        put("ts", isoFormat.format(Date()))
                    }
                    onUsageUpdate(usageJson)
                    Log.i("UsageStatsMonitor", "Uso de $app: ${deltaMs}ms")
                }

                previousStats[app] = currentTotalMs
            }

            lastQueryTimeMs = now
        } catch (e: Exception) {
            Log.e("UsageStatsMonitor", "Error consultando UsageStats: ${e.message}")
        }
    }
}
