const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:4001/ws');
let bytes = 0;
let msgs = 0;
const start = Date.now();

ws.on('open', () => console.log('conectado'));

ws.on('message', (data) => {
  if (typeof data === 'string') return;
  bytes += data.byteLength || data.length || 0;
  msgs++;
});

setInterval(() => {
  const secs = (Date.now() - start) / 1000;
  console.log(`[${secs.toFixed(1)}s] mensajes=${msgs} bytes=${(bytes/1024).toFixed(1)}KB velocidad=${((bytes/1024)/secs).toFixed(1)}KB/s`);
  if (secs > 12) {
    console.log(bytes > 200000 ? 'STREAMER OK: video H.264 fluyendo' : 'STREAMER PARCIAL/LENTO: pocos bytes');
    ws.close();
    process.exit(0);
  }
}, 2000);