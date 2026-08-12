# Vigilante: cada 5 minutos verifica que el servidor siga corriendo y lo relanza si se detuvo.
$node = 'C:\Program Files\nodejs\node.exe'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'server\.js' -and $_.CommandLine -notmatch 'ERP|next|nest' }
if (-not $running) {
  Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $dir -WindowStyle Hidden
}
