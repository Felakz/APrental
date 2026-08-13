(function () {
  const tokenKey = 'parent_token';
  let ws = null;
  let currentToken = null;
  let activeAgentId = 'Honor 400 (telefono)';
  let isLiveActive = false;
  let leafletMapInstance = null;
  let mapMarker = null;

  // Resolucion nativa de pantalla del Honor 400 (DNY-NX9)
  const DEVICE_WIDTH = 1264;
  const DEVICE_HEIGHT = 2736;

  // Elementos del DOM
  const loginView = document.getElementById('loginView');
  const mainView = document.getElementById('mainView');
  const loginForm = document.getElementById('loginForm');
  const passwordInput = document.getElementById('password');
  const loginError = document.getElementById('loginError');
  const logoutBtn = document.getElementById('logoutBtn');

  // Dispositivos y Control Remoto
  const agentsTable = document.getElementById('agentsTable').querySelector('tbody');
  const noAgents = document.getElementById('noAgents');
  const screenStatusBadge = document.getElementById('screenStatusBadge');
  const liveImg = document.getElementById('liveImg');
  const liveVideo = document.getElementById('liveVideo');
  const livePlaceholder = document.getElementById('livePlaceholder');
  const phoneScreenContainer = document.getElementById('phoneScreenContainer');
  const touchFeedback = document.getElementById('touchFeedback');

  // H.264 Streaming via JMuxer
  let h264Ws = null;
  let jmuxer = null;
  const STREAMER_PHONE_W = 1264;
  const STREAMER_PHONE_H = 2736;

  // Prevenir arrastre de imagen del navegador
  liveImg.setAttribute('draggable', 'false');
  liveImg.addEventListener('dragstart', (e) => e.preventDefault());

  // Botones de Mando y Navegacion
  const btnNavBack = document.getElementById('btnNavBack');
  const btnNavHome = document.getElementById('btnNavHome');
  const btnNavRecents = document.getElementById('btnNavRecents');
  const btnWake = document.getElementById('btnWake');
  const btnLock = document.getElementById('btnLock');
  const btnVolDown = document.getElementById('btnVolDown');
  const btnVolUp = document.getElementById('btnVolUp');
  const btnRequestGps = document.getElementById('btnRequestGps');
  const remoteTextInput = document.getElementById('remoteTextInput');
  const btnSendText = document.getElementById('btnSendText');

  // Fechas y Tablas
  const reportDate = document.getElementById('reportDate');
  const reportTable = document.getElementById('reportTable').querySelector('tbody');
  const noReport = document.getElementById('noReport');

  const locationDate = document.getElementById('locationDate');
  const locationTable = document.getElementById('locationTable').querySelector('tbody');
  const noLocation = document.getElementById('noLocation');

  const typingDate = document.getElementById('typingDate');
  const typingTable = document.getElementById('typingTable').querySelector('tbody');
  const noTyping = document.getElementById('noTyping');

  const pdfTodayBtn = document.getElementById('pdfTodayBtn');
  const pdfTable = document.getElementById('pdfTable').querySelector('tbody');
  const noPdf = document.getElementById('noPdf');

  const typingModal = document.getElementById('typingModal');
  const typingModalClose = document.getElementById('typingModalClose');
  const typingLog = document.getElementById('typingLog');

  function todayStr() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function initDates() {
    const t = todayStr();
    reportDate.value = t;
    locationDate.value = t;
    typingDate.value = t;
  }

  // ---------- API Helpers ----------
  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;
    const res = await fetch(path, { credentials: 'same-origin', ...options, headers });
    if (res.status === 401) {
      logout();
      throw new Error('Sesión expirada');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || 'Error del servidor');
    }
    return res.json();
  }

  // ---------- Auth & WebSocket ----------
  function showMain() {
    loginView.classList.add('hidden');
    mainView.classList.remove('hidden');
    initDates();
    initLeafletMap();
    loadAgents();
    loadAll();
    connectWs();
    connectH264();
  }

  function showLogin() {
    mainView.classList.add('hidden');
    loginView.classList.remove('hidden');
    passwordInput.value = '';
    loginError.textContent = '';
  }

  function logout() {
    sessionStorage.removeItem(tokenKey);
    currentToken = null;
    if (ws) { ws.close(); ws = null; }
    showLogin();
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    try {
      const data = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ password: passwordInput.value })
      });
      currentToken = data.token;
      sessionStorage.setItem(tokenKey, currentToken);
      showMain();
    } catch (err) {
      loginError.textContent = err.message || 'Contraseña incorrecta';
    }
  });

  logoutBtn.addEventListener('click', logout);

  function connectWs() {
    if (ws) {
      try { ws.close(); } catch (e) {}
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'panel.hello', token: currentToken }));
      ws.send(JSON.stringify({ type: 'agents.request' }));
      // Iniciar transmision automatica permanente sin requerir botones
      setTimeout(autoStartLive, 500);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        handleWsMessage(msg);
      } catch (e) {}
    };

    ws.onclose = () => {
      setTimeout(connectWs, 2000);
    };
  }

  function autoStartLive() {
    if (activeAgentId) {
      sendWs({ type: 'live.start', agentId: activeAgentId });
    }
  }

  // ---------- H.264 Streaming (JMuxer) ----------
  function isH264Active() {
    return jmuxer && liveVideo && !liveVideo.classList.contains('hidden');
  }

  function connectH264() {
    if (h264Ws && h264Ws.readyState === WebSocket.OPEN) return;
    try {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      h264Ws = new WebSocket(`${proto}//${location.host}:4001/ws`);
      h264Ws.binaryType = 'arraybuffer';

      h264Ws.onopen = () => console.log('[H264] Conectado al streamer');

      h264Ws.onmessage = (ev) => {
        const data = ev.data;
        if (typeof data === 'string') return;
        if (!jmuxer) {
          jmuxer = new JMuxer({
            node: 'liveVideo',
            mode: 'video',
            flushingTime: 0,
            fps: 30,
            debug: false
          });
          liveVideo.classList.remove('hidden');
          liveImg.classList.add('hidden');
          livePlaceholder.classList.add('hidden');
          screenStatusBadge.innerHTML = '<span class="dot"></span> H.264 en Vivo';
          screenStatusBadge.className = 'status-indicator online';
        }
        jmuxer.feed({ video: new Uint8Array(data) });
      };

      h264Ws.onclose = () => {
        console.log('[H264] Desconectado, reconectando en 3s...');
        if (jmuxer) {
          jmuxer = null;
          liveVideo.classList.add('hidden');
          if (!isLiveActive) livePlaceholder.classList.remove('hidden');
        }
        setTimeout(connectH264, 3000);
      };

      h264Ws.onerror = () => h264Ws.close();
    } catch (e) {
      console.log('[H264] Error de conexion:', e.message);
      setTimeout(connectH264, 5000);
    }
  }

  function sendH264(msg) {
    if (h264Ws && h264Ws.readyState === WebSocket.OPEN) {
      h264Ws.send(JSON.stringify(msg));
    }
  }

  function sendWs(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  function handleWsMessage(msg) {
    switch (msg.type) {
      case 'agents.updated':
        renderAgents(msg.agents);
        break;
      case 'live.requesting':
        // Streaming permanente - no mostrar estado de solicitud
        break;
      case 'live.accepted':
      case 'live.frame':
        isLiveActive = true;
        screenStatusBadge.innerHTML = `<span class="dot"></span> En Vivo Directo`;
        screenStatusBadge.className = 'status-indicator online';
        if (msg.image) {
          liveImg.src = 'data:image/jpeg;base64,' + msg.image;
        }
        livePlaceholder.classList.add('hidden');
        liveImg.classList.remove('hidden');
        break;
      case 'live.denied':
        isLiveActive = false;
        screenStatusBadge.innerHTML = '<span class="dot" style="background:#f59e0b"></span> Reconectando...';
        screenStatusBadge.className = 'status-indicator';
        liveImg.classList.add('hidden');
        liveVideo.classList.add('hidden');
        livePlaceholder.classList.remove('hidden');
        setTimeout(autoStartLive, 3000);
        break;
      case 'live.error':
        isLiveActive = false;
        screenStatusBadge.innerHTML = '<span class="dot" style="background:#ef4444"></span> Reconectando...';
        screenStatusBadge.className = 'status-indicator';
        liveImg.classList.add('hidden');
        liveVideo.classList.add('hidden');
        livePlaceholder.classList.remove('hidden');
        setTimeout(autoStartLive, 3000);
        break;
      case 'live.stopped':
        isLiveActive = false;
        liveImg.classList.add('hidden');
        livePlaceholder.classList.remove('hidden');
        setTimeout(autoStartLive, 2000);
        break;
      case 'location.updated':
        if (locationDate.value === todayStr()) {
          loadLocation();
        }
        break;
      case 'activity.updated':
        loadReport();
        break;
      case 'typing.updated':
        loadTyping();
        break;
      case 'blockedApps.updated':
        currentBlockedApps = msg.apps || [];
        renderBlockedApps(currentBlockedApps);
        loadReport();
        break;
      case 'app_blocked':
        console.warn('App bloqueada en el teléfono:', msg.app);
        break;
      case 'geofence.breach':
        if (geofenceBreachDate.value === todayStr()) loadGeofenceBreaches();
        break;
      case 'geofences.updated':
        loadGeofences();
        break;
      case 'appusage.updated':
        loadAppUsage();
        break;
      case 'error':
        console.error('[WS] Error del servidor:', msg.message);
        break;
    }
  }

  // ---------- Control Táctil y Gestos (Touch, Tap, Drag & Swipe) ----------
  let isPointerDown = false;
  let touchStartPos = null;
  let touchStartTime = 0;

  function getEventCoords(e) {
    if (e.touches && e.touches.length > 0) return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches.length > 0) return { clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY };
    return { clientX: e.clientX, clientY: e.clientY };
  }

  function getPhoneCoordinates(e) {
    const rect = phoneScreenContainer.getBoundingClientRect();
    const ev = getEventCoords(e);

    const relX = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    const relY = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));

    const activeW = isH264Active() ? STREAMER_PHONE_W : DEVICE_WIDTH;
    const activeH = isH264Active() ? STREAMER_PHONE_H : DEVICE_HEIGHT;
    const phoneX = Math.round(relX * activeW);
    const phoneY = Math.round(relY * activeH);

    return { phoneX, phoneY, clientX: ev.clientX - rect.left, clientY: ev.clientY - top };
  }

  function showTouchFeedback(x, y) {
    touchFeedback.style.left = `${x}px`;
    touchFeedback.style.top = `${y}px`;
    touchFeedback.classList.remove('hidden');
    setTimeout(() => touchFeedback.classList.add('hidden'), 300);
  }

  function onPointerDown(e) {
    e.preventDefault();
    ensureActiveAgent();
    isPointerDown = true;
    const coords = getPhoneCoordinates(e);
    touchStartPos = coords;
    touchStartTime = Date.now();
    showTouchFeedback(coords.clientX, coords.clientY);
  }

  function onPointerUp(e) {
    if (!isPointerDown || !touchStartPos) return;
    isPointerDown = false;
    ensureActiveAgent();

    const endCoords = getPhoneCoordinates(e);
    const duration = Date.now() - touchStartTime;
    const dx = endCoords.phoneX - touchStartPos.phoneX;
    const dy = endCoords.phoneY - touchStartPos.phoneY;
    const dist = Math.hypot(dx, dy);

    if (dist < 30) {
      if (isH264Active()) {
        sendH264({ type: 'tap', x: touchStartPos.phoneX, y: touchStartPos.phoneY });
      } else {
        sendWs({ type: 'input.tap', agentId: activeAgentId, x: touchStartPos.phoneX, y: touchStartPos.phoneY });
      }
    } else {
      const dur = Math.max(120, Math.min(250, duration));
      if (isH264Active()) {
        sendH264({ type: 'swipe', x1: touchStartPos.phoneX, y1: touchStartPos.phoneY, x2: endCoords.phoneX, y2: endCoords.phoneY, dur });
      } else {
        sendWs({ type: 'input.swipe', agentId: activeAgentId, x1: touchStartPos.phoneX, y1: touchStartPos.phoneY, x2: endCoords.phoneX, y2: endCoords.phoneY, duration: dur });
      }
    }
    touchStartPos = null;
  }

  // Soporte universal para Mouse y Pantallas Tactiles
  phoneScreenContainer.addEventListener('mousedown', onPointerDown);
  window.addEventListener('mouseup', onPointerUp);

  phoneScreenContainer.addEventListener('touchstart', onPointerDown, { passive: false });
  phoneScreenContainer.addEventListener('touchend', onPointerUp, { passive: false });

  function ensureActiveAgent() {
    if (!activeAgentId) {
      activeAgentId = 'Honor 400 (telefono)';
    }
  }

  function sendCommand(command) {
    if (isH264Active()) {
      const KEYCODE_MAP = { back: 4, home: 3, recents: 187, wake: 224, lock: 26, volume_up: 24, volume_down: 25 };
      const keyCode = KEYCODE_MAP[command];
      if (keyCode) sendH264({ type: 'key', keyCode });
    } else {
      sendWs({ type: 'command.send', agentId: activeAgentId, command });
    }
  }

  // ---------- Acciones de Navegación y Botones ----------
  btnNavBack.addEventListener('click', () => { ensureActiveAgent(); sendCommand('back'); });
  btnNavHome.addEventListener('click', () => { ensureActiveAgent(); sendCommand('home'); });
  btnNavRecents.addEventListener('click', () => { ensureActiveAgent(); sendCommand('recents'); });
  btnWake.addEventListener('click', () => { ensureActiveAgent(); sendCommand('wake'); });
  btnLock.addEventListener('click', () => { ensureActiveAgent(); sendCommand('lock'); });
  btnVolDown.addEventListener('click', () => { ensureActiveAgent(); sendCommand('volume_down'); });
  btnVolUp.addEventListener('click', () => { ensureActiveAgent(); sendCommand('volume_up'); });

  btnRequestGps.addEventListener('click', () => {
    ensureActiveAgent();
    sendWs({ type: 'command.send', agentId: activeAgentId, command: 'request_location' });
    btnRequestGps.style.filter = 'brightness(1.5)';
    setTimeout(() => { btnRequestGps.style.filter = ''; }, 1000);
  });

  btnSendText.addEventListener('click', () => {
    ensureActiveAgent();
    const text = remoteTextInput.value.trim();
    if (!text) return;
    if (isH264Active()) {
      for (const ch of text) {
        const code = ch === ' ' ? 62 : (ch === '@' ? 77 : (ch === '.' ? 55 : (ch.toUpperCase().charCodeAt(0) - 65 + 29)));
        sendH264({ type: 'key', keyCode: code });
      }
    } else {
      sendWs({ type: 'input.text', agentId: activeAgentId, text });
    }
    remoteTextInput.value = '';
  });

  remoteTextInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnSendText.click();
  });

  // Teclado Numérico y Botones de Control
  document.querySelectorAll('.numpad-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      ensureActiveAgent();
      const key = e.currentTarget.getAttribute('data-key');
      if (!key) return;
      if (isH264Active()) {
        const KEYCODE_MAP = { '0': 7, '1': 8, '2': 9, '3': 10, '4': 11, '5': 12, '6': 13, '7': 14, '8': 15, '9': 16, 'KEYCODE_DEL': 67, 'KEYCODE_SPACE': 62, 'KEYCODE_ENTER': 66 };
        const kc = KEYCODE_MAP[key];
        if (kc) sendH264({ type: 'key', keyCode: kc });
      } else {
        if (key.startsWith('KEYCODE_')) {
          sendWs({ type: 'input.key', agentId: activeAgentId, key });
        } else {
          sendWs({ type: 'input.text', agentId: activeAgentId, text: key });
        }
      }
      btn.style.transform = 'scale(0.92)';
      setTimeout(() => { btn.style.transform = ''; }, 120);
    });
  });

  // ---------- Carga y Renderizado de Dispositivos ----------
  async function loadAgents() {
    try {
      const list = await api('/api/agents');
      renderAgents(list);
    } catch (e) {}
  }

  function renderAgents(list) {
    agentsTable.innerHTML = '';
    if (!list || !list.length) {
      noAgents.classList.remove('hidden');
      activeAgentId = 'Honor 400 (telefono)';
      return;
    }
    noAgents.classList.add('hidden');

    list.forEach((a) => {
      if (!activeAgentId && a.online) {
        activeAgentId = a.id;
      }

      const tr = document.createElement('tr');
      const last = a.lastSeen ? new Date(a.lastSeen).toLocaleTimeString() : '—';
      const statusPill = a.online 
        ? `<span class="status-indicator online"><span class="dot"></span> Conectado</span>`
        : `<span class="status-indicator"><span class="dot" style="background:#ef4444"></span> Desconectado</span>`;

      tr.innerHTML = `
        <td><strong>📱 ${a.deviceName || a.id}</strong></td>
        <td>${statusPill}</td>
        <td>${last}</td>
        <td>
          <button class="btn-secondary select-agent-btn" data-id="${a.id}">
            ${activeAgentId === a.id ? '⭐ En Control' : 'Seleccionar'}
          </button>
        </td>
      `;
      agentsTable.appendChild(tr);
    });

    document.querySelectorAll('.select-agent-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        activeAgentId = e.currentTarget.getAttribute('data-id');
        autoStartLive();
        loadAll();
      });
    });
  }

  // ---------- Mapa Interactivo Leaflet ----------
  let mapPolyline = null;
  let accuracyCircle = null;

  function initLeafletMap() {
    if (leafletMapInstance) return;
    const mapEl = document.getElementById('leafletMap');
    if (!mapEl) return;

    leafletMapInstance = L.map('leafletMap').setView([-12.0464, -77.0428], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(leafletMapInstance);
  }

  function updateMapLocation(lat, lon, accuracy, historyList = []) {
    if (!leafletMapInstance) initLeafletMap();
    if (!lat || !lon) return;

    leafletMapInstance.setView([lat, lon], 16);
    if (mapMarker) {
      mapMarker.setLatLng([lat, lon]);
    } else {
      mapMarker = L.marker([lat, lon]).addTo(leafletMapInstance);
    }
    const acc = Math.round(accuracy || 15);
    mapMarker.bindPopup(`<b>📍 Honor 400 (Posición Satelital)</b><br>Coordenadas: <code>${lat.toFixed(5)}, ${lon.toFixed(5)}</code><br>Margen: ±${acc} m`).openPopup();

    if (accuracyCircle) {
      accuracyCircle.setLatLng([lat, lon]).setRadius(acc);
    } else {
      accuracyCircle = L.circle([lat, lon], { radius: acc, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.15 }).addTo(leafletMapInstance);
    }

    if (historyList && historyList.length > 1) {
      const latLngs = historyList.map((p) => [p.lat, p.lon]);
      if (mapPolyline) {
        mapPolyline.setLatLngs(latLngs);
      } else {
        mapPolyline = L.polyline(latLngs, { color: '#3b82f6', weight: 4, opacity: 0.8 }).addTo(leafletMapInstance);
      }
    }
  }

  // ---------- Carga de Datos y Reportes ----------
  let currentBlockedApps = [];

  async function loadBlockedApps() {
    try {
      currentBlockedApps = await api('/api/blocked_apps');
      renderBlockedApps(currentBlockedApps);
    } catch (e) {}
  }

  function renderBlockedApps(list) {
    const tbody = document.getElementById('blockedAppsList');
    const emptyState = document.getElementById('noBlockedApps');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!list || !list.length) {
      if (emptyState) emptyState.classList.remove('hidden');
      return;
    }
    if (emptyState) emptyState.classList.add('hidden');
    list.forEach((app) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>🚫 ${app}</strong></td>
        <td><span class="badge-tag" style="background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid #ef4444;">Bloqueada</span></td>
        <td>
          <button class="btn-secondary unblock-btn" data-app="${app}" style="padding: 4px 10px; font-size: 11px;">
            ✅ Desbloquear
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.querySelectorAll('.unblock-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const app = e.currentTarget.getAttribute('data-app');
        try {
          await api(`/api/blocked_apps/${encodeURIComponent(app)}`, { method: 'DELETE' });
          await loadBlockedApps();
          loadReport();
        } catch (err) {
          alert('Error desbloqueando app: ' + err.message);
        }
      });
    });
  }

  const btnAddBlockApp = document.getElementById('btnAddBlockApp');
  const customBlockAppInput = document.getElementById('customBlockAppInput');
  if (btnAddBlockApp && customBlockAppInput) {
    btnAddBlockApp.addEventListener('click', async () => {
      const app = customBlockAppInput.value.trim();
      if (!app) return;
      try {
        await api('/api/blocked_apps', {
          method: 'POST',
          body: JSON.stringify({ app })
        });
        customBlockAppInput.value = '';
        await loadBlockedApps();
        loadReport();
      } catch (err) {
        alert('Error bloqueando app: ' + err.message);
      }
    });
  }

  async function loadReport() {
    try {
      const data = await api(`/api/activity?date=${reportDate.value}`);
      reportTable.innerHTML = '';
      let total = 0;

      for (const [dev, list] of Object.entries(data)) {
        // Agrupar eventos por app y calcular duracion real
        const appMap = {};
        list.forEach((item) => {
          const app = item.app || 'desconocido';
          if (!appMap[app]) appMap[app] = [];
          appMap[app].push(item);
        });

        // Calcular duracion por app (suma de gaps entre eventos consecutivos)
        const aggregated = Object.entries(appMap).map(([app, events]) => {
          events.sort((a, b) => new Date(a.ts) - new Date(b.ts));
          let durationMs = 0;
          for (let i = 1; i < events.length; i++) {
            const gap = new Date(events[i].ts) - new Date(events[i - 1].ts);
            if (gap < 300000) durationMs += gap; // ignorar gaps >5min (app en background)
          }
          // Si hay un solo evento, estimar 5s de uso
          if (events.length === 1) durationMs = 5000;
          return { app, durationSec: Math.round(durationMs / 1000), count: events.length };
        });

        aggregated.sort((a, b) => b.durationSec - a.durationSec);

        aggregated.forEach((item) => {
          total++;
          const tr = document.createElement('tr');
          const mins = Math.round(item.durationSec / 60);
          const isBlocked = currentBlockedApps.includes(item.app);
          const blockBtnHtml = isBlocked
            ? `<button class="btn-secondary toggle-block-btn" data-app="${item.app}" data-action="unblock" style="padding:4px 8px; font-size:11px; color:#10b981;">✅ Desbloquear</button>`
            : `<button class="btn-action danger toggle-block-btn" data-app="${item.app}" data-action="block" style="padding:4px 8px; font-size:11px;">🚫 Bloquear</button>`;

          tr.innerHTML = `
            <td><strong>${item.app}</strong></td>
            <td><span class="badge-tag">${mins} min (${item.durationSec}s)</span></td>
            <td>${blockBtnHtml}</td>
          `;
          reportTable.appendChild(tr);
        });
      }
      noReport.classList.toggle('hidden', total > 0);

      document.querySelectorAll('.toggle-block-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const app = e.currentTarget.getAttribute('data-app');
          const action = e.currentTarget.getAttribute('data-action');
          try {
            if (action === 'block') {
              await api('/api/blocked_apps', { method: 'POST', body: JSON.stringify({ app }) });
            } else {
              await api(`/api/blocked_apps/${encodeURIComponent(app)}`, { method: 'DELETE' });
            }
            await loadBlockedApps();
            loadReport();
          } catch (err) {
            alert('Error modificando estado de la app: ' + err.message);
          }
        });
      });
    } catch (e) {}
  }

  async function loadLocation() {
    try {
      const data = await api(`/api/location?date=${locationDate.value}`);
      locationTable.innerHTML = '';
      let total = 0;
      let latest = null;
      let allPoints = [];

      for (const [dev, list] of Object.entries(data)) {
        allPoints = list;
        // Filtrar puntos duplicados consecutivos para mostrar una tabla limpia y util
        const filtered = [];
        list.forEach((loc) => {
          const prev = filtered[filtered.length - 1];
          if (!prev || Math.abs(prev.lat - loc.lat) > 0.0001 || Math.abs(prev.lon - loc.lon) > 0.0001) {
            filtered.push(loc);
          } else {
            // Actualizar la hora mas reciente de esa misma ubicacion
            prev.ts = loc.ts;
          }
        });

        filtered.slice().reverse().forEach((loc) => {
          total++;
          if (!latest) latest = loc;
          const tr = document.createElement('tr');
          const time = loc.ts ? new Date(loc.ts).toLocaleTimeString() : '—';
          const acc = Math.round(loc.accuracy || 10);
          tr.innerHTML = `
            <td>${time}</td>
            <td>${dev}</td>
            <td><code>${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}</code></td>
            <td><span class="badge-tag">±${acc} m</span></td>
            <td>
              <button class="btn-secondary center-map-btn" data-lat="${loc.lat}" data-lon="${loc.lon}" data-acc="${acc}" style="padding:4px 10px; font-size:11px; margin-right:6px;">🎯 Centrar</button>
              <a href="https://maps.google.com/?q=${loc.lat},${loc.lon}" target="_blank" class="btn-secondary" style="padding:4px 10px; font-size:11px;">Google Maps ↗</a>
            </td>
          `;
          locationTable.appendChild(tr);
        });
      }

      noLocation.classList.toggle('hidden', total > 0);
      if (latest) {
        updateMapLocation(latest.lat, latest.lon, latest.accuracy, allPoints);
      }

      document.querySelectorAll('.center-map-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const lat = parseFloat(e.currentTarget.getAttribute('data-lat'));
          const lon = parseFloat(e.currentTarget.getAttribute('data-lon'));
          const acc = parseFloat(e.currentTarget.getAttribute('data-acc'));
          updateMapLocation(lat, lon, acc, allPoints);
          document.getElementById('leafletMap').scrollIntoView({ behavior: 'smooth' });
        });
      });
    } catch (e) {}
  }

  async function loadTyping() {
    try {
      const data = await api(`/api/typing?date=${typingDate.value}`);
      typingTable.innerHTML = '';
      let total = 0;
      for (const [dev, list] of Object.entries(data)) {
        list.slice().reverse().forEach((item) => {
          total++;
          const tr = document.createElement('tr');
          const time = item.ts ? item.ts.slice(11, 19) : '—';
          const preview = item.text.length > 90 ? item.text.slice(0, 90) + '...' : item.text;
          tr.innerHTML = `
            <td>${time}</td>
            <td><span class="badge-tag">${item.app}</span></td>
            <td style="font-family:monospace; color:#60a5fa;">${escapeHtml(preview)}</td>
          `;
          tr.addEventListener('click', () => {
            typingModalTitle.textContent = `${item.app} (${time})`;
            typingLog.textContent = item.text;
            typingModal.classList.remove('hidden');
          });
          typingTable.appendChild(tr);
        });
      }
      noTyping.classList.toggle('hidden', total > 0);
    } catch (e) {}
  }

  async function loadPdfs() {
    try {
      const list = await api('/api/pdfs');
      pdfTable.innerHTML = '';
      noPdf.classList.toggle('hidden', list.length > 0);
      list.forEach((item) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>📅 Reporte del ${item.date}</strong></td>
          <td><a href="/api/pdf/${item.date}" class="btn-secondary" style="padding:6px 14px;" download>Descargar PDF</a></td>
        `;
        pdfTable.appendChild(tr);
      });
    } catch (e) {}
  }

  // ---------- Geocercas ----------
  const geofenceName = document.getElementById('geofenceName');
  const geofenceLat = document.getElementById('geofenceLat');
  const geofenceLon = document.getElementById('geofenceLon');
  const geofenceRadius = document.getElementById('geofenceRadius');
  const btnAddGeofence = document.getElementById('btnAddGeofence');
  const geofenceList = document.getElementById('geofenceList');
  const noGeofences = document.getElementById('noGeofences');
  const geofenceBreachDate = document.getElementById('geofenceBreachDate');
  const geofenceBreachList = document.getElementById('geofenceBreachList');
  const noGeofenceBreaches = document.getElementById('noGeofenceBreaches');

  async function loadGeofences() {
    try {
      const zones = await api('/api/geofences');
      geofenceList.innerHTML = '';
      if (!zones || !zones.length) {
        noGeofences.classList.remove('hidden');
        return;
      }
      noGeofences.classList.add('hidden');
      zones.forEach((z, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>📍 ${escapeHtml(z.name)}</strong></td>
          <td><code>${z.lat.toFixed(5)}, ${z.lon.toFixed(5)}</code></td>
          <td><span class="badge-tag">±${z.radius}m</span></td>
          <td>—</td>
          <td>
            <button class="btn-secondary delete-geofence-btn" data-id="${z.id || i}" style="padding:4px 10px; font-size:11px; color:#ef4444;">🗑️ Eliminar</button>
          </td>
        `;
        geofenceList.appendChild(tr);
      });
      document.querySelectorAll('.delete-geofence-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          try {
            await api(`/api/geofences/${encodeURIComponent(id)}`, { method: 'DELETE' });
            loadGeofences();
          } catch (err) { alert('Error: ' + err.message); }
        });
      });
    } catch (e) {}
  }

  if (btnAddGeofence) {
    btnAddGeofence.addEventListener('click', async () => {
      const name = geofenceName.value.trim();
      const lat = parseFloat(geofenceLat.value);
      const lon = parseFloat(geofenceLon.value);
      const radius = parseFloat(geofenceRadius.value) || 100;
      if (!name || isNaN(lat) || isNaN(lon)) {
        alert('Completa nombre, latitud y longitud');
        return;
      }
      try {
        await api('/api/geofences', {
          method: 'POST',
          body: JSON.stringify({ name, lat, lon, radius })
        });
        geofenceName.value = '';
        geofenceLat.value = '';
        geofenceLon.value = '';
        geofenceRadius.value = '100';
        loadGeofences();
      } catch (err) { alert('Error: ' + err.message); }
    });
  }

  async function loadGeofenceBreaches() {
    try {
      const data = await api(`/api/geofence_breach?date=${geofenceBreachDate.value}`);
      geofenceBreachList.innerHTML = '';
      let total = 0;
      for (const [dev, list] of Object.entries(data)) {
        list.slice().reverse().forEach((item) => {
          total++;
          const tr = document.createElement('tr');
          const time = item.ts ? new Date(item.ts).toLocaleTimeString() : '—';
          const action = item.action === 'enter' ? '🟢 Entró' : '🔴 Salió';
          tr.innerHTML = `
            <td>${time}</td>
            <td><span class="badge-tag">${escapeHtml(item.zone)}</span></td>
            <td>${action}</td>
            <td><code>${item.lat ? item.lat.toFixed(5) : '—'}, ${item.lon ? item.lon.toFixed(5) : '—'}</code></td>
            <td><span class="badge-tag">${item.distance ? Math.round(item.distance) + 'm' : '—'}</span></td>
          `;
          geofenceBreachList.appendChild(tr);
        });
      }
      noGeofenceBreaches.classList.toggle('hidden', total > 0);
    } catch (e) {}
  }

  // ---------- Uso de Apps (UsageStats) ----------
  async function loadAppUsage() {
    try {
      const data = await api(`/api/appusage?date=${reportDate.value}`);
      // Merge con datos de activity si existen
      const existingApps = {};
      for (const [dev, list] of Object.entries(data)) {
        list.forEach((item) => {
          const app = item.app || 'desconocido';
          if (!existingApps[app]) existingApps[app] = 0;
          existingApps[app] += item.durationMs || 0;
        });
      }
      // Actualizar tabla de reporte si tiene datos de UsageStats
      if (Object.keys(existingApps).length > 0) {
        const rows = reportTable.querySelectorAll('tr');
        rows.forEach((row) => {
          const appName = row.querySelector('strong');
          if (appName) {
            const name = appName.textContent.trim();
            const ms = existingApps[name];
            if (ms) {
              const badge = row.querySelector('.badge-tag');
              if (badge) {
                const mins = Math.round(ms / 60000);
                const secs = Math.round((ms % 60000) / 1000);
                badge.textContent = `${mins} min (${secs}s)`;
              }
            }
          }
        });
      }
    } catch (e) {}
  }

  pdfTodayBtn.addEventListener('click', () => {
    window.open(`/api/pdf/${todayStr()}`, '_blank');
  });

  typingModalClose.addEventListener('click', () => {
    typingModal.classList.add('hidden');
  });

  reportDate.addEventListener('change', loadReport);
  locationDate.addEventListener('change', loadLocation);
  typingDate.addEventListener('change', loadTyping);
  if (geofenceBreachDate) geofenceBreachDate.addEventListener('change', loadGeofenceBreaches);

  function escapeHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---------- Centro de Desbloqueo: PIN / Patrón / QWERTY ----------
  const unlockOverlay = document.getElementById('unlockOverlay');
  const pinPadToggle = document.getElementById('pinPadToggle');
  const pinPadClose = document.getElementById('pinPadClose');
  const pinDots = document.getElementById('pinDots');
  const btnAutoUnlock = document.getElementById('btnAutoUnlock');
  const btnKeepAwake = document.getElementById('btnKeepAwake');
  const patternGrid = document.getElementById('patternGrid');
  const patternSequence = document.getElementById('patternSequence');
  const patternClear = document.getElementById('patternClear');
  const patternConfirm = document.getElementById('patternConfirm');
  const qwertyInput = document.getElementById('qwertyInput');

  let currentMode = 'pin';
  let pinBuffer = [];
  let patternBuffer = [];
  let qwertyShift = false;
  const PIN_MAX = 12;

  const DIGIT_TO_KEYCODE = {
    '0': 'KEYCODE_0', '1': 'KEYCODE_1', '2': 'KEYCODE_2',
    '3': 'KEYCODE_3', '4': 'KEYCODE_4', '5': 'KEYCODE_5',
    '6': 'KEYCODE_6', '7': 'KEYCODE_7', '8': 'KEYCODE_8',
    '9': 'KEYCODE_9'
  };

  const CHAR_TO_KEYCODE = {};
  'abcdefghijklmnopqrstuvwxyz'.split('').forEach((c) => {
    CHAR_TO_KEYCODE[c] = 'KEYCODE_' + c.toUpperCase();
  });
  CHAR_TO_KEYCODE[' '] = 'KEYCODE_SPACE';
  CHAR_TO_KEYCODE['.'] = 'KEYCODE_PERIOD';
  CHAR_TO_KEYCODE['@'] = 'KEYCODE_AT';

  const PATTERN_COORDS = {
    '1': { x: 420, y: 800 },  '2': { x: 632, y: 800 },  '3': { x: 844, y: 800 },
    '4': { x: 420, y: 1200 }, '5': { x: 632, y: 1200 }, '6': { x: 844, y: 1200 },
    '7': { x: 420, y: 1600 }, '8': { x: 632, y: 1600 }, '9': { x: 844, y: 1600 }
  };

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ---- Tabs de modo ----
  document.querySelectorAll('.unlock-tab').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      const mode = e.currentTarget.getAttribute('data-mode');
      if (mode === currentMode) return;
      currentMode = mode;
      document.querySelectorAll('.unlock-tab').forEach(t => t.classList.remove('active'));
      e.currentTarget.classList.add('active');
      document.querySelectorAll('.unlock-mode').forEach(m => {
        m.classList.add('hidden');
        m.classList.remove('active');
      });
      const target = document.getElementById('mode' + mode.charAt(0).toUpperCase() + mode.slice(1));
      if (target) { target.classList.remove('hidden'); target.classList.add('active'); }
    });
  });

  // ---- MODO PIN ----
  function updatePinDisplay() {
    if (pinDots) pinDots.textContent = pinBuffer.map(() => '●').join('');
  }

  // Coordenadas de los botones del PIN en Honor 400 (1264x2736)
  const PIN_COORDS = {
    '1': { x: 354, y: 1231 }, '2': { x: 632, y: 1231 }, '3': { x: 910, y: 1231 },
    '4': { x: 354, y: 1532 }, '5': { x: 632, y: 1532 }, '6': { x: 910, y: 1532 },
    '7': { x: 354, y: 1833 }, '8': { x: 632, y: 1833 }, '9': { x: 910, y: 1833 },
    '0': { x: 632, y: 2134 }
  };

  function pinSendKey(value) {
    ensureActiveAgent();
    if (value === 'back') {
      if (pinBuffer.length > 0) {
        pinBuffer.pop();
        updatePinDisplay();
        sendWs({ type: 'input.key', agentId: activeAgentId, key: 'KEYCODE_DEL' });
      }
    } else if (value === 'enter') {
      sendWs({ type: 'input.tap', agentId: activeAgentId, x: 910, y: 2650 });
      setTimeout(() => { pinBuffer = []; updatePinDisplay(); }, 300);
    } else if (/^[0-9]$/.test(value) && pinBuffer.length < PIN_MAX) {
      pinBuffer.push(value);
      updatePinDisplay();
      const coord = PIN_COORDS[value];
      if (coord) {
        sendWs({ type: 'input.tap', agentId: activeAgentId, x: coord.x, y: coord.y });
      } else {
        sendWs({ type: 'input.key', agentId: activeAgentId, key: DIGIT_TO_KEYCODE[value] });
      }
    }
  }

  document.querySelectorAll('.pin-key').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const val = e.currentTarget.getAttribute('data-pin');
      if (val) pinSendKey(val);
      btn.style.transform = 'scale(0.9)';
      setTimeout(() => { btn.style.transform = ''; }, 100);
    });
  });

  // ---- MODO PATRÓN 3x3 ----
  function updatePatternDisplay() {
    if (patternSequence) {
      patternSequence.textContent = patternBuffer.length > 0
        ? 'Patrón: ' + patternBuffer.join(' → ')
        : 'Toca los puntos en orden';
    }
  }

  if (patternGrid) {
    patternGrid.querySelectorAll('.pattern-dot').forEach((dot) => {
      dot.addEventListener('click', (e) => {
        const num = e.currentTarget.getAttribute('data-dot');
        if (!patternBuffer.includes(num)) {
          patternBuffer.push(num);
          e.currentTarget.classList.add('selected');
          updatePatternDisplay();
          const coord = PATTERN_COORDS[num];
          if (coord) {
            sendWs({ type: 'input.tap', agentId: activeAgentId, x: coord.x, y: coord.y });
          }
        }
      });
    });
  }

  if (patternClear) {
    patternClear.addEventListener('click', () => {
      patternBuffer = [];
      if (patternGrid) patternGrid.querySelectorAll('.pattern-dot').forEach(d => d.classList.remove('selected'));
      updatePatternDisplay();
    });
  }

  if (patternConfirm) {
    patternConfirm.addEventListener('click', () => {
      if (patternBuffer.length < 4) { alert('Dibuja al menos 4 puntos'); return; }
      sendWs({ type: 'input.key', agentId: activeAgentId, key: 'KEYCODE_ENTER' });
      setTimeout(() => {
        patternBuffer = [];
        if (patternGrid) patternGrid.querySelectorAll('.pattern-dot').forEach(d => d.classList.remove('selected'));
        updatePatternDisplay();
      }, 500);
    });
  }

  // ---- MODO QWERTY ----
  function qwertySendChar(char) {
    ensureActiveAgent();
    if (char === 'back') {
      sendWs({ type: 'input.key', agentId: activeAgentId, key: 'KEYCODE_DEL' });
      if (qwertyInput) qwertyInput.value = qwertyInput.value.slice(0, -1);
    } else if (char === 'enter') {
      sendWs({ type: 'input.key', agentId: activeAgentId, key: 'KEYCODE_ENTER' });
      if (qwertyInput) qwertyInput.value = '';
    } else if (char === 'space') {
      sendWs({ type: 'input.key', agentId: activeAgentId, key: 'KEYCODE_SPACE' });
      if (qwertyInput) qwertyInput.value += ' ';
    } else if (char === 'shift') {
      qwertyShift = !qwertyShift;
      document.querySelectorAll('.qwerty-key[data-key="shift"]').forEach(k => k.classList.toggle('active', qwertyShift));
    } else if (CHAR_TO_KEYCODE[char.toLowerCase()]) {
      const toSend = qwertyShift ? char.toUpperCase() : char.toLowerCase();
      sendWs({ type: 'input.key', agentId: activeAgentId, key: CHAR_TO_KEYCODE[toSend.toLowerCase()] });
      if (qwertyInput) qwertyInput.value += toSend;
      if (qwertyShift && /^[a-zA-Z]$/.test(char)) {
        qwertyShift = false;
        document.querySelectorAll('.qwerty-key[data-key="shift"]').forEach(k => k.classList.remove('active'));
      }
    } else {
      sendWs({ type: 'input.key', agentId: activeAgentId, key: 'KEYCODE_' + char.toUpperCase() });
      if (qwertyInput) qwertyInput.value += char;
    }
  }

  document.querySelectorAll('.qwerty-key').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const key = e.currentTarget.getAttribute('data-key');
      if (key) qwertySendChar(key);
      btn.style.transform = 'scale(0.9)';
      setTimeout(() => { btn.style.transform = ''; }, 100);
    });
  });

  if (qwertyInput) {
    qwertyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); qwertySendChar('enter'); }
      else if (e.key === 'Backspace') { qwertySendChar('back'); }
    });
  }

  // ---- Desbloqueo Automático ----
  async function autoUnlock() {
    ensureActiveAgent();
    const pin = prompt('Ingresa el PIN del telefono (solo numeros):');
    if (!pin || !/^\d{4,12}$/.test(pin)) {
      if (pin !== null) alert('PIN invalido. Usa solo numeros (4-12 digitos).');
      return;
    }
    // 1. Despertar pantalla
    sendWs({ type: 'command.send', agentId: activeAgentId, command: 'wake' });
    sendWs({ type: 'input.key', agentId: activeAgentId, key: 'KEYCODE_WAKEUP' });
    await sleep(1200);
    // 2. Swipe arriba para llegar al PIN pad
    sendWs({ type: 'input.swipe', agentId: activeAgentId, x1: 632, y1: 2600, x2: 632, y2: 600, duration: 500 });
    await sleep(1200);
    // 3. Tocar cada digito en sus coordenadas exactas
    for (const digit of pin) {
      const coord = PIN_COORDS[digit];
      if (coord) {
        sendWs({ type: 'input.tap', agentId: activeAgentId, x: coord.x, y: coord.y });
      }
      await sleep(250);
    }
    await sleep(500);
    // 4. Tocar Enter (boton Volver/OK en la parte inferior)
    sendWs({ type: 'input.tap', agentId: activeAgentId, x: 910, y: 2650 });
    pinBuffer = pin.split('');
    updatePinDisplay();
  }

  // ---- Abrir / Cerrar Overlay ----
  if (pinPadToggle) {
    pinPadToggle.addEventListener('click', () => {
      unlockOverlay.classList.toggle('hidden');
      pinPadToggle.classList.toggle('active');
      if (!unlockOverlay.classList.contains('hidden')) {
        pinBuffer = []; patternBuffer = [];
        updatePinDisplay(); updatePatternDisplay();
        if (patternGrid) patternGrid.querySelectorAll('.pattern-dot').forEach(d => d.classList.remove('selected'));
        if (qwertyInput) qwertyInput.value = '';
      }
    });
  }

  if (pinPadClose) {
    pinPadClose.addEventListener('click', () => {
      unlockOverlay.classList.add('hidden');
      pinPadToggle.classList.remove('active');
    });
  }

  if (btnAutoUnlock) btnAutoUnlock.addEventListener('click', autoUnlock);

  if (btnKeepAwake) {
    btnKeepAwake.addEventListener('click', () => {
      ensureActiveAgent();
      sendWs({ type: 'command.send', agentId: activeAgentId, command: 'keep_awake' });
      btnKeepAwake.classList.toggle('active');
    });
  }

  function loadAll() {
    loadAgents();
    loadBlockedApps();
    loadReport();
    loadLocation();
    loadTyping();
    loadPdfs();
    loadGeofences();
  }

  // ---------- Fullscreen Mode (mobile) ----------
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
        document.body.classList.add('fullscreen-mode');
        fullscreenBtn.textContent = '✕';
      } else {
        document.exitFullscreen();
        document.body.classList.remove('fullscreen-mode');
        fullscreenBtn.textContent = '⛶';
      }
    });
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) {
        document.body.classList.remove('fullscreen-mode');
        fullscreenBtn.textContent = '⛶';
      }
    });
  }

  // Auto-login con token existente
  const savedToken = sessionStorage.getItem(tokenKey);
  if (savedToken) {
    currentToken = savedToken;
    showMain();
  } else {
    showLogin();
  }
})();
