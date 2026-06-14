#!/usr/bin/env node
/**
 * Council self-evaluation probe. Sends self-improvement prompts over the chat WS
 * (which triggers conveneOnce's self-improvement mode → council investigates the
 * Vai codebase) and captures, per turn: Vai's primary answer, each council
 * member's verdict + note, the consensus outcome/agreement, and the method
 * lessons. This is "use the council to evaluate the council" — the output is real
 * data to decide the next high-leverage upgrade.
 *
 * Usage: node scripts/council-self-eval.mjs [--base-url http://localhost:3006]
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
    label: 'council-self-effectiveness',
    content:
      'Self-improvement review: evaluate how well the SCIS consensus council currently works for improving Vai. ' +
      'As council, investigate the codebase (packages/core/src/consensus, chat/service.ts conveneOnce/runCouncilLoop, ' +
      'persistCouncilLessons, build-roster). What works, what is weak, and propose the single highest-leverage minimal ' +
      'change to make the council more useful in the human+AI improvement loop. Name proof method + one edge case.',
  },
  {
    label: 'grading-quality',
    content:
      'Self-improvement review: the council grades a draft and keeps the better redraft via councilScore = outcome*100 + ' +
      'agreement*10 + confidence. Is that grading honest? Propose whether to make it outcome-aware (only count a redraft ' +
      'win if it resolved the flagged missingCapability). Smallest testable change + edge case.',
  },
];

function askOnce(prompt) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    const startedAt = Date.now();
    const out = { label: prompt.label, text: '', modelId: null, council: null, error: null };
    const timer = setTimeout(() => { ws.close(); out.error = 'timeout 200s'; resolve(out); }, 200_000);
    ws.on('open', () => ws.send(JSON.stringify({
      conversationId: `self-eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content: prompt.content, modelId: 'vai:v0', mode: 'chat', allowLearn: false,
    })));
    ws.on('message', (raw) => {
      let chunk; try { chunk = JSON.parse(raw.toString()); } catch { return; }
      if (chunk.type === 'text_delta' && chunk.textDelta) out.text += chunk.textDelta;
      if (chunk.type === 'error') { out.error = chunk.error; clearTimeout(timer); ws.close(); resolve(out); return; }
      if (chunk.type === 'done') {
        out.modelId = chunk.modelId ?? chunk.thinking?.modelTag ?? null;
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
  process.stdout.write(`\n[self-eval] ${p.label} … `);
  const r = await askOnce(p);
  process.stdout.write(r.error ? `ERROR: ${r.error}\n` : `done in ${r.elapsedMs}ms\n`);
  if (r.council) {
    console.log(`  outcome=${r.council.outcome} agreement=${Math.round((r.council.agreement ?? 0) * 100)}% members=${r.council.members?.length ?? 0}`);
    for (const m of r.council.members ?? []) {
      console.log(`   • ${m.name} [${m.topic}] ${m.failed ? 'FAILED' : `${m.verdict}@${Math.round((m.confidence ?? 0) * 100)}%`}: ${(m.note || '').slice(0, 160)}`);
    }
    for (const l of r.council.methodLessons ?? []) console.log(`   ↳ lesson: ${l.slice(0, 200)}`);
  } else {
    console.log('  (no council attached — answer:', (r.text || '').slice(0, 160), ')');
  }
  results.push(r);
}

mkdirSync('C:/tmp/vai-audit', { recursive: true });
writeFileSync('C:/tmp/vai-audit/council-self-eval.json', JSON.stringify(results, null, 2));
console.log('\n[self-eval] saved → C:/tmp/vai-audit/council-self-eval.json');
