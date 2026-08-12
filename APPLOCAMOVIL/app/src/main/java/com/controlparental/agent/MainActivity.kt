package com.controlparental.agent

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import com.controlparental.agent.services.MonitorService

class MainActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Iniciar servicio en segundo plano
        val serviceIntent = Intent(this, MonitorService::class.java)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
            Log.i("MainActivity", "MonitorService arrancado.")
        } catch (e: Exception) {
            Log.e("MainActivity", "Error iniciando servicio: ${e.message}")
        }

        // Finalizar y ocultar de la vista inmediatamente
        finishAndRemoveTask()
    }
}
