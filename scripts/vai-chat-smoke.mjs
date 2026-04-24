#!/usr/bin/env node
/**
 * Fast quality gate for chat plumbing (no full benchmark).
 *
 * Default: runs core unit tests that lock prompt + structure-hint + ChatService wiring (offline, no API keys).
 * Live: optional checks against a running runtime (VAI_API or --base-url).
 *
 * Usage:
 *   node scripts/vai-chat-smoke.mjs
 *   node scripts/vai-chat-smoke.mjs --live
 *   node scripts/vai-chat-smoke.mjs --live --base-url http://localhost:3006
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocket } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const DEFAULT_BASE = process.env.VAI_API?.trim() || 'http://localhost:3006';

const SMOKE_ASK_TIMEOUT_MS = (() => {
  const n = Number(process.env.VAI_SMOKE_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 120_000;
})();

function runOffline() {
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'vitest',
      'run',
      'packages/core/__tests__/chat-quality.test.ts',
      'packages/core/__tests__/chat-modes.test.ts',
      'packages/core/__tests__/chat-service.test.ts',
      'packages/core/__tests__/evidence-types.test.ts',
    ],
    {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      shell: true,
    },
  );
  if (result.status !== 0) {
    console.error(`VAI_CHAT_SMOKE offline vitest exit=${result.status}`);
    process.exit(result.status ?? 1);
  }
  console.log('VAI_CHAT_SMOKE offline PASS (core chat unit tests)');
}

function toWsUrl(baseUrl) {
  return baseUrl.replace(/^http/i, 'ws').replace(/\/$/, '');
}

async function fetchHealth(baseUrl) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/health`);
  if (!res.ok) throw new Error(`/health ${res.status}`);
  return res.json();
}

async function createConversation(baseUrl, modelId, mode) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId, mode: mode ?? 'chat', title: 'vai-chat-smoke' }),
  });
  if (!res.ok) throw new Error(`create conversation: ${res.status} ${await res.text()}`);
  return res.json();
}

function askOnce(baseUrl, conversationId, content, timeoutMs = SMOKE_ASK_TIMEOUT_MS) {
  const wsUrl = `${toWsUrl(baseUrl)}/api/chat`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let text = '';
    const t = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      reject(new Error('smoke websocket timeout'));
    }, timeoutMs);

    ws.on('open', () => {
      ws.send(JSON.stringify({ conversationId, content }));
    });
    ws.on('message', (buf) => {
      const msg = JSON.parse(buf.toString());
      if (msg.type === 'text_delta' && msg.textDelta) text += msg.textDelta;
      if (msg.type === 'done') {
        clearTimeout(t);
        ws.close();
        resolve(text);
      }
      if (msg.type === 'error') {
        clearTimeout(t);
        reject(new Error(msg.error || 'ws error'));
      }
    });
    ws.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

async function runLive(baseUrl) {
  await fetchHealth(baseUrl);
  const modelId = process.env.VAI_SMOKE_MODEL?.trim() || 'vai:v0';
  const { id } = await createConversation(baseUrl, modelId, 'chat');

  const ping = await askOnce(
    baseUrl,
    id,
    'Reply with exactly this token and nothing else: VAI_SMOKE_PING',
    SMOKE_ASK_TIMEOUT_MS,
  );
  if (!/VAI_SMOKE_PING/i.test(ping)) {
    console.error('VAI_CHAT_SMOKE live FAIL: ping response:', ping.slice(0, 200));
    process.exit(1);
  }

  const multi = await askOnce(
    baseUrl,
    id,
    'In 2–4 short bullet points, name one benefit of structured chat answers and one DX shortcut pattern (e.g. command palette). Keep under 120 words.',
    SMOKE_ASK_TIMEOUT_MS,
  );
  const structured =
    /^(\s*[-*]|\s*\d+\.)/m.test(multi) || /\n[-*]\s/.test(multi) || multi.split('\n').length >= 4;
  if (!structured || multi.trim().length < 40) {
    console.error('VAI_CHAT_SMOKE live WARN: weak structure (continuing). Preview:', multi.slice(0, 300));
  }

  console.log(`VAI_CHAT_SMOKE live PASS base=${baseUrl} model=${modelId}`);
}

const args = process.argv.slice(2);
const live = args.includes('--live');
const liveOnly = args.includes('--live-only');
let baseUrl = DEFAULT_BASE;
const i = args.indexOf('--base-url');
if (i >= 0 && args[i + 1]) baseUrl = args[i + 1];

if (args.includes('--help')) {
  console.log(`vai-chat-smoke: offline unit tests by default; add --live for runtime smoke.
  --live-only     Skip offline vitest; only run WebSocket checks (use after a full offline pass).
Env: VAI_API, VAI_SMOKE_MODEL (default vai:v0), VAI_SMOKE_TIMEOUT_MS (default 120000)
`);
  process.exit(0);
}

async function main() {
  if (!liveOnly) {
    runOffline();
  }
  if (live || liveOnly) await runLive(baseUrl);
}

main().catch((err) => {
  console.error('VAI_CHAT_SMOKE ERROR', err instanceof Error ? err.message : err);
  process.exit(1);
});
