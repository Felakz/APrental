# Inicia el servidor de control parental oculto con el node.exe del paquete
# (lo lanza el Programador de tareas al iniciar sesion).
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Join-Path (Split-Path -Parent $dir) 'node.exe'
if (-not (Test-Path $node)) { $node = 'C:\Program Files\nodejs\node.exe' }
Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $dir -WindowStyle Hidden
