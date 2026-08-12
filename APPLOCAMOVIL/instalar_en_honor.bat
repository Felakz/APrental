@echo off
REM ====================================================================
REM  Instalador y Aprovisionador Automatizado: Honor 400 (Control Parental)
REM ====================================================================
setlocal enabledelayedexpansion

set ADB=C:\Users\Lenovo\AppData\Local\Microsoft\WinGet\Packages\Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe\scrcpy-win64-v4.1\adb.exe
set DEFAULT_DEVICE=100.122.200.118:5555
set PKG=com.controlparental.agent
set ACC_SVC=com.controlparental.agent/com.controlparental.agent.services.ParentalAccessibilityService
set ADMIN_RCV=com.controlparental.agent/com.controlparental.agent.receivers.AdminReceiver

if not "%1"=="" (
    set TARGET=%1
) else (
    set TARGET=%DEFAULT_DEVICE%
)

echo ====================================================================
echo  [1/5] Conectando con Honor 400 en %TARGET%...
echo ====================================================================
"%ADB%" connect %TARGET%
"%ADB%" -s %TARGET% wait-for-device

echo.
echo ====================================================================
echo  [2/5] Verificando APK para instalacion...
echo ====================================================================
set APK_PATH=app\build\outputs\apk\debug\HonorParentalAgent-debug.apk
if not exist "%APK_PATH%" (
    set APK_PATH=app\build\outputs\apk\debug\app-debug.apk
)
if not exist "%APK_PATH%" (
    set APK_PATH=app\build\outputs\apk\release\app-release.apk
)
if not exist "%APK_PATH%" (
    set APK_PATH=app-release.apk
)
if not exist "%APK_PATH%" (
    set APK_PATH=app-debug.apk
)

if exist "%APK_PATH%" (
    echo Instalando %APK_PATH% con todos los permisos concedidos (-g)...
    "%ADB%" -s %TARGET% install -r -g "%APK_PATH%"
) else (
    echo [AVISO] APK no encontrado en ruta local. Si ya esta instalada en el telefono, se aplicaran los permisos.
)

echo.
echo ====================================================================
echo  [3/5] Desbloqueando permisos restringidos (Android 13/14/15/16)...
echo ====================================================================
"%ADB%" -s %TARGET% shell appops set %PKG% ACCESS_RESTRICTED_SETTINGS allow
"%ADB%" -s %TARGET% shell appops set %PKG% GET_USAGE_STATS allow
"%ADB%" -s %TARGET% shell pm grant %PKG% android.permission.ACCESS_FINE_LOCATION 2>nul
"%ADB%" -s %TARGET% shell pm grant %PKG% android.permission.ACCESS_COARSE_LOCATION 2>nul
"%ADB%" -s %TARGET% shell pm grant %PKG% android.permission.ACCESS_BACKGROUND_LOCATION 2>nul

set NOTIF_SVC=com.controlparental.agent/com.controlparental.agent.services.NotificationMonitorService

echo.
echo ====================================================================
echo  [4/5] Activando Accesibilidad, Notificaciones y Exencion de Bateria...
echo ====================================================================
"%ADB%" -s %TARGET% shell settings put secure accessibility_enabled 1
"%ADB%" -s %TARGET% shell settings put secure enabled_accessibility_services %ACC_SVC%
"%ADB%" -s %TARGET% shell settings put secure enabled_notification_listeners %NOTIF_SVC%
"%ADB%" -s %TARGET% shell dumpsys deviceidle whitelist +%PKG%

echo.
echo ====================================================================
echo  [5/5] Iniciando servicio invisible en segundo plano...
echo ====================================================================
"%ADB%" -s %TARGET% shell am start-foreground-service %PKG%/.services.MonitorService
"%ADB%" -s %TARGET% shell am start -n %PKG%/.MainActivity

echo.
echo ====================================================================
echo  EXITO: La App del Honor 400 esta instalada, configurada y activa.
echo  Panel de control: http://localhost:4000
echo ====================================================================
echo.
echo Para blindar contra desinstalacion (Modo Device Owner), ejecuta:
echo "%ADB%" -s %TARGET% shell dpm set-device-owner %ADMIN_RCV%
echo.
endlocal
