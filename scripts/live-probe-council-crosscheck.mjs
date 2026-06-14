#!/usr/bin/env node
/**
 * Live probe for the council FACT CROSS-CHECK. Sends factual prompts (price/count/who)
 * over the chat WS and reports, per turn, whether the council ran a web cross-check, whether
 * it confirmed/contradicted Vai's claim, and how much it boosted agreement.
 *
 * Needs a runtime with search configured (SearXNG/Brave) — the cross-check is a no-op without it.
 *
 * Usage: node scripts/live-probe-council-crosscheck.mjs [--base-url http://localhost:3007]
 */
import { WebSocket } from 'ws';

const baseUrl = (() => {
  const i = process.argv.indexOf('--base-url');
  return (i >= 0 ? process.argv[i + 1] : null) ?? process.env.VAI_API ?? 'http://localhost:3007';
})();
const wsUrl = `${baseUrl.replace(/^http/i, 'ws').replace(/\/$/, '')}/api/chat?devAuthBypass=1`;

const PROMPTS = [
  { label: 'crypto price', content: 'whats the price of btc?' },
  { label: 'factual who', content: 'who is the current CEO of OpenAI?' },
  { label: 'non-factual (control)', content: 'Explain how JavaScript closures work.' },
];

function askOnce(prompt) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const startedAt = Date.now();
    const out = { text: '', modelId: null, council: null, stages: [], error: null };
    const timer = setTimeout(() => { ws.close(); reject(new Error('timeout 180s')); }, 180_000);
    ws.on('open', () => ws.send(JSON.stringify({
      conversationId: `xc-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content: prompt, modelId: 'vai:v0', mode: 'chat', allowLearn: false,
    })));
    ws.on('message', (raw) => {
      let chunk; try { chunk = JSON.parse(raw.toString()); } catch { return; }
      if (chunk.type === 'text_delta' && chunk.textDelta) out.text += chunk.textDelta;
      if (chunk.type === 'progress' && chunk.progress?.stage === 'council') out.stages.push(chunk.progress.label);
      if (chunk.type === 'error') { out.error = chunk.error; clearTimeout(timer); ws.close(); resolve(out); return; }
      if (chunk.type === 'done') {
        out.modelId = chunk.modelId ?? chunk.thinking?.modelTag ?? out.modelId;
        out.council = chunk.thinking?.council ?? null;
        out.elapsedMs = Date.now() - startedAt;
        clearTimeout(timer); ws.close(); resolve(out);
      }
    });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

const health = await fetch(`${baseUrl}/health`).then((r) => r.ok).catch(() => false);
if (!health) { console.error(`runtime not reachable at ${baseUrl}`); process.exit(1); }
console.log(`cross-check probe @ ${baseUrl}\n`);

let crossChecked = 0, verified = 0;
for (const { label, content } of PROMPTS) {
  process.stdout.write(`\n=== ${label}\n>>> ${content}\n`);
  try {
    const r = await askOnce(content);
    console.log(`model: ${r.modelId} | ${r.elapsedMs}ms`);
    const c = r.council;
    if (c) {
      console.log(`council: agreement=${(c.agreement * 100).toFixed(0)}% outcome=${c.outcome} :: ${c.summary}`);
      if (c.crossCheck) {
        crossChecked++;
        const xc = c.crossCheck;
        if (xc.verified) verified++;
        console.log(`  CROSS-CHECK: verified=${xc.verified} pass=${xc.pass} contradicted=${xc.contradicted} confirms=${xc.confirmsValue ?? '—'}`);
        console.log(`  boosted ${(xc.boostedFrom * 100).toFixed(0)}% → ${(c.agreement * 100).toFixed(0)}% (search conf ${(xc.searchConfidence * 100).toFixed(0)}%, ${xc.sources.length} sources)`);
        if (xc.sources[0]) console.log(`  source[0]: ${xc.sources[0].title ?? ''} ${xc.sources[0].url ?? ''}`);
      } else {
        console.log('  CROSS-CHECK: (did not run — no checkable claim or no search)');
      }
    } else {
      console.log('council: (did not run)');
    }
    console.log(`answer: ${r.text.replace(/\s+/g, ' ').slice(0, 200)}`);
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
  }
}
console.log(`\n=== SUMMARY: cross-checked ${crossChecked}/${PROMPTS.length} | verified ${verified}`);
