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
    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    @SuppressLint("MissingPermission")
    fun start() {
        if (isTracking || locationManager == null) return
        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    30000L, // 30 segundos
                    10f,    // 10 metros
                    this
                )
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER,
                    30000L,
                    10f,
                    this
                )
            }
            isTracking = true
            Log.i("LocationTracker", "Rastreo de ubicacion GPS y red iniciado.")
            queryLastKnown()
        } catch (e: Exception) {
            Log.e("LocationTracker", "Error al iniciar LocationTracker: ${e.message}")
        }
    }

    @SuppressLint("MissingPermission")
    fun queryLastKnown() {
        if (locationManager == null) return
        try {
            val gpsLoc = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER)
            val netLoc = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
            val best = when {
                gpsLoc != null && netLoc != null -> if (gpsLoc.time > netLoc.time) gpsLoc else netLoc
                gpsLoc != null -> gpsLoc
                else -> netLoc
            }
            if (best != null) {
                dispatchLocation(best)
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
        dispatchLocation(location)
    }

    private fun dispatchLocation(loc: Location) {
        try {
            val json = JSONObject().apply {
                put("type", "location")
                put("lat", loc.latitude)
                put("lon", loc.longitude)
                put("accuracy", loc.accuracy.toDouble())
                put("speed", loc.speed.toDouble())
                put("altitude", loc.altitude)
                put("ts", isoFormat.format(Date(loc.time)))
            }
            onLocationUpdate(json)
        } catch (e: Exception) {
            Log.e("LocationTracker", "Error formateando ubicacion: ${e.message}")
        }
    }

    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}
}
