# Inicia el servidor de control parental oculto (lo lanza el Programador de tareas al iniciar sesion).
$node = 'C:\Program Files\nodejs\node.exe'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $dir -WindowStyle Hidden
