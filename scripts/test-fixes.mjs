/**
 * Focused re-test of fixed issues
 */
import { WebSocket } from 'ws';
const WS_URL = 'ws://localhost:3006/api/chat';
const REST_URL = 'http://localhost:3006';

async function chat(convId, msg, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let response = '';
    let gotDone = false;
    ws.on('open', () => ws.send(JSON.stringify({ conversationId: convId, content: msg })));
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString());
      if (m.type === 'text_delta' && m.textDelta) { response += m.textDelta; process.stdout.write(m.textDelta); }
      else if (m.type === 'done') { gotDone = true; ws.close(); }
      else if (m.type === 'error') { ws.close(); reject(new Error(m.error)); }
    });
    ws.on('close', () => resolve(response || '[no response]'));
    ws.on('error', reject);
    setTimeout(() => { if (!gotDone) { ws.close(); resolve(response || '[timeout]'); } }, timeoutMs);
  });
}

async function conv(title) {
  return (await (await fetch(`${REST_URL}/api/conversations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, modelId: 'vai:v0' }),
  })).json()).id;
}

async function ask(id, msg) {
  console.log(`\n── You: ${msg}`);
  console.log(`<< VAI:`);
  const a = await chat(id, msg);
  if (!a.endsWith('\n')) console.log('');
  return a;
}

const c = await conv('Fix Test');

// 1. Greeting with "VAI"
console.log('=== GREETING ===');
let a = await ask(c, 'Hey VAI!');
const greetOk = a.includes('learned from') || a.includes('Hello') || a.includes('Hey');
console.log(greetOk ? '  ✓ Greeting works' : '  ✗ Greeting broken');

// 2. "What is Vitest?"
console.log('\n=== VITEST KNOWLEDGE ===');
a = await ask(c, 'What is Vitest?');
const vOk = a.toLowerCase().includes('vitest') && (a.includes('fastest') || a.includes('Vite'));
console.log(vOk ? '  ✓ Vitest answer correct' : '  ✗ Vitest answer wrong');

// 3. "What is Playwright?"
a = await ask(c, 'What is Playwright?');
const pOk = a.toLowerCase().includes('playwright') && (a.includes('E2E') || a.includes('cross-browser') || a.includes('browser'));
console.log(pOk ? '  ✓ Playwright answer correct' : '  ✗ Playwright answer wrong');

// 4. "What is cargo nextest?"
a = await ask(c, 'What is cargo nextest?');
const nOk = a.toLowerCase().includes('nextest') || a.toLowerCase().includes('rust');
console.log(nOk ? '  ✓ Nextest answer correct' : '  ✗ Nextest answer wrong');

// 5. "2 to the power of 10"
console.log('\n=== MATH ===');
a = await ask(c, '2 to the power of 10');
const mOk = a.includes('1024');
console.log(mOk ? '  ✓ 2^10 = 1024 correct' : '  ✗ 2^10 wrong');

// 6. "5 squared"
a = await ask(c, 'What is 5 squared?');
const sOk = a.includes('25');
console.log(sOk ? '  ✓ 5² = 25 correct' : '  ✗ 5² wrong');

// 7. Testing strategy
console.log('\n=== TESTING STRATEGY ===');
a = await ask(c, 'What testing strategy do you recommend for 2026?');
const tOk = a.includes('Vitest') || a.includes('Playwright') || a.includes('testing');
console.log(tOk ? '  ✓ Testing strategy answer' : '  ✗ No testing strategy');

// 8. MSW from bootstrap
a = await ask(c, 'What is MSW and what gotchas should I know?');
const mswOk = a.includes('MSW') || a.includes('Mock Service Worker') || a.includes('intercept');
console.log(mswOk ? '  ✓ MSW answer correct' : '  ✗ MSW answer wrong');

// 9. Who built VeggaAI (teach + recall)
console.log('\n=== TEACHING ===');
await ask(c, 'VeggaAI is a local-first AI built by Vegga (v3gga) from Norway');
a = await ask(c, 'Who built VeggaAI?');
const whoOk = a.includes('Vegga') || a.includes('v3gga');
console.log(whoOk ? '  ✓ Knows who built VeggaAI' : '  ✗ Doesn\'t know');

// 10. Key value parser
console.log('\n=== CODE PATTERNS ===');
a = await ask(c, 'Show me how to parse key=value config into JSON');
const kvOk = a.includes('indexOf') || a.includes('split') || a.includes('key');
console.log(kvOk ? '  ✓ KV parser shown' : '  ✗ KV parser not found');

console.log('\n=== ALL FOCUSED TESTS DONE ===');
