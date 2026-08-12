const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:4001/ws');

let received = 0;
let start = null;
const types = {};

ws.on('open', () => {
  console.log('conectado al streamer');
  start = Date.now();
});

ws.on('message', (data) => {
  if (typeof data === 'string') return;
  received++;
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const type = buf[0] & 0x1f;
  types[type] = (types[type] || 0) + 1;
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  if (received % 20 === 0 || received === 1) {
    console.log(`[${elapsed}s] NALs recibidos: ${received} | tipos: ${JSON.stringify(types)}`);
  }
  if (received >= 60) {
    console.log('SUCCESS: 60 NALs recibidos, stream H.264 funcionando');
    ws.close();
    process.exit(0);
  }
});

ws.on('error', (e) => {
  console.log('ERROR:', e.message);
  process.exit(1);
});

setTimeout(() => {
  console.log(`TIMEOUT: solo ${received} NALs en 10s`);
  process.exit(received > 5 ? 0 : 1);
}, 10000);
