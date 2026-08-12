@echo off
REM Conecta al Honor 400 via Tailscale y abre scrcpy.
REM Uso: conectar.bat 100.x.y.z   (IP de Tailscale del telefono)
setlocal

set ADB=C:\Users\Lenovo\AppData\Local\Microsoft\WinGet\Packages\Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe\scrcpy-win64-v4.1\adb.exe
set SCRCPY=C:\Users\Lenovo\AppData\Local\Microsoft\WinGet\Packages\Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe\scrcpy-win64-v4.1\scrcpy.exe

if "%1"=="" (
  echo Uso: conectar.bat ^<IP-Tailscale-del-telefono^>
  echo Ejemplo: conectar.bat 100.84.23.7
  exit /b 1
)

set IP=%1

echo [1/3] Conectando adb a %IP%:5555 ...
"%ADB%" connect %IP%:5555
if errorlevel 1 (
  echo No se pudo conectar. Revisa que el telefono tenga adb por red activo.
  echo Si se reinicio el telefono, conectalo por USB una vez y ejecuta: adb tcpip 5555
  exit /b 1
)

echo [2/3] Dispositivos conectados y activando pantalla:
"%ADB%" devices
"%ADB%" -s %IP%:5555 shell input keyevent KEYCODE_WAKEUP

echo [3/3] Abriendo scrcpy (pantalla completa con control tactil y teclado)...
"%SCRCPY%" -s %IP%:5555 --keyboard=sdk --mouse=sdk --stay-awake --max-size 1280 --video-bit-rate 8M

endlocal
