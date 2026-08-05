const state = {
  token: null,
  ws: null,
  agents: [],
  currentAgentId: null,
  liveActive: false
};

const $ = (id) => document.getElementById(id);

// ---------- Login ----------
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginError').textContent = '';
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: $('password').value })
  });
  if (res.ok) {
    const data = await res.json();
    state.token = data.token;
    $('loginView').classList.add('hidden');
    $('mainView').classList.remove('hidden');
    connectWs();
    loadAgents();
    loadReport();
    loadTyping();
    loadPdfs();
    $('reportDate').value = todayLocal();
    $('typingDate').value = todayLocal();
    setInterval(loadReport, 10000);
    setInterval(loadTyping, 10000);
    setInterval(loadPdfs, 60000);
  } else {
    const data = await res.json().catch(() => ({}));
    $('loginError').textContent = data.error || 'No se pudo iniciar sesión';
  }
});

$('logoutBtn').addEventListener('click', () => {
  state.token = null;
  if (state.ws) state.ws.close();
  if (state.liveActive) closeLive();
  $('mainView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
  $('password').value = '';
});

// ---------- WebSocket ----------
function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  state.ws = new WebSocket(`${proto}://${location.host}/ws`);
  state.ws.onopen = () => {
    state.ws.send(JSON.stringify({ type: 'panel.hello', token: state.token }));
  };
  state.ws.onmessage = (ev) => handleMessage(JSON.parse(ev.data));
  state.ws.onclose = () => {
    if (state.token) setTimeout(connectWs, 3000);
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'agents.updated':
      state.agents = msg.agents || [];
      renderAgents();
      break;
    case 'live.requesting':
      setLiveStatus('requesting', 'solicitando permiso...');
      break;
    case 'live.accepted':
      setLiveStatus('live', 'EN VIVO');
      break;
    case 'live.denied':
      setLiveStatus('offline', 'el aviso fue rechazado');
      setTimeout(() => closeLive(), 1500);
      break;
    case 'live.frame':
      $('livePlaceholder').classList.add('hidden');
      $('liveImg').classList.remove('hidden');
      $('liveImg').src = 'data:image/jpeg;base64,' + msg.image;
      break;
    case 'live.stopped':
    case 'live.error':
      closeLive();
      break;
    case 'error':
      if (msg.message) alert(msg.message);
      break;
  }
}

// ---------- Agentes ----------
async function loadAgents() {
  const res = await fetch('/api/agents', { headers: { Authorization: `Bearer ${state.token}` } });
  if (res.ok) {
    state.agents = await res.json();
    renderAgents();
  }
}

function renderAgents() {
  const tbody = $('agentsTable').querySelector('tbody');
  tbody.innerHTML = '';
  $('noAgents').classList.toggle('hidden', state.agents.length > 0);
  for (const agent of state.agents) {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.textContent = agent.deviceName;

    const tdStatus = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'badge ' + (agent.online ? 'online' : 'offline');
    badge.textContent = agent.online ? 'Conectado' : 'Desconectado';
    tdStatus.appendChild(badge);

    const tdLive = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'small';
    btn.textContent = 'Ver pantalla';
    btn.disabled = !agent.online;
    btn.addEventListener('click', () => startLive(agent.id, agent.deviceName));
    tdLive.appendChild(btn);

    tr.appendChild(tdName);
    tr.appendChild(tdStatus);
    tr.appendChild(tdLive);
    tbody.appendChild(tr);
  }
}

// ---------- Reporte ----------
async function loadReport() {
  const date = $('reportDate').value || todayLocal();
  const res = await fetch(`/api/report?date=${date}`, { headers: { Authorization: `Bearer ${state.token}` } });
  if (!res.ok) return;
  const data = await res.json();
  const tbody = $('reportTable').querySelector('tbody');
  tbody.innerHTML = '';

  const rows = [];
  for (const deviceName of Object.keys(data.agents)) {
    const events = (data.agents[deviceName] || []).sort((a, b) => (a.ts < b.ts ? -1 : 1));
    const totals = new Map(); // app -> { seconds, lastTitle, detected }
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const endTs = i + 1 < events.length ? events[i + 1].ts : new Date().toISOString();
      const seconds = Math.max(0, (new Date(endTs) - new Date(ev.ts)) / 1000);
      const key = ev.detected || ev.app;
      if (!totals.has(key)) totals.set(key, { seconds: 0, lastTitle: ev.title, detected: ev.detected, app: ev.app });
      totals.get(key).seconds += seconds;
      if (ev.title) totals.get(key).lastTitle = ev.title;
    }
    for (const [app, info] of totals) {
      rows.push({ deviceName, app, detected: info.detected, seconds: info.seconds, lastTitle: info.lastTitle });
    }
  }

  $('noReport').classList.toggle('hidden', rows.length > 0);
  rows.sort((a, b) => b.seconds - a.seconds);
  for (const r of rows) {
    const tr = document.createElement('tr');
    const tdApp = document.createElement('td');
    const label = r.detected ? r.detected : `${r.app}${r.deviceName ? ` (${r.deviceName})` : ''}`;
    tdApp.textContent = label;
    const tdTime = document.createElement('td');
    tdTime.textContent = formatDuration(r.seconds);
    const tdTitle = document.createElement('td');
    tdTitle.textContent = r.lastTitle || '-';
    tr.appendChild(tdApp);
    tr.appendChild(tdTime);
    tr.appendChild(tdTitle);
    tbody.appendChild(tr);
  }
}

function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ---------- PDF ----------
function todayLocal() {
  return new Date().toLocaleDateString('en-CA');
}

async function downloadPdf(date) {
  const res = await fetch(`/api/pdf?date=${date}`, {
    headers: { Authorization: `Bearer ${state.token}` }
  });
  if (!res.ok) {
    alert('No se pudo generar el PDF de esa fecha.');
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reporte-${date}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

$('pdfTodayBtn').addEventListener('click', () => downloadPdf(todayLocal()));
$('reportDate').addEventListener('change', loadReport);
$('typingDate').addEventListener('change', loadTyping);

async function loadPdfs() {
  const res = await fetch('/api/pdfs', { headers: { Authorization: `Bearer ${state.token}` } });
  if (!res.ok) return;
  const pdfs = await res.json();
  const tbody = $('pdfTable').querySelector('tbody');
  tbody.innerHTML = '';
  $('noPdf').classList.toggle('hidden', pdfs.length > 0);
  for (const p of pdfs) {
    const tr = document.createElement('tr');
    const tdDate = document.createElement('td');
    tdDate.textContent = p.date;
    const tdBtn = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'small';
    btn.textContent = 'Descargar';
    btn.addEventListener('click', () => downloadPdf(p.date));
    tdBtn.appendChild(btn);
    tr.appendChild(tdDate);
    tr.appendChild(tdBtn);
    tbody.appendChild(tr);
  }
}

// ---------- Teclado ----------
async function loadTyping() {
  const date = $('typingDate').value || todayLocal();
  const res = await fetch(`/api/typing?date=${date}`, { headers: { Authorization: `Bearer ${state.token}` } });
  if (!res.ok) return;
  const data = await res.json();
  const tbody = $('typingTable').querySelector('tbody');
  tbody.innerHTML = '';

  const rows = [];
  for (const deviceName of Object.keys(data.agents)) {
    const events = (data.agents[deviceName] || []).sort((a, b) => (a.ts < b.ts ? -1 : 1));
    for (const ev of events.slice(-30)) {
      rows.push({ deviceName, ...ev });
    }
  }
  $('noTyping').classList.toggle('hidden', rows.length > 0);
  rows.reverse();
  for (const r of rows) {
    const tr = document.createElement('tr');
    const tdTime = document.createElement('td');
    tdTime.textContent = r.ts ? r.ts.slice(11, 19) : '-';
    const tdApp = document.createElement('td');
    if (r.detected) {
      const main = document.createElement('div');
      main.textContent = r.detected;
      const sub = document.createElement('div');
      sub.className = 'muted small-text';
      sub.textContent = r.app;
      tdApp.appendChild(main);
      tdApp.appendChild(sub);
    } else {
      tdApp.textContent = `${r.app}${r.title ? ` — ${r.title}` : ''}`;
    }
    const tdText = document.createElement('td');
    tdText.textContent = r.text || '';
    const tdBtn = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'small';
    btn.textContent = 'Ver todo';
    const key = r.detected || r.app;
    btn.addEventListener('click', () => openTypingModal(key, r.deviceName));
    tdBtn.appendChild(btn);
    tr.appendChild(tdTime);
    tr.appendChild(tdApp);
    tr.appendChild(tdText);
    tr.appendChild(tdBtn);
    tbody.appendChild(tr);
  }
}

async function openTypingModal(key, deviceName) {
  const date = $('typingDate').value || todayLocal();
  const res = await fetch(`/api/typing?date=${date}`, { headers: { Authorization: `Bearer ${state.token}` } });
  if (!res.ok) return;
  const data = await res.json();
  const events = (data.agents[deviceName] || [])
    .filter((e) => (e.detected || e.app) === key)
    .sort((a, b) => (a.ts < b.ts ? -1 : 1));

  $('typingModalTitle').textContent = `Texto completo — ${key}${deviceName ? ` (${deviceName})` : ''}`;
  const log = $('typingLog');
  log.innerHTML = '';
  if (events.length === 0) {
    log.textContent = 'Sin registros.';
  } else {
    for (const ev of events) {
      const p = document.createElement('p');
      const t = document.createElement('span');
      t.className = 'typing-time';
      const time = ev.ts ? ev.ts.slice(11, 19) : '';
      t.textContent = time ? `${time}${ev.title ? ` — ${ev.title}` : ''}: ` : '';
      p.appendChild(t);
      p.appendChild(document.createTextNode(ev.text || ''));
      log.appendChild(p);
    }
  }
  $('typingModal').classList.remove('hidden');
}

function closeTypingModal() {
  $('typingModal').classList.add('hidden');
}

$('typingModalClose').addEventListener('click', closeTypingModal);
$('typingModal').addEventListener('click', (e) => {
  if (e.target === $('typingModal')) closeTypingModal();
});

// ---------- Vista en vivo ----------
const LIVE_QUALITIES = {
  960: { frameMaxWidth: 960, frameQuality: 45 },
  1280: { frameMaxWidth: 1280, frameQuality: 70 },
  1920: { frameMaxWidth: 1920, frameQuality: 85 }
};

function currentQuality() {
  const v = parseInt($('liveQuality').value, 10);
  return LIVE_QUALITIES[v] || LIVE_QUALITIES[1920];
}

function sendLiveConfig() {
  if (!state.currentAgentId) return;
  const q = currentQuality();
  state.ws.send(JSON.stringify({ type: 'live.config', agentId: state.currentAgentId, ...q }));
}

function startLive(agentId, deviceName) {
  if (state.liveActive) closeLive();
  state.currentAgentId = agentId;
  state.liveActive = true;
  $('liveTitle').textContent = `Vista en vivo: ${deviceName}`;
  $('liveImg').src = '';
  $('liveImg').classList.add('hidden');
  $('livePlaceholder').classList.remove('hidden');
  setLiveStatus('requesting', 'solicitando permiso...');
  $('liveModal').classList.remove('hidden');
  state.ws.send(JSON.stringify({ type: 'live.start', agentId }));
  sendLiveConfig();
}

function setLiveStatus(kind, text) {
  const el = $('liveStatus');
  el.className = 'badge ' + kind;
  el.textContent = text;
}

function closeLive() {
  if (!state.liveActive) return;
  state.ws.send(JSON.stringify({ type: 'live.stop', agentId: state.currentAgentId }));
  state.liveActive = false;
  state.currentAgentId = null;
  exitFullscreen();
  $('liveModal').classList.add('hidden');
  $('liveImg').src = '';
}

function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function requestFullscreen() {
  const el = $('liveModal');
  if (el.requestFullscreen) {
    el.requestFullscreen();
  } else if (el.webkitRequestFullscreen) {
    el.webkitRequestFullscreen();
  } else {
    el.classList.add('fs-overlay');
  }
}

function exitFullscreen() {
  const el = $('liveModal');
  if (isFullscreen()) {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  }
  el.classList.remove('fs-overlay');
}

function toggleFullscreen() {
  if (isFullscreen()) exitFullscreen();
  else requestFullscreen();
}

document.addEventListener('fullscreenchange', () => {
  $('liveModal').classList.toggle('fs-overlay', isFullscreen());
});
document.addEventListener('webkitfullscreenchange', () => {
  $('liveModal').classList.toggle('fs-overlay', isFullscreen());
});

$('liveQuality').addEventListener('change', sendLiveConfig);
$('liveFullBtn').addEventListener('click', toggleFullscreen);
$('liveCloseBtn').addEventListener('click', closeLive);
