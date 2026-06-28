#!/usr/bin/env node
/**
 * chat-quality-probe — drive REAL end-user questions through the live chat WS and
 * print each answer + how it was handled (strategy/confidence/council). This is the
 * honest "does the chat deliver excellent, accurate, intent-correct answers?" test.
 */
import { WebSocket } from 'ws';

const BASE = process.env.VAI_API || 'http://localhost:3006';
// Only attach devAuthBypass to a LOOPBACK target — sending it to an arbitrary VAI_API host turns this
// probe into a bypass client if any non-local server honours it (CodeRabbit #25, security).
const isLoopback = (() => {
  try { const h = new URL(BASE).hostname; return h === 'localhost' || h === '127.0.0.1' || h === '::1'; }
  catch { return false; }
})();
const wsUrl = `${BASE.replace(/^http/i, 'ws')}/api/chat${isLoopback ? '?devAuthBypass=1' : ''}`;

const QUESTIONS = [
  { intent: 'factual', q: 'What is the capital of Japan?' },
  { intent: 'factual', q: 'Who wrote Romeo and Juliet?' },
  { intent: 'reasoning', q: 'Why do engineering trade-offs matter?' },
  { intent: 'code', q: 'Write a JavaScript function to debounce a callback.' },
  { intent: 'cs-concept', q: 'Explain how a hash map works and its time complexity.' },
  { intent: 'conversational', q: 'Hi, what can you help me with?' },
  { intent: 'self-knowledge', q: 'What is your engine and how do you work?' },
  { intent: 'comparison', q: 'What is the difference between REST and GraphQL?' },
];

function ask({ intent, q }) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    const started = Date.now();
    let text = '';
    let thinking = null;
    let settled = false;
    // Single-shot settle so error/done/close/timeout can't double-resolve, and so the probe finishes
    // the moment the socket closes instead of hanging for the full 120s timeout (CodeRabbit #25).
    const settle = (extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      resolve({ intent, q, text, thinking, ms: Date.now() - started, ...extra });
    };
    const timer = setTimeout(() => settle({ timedOut: true }), 120000);
    ws.on('open', () => ws.send(JSON.stringify({
      conversationId: `quality-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      content: q, mode: 'chat', processDepth: 'balanced', allowLearn: false,
    })));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.type === 'text_delta' && m.textDelta) text += m.textDelta;
      if (m.type === 'error') settle({ error: m.error });
      if (m.type === 'done') { thinking = m.thinking || null; settle(); }
    });
    ws.on('error', (e) => settle({ error: String(e) }));
    ws.on('close', () => settle({ closed: true })); // resolve immediately on socket close
  });
}

const results = [];
for (const item of QUESTIONS) {
  process.stderr.write(`asking [${item.intent}] ${item.q}\n`);
  results.push(await ask(item));
}

for (const r of results) {
  console.log('\n' + '='.repeat(78));
  console.log(`[${r.intent}] ${r.q}   (${r.ms}ms${r.timedOut ? ' TIMEOUT' : ''})`);
  if (r.error) { console.log('  ERROR:', r.error); continue; }
  const t = r.thinking || {};
  console.log(`  strategy=${t.strategy || '?'} conf=${t.confidence ?? '?'} model=${t.modelTag || '?'}` +
    (t.council ? ` | council=${t.council.outcome} ${Math.round((t.council.agreement || 0) * 100)}% ${(t.council.members || []).filter((m) => !m.failed).length}/${t.council.members?.length || 0}` : ''));
  console.log('  ── answer ──');
  console.log((r.text || '(empty)').trim().split('\n').map((l) => '  ' + l).join('\n').slice(0, 900));
}
