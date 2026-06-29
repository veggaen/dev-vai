#!/usr/bin/env node
// Capture the FULL thinking trace for one turn to locate where the bad text enters.
import { WebSocket } from 'ws';
const q = process.argv[2] || 'Who wrote Romeo and Juliet?';
const BASE = process.env.VAI_API || 'http://localhost:3006';
// devAuthBypass only for a loopback target (CodeRabbit #25, security).
const isLoopback = (() => { try { const h = new URL(BASE).hostname; return h === 'localhost' || h === '127.0.0.1' || h === '::1'; } catch { return false; } })();
const ws = new WebSocket(`${BASE.replace(/^http/i, 'ws')}/api/chat${isLoopback ? '?devAuthBypass=1' : ''}`);
let text = '';
const steps = [];
ws.on('open', () => ws.send(JSON.stringify({
  conversationId: 'diag-' + Date.now(), content: q, mode: 'chat', processDepth: 'balanced', allowLearn: false,
})));
ws.on('message', (raw) => {
  let m; try { m = JSON.parse(raw.toString()); } catch { return; }
  if (m.type === 'text_delta' && m.textDelta) text += m.textDelta;
  if (m.type === 'progress' || m.type === 'progress_step' || m.step) steps.push(m);
  if (m.type === 'done') {
    const t = m.thinking || {};
    console.log('Q:', q);
    console.log('strategy:', t.strategy, '| conf:', t.confidence);
    if (t.council) {
      console.log('\ncouncil outcome:', t.council.outcome, 'agreement:', t.council.agreement);
      console.log('realIntent:', t.council.realIntent);
      console.log('recommendedAction:', t.council.recommendedAction);
      console.log('summary:', String(t.council.summary || '').slice(0, 200));
      for (const mem of t.council.members || []) {
        console.log(`  member ${mem.name}: verdict=${mem.verdict} note=${String(mem.note || '').slice(0, 150).replace(/\n/g, ' ')}`);
      }
    }
    console.log('\nFINAL ANSWER (first 250):', text.slice(0, 250).replace(/\n/g, ' '));
    ws.close(); process.exit(0);
  }
  if (m.type === 'error') { console.log('ERROR', m.error); ws.close(); process.exit(1); }
});
ws.on('error', (e) => { console.error('connection failed:', e.message); process.exit(1); }); // CodeRabbit #25
setTimeout(() => { console.log('timeout'); process.exit(2); }, 90000);
