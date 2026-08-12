# Control del Honor 400 a distancia (scrcpy + Tailscale)

Este paquete te permite ver y controlar la pantalla del Honor 400 desde el PC,
desde cualquier lugar, igual que con el cable USB pero por internet.

## Panel web: ver el telefono desde tu otro celular

El puente `agente_honor.py` hace que el Honor 400 aparezca dentro del panel web
de control parental (el mismo que usas para el PC).

1. Ejecuta `iniciar.bat` (arranca el servidor del panel + el puente).
2. En tu otro celular, instala **Tailscale** e inicia sesion con la misma cuenta.
3. Abre en el navegador del celular: `http://100.112.77.32:4000`
   (la IP Tailscale del PC).
4. Entra con la contrasena del panel y pulsa **"Ver pantalla"** en el dispositivo
   "Honor 400 (telefono)".

## Control total desde el PC (scrcpy)

## Requisitos (ya instalados en el PC)

- scrcpy 4.1 (incluye adb)  -> instalado con winget
- Tailscale                 -> ya esta instalado en el PC
- Tailscale en el telefono   -> se instala desde Play Store / APK

## Paso 1: en el Honor 400 (una sola vez)

1. `Ajustes` -> `Acerca del telefono` -> pulsa **7 veces** sobre
   "Número de compilación" hasta que aparezca "Ya es desarrollador".
2. `Ajustes` -> `Sistema` (o `Sistema y actualizaciones`) -> `Opciones de desarrollador` -> activa:
   - **Depuración USB**
   - **Depuración USB (ajustes de seguridad)** o **Permitir simulación de entrada por ADB** (imprescindible para controlar la pantalla con ratón y teclado).
   - **Permitir depuración ADB en modo solo carga** (evita desconexiones involuntarias).
   - **Depuración inalámbrica** (opcional, para emparejar sin cable)
3. Instala **Tailscale** en el telefono:
   - Play Store: busca "Tailscale" (oficial de tailscale.com)
   - O descarga el APK desde https://tailscale.com/download/android
4. Abre Tailscale en el telefono e inicia sesion con la MISMA cuenta que en el PC.
   Debe quedar en "Connected".
5. En Tailscale del telefono (o desde la web de Tailscale) anota su **IP de
   Tailscale** (suele ser `100.x.y.z`). La necesitas en el paso 3.

## Paso 2: conectar el telefono por USB (una sola vez)

Conecta el Honor 400 al PC por USB (cable de datos) y acepta en el telefono
el aviso "¿Permitir depuración USB?" marcando "Siempre".

Verifica que el PC lo ve:

    adb devices

Debe aparecer una fila con el serial del telefono y el estado "device".

## Paso 3: habilitar adb por red

Con el telefono conectado por USB, ejecuta:

    adb tcpip 5555

Luego ya puedes desconectar el cable. El telefono queda escuchando en el puerto 5555.

Nota: esto se resetea al reiniciar el telefono. Si lo reinician, repite los
pasos 2 y 3 (o usa "Depuración inalámbrica" con codigo de emparejamiento).

## Paso 4: conectar a distancia y abrir scrcpy

Usa el script `conectar.bat` pasando la IP de Tailscale del telefono:

    conectar.bat 100.x.y.z

Ese script hace `adb connect 100.x.y.z:5555` y luego abre scrcpy con calidad alta.

Alternativa manual:

    adb connect 100.x.y.z:5555
    scrcpy

Para que se vea mas fluido a distancia puedes probar:

    scrcpy --video-bit-rate 8M --max-size 1280

## Solucion de problemas

- **"no devices / cannot connect"**: el telefono se reinicio y perdio el modo
  tcpip. Repite pasos 2 y 3 (o usa el emparejamiento inalámbrico).
- **El telefono no se ve en adb**: revisa que la depuracion USB este activa y
  que el cable sea de datos.
- **Se corta al apagar pantalla**: cambia en el telefono `Opciones de
  desarrollador` -> "Mantener activa la pantalla" mientras se carga, o activa
  el modo "No apagar" de scrcpy con `scrcpy --stay-awake`.
