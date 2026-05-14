/**
 * E2E chat harness — drives the live runtime via the same WebSocket the
 * desktop UI uses (ws://localhost:3006/api/chat), so what the harness sees
 * is exactly what V3gga sees in the desktop app.
 *
 * Usage:
 *   node scripts/e2e-chat-probe.mjs                       # default screenshot probes
 *   node scripts/e2e-chat-probe.mjs --new                 # force new conversation
 *   node scripts/e2e-chat-probe.mjs --prompt "hello"      # ad hoc single prompt
 *   node scripts/e2e-chat-probe.mjs --file probes.txt     # one prompt per line
 *
 * Each prompt is sent on the SAME conversation so multi-turn (e.g.
 * "and the second?") behaves like the real chat history.
 */
import WSDefault from 'ws';
const WebSocket = WSDefault.WebSocket || WSDefault;

const REST = 'http://localhost:3006';
const WS = 'ws://localhost:3006/api/chat';
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const argVal = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

async function ensureHealth() {
  const r = await fetch(`${REST}/health`).catch(() => null);
  if (!r || !r.ok) { console.error('Runtime not reachable on', REST); process.exit(2); }
}

async function newConversation(title) {
  const r = await fetch(`${REST}/api/conversations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, modelId: 'vai:v0' }),
  });
  if (!r.ok) throw new Error(`conv create failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.id;
}

function ask(conversationId, content) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS);
    let text = '';
    let settled = false;
    const finish = (label) => {
      if (settled) return;
      settled = true;
      try { ws.terminate(); } catch {}
      resolve(text || (label ? `[${label}]` : ''));
    };
    const t = setTimeout(() => finish('timeout'), 20000);
    t.unref?.();
    ws.on('open', () => ws.send(JSON.stringify({ conversationId, content })));
    ws.on('message', (raw) => {
      try {
        const m = JSON.parse(raw.toString());
        if (m.type === 'text_delta' && m.textDelta) text += m.textDelta;
        else if (m.type === 'done') { clearTimeout(t); finish(); }
        else if (m.type === 'error') { text = '[error] ' + (m.error || ''); clearTimeout(t); finish(); }
      } catch {}
    });
    ws.on('close', () => { clearTimeout(t); finish('close-no-done'); });
    ws.on('error', (e) => { text ||= '[ws-error] ' + e.message; clearTimeout(t); finish(); });
  });
}

const SCREENSHOT_PROBES = [
  'who was founder of apple? tell me his name only',
  'what are the top 10 most important skills needed to know of when playing league of legends?',
  'what was the first message I send in this chat? tell me exactly please',
  'and the second?',
  'no the second message',
];

async function loadPrompts() {
  const single = argVal('--prompt');
  if (single) return [single];
  const file = argVal('--file');
  if (file) {
    const fs = await import('node:fs/promises');
    const raw = await fs.readFile(file, 'utf8');
    return raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  }
  return SCREENSHOT_PROBES;
}

await ensureHealth();
const prompts = await loadPrompts();
const convId = await newConversation('e2e-probe ' + new Date().toISOString());
console.log(`conv=${convId}\n`);

// Process-wide hard deadline so a hung WS can never block the whole run.
const HARD_DEADLINE_MS = Number(argVal('--deadline')) || 30_000 * Math.max(1, prompts.length);
const hardTimer = setTimeout(() => {
  console.error(`\n[hard-deadline] exceeded ${HARD_DEADLINE_MS}ms — exiting.`);
  process.exit(3);
}, HARD_DEADLINE_MS);
hardTimer.unref?.();

for (const p of prompts) {
  process.stdout.write(`Q: ${p}\n`);
  const a = await Promise.race([
    ask(convId, p),
    new Promise((res) => setTimeout(() => res('[per-prompt-timeout]'), 22_000)),
  ]);
  const oneline = String(a).replace(/\s+/g, ' ').trim();
  console.log('A:', oneline.slice(0, 600) + (oneline.length > 600 ? ' …' : ''));
  console.log('---');
  // Force-flush so even a kill leaves the previous answer captured.
  await new Promise((r) => process.stdout.write('', r));
}
clearTimeout(hardTimer);
