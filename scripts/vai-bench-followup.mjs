/**
 * vai-bench-followup.mjs — measure engine-layer follow-up handling.
 *
 * For each pair (turn-1 prompt, turn-2 follow-up):
 *   - create a fresh conversation
 *   - send turn 1, drain (warm context)
 *   - send turn 2, time it, fetch assistant modelId
 *
 * Pass = turn 2 finishes under FOLLOWUP_TIMEOUT_MS AND modelId is one of
 *        chat-continuation:* | chat-constrained-code:* (deterministic
 *        short-circuit, not the slow corpus path).
 */

const VAI_BASE = process.env.VAI_BASE_URL ?? 'http://localhost:3006';
const VAI_MODEL = process.env.VAI_MODEL ?? 'vai:v0';
const FOLLOWUP_TIMEOUT_MS = Number(process.env.VAI_FOLLOWUP_TIMEOUT_MS ?? 10000);
const TURN1_TIMEOUT_MS = Number(process.env.VAI_TURN1_TIMEOUT_MS ?? 60000);

const PAIRS = [
  // Templated path (constrained-code emitter handles both turns).
  { name: 'todo + clear-completed',     turn1: 'build a vite react tailwind todo app with TypeScript only', turn2: 'now add a clear completed button' },
  { name: 'pricing + table',            turn1: 'build a pricing page in plain HTML and CSS only',           turn2: 'now add a compare table' },
  { name: 'dashboard + search',         turn1: 'build a dashboard with stat cards in React + Tailwind',     turn2: 'now add a search input' },
  // Engine-layer continuations (templated path does NOT match — exercises new emitter).
  { name: 'rust + add button',          turn1: 'how do I learn rust?',                                       turn2: 'now add a button to that' },
  { name: 'css grid + add form',        turn1: 'explain css grid in two sentences',                          turn2: 'now add a contact form' },
  { name: 'react hooks + add list',     turn1: 'briefly: what is useEffect for?',                            turn2: 'now add a list' },
  { name: 'js promises + dark mode',    turn1: 'one-liner: what is a promise?',                              turn2: 'make it dark' },
  { name: 'arbitrary chat + explain it',turn1: 'show me a tiny TypeScript snippet that uses a generic',     turn2: 'explain it' },
  { name: 'arbitrary chat + fix it',    turn1: 'give me a one-line typescript example with a Map',          turn2: 'fix it' },
];

async function createConversation() {
  const r = await fetch(`${VAI_BASE}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: VAI_MODEL, mode: 'builder', title: `fb-${Date.now()}` }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`POST /api/conversations ${r.status}: ${await r.text()}`);
  const { id } = await r.json();
  return id;
}

async function sendMessage(conversationId, content, timeoutMs) {
  const t0 = Date.now();
  const r = await fetch(`${VAI_BASE}/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`POST messages ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return { ms: Date.now() - t0, text: typeof data.content === 'string' ? data.content : '' };
}

async function fetchLastAssistantModelId(conversationId) {
  const r = await fetch(`${VAI_BASE}/api/conversations/${conversationId}/messages`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) return null;
  const data = await r.json();
  const arr = Array.isArray(data) ? data : (data.messages ?? []);
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].role === 'assistant') return arr[i].modelId ?? null;
  }
  return null;
}

async function main() {
  console.log(`vai-bench-followup -> ${VAI_BASE}`);
  const results = [];
  for (const pair of PAIRS) {
    process.stdout.write(`  ${pair.name.padEnd(36)} `);
    let convId;
    try {
      convId = await createConversation();
    } catch (e) {
      console.log(`FAIL (create: ${e.message})`);
      results.push({ ...pair, pass: false });
      continue;
    }
    try {
      const t1 = await sendMessage(convId, pair.turn1, TURN1_TIMEOUT_MS);
      const t2 = await sendMessage(convId, pair.turn2, FOLLOWUP_TIMEOUT_MS);
      const modelId = await fetchLastAssistantModelId(convId);
      const fast = t2.ms < FOLLOWUP_TIMEOUT_MS;
      const shortCircuit =
        typeof modelId === 'string' &&
        (modelId.startsWith('chat-continuation:') || modelId.startsWith('chat-constrained-code:'));
      const pass = fast && shortCircuit;
      console.log(`${pass ? 'PASS' : 'FAIL'}  t1=${t1.ms}ms  t2=${t2.ms}ms  model=${modelId ?? 'n/a'}`);
      results.push({ ...pair, pass, t1: t1.ms, t2: t2.ms, modelId });
    } catch (e) {
      console.log(`FAIL (${e.message})`);
      results.push({ ...pair, pass: false });
    }
  }
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const t2s = results.filter((r) => typeof r.t2 === 'number').map((r) => r.t2).sort((a, b) => a - b);
  const median = t2s.length ? t2s[Math.floor(t2s.length / 2)] : null;
  const max = t2s.length ? t2s[t2s.length - 1] : null;
  console.log('');
  console.log(`Pairs: ${passed}/${total}  median t2=${median ?? 'n/a'}ms  max t2=${max ?? 'n/a'}ms`);
  if (passed !== total) {
    console.log('FAIL');
    process.exit(1);
  }
  console.log('OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
