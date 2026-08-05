# Control Parental

Aplicacion de control parental **autocontenida** para Windows. No requiere instalar Python ni Node.js:
incluye el agente compilado (`agente.exe`), el servidor web con panel de supervision y el runtime de
Node.js (`node.exe`).

## Contenido

```
ControlParental-App/
  instalar.bat            Instalador (copia, arranque automatico, firewall)
  desinstalar.bat         Desinstalador
  MANUAL.md               Manual de instalacion y uso (incluye acceso remoto con Tailscale)
  node.exe                Runtime de Node.js incluido
  agente/
    agente.exe            Agente compilado (corre en el PC del hijo/a)
    config.example.json   Ejemplo de configuracion del agente
  server/
    server.js             API REST + WebSocket (agentes y paneles)
    config.example.js     Ejemplo de credenciales y puerto
    public/               Panel web (HTML/CSS/JS)
    start_server.ps1      Lanza el servidor al iniciar sesion (tarea programada)
    server_watchdog.ps1   Relanza el servidor si se detiene (cada 5 min)
    firewall.ps1          Abre el puerto 4000 en el Firewall (como admin)
```

## Instalacion rapida

1. Descarga el paquete y ejecuta `instalar.bat` (como administrador para el arranque automatico).
2. Abre el panel en `http://localhost:4000` y entra con la contrasena del panel.
3. Para el PC del hijo/a, edita `agente\config.json` (`serverUrl` y `agentKey`) y reinicia.

Detalles, configuracion de claves, despliegue en el PC del hijo/a y acceso remoto con Tailscale:
**lee `ControlParental-App\MANUAL.md`**.

## Caracteristicas

- Pantalla en vivo HD (selector de calidad Estandar / Alta / Ultra HD) con pantalla completa, tambien desde el movil.
- Reporte de actividad por aplicacion y texto de teclado, consultables por **cualquier dia pasado**.
- **PDF diario** de reportes, descargable desde el panel.
- Aceptacion automatica de supervision y monitoreo de teclado **siempre activos** (no se desactivan).
- Arranque automatico y vigilancia (servidor y agente se relanzan solos si se detienen).

## Seguridad

- El panel pide contrasena y usa tokens de sesion; el agente se autentica con una clave compartida.
- **Cambia las claves** en `server\config.js` y `agente\config.json` antes de desplegar
  (el repositorio solo incluye ejemplos con valores de relleno).
- Para uso fuera de tu red local, usa una VPN como **Tailscale** (instrucciones en el manual).

## Código fuente

El codigo fuente del servidor esta en `ControlParental-App\server\` y el del agente en `agent\agent.py`
(compilado a `agente.exe` con PyInstaller). Las credenciales, los reportes (`server\data\`) y las configs
reales quedan excluidos del repositorio.
