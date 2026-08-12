#!/usr/bin/env python3
"""Puente PC <-> Honor 400 para el panel de control parental.

Corre en el PC. Conecta con el telefono via adb (por Tailscale) y con el
servidor del panel. Cuando el padre pide ver la pantalla, captura frames
del telefono (screencap) y los envia como en el protocolo del agente PC.
"""

import base64
import io
import json
import os
import subprocess
import sys
import threading
import time
import traceback
from datetime import datetime

import websocket

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(SCRIPT_DIR, "config.json")
LOG_FILE = os.path.join(SCRIPT_DIR, "agente_honor.log")

# Ruta de adb (incluido con scrcpy)
ADB = os.path.join(
    os.path.expandvars(r"%LOCALAPPDATA%"),
    "Microsoft",
    "WinGet",
    "Packages",
    "Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe",
    "scrcpy-win64-v4.1",
    "adb.exe",
)

DEFAULT_CONFIG = {
    "serverUrl": "ws://localhost:4000/ws",
    "agentKey": "xiqjtUg1F39TlvYdVRDA8SzCMQELo5nh",
    "deviceName": "Honor 400 (telefono)",
    "adbAddress": "100.122.200.118:5555",
    "frameIntervalSec": 1.0,
    "frameMaxWidth": 960,
    "frameQuality": 55,
    "activityIntervalSec": 5,
}


def log(msg):
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write("[%s] %s\n" % (datetime.now().isoformat(), msg))
    except Exception:
        pass


def load_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    else:
        cfg = {}
    for key, val in DEFAULT_CONFIG.items():
        cfg.setdefault(key, val)
    save_config(cfg)
    return cfg


def save_config(cfg):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


cfg = load_config()

live_event = threading.Event()
ws_conn = None
ws_lock = threading.Lock()


def send(obj):
    global ws_conn
    with ws_lock:
        if ws_conn and ws_conn.sock:
            try:
                ws_conn.send(json.dumps(obj, ensure_ascii=False))
                return True
            except Exception as e:
                log("send: error: %s" % e)
    return False


def get_target_device():
    """Detecta automaticamente si el dispositivo esta por USB o por IP."""
    try:
        p2 = subprocess.run([ADB, "devices"], capture_output=True, timeout=2, creationflags=0x08000000)
        lines = p2.stdout.decode("utf-8", errors="ignore").splitlines()
        for line in lines[1:]:
            parts = line.strip().split()
            if len(parts) >= 2 and parts[1] == "device":
                return parts[0]
    except Exception:
        pass
    return cfg.get("adbAddress", "100.122.200.118:5555")


def adb(args):
    """Ejecuta un comando adb y devuelve (returncode, stdout, stderr)."""
    target = get_target_device()
    cmd = [ADB, "-s", target] + args
    try:
        p = subprocess.run(
            cmd,
            capture_output=True,
            timeout=20,
            creationflags=0x08000000,  # CREATE_NO_WINDOW
        )
        return p.returncode, p.stdout, p.stderr
    except Exception as e:
        log("adb: error ejecutando %s: %s" % (args, e))
        return 1, b"", str(e).encode()


def adb_connected():
    target = get_target_device()
    p = subprocess.run([ADB, "-s", target, "get-state"], capture_output=True, timeout=3, creationflags=0x08000000)
    return p.returncode == 0 and b"device" in p.stdout


def capture_frame():
    """Captura la pantalla del telefono (screencap) y la devuelve como JPEG base64."""
    from PIL import Image

    code, out, err = adb(["exec-out", "screencap", "-p"])
    if code != 0 or not out:
        log("capture: screencap fallo (code=%s err=%s)" % (code, err[:120]))
        return None
    try:
        img = Image.open(io.BytesIO(out))
        img = img.convert("RGB")
        max_w = int(cfg.get("frameMaxWidth", 960))
        if img.width > max_w:
            ratio = max_w / img.width
            img = img.resize((max_w, max(1, int(img.height * ratio))))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=int(cfg.get("frameQuality", 55)))
        return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception as e:
        log("capture: error procesando imagen: %s" % e)
        return None


def capture_loop():
    log("capture_loop: inicio")
    while live_event.is_set():
        try:
            if not adb_connected():
                log("capture_loop: buscando dispositivo...")
                time.sleep(2)
                continue
            frame = capture_frame()
            if frame:
                ok = send({"type": "live.frame", "image": frame})
                log("capture_loop: frame %d bytes ok=%s" % (len(frame), ok))
        except Exception as e:
            log("capture_loop: error: %s\n%s" % (e, traceback.format_exc()))
        time.sleep(float(cfg.get("frameIntervalSec", 0.8)))
    log("capture_loop: fin")


def start_live(request_id):
    if not live_event.is_set():
        live_event.set()
        # Despertar pantalla si esta en reposo
        adb(["shell", "input", "keyevent", "KEYCODE_WAKEUP"])
        send({"type": "live.accepted", "requestId": request_id})
        log("start_live: aceptado requestId=%s (pantalla despierta)" % request_id)
        threading.Thread(target=capture_loop, daemon=True).start()
    else:
        log("start_live: ya activo (ignorado)")


def stop_live():
    if live_event.is_set():
        live_event.clear()
        send({"type": "live.stopped"})
        log("stop_live: detenido")


# ---------- monitoreo de actividad (app en primer plano) ----------
def get_foreground():
    """Devuelve el nombre de la app en primer plano (via dumpsys)."""
    # Intento 1: dumpsys activity (muy preciso en Android 14/15/16)
    code, out, _ = adb(["shell", "dumpsys", "activity", "top"])
    if code == 0 and out:
        text = out.decode("utf-8", "replace")
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("ACTIVITY ") and "/" in line:
                try:
                    parts = line.split()[1] # ej: com.android.settings/.Settings
                    pkg = parts.split("/")[0]
                    return pkg, parts
                except Exception:
                    pass

    # Intento 2: dumpsys window (fallback)
    code, out, _ = adb(["shell", "dumpsys", "window", "windows"])
    if code == 0 and out:
        text = out.decode("utf-8", "replace")
        for marker in ["mCurrentFocus", "mFocusedApp", "imeInputTarget"]:
            if marker in text:
                try:
                    idx = text.index(marker)
                    line = text[idx: idx + 200].split("\n")[0]
                    if "{" in line and "}" in line:
                        comp = line.split("{")[1].split("}")[0]
                        if "/" in comp:
                            pkg = comp.split("/")[0].split()[-1]
                            return pkg, comp
                except Exception:
                    pass
    return "desconocido", ""


def monitor_loop(ws):
    last_pkg = None
    while ws_conn == ws and ws.sock:
        try:
            pkg, comp = get_foreground()
            if pkg and pkg != last_pkg:
                send({
                    "type": "activity",
                    "app": pkg,
                    "title": comp,
                    "detected": None,
                    "ts": datetime.now().isoformat(),
                })
                last_pkg = pkg
        except Exception as e:
            log("monitor_loop: error: %s" % e)
        time.sleep(int(cfg.get("activityIntervalSec", 5)))


# ---------- mensajes del servidor ----------
def handle_message(data):
    t = data.get("type")
    if t == "live.request":
        start_live(data.get("requestId"))
    elif t == "live.stop":
        stop_live()
    elif t == "ping":
        send({"type": "pong"})
    elif t == "input.tap":
        x = int(data.get("x", 0))
        y = int(data.get("y", 0))
        log("input.tap: (%d, %d)" % (x, y))
        adb(["shell", "input", "tap", str(x), str(y)])
    elif t == "input.swipe":
        x1 = int(data.get("x1", 0))
        y1 = int(data.get("y1", 0))
        x2 = int(data.get("x2", 0))
        y2 = int(data.get("y2", 0))
        dur = max(100, min(250, int(data.get("duration", 200))))
        log("input.swipe: (%d, %d) -> (%d, %d) dur=%dms" % (x1, y1, x2, y2, dur))
        adb(["shell", "input", "swipe", str(x1), str(y1), str(x2), str(y2), str(dur)])
    elif t == "input.key":
        key = data.get("key", "")
        log("input.key: %s" % key)
        adb(["shell", "input", "keyevent", str(key)])
    elif t == "input.text":
        raw_text = data.get("text", "")
        log("input.text: %s" % raw_text)
        # Escape spaces for adb input text
        safe_text = raw_text.replace(" ", "%s").replace("&", "\\&").replace("<", "\\<").replace(">", "\\>")
        adb(["shell", "input", "text", safe_text])
    elif t == "command":
        cmd = data.get("command")
        log("command: %s" % cmd)
        if cmd == "lock":
            adb(["shell", "input", "keyevent", "26"])
        elif cmd == "wake":
            adb(["shell", "input", "keyevent", "KEYCODE_WAKEUP"])
        elif cmd == "home":
            adb(["shell", "input", "keyevent", "KEYCODE_HOME"])
        elif cmd == "back":
            adb(["shell", "input", "keyevent", "KEYCODE_BACK"])
        elif cmd == "recents" or cmd == "app_switch":
            adb(["shell", "input", "keyevent", "KEYCODE_APP_SWITCH"])
        elif cmd == "volume_up":
            adb(["shell", "input", "keyevent", "KEYCODE_VOLUME_UP"])
        elif cmd == "volume_down":
            adb(["shell", "input", "keyevent", "KEYCODE_VOLUME_DOWN"])
        elif cmd == "request_location":
            # Intento de lectura de ultima ubicacion por adb
            code, out, _ = adb(["shell", "dumpsys", "location"])
            if code == 0 and out:
                import re
                txt = out.decode("utf-8", "replace")
                # Buscar patron Location[gps lat,lon ...] o h:[lat,lon] o similar
                m = re.search(r"Location\[(?:gps|network|fused)\s+([\-\d\.]+)[,\s]+([\-\d\.]+)", txt)
                if not m:
                    m = re.search(r"last\s+location=Location\[\w+\s+([\-\d\.]+)[,\s]+([\-\d\.]+)", txt, re.IGNORECASE)
                if m:
                    lat, lon = float(m.group(1)), float(m.group(2))
                    send({
                        "type": "location",
                        "lat": lat,
                        "lon": lon,
                        "accuracy": 15.0,
                        "speed": 0,
                        "ts": datetime.now().isoformat()
                    })


def receiver(ws):
    global ws_conn
    log("receiver: inicio")
    try:
        while ws and ws.sock:
            msg = ws.recv()
            if not msg:
                break
            handle_message(json.loads(msg))
    except Exception as e:
        log("receiver: conexion perdida: %s" % e)
    finally:
        try:
            ws.close()
        except Exception:
            pass
        if ws_conn == ws:
            ws_conn = None


def connect():
    global ws_conn
    import ssl
    url = cfg["serverUrl"]
    log("connect: conectando a %s" % url)
    sslopt = {"cert_reqs": ssl.CERT_NONE} if url.startswith("wss://") else {}
    ws = websocket.create_connection(url, timeout=10, sslopt=sslopt, enable_multithread=True)
    ws.settimeout(None)
    ws.send(json.dumps({
        "type": "agent.hello",
        "agentKey": cfg["agentKey"],
        "deviceName": cfg["deviceName"],
    }, ensure_ascii=False))
    welcome = json.loads(ws.recv())
    if welcome.get("type") != "agent.welcome":
        raise RuntimeError(welcome.get("message") or "welcome inesperado")
    log("connect: registrado como '%s'" % welcome.get("id"))
    ws_conn = ws
    threading.Thread(target=receiver, args=(ws,), daemon=True).start()
    threading.Thread(target=monitor_loop, args=(ws,), daemon=True).start()


def main():
    log("main: inicio (adb=%s)" % ADB)
    if not os.path.exists(ADB):
        log("main: ADB no encontrado en %s" % ADB)
        print("ADB no encontrado. Revisa config.json")
        return
    while True:
        try:
            connect()
            while ws_conn and ws_conn.sock:
                time.sleep(1)
        except Exception as e:
            log("main: error: %s" % e)
            time.sleep(3)
        except KeyboardInterrupt:
            stop_live()
            sys.exit(0)
        except Exception as e:
            log("main: error: %s\n%s" % (e, traceback.format_exc()))
        finally:
            stop_live()
        time.sleep(3)


if __name__ == "__main__":
    main()
