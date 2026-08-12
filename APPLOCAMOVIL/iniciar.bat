@echo off
REM Inicia el servidor del panel + el puente del Honor 400.
setlocal

set SERVER_DIR=C:\Users\Lenovo\Documents\Default Project\server
set PUENTE_DIR=C:\Users\Lenovo\Documents\Default Project\APPLOCAMOVIL

echo [1/3] Arrancando servidor del panel...
start "ControlParental-Server" cmd /c "cd /d %SERVER_DIR% && node server.js"

echo [2/3] Arrancando puente Honor 400...
start "ControlParental-Puente" cmd /c "cd /d %PUENTE_DIR% && python agente_honor.py"

echo [3/3] Panel:  http://localhost:4000
echo        Desde tu celular (Tailscale):  http://100.112.77.32:4000
endlocal
