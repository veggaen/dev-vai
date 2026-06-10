#!/usr/bin/env node
/**
 * Direct local client for the fast Grok <-> Vai channel (127.0.0.1:48765).
 *
 * This is the "better and faster" same-machine channel:
 * - Raw TCP to private port (no main server auth/HTTP/WS overhead).
 * - Still uses full real ChatService inside Vai — all intelligence, voice handling,
 *   compounds, context, actions, etc.
 * - From this Grok window (grok.exe), connect, send, get streamed response.
 *
 * Responses appear here in the tool output — "as if Vai wrote in this input/window".
 *
 * Usage:
 *   node scripts/vai-direct-client.mjs "Hi Vai, real conversation over direct channel..."
 */

import * as net from 'node:net';

const HOST = '127.0.0.1';
const PORT = 48765;

const message = process.argv[2];
if (!message) {
  console.error('Usage: node scripts/vai-direct-client.mjs "your message" [convId]');
  process.exit(1);
}
const conversationId = process.argv[3] || `grok-direct-${Date.now()}`;

// Length-prefixed framing (explicit protocol, robust, andrewrk p2p/explicit-Io inspired).
function sendFramed(sock, obj) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  const hdr = Buffer.allocUnsafe(4);
  hdr.writeUInt32BE(payload.length, 0);
  sock.write(hdr);
  sock.write(payload);
}

let recvBuf = Buffer.alloc(0);
function handleFramedData(chunk, onMsg) {
  recvBuf = Buffer.concat([recvBuf, chunk]);
  while (recvBuf.length >= 4) {
    const len = recvBuf.readUInt32BE(0);
    if (recvBuf.length < 4 + len) break;
    const pay = recvBuf.subarray(4, 4 + len);
    recvBuf = recvBuf.subarray(4 + len);
    let m;
    try { m = JSON.parse(pay.toString('utf8')); } catch { continue; }
    onMsg(m);
  }
}

const socket = net.connect({ host: HOST, port: PORT }, () => {
  sendFramed(socket, { type: 'message', conversationId, content: message });
});

let full = '';
socket.on('data', (chunk) => {
  handleFramedData(chunk, (m) => {
    if (m.type === 'delta' && m.textDelta) {
      full += m.textDelta;
      process.stdout.write(m.textDelta);
    } else if (m.type === 'done') {
      console.log('\n--- (via direct local channel) ---');
      socket.end();
    } else if (m.type === 'error') {
      console.error('\n[error]', m.error);
      socket.end();
    }
  });
});

socket.on('error', (e) => {
  console.error('Direct channel connect failed. Is Vai running with the direct listener active?', e.message);
  process.exit(1);
});