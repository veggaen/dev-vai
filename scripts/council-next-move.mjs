#!/usr/bin/env node
/**
 * Council "next move" probe — convenes the council on what to improve next, so the
 * implementation acts on its validated reasoning (member notes + method lessons),
 * not an assumption. Builds on council-self-eval: this round asks specifically
 * about the propagateCouncilLessons idea the council itself raised last time.
 *
 * Usage: node scripts/council-next-move.mjs [--base-url http://localhost:3006]
 */
import { WebSocket } from 'ws';
import { writeFileSync, mkdirSync } from 'node:fs';

const baseUrl = (() => {
  const i = process.argv.indexOf('--base-url');
  return (i >= 0 ? process.argv[i + 1] : null) ?? process.env.VAI_API ?? 'http://localhost:3006';
})();
const wsUrl = `${baseUrl.replace(/^http/i, 'ws').replace(/\/$/, '')}/api/chat?devAuthBypass=1`;

const PROMPTS = [
  {
    label: 'propagate-lessons',
    content:
      'Self-improvement review: persistCouncilLessons already saves non-ship council method lessons as class-scope ' +
      'RouteGuidance that the dispatcher injects on similar future turns. The council previously suggested a ' +
      'propagateCouncilLessons() that ACTIVELY applies lessons to internal state beyond persist→inject. Concretely: is ' +
      'there a real gap between "stored + injected as a prompt nudge" and "applied"? If yes, name the SMALLEST change ' +
      'that makes a persisted lesson measurably change behavior, with a proof method (unit test / live probe) and one edge case. ' +
      'If persist→inject already IS propagation, say so honestly and name a different higher-value upgrade instead.',
  },
  {
    label: 'highest-value-next',
    content:
      'Self-improvement review: across Vai right now (chat/service.ts council loop, route-guidance injection, the desktop ' +
      'process UI + FileChangesBar, the build pipeline), name the single highest-leverage minimal upgrade that would most ' +
      'improve real user experience or Vai\'s self-improvement quality. Ground it in specific files. Smallest testable change + proof + edge case.',
  },
];

function askOnce(prompt) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    const startedAt = Date.now();
    const out = { label: prompt.label, text: '', council: null, error: null };
    const timer = setTimeout(() => { ws.close(); out.error = 'timeout 220s'; resolve(out); }, 220_000);
    ws.on('open', () => ws.send(JSON.stringify({
      conversationId: `next-move-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content: prompt.content, modelId: 'vai:v0', mode: 'chat', allowLearn: false,
    })));
    ws.on('message', (raw) => {
      let chunk; try { chunk = JSON.parse(raw.toString()); } catch { return; }
      if (chunk.type === 'text_delta' && chunk.textDelta) out.text += chunk.textDelta;
      if (chunk.type === 'error') { out.error = chunk.error; clearTimeout(timer); ws.close(); resolve(out); return; }
      if (chunk.type === 'done') {
        out.council = chunk.thinking?.council ?? null;
        out.elapsedMs = Date.now() - startedAt;
        clearTimeout(timer); ws.close(); resolve(out);
      }
    });
    ws.on('error', (err) => { out.error = String(err); clearTimeout(timer); resolve(out); });
  });
}

const results = [];
for (const p of PROMPTS) {
  process.stdout.write(`\n[next-move] ${p.label} … `);
  const r = await askOnce(p);
  process.stdout.write(r.error ? `ERROR: ${r.error}\n` : `done in ${r.elapsedMs}ms\n`);
  console.log('  PRIMARY:', (r.text || '').slice(0, 400).replace(/\n+/g, ' '));
  if (r.council) {
    console.log(`  council: outcome=${r.council.outcome} agree=${Math.round((r.council.agreement ?? 0) * 100)}% members=${r.council.members?.length ?? 0} responded=${(r.council.members ?? []).filter(m => !m.failed).length}`);
    for (const m of (r.council.members ?? []).filter(m => !m.failed)) {
      console.log(`   • ${m.name} ${m.verdict}@${Math.round((m.confidence ?? 0) * 100)}%: ${(m.note || '').slice(0, 200)}`);
    }
    for (const l of r.council.methodLessons ?? []) console.log(`   ↳ lesson: ${l.slice(0, 240)}`);
    for (const c of r.council.missingCapabilities ?? []) console.log(`   ⚠ missing: ${c.slice(0, 160)}`);
  }
  results.push(r);
}

mkdirSync('C:/tmp/vai-audit', { recursive: true });
writeFileSync('C:/tmp/vai-audit/council-next-move.json', JSON.stringify(results, null, 2));
console.log('\n[next-move] saved → C:/tmp/vai-audit/council-next-move.json');
