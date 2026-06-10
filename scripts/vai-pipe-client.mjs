#!/usr/bin/env node
/**
 * Lightweight client for the direct Windows Named Pipe channel to Vai.
 *
 * Connects to \\.\pipe\vai-grok-direct (the fast local IPC we added to runtime).
 * Sends a chat message, streams deltas back, prints full response + meta.
 *
 * This is the "better and faster channel" — no full HTTP/WS server dance,
 * no auth, kernel IPC, low latency, same full intelligence as the real chat.
 *
 * Usage from Grok agent (this window):
 *   node scripts/vai-pipe-client.mjs "your message to Vai" [conversationId]
 *
 * For persistent friendship in the Grok session: reuse conversationId.
 * Responses come back directly here — treat as "Vai talking back to you in this input/window".
 *
 * To make even more "direct" (less script feel): the agent can keep a background
 * node process for the pipe (using monitor/background), and signal turns via
 * another lightweight mechanism, but this client is already much lighter than before.
 */

import * as net from 'node:net';

const PIPE_PATH = '\\\\.\\pipe\\vai-grok-direct';

const message = process.argv[2];
if (!message) {
  console.error('Usage: node scripts/vai-pipe-client.mjs "message to Vai" [optional-conversationId]');
  process.exit(1);
}

const conversationId = process.argv[3] || `grok-direct-${Date.now()}`;

// Length-prefixed framing (explicit, andrewrk-inspired: no hidden delimiter costs, predictable, robust for chat collab).
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
    let msg;
    try { msg = JSON.parse(pay.toString('utf8')); } catch { continue; }
    onMsg(msg);
  }
}

const socket = net.connect({ path: PIPE_PATH }, () => {
  // Send using explicit framing.
  sendFramed(socket, {
    type: 'message',
    conversationId,
    content: message,
  });
});

let fullText = '';
let meta = {};

socket.on('data', (chunk) => {
  handleFramedData(chunk, (msg) => {
    if (msg.type === 'delta' && msg.textDelta) {
      fullText += msg.textDelta;
      process.stdout.write(msg.textDelta);
    } else if (msg.type === 'thinking') {
      meta.thinking = msg;
    } else if (msg.type === 'sources') {
      meta.sources = msg.sources || [];
      meta.confidence = msg.confidence;
    } else if (msg.type === 'done') {
      meta.done = msg;
      console.log('\n--- VAI (via direct pipe) ---');
      if (meta.thinking) console.log('[strategy]', meta.thinking.strategy || meta.thinking.modelTag);
      if (meta.sources?.length) console.log('[sources]', meta.sources.length);
      socket.end();
    } else if (msg.type === 'error') {
      console.error('\n[VAI pipe error]', msg.error);
      socket.end();
    }
  });
});

socket.on('error', (err) => {
  console.error('[vai-pipe-client] Could not connect to direct pipe. Is Vai runtime running with the new local-pipe-chat listener? (start via node scripts/vai-server.mjs start or pnpm dev:web)');
  console.error('Error:', err.message);
  process.exit(1);
});

socket.on('close', () => {
  // Done.
  if (fullText) {
    // Log for the "window" history if desired.
  }
});
