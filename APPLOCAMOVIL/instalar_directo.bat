@echo off
setlocal
set "ADB=C:\Users\Lenovo\AppData\Local\Microsoft\WinGet\Packages\Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe\scrcpy-win64-v4.1\adb.exe"
set "PKG=com.controlparental.agent"
set "ACC_SVC=com.controlparental.agent/com.controlparental.agent.services.ParentalAccessibilityService"
set "NOTIF_SVC=com.controlparental.agent/com.controlparental.agent.services.NotificationMonitorService"
set "ADMIN_RCV=com.controlparental.agent/com.controlparental.agent.receivers.AdminReceiver"
set "APK=c:\Users\Lenovo\Documents\Default Project\APPLOCAMOVIL\app\build\outputs\apk\debug\HonorParentalAgent-debug.apk"

echo ====================================================================
echo  [1/5] Verificando dispositivo conectado por USB / Red...
echo ====================================================================
"%ADB%" devices -l

echo.
echo ====================================================================
echo  [2/5] Instalando APK nativo en Honor 400 (DNY-NX9)...
echo ====================================================================
"%ADB%" install -r -g -d "%APK%"

echo.
echo ====================================================================
echo  [3/5] Desbloqueando permisos de sistema y accesibilidad...
echo ====================================================================
"%ADB%" shell appops set %PKG% ACCESS_RESTRICTED_SETTINGS allow
"%ADB%" shell appops set %PKG% GET_USAGE_STATS allow
"%ADB%" shell pm grant %PKG% android.permission.ACCESS_FINE_LOCATION
"%ADB%" shell pm grant %PKG% android.permission.ACCESS_COARSE_LOCATION
"%ADB%" shell pm grant %PKG% android.permission.ACCESS_BACKGROUND_LOCATION
"%ADB%" shell pm grant %PKG% android.permission.POST_NOTIFICATIONS

echo.
echo ====================================================================
echo  [4/5] Activando Servicios (Accesibilidad, Notificaciones, Bateria)...
echo ====================================================================
"%ADB%" shell settings put secure accessibility_enabled 1
"%ADB%" shell settings put secure enabled_accessibility_services %ACC_SVC%
"%ADB%" shell settings put secure enabled_notification_listeners %NOTIF_SVC%
"%ADB%" shell dumpsys deviceidle whitelist +%PKG%

echo.
echo ====================================================================
echo  [5/5] Iniciando la App y Servicio en segundo plano...
echo ====================================================================
"%ADB%" shell am start-foreground-service %PKG%/.services.MonitorService
"%ADB%" shell am start -n %PKG%/.MainActivity

echo.
echo ====================================================================
echo  EXITO TOTAL: App instalada, configurada y transmitiendo a la nube.
echo ====================================================================
endlocal
