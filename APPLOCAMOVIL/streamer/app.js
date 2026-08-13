(() => {
  const video = document.getElementById('video');
  const status = document.getElementById('status');
  const overlay = document.getElementById('overlay');

  let ws = null;
  let jmuxer = null;
  let connected = false;

  // mapear coordenadas del video (objeto) a las del telefono (720x1280)
  const PHONE_W = 1264;
  const PHONE_H = 2736;

  function mapPoint(e) {
    const rect = video.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * PHONE_W;
    const y = ((e.clientY - rect.top) / rect.height) * PHONE_H;
    return { x: Math.round(x), y: Math.round(y) };
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function setStatus(text) {
    status.textContent = text;
  }

  // ---------- gestos táctiles ----------
  let touchStart = null;
  let touchTimer = null;
  let longPressFired = false;

  video.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY, ts: Date.now() };
    longPressFired = false;
    touchTimer = setTimeout(() => {
      longPressFired = true;
      // press largo: teclado o menu
      send({ type: 'key', keyCode: 4 });
    }, 800);
  }, { passive: false });

  video.addEventListener('touchmove', (e) => {
    e.preventDefault();
  }, { passive: false });

  video.addEventListener('touchend', (e) => {
    e.preventDefault();
    clearTimeout(touchTimer);
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (longPressFired) {
      touchStart = null;
      return;
    }
    if (dist > 24) {
      // swipe
      const a = mapPoint({ clientX: touchStart.x, clientY: touchStart.y });
      const b = mapPoint({ clientX: t.clientX, clientY: t.clientY });
      send({ type: 'swipe', x1: a.x, y1: a.y, x2: b.x, y2: b.y, dur: 250 });
    } else {
      // tap
      const p = mapPoint({ clientX: t.clientX, clientY: t.clientY });
      send({ type: 'tap', x: p.x, y: p.y });
    }
    touchStart = null;
  }, { passive: false });

  // ratón (PC)
  let mouseDown = false;
  let mouseStart = null;
  video.addEventListener('mousedown', (e) => {
    mouseDown = true;
    mouseStart = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('mouseup', (e) => {
    if (!mouseDown) return;
    mouseDown = false;
    const dx = e.clientX - mouseStart.x;
    const dy = e.clientY - mouseStart.y;
    if (Math.sqrt(dx * dx + dy * dy) > 24) {
      const a = mapPoint({ clientX: mouseStart.x, clientY: mouseStart.y });
      const b = mapPoint({ clientX: e.clientX, clientY: e.clientY });
      send({ type: 'swipe', x1: a.x, y1: a.y, x2: b.x, y2: b.y, dur: 250 });
    } else {
      const p = mapPoint({ clientX: e.clientX, clientY: e.clientY });
      send({ type: 'tap', x: p.x, y: p.y });
    }
  });

  // ---------- botones ----------
  document.getElementById('btnBack').addEventListener('click', () => send({ type: 'key', keyCode: 4 }));
  document.getElementById('btnHome').addEventListener('click', () => send({ type: 'key', keyCode: 3 }));
  document.getElementById('btnRecents').addEventListener('click', () => send({ type: 'key', keyCode: 187 }));
  document.getElementById('btnPower').addEventListener('click', () => send({ type: 'key', keyCode: 26 }));
  document.getElementById('btnFull').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  });

  // teclado físico: enviar texto
  let keyBuffer = '';
  let keyTimer = null;
  document.addEventListener('keydown', (e) => {
    if (e.key.length === 1) {
      keyBuffer += e.key;
      clearTimeout(keyTimer);
      keyTimer = setTimeout(() => {
        send({ type: 'text', text: keyBuffer });
        keyBuffer = '';
      }, 120);
    } else if (e.key === 'Backspace') {
      send({ type: 'key', keyCode: 67 });
    } else if (e.key === 'Enter') {
      send({ type: 'key', keyCode: 66 });
    } else if (e.key === 'Escape') {
      send({ type: 'key', keyCode: 4 });
    }
  });

  // ---------- websocket + jmuxer ----------
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(proto + '://' + location.host + '/ws');
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      connected = true;
      setStatus('conectado — esperando video');
    };

    ws.onmessage = (ev) => {
      const data = ev.data;
      if (typeof data === 'string') return;
      if (!jmuxer) {
        jmuxer = new JMuxer({
          node: 'video',
          mode: 'video',
          flushingTime: 0,
          fps: 30,
          debug: false
        });
        overlay.classList.add('hidden');
        setStatus('EN VIVO');
      }
      jmuxer.feed({ video: new Uint8Array(data) });
    };

    ws.onclose = () => {
      connected = false;
      setStatus('desconectado — reconectando...');
      setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  connect();
})();
