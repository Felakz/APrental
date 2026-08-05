# Vigilante: cada 5 minutos verifica que el agente (agente.exe) siga corriendo y lo relanza si se detuvo.
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $dir 'agente.exe'

# Si quedo un agente Python viejo (agent.py) en conflicto, lo terminamos para evitar duplicados.
Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -match 'agent\.py' } | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

$running = Get-CimInstance Win32_Process -Filter "Name='agente.exe'"
if (-not $running) {
  Start-Process -FilePath $exe -WorkingDirectory $dir -WindowStyle Hidden
}
