// Streamer H.264 del Honor 400 a navegador con control remoto.
// Sin permisos en el telefono: usa adb (permisos shell).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { WebSocketServer } = require('ws');

function log(msg) {
  try {
    fs.appendFileSync(path.join(__dirname, 'streamer.log'), '[' + new Date().toISOString() + '] ' + msg + '\n');
  } catch (e) {}
}

const PORT = 4001;
const ADB = 'C:\\Users\\Lenovo\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe\\scrcpy-win64-v4.1\\adb.exe';
const DEVICE = '100.122.200.118:5555';

let proc = null;          // proceso adb screenrecord
let restartTimer = null;
let reconnectTimer = null;

// ---------- helper adb ----------
function adbRun(args) {
  return new Promise((resolve) => {
    execFile(ADB, ['-s', DEVICE, ...args], { timeout: 15000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return resolve({ err, stderr: String(stderr) });
      resolve({ err: null, stdout: String(stdout) });
    });
  });
}

async function ensureConnected() {
  const r = await adbRun(['connect', DEVICE]);
  return r;
}

// ---------- captura H.264 ----------
async function wakeDevice() {
  await adbRun(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']);
}

async function startCapture() {
  if (proc) return;
  console.log('[stream] asegurando pantalla activa y lanzando captura H.264...');
  await wakeDevice();

  // screenrecord se corta a los 180s maximo; lo relanzamos en bucle
  proc = spawn(ADB, ['-s', DEVICE, 'exec-out', 'screenrecord', '--output-format=h264', '--size', '1264x2736', '--bit-rate', '4000000', '--time-limit', '170', '-'], { windowsHide: true });

  proc.stdout.on('data', (chunk) => {
    // Buscar y guardar SPS/PPS de los primeros chunks para nuevos clientes
    findAndCacheHeaders(chunk);

    // Transmitir chunks directamente a todos los clientes WebSocket
    for (const client of clients) {
      if (client.readyState === 1) {
        try { client.send(chunk); } catch (e) {}
      }
    }
  });

  proc.stderr.on('data', (d) => {
    const text = String(d).trim();
    if (text) {
      console.log('[stream] stderr:', text.slice(0, 200));
      if (text.toLowerCase().includes('dozing')) {
        wakeDevice();
      }
    }
  });

  proc.on('exit', (code) => {
    console.log('[stream] screenrecord termino (code=' + code + ')');
    proc = null;
    scheduleRestart();
  });
  proc.on('error', (err) => {
    console.log('[stream] error:', err.message);
    proc = null;
    scheduleRestart();
  });
}

let cache = { sps: null, pps: null }; // ultimo SPS/PPS con startcode para nuevos clientes

function findAndCacheHeaders(buf) {
  for (let i = 0; i + 4 <= buf.length; i++) {
    let startLen = 0;
    if (i + 4 <= buf.length && buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 0 && buf[i + 3] === 1) {
      startLen = 4;
    } else if (i + 3 <= buf.length && buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) {
      startLen = 3;
    }
    if (startLen > 0 && i + startLen < buf.length) {
      const type = buf[i + startLen] & 0x1f;
      if (type === 7 && !cache.sps) {
        const next = findNextStartCode(buf, i + startLen);
        cache.sps = next !== -1 ? buf.subarray(i, next) : buf.subarray(i);
        console.log('[stream] SPS detectado y guardado (' + cache.sps.length + ' bytes)');
      } else if (type === 8 && !cache.pps) {
        const next = findNextStartCode(buf, i + startLen);
        cache.pps = next !== -1 ? buf.subarray(i, next) : buf.subarray(i);
        console.log('[stream] PPS detectado y guardado (' + cache.pps.length + ' bytes)');
      }
    }
  }
}

function findNextStartCode(buf, from) {
  for (let i = from; i + 3 <= buf.length; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0 && (buf[i + 2] === 1 || (i + 4 <= buf.length && buf[i + 2] === 0 && buf[i + 3] === 1))) {
      return i;
    }
  }
  return -1;
}

function scheduleRestart() {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    startCapture();
  }, 1000);
}

// ---------- websocket ----------
const clients = new Set();

function onWsConnect(ws) {
  clients.add(ws);
  console.log('[ws] cliente conectado (' + clients.size + ')');
  // mandar SPS/PPS al nuevo cliente para que pueda decodificar
  if (cache.sps) {
    try { ws.send(cache.sps); } catch (e) {}
  }
  if (cache.pps) {
    try { ws.send(cache.pps); } catch (e) {}
  }
  // asegurar que la captura corra
  ensureConnected().then(() => {
    if (!proc) startCapture();
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    handleCommand(msg);
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log('[ws] cliente desconectado (' + clients.size + ')');
    if (clients.size === 0) {
      // nadie viendo: parar captura para ahorrar recursos
      if (proc) { proc.kill(); proc = null; }
    }
  });
}

// ---------- control remoto (adb input) ----------
function handleCommand(msg) {
  const adbInput = (args) => {
    execFile(ADB, ['-s', DEVICE, 'shell', 'input', ...args], { windowsHide: true }, (err) => {
      if (err) console.log('[input] error:', String(err.stderr || err.message).slice(0, 200));
    });
  };

  switch (msg.type) {
    case 'tap':
      adbInput(['tap', String(msg.x), String(msg.y)]);
      break;
    case 'swipe':
      adbInput(['swipe', String(msg.x1), String(msg.y1), String(msg.x2), String(msg.y2), String(msg.dur || 300)]);
      break;
    case 'key': // keycode de Android, ej: 4=back 3=home 24=volup
      adbInput(['keyevent', String(msg.keyCode)]);
      break;
    case 'text':
      adbInput(['text', String(msg.text || '')]);
      break;
  }
}

// ---------- servidor HTTP: pagina ----------
function serveStatic(res, file, type) {
  fs.readFile(path.join(__dirname, file), (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/') return serveStatic(res, 'index.html', 'text/html');
  if (req.url === '/app.js') return serveStatic(res, 'app.js', 'application/javascript');
  if (req.url === '/style.css') return serveStatic(res, 'style.css', 'text/css');
  if (req.url === '/jmuxer.min.js') return serveStatic(res, 'public/jmuxer.min.js', 'application/javascript');
  res.writeHead(404); res.end('not found');
});

const wss = new WebSocketServer({ server });
wss.on('connection', onWsConnect);

server.listen(PORT, () => {
  console.log('Streamer Honor 400 en http://localhost:' + PORT);
  ensureConnected().then(() => {
    startCapture();
  });
});

process.on('exit', () => {
  if (proc) proc.kill();
});
