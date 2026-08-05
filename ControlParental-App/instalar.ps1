# Instalador de Control Parental (ejecutado por instalar.bat)
$ErrorActionPreference = 'Stop'

function Test-Admin {
  return ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-Host "=========================================="
Write-Host "  Control Parental - Instalador"
Write-Host "=========================================="

# Si no somos administradores, re-elevar con UAC (necesario para registrar
# las tareas de arranque automatico). Si no se puede, continuar igual.
$isAdmin = Test-Admin
if (-not $isAdmin) {
  try {
    Write-Host "Solicitando permisos de administrador ..."
    Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"") -Verb RunAs
    Write-Host "Se abrio la ventana de administrador para completar la instalacion."
    exit
  } catch {
    Write-Host "[AVISO] Sin permisos de administrador: no se registrara el arranque automatico."
    Write-Host "        Para activarlo, ejecuta instalar.bat como administrador."
  }
}

$src = $PSScriptRoot
$app = Join-Path $env:LOCALAPPDATA 'ControlParental'

Write-Host ""
Write-Host "[1/4] Copiando archivos a $app ..."
if (-not (Test-Path $app)) { New-Item -ItemType Directory -Path $app | Out-Null }
Copy-Item -Path (Join-Path $src 'agente') -Destination $app -Recurse -Force
Copy-Item -Path (Join-Path $src 'server') -Destination $app -Recurse -Force
Copy-Item -Path (Join-Path $src 'node.exe') -Destination $app -Force
if (Test-Path (Join-Path $src 'MANUAL.md')) {
  Copy-Item -Path (Join-Path $src 'MANUAL.md') -Destination (Join-Path $app 'MANUAL.md') -Force
}

# Generar configs desde los ejemplos si no existen (para que el usuario los personalice)
if (-not (Test-Path (Join-Path $app 'server\config.js'))) {
  Copy-Item -Path (Join-Path $app 'server\config.example.js') -Destination (Join-Path $app 'server\config.js') -Force
  Write-Host "    server\config.js generado desde el ejemplo. Revisa las claves."
}
if (-not (Test-Path (Join-Path $app 'agente\config.json'))) {
  Copy-Item -Path (Join-Path $app 'agente\config.example.json') -Destination (Join-Path $app 'agente\config.json') -Force
  Write-Host "    agente\config.json generado desde el ejemplo. Revisa la URL y la clave."
}

Write-Host ""
Write-Host "[2/4] Registrando tareas de arranque automatico ..."

function New-Task($name, $trigger, $file) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$file`""
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Force | Out-Null
  Write-Host "    tarea $name OK"
}

try {
  New-Task 'ControlParentalServer' (New-ScheduledTaskTrigger -AtLogOn) (Join-Path $app 'server\start_server.ps1')
  New-Task 'ControlParentalServerWatchdog' (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration ([TimeSpan]::MaxValue)) (Join-Path $app 'server\server_watchdog.ps1')
  New-Task 'ControlParentalAgent' (New-ScheduledTaskTrigger -AtLogOn) (Join-Path $app 'agente\start_agent.ps1')
  New-Task 'ControlParentalAgentWatchdog' (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration ([TimeSpan]::MaxValue)) (Join-Path $app 'agente\watchdog.ps1')
} catch {
  Write-Host "    [AVISO] No se pudieron registrar las tareas de arranque automatico."
  Write-Host "    Ejecuta instalar.bat como administrador para activarlas."
}

Write-Host ""
Write-Host "[3/4] Abriendo el puerto 4000 en el firewall ..."
try {
  netsh advfirewall firewall add rule name="Control Parental 4000" dir=in action=allow protocol=TCP localport=4000 | Out-Null
  Write-Host "    puerto 4000 abierto."
} catch {
  Write-Host "    [AVISO] No se pudo abrir el firewall (requiere administrador)."
  Write-Host "    Ejecuta como administrador: server\firewall.ps1"
}

Write-Host ""
Write-Host "[4/4] Iniciando servidor y agente ..."
Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $app 'server\server_watchdog.ps1')`""
Start-Sleep -Seconds 2
Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $app 'agente\watchdog.ps1')`""

Write-Host ""
Write-Host "Instalacion completada."
Write-Host "  Panel: http://localhost:4000"
Write-Host "  Manual: $app\MANUAL.md"
Write-Host ""
Write-Host "IMPORTANTE: abre MANUAL.md para configurar las claves y la"
Write-Host "conexion del agente (IP o Tailscale) antes de usarlo en otro PC."
Read-Host "Presiona Enter para salir"
