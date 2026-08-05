# Inicia el agente compilado (agente.exe) oculto (lo lanza el Programador de tareas al iniciar sesion).
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $dir 'agente.exe'
Start-Process -FilePath $exe -WorkingDirectory $dir -WindowStyle Hidden
