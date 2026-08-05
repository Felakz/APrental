# Control Parental - Manual de instalacion

Aplicacion autocontenida de control parental para Windows:
agente (agente.exe) + servidor web con panel de supervision (node.exe incluido).
No requiere instalar Python ni Node.js.

## Contenido del paquete

- `agente\agente.exe` : agente que corre en el PC del hijo/a (captura de pantalla en vivo, actividad y teclado).
- `agente\config.json` : configuracion del agente (URL del servidor y clave).
- `server\` : servidor web + panel (node.exe incluido, sin dependencias externas).
- `node.exe` : runtime de Node.js incluido.
- `instalar.bat` : instalador (copia, registra arranque automatico y abre el firewall).
- `desinstalar.bat` : desinstalador.

## Instalacion (en el PC donde vivira el servidor/padre)

1. Copia la carpeta `ControlParental-App` a donde quieras (por ejemplo `C:\ControlParental`).
2. Doble clic en `instalar.bat`. Hara:
   - Copiar la app a `%LOCALAPPDATA%\ControlParental`.
   - Registrar 4 tareas de arranque automatico (servidor + agente, y sus vigilantes).
   - Abrir el puerto 4000 en el firewall (si tienes permisos de administrador; si no,
     ejecuta luego `server\firewall.ps1` como administrador).
3. Abre el panel: `http://localhost:4000` y entra con la contrasena del panel.

## Configuracion de claves (IMPORTANTE)

Ambos archivos usan las mismas claves; cambialas ANTES de desplegar:

- `server\config.js` :
  - `parentPassword` : contrasena para entrar al panel.
  - `agentKey` : clave que valida a los agentes.
- `agente\config.json` :
  - `agentKey` : debe ser IGUAL a la del servidor.
  - `serverUrl` : direccion del servidor al que se conecta el agente.

Despues de cambiar `server\config.js`, reinicia el servidor (ver "Reiniciar").

## Uso en el PC del hijo/a (solo agente)

1. Instala el paquete con `instalar.bat` (puedes borrar `server\` si quieres, no hace falta).
2. Edita `agente\config.json`:
   - `serverUrl`: pon la IP del PC del padre, p. ej. `ws://192.168.1.50:4000/ws`
     (o la IP de Tailscale si usas acceso remoto, ver abajo).
   - `agentKey`: la misma clave que definiste en el servidor.
   - `deviceName`: un nombre descriptivo, p. ej. "PC de la sala".
3. Guarda y reinicia el agente (o reinicia el PC). Aparecera en el panel como "Conectado".

Nota: la pantalla en vivo se muestra de forma automatica sin aviso (aceptacion automatica
siempre activa). El monitoreo de teclado y la aceptacion automatica no se pueden desactivar.

## Acceso remoto (desde el movil / otro lugar) con Tailscale

1. Instala Tailscale (https://tailscale.com/download) en el PC del padre y en el PC del hijo.
2. Inicia sesion con la misma cuenta en ambos.
3. En el PC del padre, anota su IP de Tailscale (icono en la barra de tareas > IP, p. ej. `100.x.y.z`).
4. En el agente del PC del hijo, pon `serverUrl`: `ws://100.x.y.z:4000/ws`.
5. Desde el movil del padre (con Tailscale instalado y la misma cuenta), abre `http://100.x.y.z:4000`.

## Tareas de arranque automatico

| Tarea | Momento | Que hace |
|---|---|---|
| ControlParentalServer | Al iniciar sesion | Arranca el servidor web |
| ControlParentalServerWatchdog | Cada 5 min | Relanza el servidor si se detuvo |
| ControlParentalAgent | Al iniciar sesion | Arranca el agente |
| ControlParentalAgentWatchdog | Cada 5 min | Relanza el agente si se detuvo |

## Reiniciar el servidor o el agente manualmente

- Abre el Administrador de tareas, busca los procesos `node.exe` (server.js) y `agente.exe`, terminarlos,
  y ejecuta de nuevo `server\start_server.ps1` y `agente\start_agent.ps1` (o espera al vigilante).

## Desinstalar

Doble clic en `desinstalar.bat`: detiene procesos, elimina tareas, carpeta y regla de firewall.

## Solucion de problemas

- **El agente no aparece en el panel**: revisa que `serverUrl` y `agentKey` coincidan y que el puerto 4000 este abierto.
- **No hay video en vivo**: el agente debe estar corriendo; desde el panel usa el selector de calidad (Estandar/Alta/Ultra HD).
- **Reportes PDF**: se generan automaticamente una vez por dia y se pueden descargar desde el panel.
- **Log del agente**: si algo falla, revisa `agente\agente.log` (se crea junto al agente).
