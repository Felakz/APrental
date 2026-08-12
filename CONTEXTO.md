# CONTEXTO DEL PROYECTO: Control Parental Honor 400

Este archivo contiene el contexto técnico completo, la arquitectura, las decisiones y el estado actual del proyecto para que cualquier desarrollador o IA pueda continuar el trabajo sin fricciones.

---

## 1. Objetivo General
Construir una solución de monitoreo y control remoto para un teléfono **Honor 400 (Android 16)** perteneciente al hijo del usuario, permitiendo supervisión y control desde el PC del padre y desde un celular secundario vía web.

El proyecto consta de dos fases/enfoques:
1. **Solución Inmediata (Puente ADB + Streamer H.264 + Tailscale):**
   - Transmisión de pantalla en vivo sin requerir permisos interactivos en el teléfono (usando permisos de shell vía ADB).
   - Control remoto interactivo (toques, deslizamientos, teclas) desde una interfaz web.
   - Integración con el panel de control parental existente en Node.js.
2. **Aplicación Android Nativa (Kotlin - Fases futuras/en curso):**
   - Agente que se ejecuta en el Honor 400.
   - Funciones: Actividad de apps, registro de texto vía `AccessibilityService`, ubicación GPS con historial, capturas automáticas (`takeScreenshot`), notificaciones y modo `Device Owner` (no desinstalable vía ADB).

---

## 2. Entorno de Ejecución e Infraestructura

- **Sistemas y Herramientas en PC (Windows):**
  - **Node.js**: v24.19.0 (`C:\Program Files\nodejs\node.exe`)
  - **Python**: 3.12 (`C:\Users\Lenovo\AppData\Local\Programs\Python\Python312\python.exe`) con paquetes `websocket-client`, `PIL`, `psutil`.
  - **ADB / scrcpy**: v4.1 instalado en `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe\scrcpy-win64-v4.1\adb.exe`
  - **Tailscale**: Red privada virtual (VPN mesh). IP del PC: `100.112.77.32`

- **Dispositivo Objetivo (Honor 400):**
  - **Modelo**: HONOR DNY-NX9 (Android 16)
  - **IP en Tailscale**: `100.122.200.118`
  - **Puerto ADB TCP/IP**: `5555` (dispositivo conectado en `100.122.200.118:5555`)
  - **Modo Desarrollador**: Habilitado con Depuración USB y Depuración Inalámbrica.

---

## 3. Arquitectura del Código Fuente

El proyecto se compone de los siguientes módulos en `C:\Users\Lenovo\Documents\Default Project\`:

```
Default Project/
├── server/                                # Backend principal de Control Parental
│   ├── server.js                         # Servidor Express + WebSocket (puerto 4000)
│   ├── config.js                         # parentPassword y agentKey
│   ├── data/                             # Almacenamiento JSON de reportes y PDFs
│   └── public/                           # Panel web HTML/JS para el padre
│
├── APPLOCAMOVIL/                          # Módulo para el Honor 400
│   ├── agente_honor.py                   # Puente Python que envía screenshots JPEG (~1 fps) al panel (puerto 4000)
│   ├── conectar.bat                      # Script para conectar ADB y lanzar scrcpy local
│   ├── iniciar.bat                       # Script para iniciar server.js + agente_honor.py de un clic
│   ├── GUIAS.md                          # Instrucciones de configuración
│   │
│   └── streamer/                         # Streamer H.264 de alta fluidez + Control táctil (puerto 4001)
│       ├── package.json                  # Dependencias: ws, jmuxer
│       ├── server.js                     # Servidor Node.js que ejecuta adb screenrecord e inyecta gestos
│       ├── index.html                    # Interfaz web móvil
│       ├── app.js                        # Cliente WS + jmuxer + captura de eventos touch/mouse/teclado
│       ├── style.css                     # Estilos oscuros responsivos
│       └── public/jmuxer.min.js          # Muxer fMP4 para reproducción nativa MSE en el navegador
│
├── ControlParental-App/                  # Empaquetado ejecutable para distribución
└── agent/                                # Agente original de Windows (agent.py -> agente.exe)
```

---

## 4. Credenciales y Configuración de Red

- **Servidor Web Panel**: `http://localhost:4000` (Local) o `http://100.112.77.32:4000` (Tailscale)
  - **Contraseña del Panel (`parentPassword`)**: `IRZ6nCHU2bEGT9F8K5k1jDyv`
  - **Clave de Agente (`agentKey`)**: `xiqjtUg1F39TlvYdVRDA8SzCMQELo5nh`
- **Streamer H.264**: `http://localhost:4001` (Local) o `http://100.112.77.32:4001` (Tailscale)

---

## 5. Estado Actual del Desarrollo

1. **Conexión ADB por Red:**
   - La conexión ADB TCP/IP a `100.122.200.118:5555` está activa y verificada.
   - Si el dispositivo se reinicia o pierde energía, se debe reconectar por USB una vez y ejecutar `adb tcpip 5555`.

2. **Puente `agente_honor.py` (Puerto 4000):**
   - **Estado:** Totalmente funcional.
   - Captura la pantalla del Honor 400 vía `adb exec-out screencap -p`, la comprime a JPEG con PIL y la transmite por WebSocket al panel Express en el puerto 4000.
   - Apariencia en panel: Se registra como dispositivo `"Honor 400 (telefono)"`.

3. **Streamer H.264 de Baja Latencia + Control Táctil (Puerto 4001):**
   - **Estado:** En desarrollo / Corrección de parser NAL.
   - `adb exec-out screenrecord --output-format=h264 --size 720x1280 --bit-rate 4000000 --time-limit 170 -` transmite video H.264 en bruto vía `stdout`.
   - La decodificación en frontend se realiza con `jmuxer` (MSE nativo).
   - Inyección de gestos implementada en `server.js`: `tap`, `swipe`, `key`, `text` usando `adb shell input`.

4. **Instalación de Android Studio:**
   - Proceso iniciado vía `winget install Google.AndroidStudio` para la fase de desarrollo nativo Kotlin.

---

## 6. Próximos Pasos para la Continuación

1. **Ajustar el troceado de NAL units en `APPLOCAMOVIL/streamer/server.js`:**
   - Asegurar que la búsqueda de start codes contemple tanto prefijos de 4 bytes (`00 00 00 01`) como de 3 bytes (`00 00 01`) de la norma Annex B H.264 para no acumular búfer en la lectura de `proc.stdout`.
2. **Verificar Android Studio:**
   - Confirmar si la instalación finalizó correctamente e inicializar el proyecto Kotlin dentro de `APPLOCAMOVIL/app`.
3. **Desarrollar la App Kotlin (`APPLOCAMOVIL/app`):**
   - `AccessibilityService` para captura de texto y `takeScreenshot()` silencioso.
   - `LocationManager` para eventos de GPS.
   - `UsageStatsManager` para reporte de aplicaciones activas.
   - `DeviceOwnerReceiver` configurado vía `adb shell dpm set-device-owner`.
