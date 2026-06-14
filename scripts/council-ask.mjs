#!/usr/bin/env node
/**
 * council-ask — consult Vai's SCIS council on a single question from the CLI and
 * print the structured verdict (outcome, agreement, each responding member's note,
 * method lessons, missing capabilities). Makes "ask the council" a one-liner in the
 * improvement loop instead of a bespoke probe script each time.
 *
 * Self-improvement framing is auto-added so the council investigates the codebase.
 *
 * Usage:
 *   node scripts/council-ask.mjs "should councilScore be outcome-aware? smallest change + proof + edge case"
 *   node scripts/council-ask.mjs --base-url http://localhost:3006 "..."
 *   echo "long question..." | node scripts/council-ask.mjs --stdin
 */
import { WebSocket } from 'ws';

const args = process.argv.slice(2);
const baseIdx = args.indexOf('--base-url');
const baseUrl = (baseIdx >= 0 ? args[baseIdx + 1] : null) ?? process.env.VAI_API ?? 'http://localhost:3006';
const useStdin = args.includes('--stdin');
const question = useStdin
  ? await new Promise((r) => { let s = ''; process.stdin.on('data', (d) => (s += d)); process.stdin.on('end', () => r(s.trim())); })
  : args.filter((a) => a !== '--base-url' && a !== baseUrl && a !== '--stdin').join(' ').trim();

if (!question) {
  console.error('Usage: node scripts/council-ask.mjs "<question>"');
  process.exit(1);
}

const wsUrl = `${baseUrl.replace(/^http/i, 'ws').replace(/\/$/, '')}/api/chat?devAuthBypass=1`;
// Self-improvement keywords trigger conveneOnce's self-improvement mode (codebase context).
const content =
  `Self-improvement review: ${question}\n` +
  'As council, investigate the relevant Vai codebase. Give the smallest testable change, a proof method, and one edge case. ' +
  'If the premise is wrong, say so honestly.';

const ws = new WebSocket(wsUrl);
const startedAt = Date.now();
let text = '';
let council = null;
const timer = setTimeout(() => { console.error('timeout 220s'); ws.close(); process.exit(2); }, 220_000);

ws.on('open', () => ws.send(JSON.stringify({
  conversationId: `council-ask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  content, modelId: 'vai:v0', mode: 'chat', allowLearn: false,
})));

ws.on('message', (raw) => {
  let chunk; try { chunk = JSON.parse(raw.toString()); } catch { return; }
  if (chunk.type === 'text_delta' && chunk.textDelta) text += chunk.textDelta;
  if (chunk.type === 'error') { console.error('error:', chunk.error); clearTimeout(timer); ws.close(); process.exit(2); }
  if (chunk.type === 'done') {
    council = chunk.thinking?.council ?? null;
    clearTimeout(timer);
    ws.close();
    const ms = Date.now() - startedAt;
    console.log(`\n━━━ Vai primary (${ms}ms) ━━━`);
    console.log((text || '(no text)').trim().slice(0, 700));
    if (council) {
      const responded = (council.members ?? []).filter((m) => !m.failed);
      console.log(`\n━━━ Council: ${council.outcome} · ${Math.round((council.agreement ?? 0) * 100)}% agree · ${responded.length}/${council.members?.length ?? 0} responded ━━━`);
      if (council.realIntent) console.log(`read as: ${council.realIntent}`);
      for (const m of responded) {
        console.log(`\n• ${m.name} — ${m.verdict}@${Math.round((m.confidence ?? 0) * 100)}% → ${m.action}`);
        if (m.note) console.log(`  ${m.note.slice(0, 400)}`);
      }
      if (council.missingCapabilities?.length) console.log(`\n⚠ missing: ${council.missingCapabilities.join(' • ')}`);
      if (council.methodLessons?.length) {
        console.log('\n↳ method lessons:');
        for (const l of council.methodLessons) console.log(`  - ${l}`);
      }
    } else {
      console.log('\n(no council convened for this turn)');
    }
    process.exit(0);
  }
});
ws.on('error', (err) => { console.error('ws error:', String(err)); clearTimeout(timer); process.exit(2); });
