#!/usr/bin/env node
/**
 * Live probe for the FRIEND-COUNCIL REDRAFT LOOP.
 *
 * Drives real prompts over the chat WebSocket and reports, per turn, what the
 * council did: did it review the buffered draft, did it ask for a revision, did
 * Vai redraft, and what changed. Proves the runCouncilLoop path end-to-end
 * against the running runtime + real local Ollama models — not unit stubs.
 *
 * The council emits `progress` chunks with stage:'council':
 *   - "Friend council reviewing the draft"            (running)
 *   - "Council asked for a revision — Vai redrafted"  (done, revised)
 *   - "Council cleared the draft"                     (done, ship)
 *   - "Council reviewed the draft"                    (done, no change)
 * and carries a `thinking.council` projection on the `done` chunk.
 *
 * Usage: node scripts/live-probe-council-redraft.mjs [--base-url http://localhost:3007]
 */

import { WebSocket } from 'ws';

const baseUrl = (() => {
  const i = process.argv.indexOf('--base-url');
  return (i >= 0 ? process.argv[i + 1] : null) ?? process.env.VAI_API ?? 'http://localhost:3007';
})();
const wsUrl = `${baseUrl.replace(/^http/i, 'ws').replace(/\/$/, '')}/api/chat?devAuthBypass=1`;

// Prompts chosen to exercise the substantive (model-answered) path where the
// council is allowed to run — analysis / comparison / explanation, not greetings.
const PROMPTS = [
  { label: 'explanation', content: 'Explain how JavaScript closures work and why they are useful.' },
  { label: 'comparison', content: 'Compare optimistic and pessimistic locking — when would you pick each?' },
  { label: 'open-ended advice', content: 'I have a slow React list rendering thousands of rows. How should I approach fixing it?' },
  { label: 'ambiguous-ish', content: 'how do I make my app faster' },
  { label: 'norwegian substantive', content: 'Hva er forskjellen på en prosess og en tråd?' },
];

function askOnce(prompt) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const startedAt = Date.now();
    const out = {
      text: '', modelId: null, turnKind: null, error: null,
      councilStages: [], councilThinking: null, redraftAsked: false, cleared: false,
    };
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`timeout 180s (got: "${out.text.slice(0, 100)}")`));
    }, 180_000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        conversationId: `council-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
      if (chunk.type === 'progress' && chunk.progress?.stage === 'council') {
        out.councilStages.push({
          label: chunk.progress.label,
          status: chunk.progress.status,
          detail: chunk.progress.detail,
        });
        if (/revision/i.test(chunk.progress.label || '')) out.redraftAsked = true;
        if (/cleared/i.test(chunk.progress.label || '')) out.cleared = true;
      }
      if (chunk.type === 'error') {
        out.error = chunk.error; out.elapsedMs = Date.now() - startedAt;
        clearTimeout(timer); ws.close(); resolve(out); return;
      }
      if (chunk.type === 'done') {
        out.modelId = chunk.modelId ?? chunk.thinking?.modelTag ?? out.modelId;
        out.councilThinking = chunk.thinking?.council ?? null;
        out.elapsedMs = Date.now() - startedAt;
        clearTimeout(timer); ws.close(); resolve(out);
      }
    });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

const health = await fetch(`${baseUrl}/health`).then((r) => r.ok).catch(() => false);
if (!health) { console.error(`runtime not reachable at ${baseUrl}`); process.exit(1); }
console.log(`probing council redraft loop @ ${baseUrl}\n`);

let reviewed = 0, revised = 0, cleared = 0;
for (const { label, content } of PROMPTS) {
  process.stdout.write(`\n=== ${label}\n>>> ${content}\n`);
  try {
    const r = await askOnce(content);
    console.log(`model: ${r.modelId} | turnKind: ${r.turnKind} | ${r.elapsedMs}ms`);
    if (r.councilStages.length) {
      reviewed++;
      console.log('council:');
      for (const s of r.councilStages) console.log(`  - [${s.status}] ${s.label}${s.detail ? ` :: ${s.detail}` : ''}`);
      if (r.redraftAsked) revised++;
      if (r.cleared) cleared++;
    } else {
      console.log('council: (did not run — deterministic/builder/conversational path)');
    }
    if (r.councilThinking) {
      const c = r.councilThinking;
      console.log(`council verdict: outcome=${c.outcome ?? '?'} action=${c.recommendedAction ?? '?'} ${c.summary ? `:: ${c.summary}` : ''}`);
    }
    if (r.error) console.log(`ERROR: ${r.error}`);
    const preview = r.text.replace(/\s+/g, ' ').slice(0, 320);
    console.log(`answer (${r.text.length} chars): ${preview}${r.text.length > 320 ? '…' : ''}`);
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
  }
}

console.log(`\n=== SUMMARY: council reviewed ${reviewed}/${PROMPTS.length} | asked-revision ${revised} | cleared ${cleared}`);
