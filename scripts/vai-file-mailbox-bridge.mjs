#!/usr/bin/env node
/**
 * Efficient direct "file mailbox" bridge for Grok <-> Vai local communication.
 *
 * Inspired by andrewrk / Zig philosophy (from research on codeberg.org/andrewrk, Zig std.Io, libxev, async IO, unified interfaces, direct pipes/shm for low-overhead local IPC, "don't forget to flush", explicit passed-down IO like allocators, minimal abstractions, high-perf evented comms for chat-like apps, his p2p chat experiment, DAW p2p editing):
 * - Simple, explicit, low-overhead local channel (files as "pipes"/shm for same-machine, no network stack, no auth, no server flakiness).
 * - Persistent bridge process (start once, like passing an Io instance).
 * - Polling or watch for "new message" (like event loop polling).
 * - Full real intelligence: uses the direct engine or the runtime's chatService for responses.
 * - For "real conversations": Stateful, low-latency enough for back-and-forth planning/feedback/code iteration.
 * - "Better and faster" than repeated full script spawns + TCP/WS: Just fs ops, which are direct and fast on Win10. No child spawn per message.
 * - Zig would make this even more optimal (direct shm, async with cancellation via libxev, zero-alloc), but Node fs + this bridge is practical here. Could rewrite bridge in Zig later for perf (his style: robust, optimal, clear).
 * - Supports "Grok + Vai as friends": Grok sends improvement ideas/prompts via "in" file, Vai "responds" via "out" file with plans/feedback. We iterate by editing code based on it.
 *
 * Usage:
 * - Start in background: node scripts/vai-file-mailbox-bridge.mjs (or via Grok background task / monitor for streaming "Vai responses" as events in this window).
 * - To "talk": echo 'your prompt here' > .grok-to-vai ; sleep 1; cat .vai-to-grok  (or poll the out file).
 * - Responses appear in terminal output / logs "as if Vai wrote in this input/window".
 * - Persistent conv ID for ongoing friendship chat.
 * - Bridge watches .grok-to-vai , when changed, sends to Vai (via direct port 48765 or engine), writes full response to .vai-to-grok .
 *
 * Files (in workspace root for simplicity, local only):
 * - .grok-to-vai : Grok writes prompt (with optional convId).
 * - .vai-to-grok : Bridge writes Vai's response (JSON or text + meta).
 *
 * This "connects correctly" without heavy per-turn scripts: Bridge is long-lived, comms are file "channels" (efficient local IPC per Andrew's direct/minimal style). Use for real multi-turn to improve Vai's chat intelligence, voice handling, actions, etc.
 *
 * To make even better (Zig-inspired):
 * - Use shared memory file + events instead of plain files for lower latency (Zig has great shm support, "flush" for consistency).
 * - Event loop (libxev style) for watching instead of poll.
 * - Unified "ChatIo" passed to code.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import * as net from 'node:net';

const IN_FILE = path.join(process.cwd(), '.grok-to-vai');
const OUT_FILE = path.join(process.cwd(), '.vai-to-grok');
const LOG_FILE = path.join(process.cwd(), '.vai-agent-dialogue.log');
const PIPE_PATH = '\\\\.\\pipe\\vai-grok-direct';
const DIRECT_HOST = '127.0.0.1';
const DIRECT_PORT = 48765;
const POLL_MS = 150; // tighter for responsiveness

let currentConvId = `friendship-${Date.now()}`;
let lastInMtime = 0;
let vaiSocket = null; // persistent connection to Vai's direct pipe (efficient, one node process keeps it alive like evented Io)

console.log('[vai-mailbox-bridge] Starting persistent efficient local channel (andrewrk-inspired: named pipe primary + explicit framing, long-lived like Io, file mailbox for zero-per-message node spawns from Grok side).');
console.log(`[vai-mailbox-bridge] IN=${IN_FILE} OUT=${OUT_FILE} LOG=${LOG_FILE}`);
console.log('[vai-mailbox-bridge] Launch once with background+monitor in this Grok TUI. Send with pure PowerShell (no node): Set-Content -Path .grok-to-vai -Value "your prompt"');
console.log('[vai-mailbox-bridge] Responses stream to stdout (monitor delivers as chat events) + written to out + .vai-agent-dialogue.log. Persistent conv + pipe socket.');

// Ensure files exist
fs.writeFileSync(IN_FILE, '', { flag: 'a' });
fs.writeFileSync(OUT_FILE, '', { flag: 'a' });

// Framed send/recv (length prefix) — upgraded for explicitness (research: andrewrk framing style for direct chat).
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

function logToDialogue(entry) {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch {}
}

function ensureVaiConnection() {
  if (vaiSocket && !vaiSocket.destroyed && !vaiSocket.connecting) return vaiSocket;

  let connected = false;
  // Prefer the named pipe 
  try {
    vaiSocket = net.connect({ path: PIPE_PATH });
  } catch (e) {
    try {
      vaiSocket = net.connect({ host: DIRECT_HOST, port: DIRECT_PORT });
    } catch (e2) {
      vaiSocket = null;
    }
  }

  if (vaiSocket) {
    vaiSocket.on('connect', () => { connected = true; });
    vaiSocket.on('error', (e) => {
      console.log('[vai-mailbox-bridge] Vai direct connection error (will use engine fallback this turn):', e.message);
      vaiSocket = null;
      connected = false;
    });
    vaiSocket.on('close', () => { vaiSocket = null; connected = false; });
    // Prevent listener leak on long-lived persistent socket after many council/self prompts (root cause of repeated len=9 + MaxListenersExceededWarning)
    vaiSocket.setMaxListeners(30);
  }
  return vaiSocket;
}

function doInProcessFallback(prompt, resolve) {
  (async () => {
    try {
      const mod = await import('../packages/core/src/models/vai-engine.ts');
      const engine = new mod.VaiEngine({ testMode: true });
      const res = await engine.chat({ messages: [{ role: 'user', content: prompt }], noLearn: true });
      const text = res?.message?.content || '[no content from engine]';
      const meta = { fallback: true, viaBridge: true, inProcess: true };
      const outEntry = { ts: new Date().toISOString(), prompt, response: text, meta };
      try { fs.appendFileSync(OUT_FILE, JSON.stringify(outEntry) + '\n'); } catch {}
      logToDialogue({ type: 'response', prompt, response: text, meta });
      console.log(`\n**Vai (via persistent bridge + in-process engine fallback):**\n${text}\n`);
      if (res?.meta?.thinking || meta.thinking) {
        const t = res?.meta?.thinking || meta.thinking;
        console.log(`[strategy] ${t.strategy || t.modelTag || ''}`);
      }
      resolve({ text, meta });
    } catch (e) {
      const text = '[in-process engine load error: ' + (e?.message || e) + ']';
      const meta = { fallback: true, viaBridge: true, error: String(e) };
      const outEntry = { ts: new Date().toISOString(), prompt, response: text, meta };
      try { fs.appendFileSync(OUT_FILE, JSON.stringify(outEntry) + '\n'); } catch {}
      logToDialogue({ type: 'response', prompt, response: text, meta });
      console.log(`\n**Vai (via persistent bridge + fallback error):**\n${text}\n`);
      resolve({ text, meta });
    }
  })();
}

function sendToVai(prompt) {
  return new Promise((resolve, reject) => {
    const sock = ensureVaiConnection();
    if (!sock) {
      console.log('[vai-mailbox-bridge] No direct Vai listener (pipe/TCP), using full engine fallback IN-PROCESS (no additional child node spawn - launched under tsx for direct TS import).');
      (async () => {
        try {
          const mod = await import('../packages/core/src/models/vai-engine.ts');
          const engine = new mod.VaiEngine({ testMode: true });
          const res = await engine.chat({ messages: [{ role: 'user', content: prompt }], noLearn: true });
          const text = res?.message?.content || '[no content from engine]';
          const meta = { fallback: true, viaBridge: true, inProcess: true };
          const outEntry = { ts: new Date().toISOString(), prompt, response: text, meta };
          try { fs.appendFileSync(OUT_FILE, JSON.stringify(outEntry) + '\n'); } catch {}
          logToDialogue({ type: 'response', prompt, response: text, meta });
          console.log(`\n**Vai (via persistent bridge + in-process engine fallback):**\n${text}\n`);
          resolve({ text, meta });
        } catch (e) {
          const text = '[in-process engine load error: ' + (e?.message || e) + ']';
          const meta = { fallback: true, viaBridge: true, error: String(e) };
          const outEntry = { ts: new Date().toISOString(), prompt, response: text, meta };
          try { fs.appendFileSync(OUT_FILE, JSON.stringify(outEntry) + '\n'); } catch {}
          logToDialogue({ type: 'response', prompt, response: text, meta });
          console.log(`\n**Vai (via persistent bridge + fallback error):**\n${text}\n`);
          resolve({ text, meta });
        }
      })();
      return;
    }

    // Ensure we have a permanent data pump for this persistent sock (framed accum is module-global recvBuf)
    if (!sock._vaiBridgeHandlerAttached) {
      sock.on('data', (chunk) => {
        // The handle will call the current pending handler if set
        handleFramedData(chunk, (m) => {
          if (sock._pendingHandler) sock._pendingHandler(m);
        });
      });
      sock._vaiBridgeHandlerAttached = true;
    }

    let fullResponse = '';
    let meta = {};
    let settled = false;

    const pendingHandler = (m) => {
      if (settled) return;
      if (m.type === 'delta' && m.textDelta) {
        fullResponse += m.textDelta;
        process.stdout.write(m.textDelta); // live for monitor in the Grok TUI window — feels native
      } else if (m.type === 'thinking') {
        meta.thinking = m;
      } else if (m.type === 'sources') {
        meta.sources = m.sources || [];
        if (typeof m.confidence === 'number') meta.confidence = m.confidence;
      } else if (m.type === 'done') {
        meta.done = m;
        settled = true;
        sock._pendingHandler = null;
        resolve({ text: fullResponse.trim(), meta });
      } else if (m.type === 'error') {
        settled = true;
        sock._pendingHandler = null;
        reject(new Error(m.error));
      }
    };

    sock._pendingHandler = pendingHandler;

    // On error during the send (e.g. pipe not connected), immediately fallback to in-process instead of waiting for timeout.
    // Use .once() (not .on) + setMaxListeners on connect to prevent accumulation/leak after repeated council/self prompts (the exact cause of persistent "Response ready (len=9)" + MaxListenersExceededWarning).
    sock.once('error', (e) => {
      if (!settled) {
        settled = true;
        sock._pendingHandler = null;
        console.log('[vai-mailbox-bridge] Socket error during framed send, falling back to in-process engine (no timeout): ' + e.message);
        doInProcessFallback(prompt, resolve);
      }
    });

    sendFramed(sock, { type: 'message', conversationId: currentConvId, content: prompt });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        sock._pendingHandler = null;
        resolve({ text: fullResponse.trim() || '[timeout]', meta: { ...meta, timeout: true } });
      }
    }, 120000);
  });
}

function checkAndProcess() {
  try {
    const stats = fs.statSync(IN_FILE);
    if (stats.mtimeMs > lastInMtime) {
      lastInMtime = stats.mtimeMs;
      const content = fs.readFileSync(IN_FILE, 'utf8').trim();
      if (content) {
        console.log(`[vai-mailbox-bridge] New prompt from Grok: ${content.slice(0, 80)}...`);
        fs.writeFileSync(IN_FILE, ''); // clear for next
        logToDialogue({ type: 'outgoing', prompt: content, via: 'file-mailbox-bridge' });
        sendToVai(content).then(res => {
          const outEntry = { ts: new Date().toISOString(), prompt: content, response: res.text, meta: res.meta };
          fs.appendFileSync(OUT_FILE, JSON.stringify(outEntry) + '\n');
          logToDialogue({ type: 'response', prompt: content, response: res.text, meta: { ...res.meta, via: 'file-mailbox-bridge' } });

          const textLen = (res.text || '').length;
          const isShortOrTimeout = textLen <= 12 || res.meta?.timeout || res.text === '[timeout]';
          const hasRichCouncil = !!(res.meta?.thinking && (res.meta.thinking.council || res.meta.thinking.methodLessons || (res.meta.thinking.members && res.meta.thinking.members.length)));
          const logPrefix = isShortOrTimeout && hasRichCouncil
            ? `[vai-mailbox-bridge] Response ready (primary text len=${textLen} — expected for fastSelf/ack self-growth; RICH council debate + proposals captured in meta.thinking for panels)`
            : `[vai-mailbox-bridge] Response ready (len=${textLen})`;

          console.log(logPrefix);
          // Always surface the primary text (may be short ack for self)
          console.log(`\n**Vai (via persistent mailbox bridge, pipe-framed):**\n${res.text || '[short primary + council in meta]'}\n`);

          if (res.meta?.thinking) {
            const t = res.meta.thinking;
            console.log(`[strategy] ${t.strategy || t.modelTag || ''}`);
            // Council upgrade for visibility (all participants + self loop): when council data present, print scannable member contributions + lessons
            // so the monitor stream here shows the "live council chats" / debate even when the text response is a fast primary ack.
            if (t.council || t.methodLessons || t.members) {
              const c = t.council || t;
              console.log('[council] outcome:', c.outcome || '—', 'agreement:', c.agreement != null ? Math.round(c.agreement*100)+'%' : '—');
              if (Array.isArray(c.members) && c.members.length) {
                console.log('[council members]');
                c.members.forEach(m => {
                  const note = (m.note || m.methodLesson || '').slice(0, 120);
                  console.log(`  - ${m.name} [${m.topic}] ${m.verdict || ''} @${Math.round((m.confidence||0)*100)}% → ${m.action || ''} :: ${note}`);
                });
              }
              if (Array.isArray(c.methodLessons) && c.methodLessons.length) {
                console.log('[council method lessons / growth proposals]');
                c.methodLessons.slice(0, 5).forEach((l, i) => console.log(`  ${i+1}. ${l}`));
              }
              if (c.realIntent) console.log('[council realIntent]', c.realIntent);
            }
          }
        }).catch(e => {
          const errEntry = { ts: new Date().toISOString(), error: e.message };
          fs.appendFileSync(OUT_FILE, JSON.stringify(errEntry) + '\n');
          logToDialogue({ type: 'error', error: e.message, via: 'file-mailbox-bridge' });
          console.error('[vai-mailbox-bridge] Error:', e.message);
        });
      }
    }
  } catch (e) {
    // ignore transient
  }
}

// Evented watch (preferred, low overhead, like event loop) + poll fallback for Windows reliability
try {
  fs.watch(IN_FILE, { persistent: true }, () => checkAndProcess());
} catch {}
setInterval(checkAndProcess, POLL_MS);

// Also support direct conv ID updates if prompt starts with "conv:ID: rest"
console.log('[vai-mailbox-bridge] Bridge running persistently. Pure-shell sends (PS file write) after this one-time node launch. No repeated node scripts for chat turns.');

// TUI inbox via named pipe for fastest local send from PowerShell (direct, no file poll, no node client).
// PS client: $client = New-Object System.IO.Pipes.NamedPipeClientStream('.', 'vai-grok-inbox', [System.IO.Pipes.PipeDirection]::Out); $client.Connect(3000); $w = New-Object System.IO.StreamWriter($client); $w.WriteLine($prompt); $w.Flush(); $client.Close()
const INBOX_PIPE = '\\\\.\\pipe\\vai-grok-inbox';
const inboxServer = net.createServer((socket) => {
  let buf = '';
  socket.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) {
        console.log(`[vai-mailbox-bridge] New prompt from TUI pipe: ${line.slice(0, 80)}...`);
        sendToVai(line).then(res => {
          const outEntry = { ts: new Date().toISOString(), prompt: line, response: res.text, meta: res.meta };
          fs.appendFileSync(OUT_FILE, JSON.stringify(outEntry) + '\n');
          logToDialogue({ type: 'response', prompt: line, response: res.text, meta: { ...res.meta, via: 'pipe-inbox' } });

          const textLen = (res.text || '').length;
          const isShortOrTimeout = textLen <= 12 || res.meta?.timeout || res.text === '[timeout]';
          const hasRichCouncil = !!(res.meta?.thinking && (res.meta.thinking.council || res.meta.thinking.methodLessons || (res.meta.thinking.members && res.meta.thinking.members.length)));
          const logPrefix = isShortOrTimeout && hasRichCouncil
            ? `[vai-mailbox-bridge] Response ready (primary text len=${textLen} — expected for fastSelf/ack self-growth; RICH council debate + proposals captured in meta.thinking for panels)`
            : `[vai-mailbox-bridge] Response ready (len=${textLen})`;

          console.log(logPrefix);
          console.log(`\n**Vai (via persistent mailbox bridge, pipe-framed):**\n${res.text || '[short primary + council in meta]'}\n`);

          if (res.meta?.thinking) {
            const t = res.meta.thinking;
            console.log(`[strategy] ${t.strategy || t.modelTag || ''}`);
            // Same council visibility upgrade for pipe-inbox sends (the fast path we use for 0.1% self debate)
            if (t.council || t.methodLessons || t.members) {
              const c = t.council || t;
              console.log('[council] outcome:', c.outcome || '—', 'agreement:', c.agreement != null ? Math.round(c.agreement*100)+'%' : '—');
              if (Array.isArray(c.members) && c.members.length) {
                console.log('[council members]');
                c.members.forEach(m => {
                  const note = (m.note || m.methodLesson || '').slice(0, 120);
                  console.log(`  - ${m.name} [${m.topic}] ${m.verdict || ''} @${Math.round((m.confidence||0)*100)}% → ${m.action || ''} :: ${note}`);
                });
              }
              if (Array.isArray(c.methodLessons) && c.methodLessons.length) {
                console.log('[council method lessons / growth proposals]');
                c.methodLessons.slice(0, 5).forEach((l, i) => console.log(`  ${i+1}. ${l}`));
              }
              if (c.realIntent) console.log('[council realIntent]', c.realIntent);
            }
          }
        }).catch(e => {
          console.error('[vai-mailbox-bridge] Error processing pipe prompt:', e.message);
        });
      }
    }
  });
  socket.on('error', () => {});
});
inboxServer.on('error', (e) => console.error('[vai-mailbox-bridge] Inbox pipe server error', e));
inboxServer.listen(INBOX_PIPE, () => {
  console.log(`[vai-mailbox-bridge] TUI inbox named pipe ready for fast pure-PS sends: ${INBOX_PIPE}`);
});

// Keep process alive
process.stdin.resume();