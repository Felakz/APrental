# Desinstalador de Control Parental (ejecutado por desinstalar.bat)
$ErrorActionPreference = 'Stop'
$app = Join-Path $env:LOCALAPPDATA 'ControlParental'

Write-Host "Deteniendo procesos ..."
Get-CimInstance Win32_Process -Filter "Name='agente.exe'" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'server\.js' -and $_.CommandLine -notmatch 'ERP|next|nest' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "Eliminando tareas programadas ..."
$tasks = 'ControlParentalServer','ControlParentalServerWatchdog','ControlParentalAgent','ControlParentalAgentWatchdog'
foreach ($t in $tasks) {
  Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue
}
Write-Host "Tareas eliminadas."

Write-Host "Eliminando carpeta $app ..."
Remove-Item -Path $app -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Cerrando el puerto 4000 en el firewall ..."
try {
  netsh advfirewall firewall delete rule name="Control Parental 4000" | Out-Null
} catch {
  Write-Host "  AVISO: elimina manualmente la regla de firewall (requiere administrador)."
}

Write-Host "Desinstalacion completada."
Read-Host "Presiona Enter para salir"
