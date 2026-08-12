package com.controlparental.agent.services

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*

class NotificationMonitorService : NotificationListenerService() {

    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return
        val pkg = sbn.packageName ?: return
        if (pkg.contains("com.controlparental.agent") || pkg.contains("android")) return

        val extras = sbn.notification.extras ?: return
        val title = extras.getString(Notification.EXTRA_TITLE) ?: ""
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""

        if (title.isEmpty() && text.isEmpty()) return

        Log.i("NotifMonitor", "Notificacion recibida de $pkg: $title - $text")

        try {
            val json = JSONObject().apply {
                put("type", "notification")
                put("app", pkg)
                put("title", title)
                put("text", text)
                put("ts", isoFormat.format(Date()))
            }
            ParentalAccessibilityService.instance?.sendCustomEvent(json)
        } catch (e: Exception) {
            Log.e("NotifMonitor", "Error despachando notificacion: ${e.message}")
        }
    }
}
