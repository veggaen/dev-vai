#!/usr/bin/env node
/**
 * Live probe for the primary-generator flip + qwen3:8b upgrade.
 *
 * Sends a handful of real prompts over the chat WebSocket and reports, per
 * turn: which model answered, whether a fallback/flip notice fired, elapsed
 * time, and the first lines of the answer — so routing claims are verified
 * against the running runtime instead of unit stubs.
 *
 * Usage: node scripts/live-probe-primary-flip.mjs [--base-url http://localhost:3006]
 */

import { WebSocket } from 'ws';

const baseUrl = (() => {
  const i = process.argv.indexOf('--base-url');
  return (i >= 0 ? process.argv[i + 1] : null) ?? process.env.VAI_API ?? 'http://localhost:3006';
})();
// devAuthBypass only works from localhost (see platform-auth isLocalDevAuthBypassRequested).
const wsUrl = `${baseUrl.replace(/^http/i, 'ws').replace(/\/$/, '')}/api/chat?devAuthBypass=1`;

const PROMPTS = [
  { label: 'factual gap (was honest-gap fallback)', content: 'what is a deadlock?' },
  { label: 'bare topic word (was greeting hijack)', content: 'docker' },
  { label: 'comparison class', content: 'Compare PostgreSQL and MySQL for a small SaaS — which would you pick and why?' },
  { label: 'greeting (must stay fast + deterministic)', content: 'hey!' },
  { label: 'norwegian substantive', content: 'hva er forskjellen på TCP og UDP?' },
];

function askOnce(prompt) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const startedAt = Date.now();
    const out = { text: '', modelId: null, fallback: null, progress: [], turnKind: null, error: null };
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`timeout after 180s (got so far: "${out.text.slice(0, 120)}")`));
    }, 180_000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        conversationId: `live-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        content: prompt,
        modelId: 'vai:v0',
        mode: 'chat',
        allowLearn: false,
      }));
    });
    ws.on('message', (raw) => {
      let chunk;
      try { chunk = JSON.parse(raw.toString()); } catch { return; }
      if (chunk.type === 'text_delta' && chunk.textDelta) out.text += chunk.textDelta;
      if (chunk.type === 'turn_kind') out.turnKind = chunk.turnKind;
      if (chunk.type === 'fallback_notice') out.fallback = chunk.fallback;
      if (chunk.type === 'progress' && chunk.progress?.label) out.progress.push(chunk.progress.label);
      if (chunk.type === 'error') {
        out.error = chunk.error;
        out.elapsedMs = Date.now() - startedAt;
        clearTimeout(timer);
        ws.close();
        resolve(out);
        return;
      }
      if (chunk.type === 'done') {
        out.modelId = chunk.modelId ?? chunk.thinking?.modelTag ?? out.modelId;
        out.elapsedMs = Date.now() - startedAt;
        clearTimeout(timer);
        ws.close();
        resolve(out);
      }
    });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

const health = await fetch(`${baseUrl}/health`).then((r) => r.ok).catch(() => false);
if (!health) {
  console.error(`runtime not reachable at ${baseUrl}`);
  process.exit(1);
}

for (const { label, content } of PROMPTS) {
  process.stdout.write(`\n=== ${label}\n>>> ${content}\n`);
  try {
    const r = await askOnce(content);
    console.log(`model: ${r.modelId} | turnKind: ${r.turnKind} | ${r.elapsedMs}ms`);
    if (r.fallback) console.log(`route: ${r.fallback.fromModelId} -> ${r.fallback.toModelId} (${r.fallback.reason})`);
    if (r.progress.length) console.log(`progress: ${r.progress.join(' | ')}`);
    if (r.error) console.log(`ERROR: ${r.error}`);
    const preview = r.text.replace(/\s+/g, ' ').slice(0, 400);
    console.log(`answer (${r.text.length} chars): ${preview}${r.text.length > 400 ? '…' : ''}`);
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
  }
}
