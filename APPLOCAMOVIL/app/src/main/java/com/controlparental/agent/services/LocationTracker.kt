package com.controlparental.agent.services

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.util.Log
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*

class LocationTracker(
    private val context: Context,
    private val onLocationUpdate: (JSONObject) -> Unit
) : LocationListener {

    private val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    private var isTracking = false
    private var lastSentLocation: Location? = null
    private var lastSentTimeMs: Long = 0L

    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    @SuppressLint("MissingPermission")
    fun start() {
        if (isTracking || locationManager == null) return
        try {
            val providers = locationManager.allProviders
            for (p in providers) {
                if (p != LocationManager.PASSIVE_PROVIDER && locationManager.isProviderEnabled(p)) {
                    locationManager.requestLocationUpdates(p, 20000L, 10f, this)
                }
            }
            isTracking = true
            Log.i("LocationTracker", "Rastreo de ubicacion iniciado con proveedores: $providers")
            queryLastKnown()
        } catch (e: Exception) {
            Log.e("LocationTracker", "Error al iniciar LocationTracker: ${e.message}")
        }
    }

    @SuppressLint("MissingPermission")
    fun queryLastKnown() {
        if (locationManager == null) return
        try {
            var best: Location? = null
            val providers = locationManager.allProviders
            for (p in providers) {
                try {
                    val loc = locationManager.getLastKnownLocation(p)
                    if (loc != null) {
                        if (best == null || loc.time > best.time) {
                            best = loc
                        }
                    }
                } catch (e: Exception) {}
            }

            if (best != null) {
                dispatchLocation(best, force = true)
            } else {
                for (p in providers) {
                    if (locationManager.isProviderEnabled(p)) {
                        locationManager.requestSingleUpdate(p, this, null)
                        break
                    }
                }
            }
        } catch (e: Exception) {
            Log.w("LocationTracker", "No se pudo obtener ultima ubicacion: ${e.message}")
        }
    }

    fun stop() {
        if (!isTracking || locationManager == null) return
        try {
            locationManager.removeUpdates(this)
            isTracking = false
            Log.i("LocationTracker", "Rastreo de ubicacion detenido.")
        } catch (e: Exception) {
            Log.e("LocationTracker", "Error deteniendo LocationTracker: ${e.message}")
        }
    }

    override fun onLocationChanged(location: Location) {
        dispatchLocation(location, force = false)
    }

    private fun dispatchLocation(loc: Location, force: Boolean = false) {
        val now = System.currentTimeMillis()
        val last = lastSentLocation
        if (!force && last != null) {
            val dist = loc.distanceTo(last)
            val elapsed = now - lastSentTimeMs
            // Filtrar duplicados: solo enviar si se movio mas de 15 metros o paso mas de 60 segundos
            if (dist < 15f && elapsed < 60000L) {
                return
            }
        }
        lastSentLocation = loc
        lastSentTimeMs = now

        try {
            val json = JSONObject().apply {
                put("type", "location")
                put("lat", loc.latitude)
                put("lon", loc.longitude)
                put("accuracy", loc.accuracy.toDouble())
                put("speed", loc.speed.toDouble())
                put("altitude", loc.altitude)
                put("ts", isoFormat.format(Date(if (loc.time > 0) loc.time else now)))
            }
            onLocationUpdate(json)
            Log.i("LocationTracker", "Ubicacion enviada: ${loc.latitude}, ${loc.longitude} (acc=${loc.accuracy}m)")
        } catch (e: Exception) {
            Log.e("LocationTracker", "Error formateando ubicacion: ${e.message}")
        }
    }

    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}
}
