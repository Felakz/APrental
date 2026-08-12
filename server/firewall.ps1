# Abre el puerto 4000 en el Firewall de Windows para que el panel sea visible
# desde otros dispositivos de la misma red (movil del padre, etc.).
# EJECUTAR COMO ADMINISTRADOR: clic derecho sobre el archivo -> Ejecutar con PowerShell.
netsh advfirewall firewall add rule name="Control Parental 4000" dir=in action=allow protocol=TCP localport=4000
Write-Host "Puerto 4000 abierto en el firewall."
