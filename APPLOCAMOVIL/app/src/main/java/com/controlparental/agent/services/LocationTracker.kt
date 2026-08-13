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

    // Geocercas: mapa de nombre -> (lat, lon, radiusMeters, lastState: inside?)
    private val geofences = mutableMapOf<String, GeofenceZone>()

    data class GeofenceZone(val id: String, val name: String, val lat: Double, val lon: Double, val radius: Float, var wasInside: Boolean? = null)

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

    fun updateGeofences(zones: List<JSONObject>) {
        geofences.clear()
        for (z in zones) {
            val id = z.optString("id", "")
            val name = z.optString("name", "zona_${geofences.size}")
            val lat = z.optDouble("lat", 0.0)
            val lon = z.optDouble("lon", 0.0)
            val radius = z.optDouble("radius", 100.0).toFloat()
            if (lat != 0.0 && lon != 0.0) {
                geofences[name] = GeofenceZone(id, name, lat, lon, radius)
                Log.i("LocationTracker", "Geocerca registrada: $name ($lat,$lon r=${radius}m)")
            }
        }
        Log.i("LocationTracker", "Total geocercas: ${geofences.size}")
    }

    private fun checkGeofences(loc: Location) {
        for ((name, zone) in geofences) {
            val zoneLoc = Location("").apply {
                latitude = zone.lat
                longitude = zone.lon
            }
            val dist = loc.distanceTo(zoneLoc)
            val isInside = dist <= zone.radius

            if (zone.wasInside != null && isInside != zone.wasInside) {
                val action = if (isInside) "enter" else "exit"
                val breachJson = JSONObject().apply {
                    put("type", "geofence.breach")
                    put("geofenceId", zone.id)
                    put("zone", name)
                    put("action", action)
                    put("lat", loc.latitude)
                    put("lon", loc.longitude)
                    put("distance", dist.toDouble())
                    put("ts", isoFormat.format(Date()))
                }
                onLocationUpdate(breachJson)
                Log.i("LocationTracker", "Geocerca '$name': $action (dist=${dist}m, radio=${zone.radius}m)")
            }
            zone.wasInside = isInside
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
            if (dist < 15f && elapsed < 60000L) {
                return
            }
        }
        lastSentLocation = loc
        lastSentTimeMs = now

        // Verificar geocercas siempre (incluso si no envia ubicacion)
        checkGeofences(loc)

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
