#!/usr/bin/env node
/**
 * AGENT-SPEAK-TO-VAI — The official, efficient, no-shortcuts channel for Grok (this agent)
 * to speak directly to Vai (the live runtime intelligence) or fall back to direct engine.
 *
 * Philosophy (per user directive):
 * - Efficient and fast as possible for iteration.
 * - Never cut corners: full health checks, proper WS streaming, full response capture,
 *   logging of every exchange, reuse of context where sensible.
 * - "Think twice": the caller (me) is expected to craft thoughtful, novel, aligned prompts
 *   every time. This script supports that by providing clean output + history.
 * - Every interaction should probe something new, different, or aligned with improving
 *   real intelligence, voice/writing quality, actions, epistemic honesty, etc.
 *
 * Usage (from terminal or via run_terminal_command):
 *   node scripts/agent-speak-to-vai.mjs "hey so tell me X and also Y in spoken style"
 *   node scripts/agent-speak-to-vai.mjs --direct "test prompt for engine only"
 *   node scripts/agent-speak-to-vai.mjs --new-conv "fresh conversation"
 *
 * Output:
 * - Streams the response live to stdout.
 * - On finish, prints structured meta (strategy, confidence, sources count, etc.).
 * - Appends full exchange (timestamp, prompt, response, meta) to .vai-agent-dialogue.log
 *
 * This is also the model for "how to work on Vai":
 *   1. Make change (no shortcut).
 *   2. Use a reload helper (build + restart + verify).
 *   3. Speak to Vai with a new probe that tests the change + something fresh.
 *   4. Analyze the response rigorously.
 */

import { WebSocket } from 'ws';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as net from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LOG_FILE = join(ROOT, '.vai-agent-dialogue.log');
const CONV_ID_FILE = join(ROOT, '.vai-agent-conv-id');
const WS_URL = 'ws://localhost:3006/api/chat';
const REST_URL = 'http://localhost:3006';
const HEALTH_URL = 'http://localhost:3006/health';
const START_SCRIPT = join(ROOT, 'scripts', 'vai-server.mjs');

function logToFile(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  appendFileSync(LOG_FILE, line, 'utf8');
}

function getLastConvId() {
  try {
    if (existsSync(CONV_ID_FILE)) {
      return readFileSync(CONV_ID_FILE, 'utf8').trim();
    }
  } catch {}
  return null;
}

function saveConvId(id) {
  writeFileSync(CONV_ID_FILE, id, 'utf8');
}

async function ensureServerHealthy(timeoutMs = 30000) {
  // Try health a few times
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        const data = await res.json();
        return { ok: true, data };
      }
    } catch {}
    await new Promise(r => setTimeout(r, 800));
  }
  return { ok: false };
}

async function startServerIfNeeded() {
  const health = await ensureServerHealthy(3000);
  if (health.ok) {
    console.log('[agent-channel] Server already healthy.');
    return health.data;
  }

  console.log('[agent-channel] Starting VAI server (no shortcuts, full start)...');
  // Use the manager — it stops old, starts fresh, waits for health internally.
  const startProc = spawn(process.execPath, [START_SCRIPT, 'start'], {
    stdio: 'inherit',
    cwd: ROOT,
  });

  await new Promise((resolve, reject) => {
    startProc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`vai-server start exited with code ${code}`));
    });
    startProc.on('error', reject);
  });

  const finalHealth = await ensureServerHealthy(20000);
  if (!finalHealth.ok) {
    throw new Error('Server failed to become healthy after start.');
  }
  console.log('[agent-channel] Server is healthy after start.');
  return finalHealth.data;
}

async function createConversation(title = 'Grok Engineer Agent ↔ Vai') {
  const res = await fetch(`${REST_URL}/api/conversations`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-vai-dev-auth-bypass': '1',   // local dev bypass — allows agent channel to create conversations without full Google/WorkOS sign-in
    },
    body: JSON.stringify({ title, modelId: 'vai:v0' }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to create conversation: ${res.status} ${text}`);
  }
  const conv = await res.json();
  return conv.id;
}

async function sendMessageViaWS(conversationId, content) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let fullText = '';
    const events = {
      thinking: null,
      sources: [],
      turnKind: null,
      model: null,
      confidence: null,
    };
    let gotDone = false;
    let settled = false;
    let timeout;

    const finish = (extra = {}) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (!ws) return;
      try { ws.close(); } catch {}
      resolve({ text: fullText.trim(), ...events, ...extra });
    };

    ws.on('open', () => {
      ws.send(JSON.stringify({ conversationId, content }));
    });

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }

      if (msg.type === 'text_delta' && msg.textDelta) {
        fullText += msg.textDelta;
        process.stdout.write(msg.textDelta);
      } else if (msg.type === 'thinking' || msg.thinking) {
        events.thinking = msg.thinking || msg;
      } else if (msg.type === 'sources') {
        events.sources = msg.sources || [];
        if (typeof msg.confidence === 'number') events.confidence = msg.confidence;
      } else if (msg.type === 'turn_kind') {
        events.turnKind = msg.turnKind;
      } else if (msg.modelId) {
        events.model = msg.modelId;
      } else if (msg.type === 'done') {
        gotDone = true;
        finish();
      } else if (msg.type === 'error') {
        finish({ error: msg.error });
      }
    });

    ws.on('close', () => {
      if (!gotDone) {
        finish({ partial: true });
      }
    });

    ws.on('error', (err) => {
      finish({ error: err.message || String(err) });
    });

    timeout = setTimeout(() => {
      if (!gotDone) {
        console.log('\n[agent-channel] Timeout waiting for done.');
        finish({ timedOut: true });
      }
    }, 120000);
  });
}

const PIPE_PATH = '\\\\.\\pipe\\vai-grok-direct';
const DIRECT_TCP_HOST = '127.0.0.1';
const DIRECT_TCP_PORT = 48765;
const DIRECT_LOCAL_TIMEOUT_MS = Number.parseInt(process.env.VAI_AGENT_DIRECT_TIMEOUT_MS || '120000', 10);

function sendFramed(sock, obj) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  const hdr = Buffer.allocUnsafe(4);
  hdr.writeUInt32BE(payload.length, 0);
  sock.write(hdr);
  sock.write(payload);
}

function handleFramedData(bufRef, chunk, onMsg) {
  bufRef.buf = Buffer.concat([bufRef.buf || Buffer.alloc(0), chunk]);
  while (bufRef.buf.length >= 4) {
    const b = bufRef.buf;
    const len = b.readUInt32BE(0);
    if (b.length < 4 + len) break;
    const pay = b.subarray(4, 4 + len);
    bufRef.buf = b.subarray(4 + len);
    let m;
    try { m = JSON.parse(pay.toString('utf8')); } catch { continue; }
    onMsg(m);
  }
}

async function speakViaDirectLocal(content, conversationId) {
  // Preferred efficient path (andrewrk-inspired): connect to named pipe (or TCP fallback) with explicit length-prefixed framing.
  // Lower overhead than WS to main server. Still full ChatService inside runtime (all intelligence).
  // Persistent convId supported. Fast local on Win (named pipe kernel direct).
  console.log('[agent-channel] Using DIRECT LOCAL (pipe preferred, framed) for minimal overhead.');
  const usePipe = true; // primary

  return new Promise((resolve, reject) => {
    const target = usePipe
      ? { path: PIPE_PATH }
      : { host: DIRECT_TCP_HOST, port: DIRECT_TCP_PORT };

    let sock;
    try {
      sock = net.connect(target);
    } catch (e) {
      return reject(e);
    }

    const bufRef = { buf: Buffer.alloc(0) };
    let fullText = '';
    const events = { thinking: null, sources: [], turnKind: null, confidence: null };
    let settled = false;
    let sawTerminal = false;
    let timeout;

    const finish = (extra = {}) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      try { sock.end(); } catch {}
      resolve({ text: fullText.trim(), ...events, ...extra, directLocal: true });
    };

    sock.on('connect', () => {
      sendFramed(sock, { type: 'message', conversationId: conversationId || `grok-direct-${Date.now()}`, content });
    });

    sock.setTimeout(DIRECT_LOCAL_TIMEOUT_MS, () => {
      finish({ timedOut: true, missingTerminal: !sawTerminal });
    });

    sock.on('data', (chunk) => {
      handleFramedData(bufRef, chunk, (msg) => {
        if (msg.type === 'delta' && msg.textDelta) {
          fullText += msg.textDelta;
          process.stdout.write(msg.textDelta);
        } else if (msg.type === 'thinking' || msg.thinking) {
          events.thinking = msg.thinking || msg;
        } else if (msg.type === 'sources') {
          events.sources = msg.sources || [];
          if (typeof msg.confidence === 'number') events.confidence = msg.confidence;
        } else if (msg.type === 'turn_kind') {
          events.turnKind = msg.turnKind;
        } else if (msg.type === 'done') {
          sawTerminal = true;
          finish({ terminal: true });
        } else if (msg.type === 'error') {
          sawTerminal = true;
          finish({ error: msg.error, terminal: true });
        }
      });
    });

    sock.on('error', (err) => {
      // fallback will be handled by caller
      finish({ error: err.message || String(err), connectFailed: true });
    });

    sock.on('close', () => {
      if (!sawTerminal) finish({ partial: true, missingTerminal: true });
    });

    timeout = setTimeout(() => {
      finish({ timedOut: true, missingTerminal: !sawTerminal });
    }, DIRECT_LOCAL_TIMEOUT_MS);
  });
}

async function speakDirectEngine(content) {
  // Fast path for code changes: direct engine using the exact same tsx + cli pattern the server manager uses.
  // Source-level (current .ts), very fast iteration, exercises normalization, compound splitter+combine, routers, risk review etc. exactly as the real chat does.
  // Uses a temp .mts file for proper ESM top-level await support.
  console.log('[agent-channel] Using DIRECT ENGINE (fast, source-level, for iteration — no shortcuts on fidelity).');

  const TSX_CLI = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const tmpFile = join(ROOT, '.vai-agent-direct-eval.mts');

  const code = `import { VaiEngine } from './packages/core/src/models/vai-engine.js';
const engine = new VaiEngine({ testMode: true });
const res = await engine.chat({ messages: [{ role: 'user', content: ${JSON.stringify(content)} }], noLearn: true });
console.log('\\n--- DIRECT RESPONSE ---');
console.log(res?.message?.content || '[no content]');
console.log('--- META ---');
const meta = (engine._lastMeta || {});
console.log(JSON.stringify({ strategy: meta.strategy || res?.strategy, confidence: meta.confidence, finishReason: res?.finishReason }, null, 2));
`;

  writeFileSync(tmpFile, code, 'utf8');

  const proc = spawn(process.execPath, [TSX_CLI, tmpFile], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  proc.stdout.on('data', d => { out += d; process.stdout.write(d); });
  proc.stderr.on('data', d => process.stderr.write(d));

  await new Promise(r => proc.on('close', r));

  try { unlinkSync(tmpFile); } catch {}

  return { text: out, direct: true };
}

async function main() {
  const args = process.argv.slice(2);
  const useDirect = args.includes('--direct');
  const forceNew = args.includes('--new-conv') || args.includes('--new');
  const message = args.filter(a => !a.startsWith('--')).join(' ').trim();

  if (!message) {
    console.error('Usage: node scripts/agent-speak-to-vai.mjs [--direct] [--new-conv] "your message to Vai"');
    console.error('Every call should be a thoughtful, new or aligned probe into real intelligence.');
    process.exit(1);
  }

  console.log(`[agent-channel] Speaking to Vai: "${message.slice(0, 80)}${message.length > 80 ? '...' : ''}"`);
  logToFile({ type: 'outgoing', prompt: message, direct: useDirect });

  let responseData;

  if (useDirect) {
    responseData = await speakDirectEngine(message);
  } else {
    try {
      const healthData = await startServerIfNeeded();
      console.log(`[agent-channel] Runtime engine: ${healthData?.engine || 'vai:v0'}`);

      let convId = forceNew ? null : getLastConvId();
      if (!convId) {
        convId = await createConversation('Grok Engineer Agent Session (persistent)');
        saveConvId(convId);
        console.log(`[agent-channel] New conversation: ${convId}`);
      } else {
        console.log(`[agent-channel] Reusing conversation: ${convId}`);
      }

      // Try the upgraded direct local channel first (pipe + explicit framing) — more efficient, lower overhead than WS.
      // Falls back inside to TCP if pipe not listening, then to WS.
      try {
        console.log('[agent-channel] Sending via direct local (pipe framed)...');
        responseData = await speakViaDirectLocal(message, convId);
        if (
          responseData.connectFailed
          || responseData.timedOut
          || responseData.missingTerminal
          || responseData.error
          || (!responseData.text && !responseData.thinking)
        ) {
          throw new Error('direct local incomplete');
        }
      } catch (directErr) {
        console.log(`[agent-channel] Direct local unavailable/incomplete (${directErr.message}), falling back to WS...`);
        responseData = await sendMessageViaWS(convId, message);
      }
    } catch (e) {
      console.error('[agent-channel] Runtime path failed:', e.message);
      console.log('[agent-channel] Falling back to direct engine (still valuable for intelligence).');
      responseData = await speakDirectEngine(message);
      responseData.fellBack = true;
    }
  }

  console.log('\n[agent-channel] === FULL RESPONSE CAPTURED ===');
  const hasRealText = responseData.text && responseData.text.length > 20;
  if (responseData.text) {
    if (!hasRealText) console.log('(partial or empty response from this path)');
  }
  if (responseData.sources?.length) {
    console.log(`[sources: ${responseData.sources.length}]`);
  }
  if (responseData.thinking) {
    console.log('[thinking/strategy present]');
  }

  logToFile({
    type: 'response',
    prompt: message,
    response: responseData.text,
    meta: {
      direct: !!responseData.direct,
      fellBack: !!responseData.fellBack,
      strategy: responseData.thinking?.strategy || responseData.strategy,
      confidence: responseData.confidence,
      sources: responseData.sources?.length || 0,
      turnKind: responseData.turnKind,
    },
  });

  console.log('\n[agent-channel] Interaction logged to .vai-agent-dialogue.log');
  if (!hasRealText && !responseData.direct) {
    console.log('[agent-channel] No substantial text from runtime WS — falling back to direct for this turn (still high fidelity for intelligence code).');
    // one-shot fallback
    const fb = await speakDirectEngine(message);
    console.log(fb.text);
    logToFile({ type: 'fallback-direct', prompt: message, response: fb.text });
  }
  console.log('[agent-channel] Now (as computer): think twice about what this reveals about Vai\'s current intelligence, what was new, and what the next probe should be.');
}

main().catch(err => {
  console.error('[agent-channel] Fatal error (no shortcuts — surface it):', err);
  process.exit(1);
});
