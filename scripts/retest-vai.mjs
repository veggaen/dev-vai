/**
 * Quick re-test of VAI after fixes: code gen, math, teaching
 * Usage: node scripts/retest-vai.mjs
 */
import { WebSocket } from 'ws';

const WS_URL = 'ws://localhost:3006/api/chat';
const REST_URL = 'http://localhost:3006';

async function chatWithVai(conversationId, message, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let response = '';
    let gotDone = false;
    ws.on('open', () => ws.send(JSON.stringify({ conversationId, content: message })));
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'text_delta' && msg.textDelta) {
        response += msg.textDelta;
        process.stdout.write(msg.textDelta);
      } else if (msg.type === 'done') { gotDone = true; ws.close(); }
      else if (msg.type === 'error') { ws.close(); reject(new Error(msg.error)); }
    });
    ws.on('close', () => resolve(response || '[no response]'));
    ws.on('error', (err) => reject(err));
    setTimeout(() => { if (!gotDone) { ws.close(); resolve(response || '[timeout]'); } }, timeoutMs);
  });
}

async function createConv(title) {
  const res = await fetch(`${REST_URL}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, modelId: 'vai:v0' }),
  });
  return (await res.json()).id;
}

async function ask(convId, msg) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`>> You: ${msg}`);
  console.log(`<< VAI:`);
  const answer = await chatWithVai(convId, msg);
  if (!answer.endsWith('\n')) console.log('');
  return answer;
}

// ── TEST 1: Code Generation ──
console.log('═══ CODE GENERATION ═══');
const c1 = await createConv('Code Gen');
await ask(c1, 'Write me a hello world in JavaScript');
await ask(c1, 'Write me a hello world in Python');
await ask(c1, 'Write a function in JavaScript that takes two numbers and returns their sum');

// ── TEST 2: Math ──
console.log('\n═══ MATH ═══');
const c2 = await createConv('Math');
let ans = await ask(c2, 'What is 555 + 123 + 251251243 minus 1 million?');
const TARGET = '250251921';
if (ans.includes(TARGET)) {
  console.log(`✓ GOT IT FIRST TRY!`);
} else {
  console.log(`✗ Wrong answer, trying again...`);
  ans = await ask(c2, '555 + 123 + 251251243 - 1000000');
  if (ans.includes(TARGET)) console.log(`✓ Got it on numeric form!`);
  else {
    ans = await ask(c2, 'Calculate 555 + 123 + 251251243 minus 1 million');
    if (ans.includes(TARGET)) console.log(`✓ Got it with "calculate"!`);
    else console.log(`✗ Still wrong.`);
  }
}

// ── TEST 3: Simple math
await ask(c2, 'What is 2 + 2?');
await ask(c2, 'What is 100 times 50?');
await ask(c2, 'Solve 1000 minus 333');

// ── TEST 4: Teaching ──
console.log('\n═══ TEACHING ═══');
const c3 = await createConv('Teaching');
await ask(c3, 'I want to teach you about emergent complexity: "emergent complexity" means that simple rules repeated many times create incredibly complex behavior. For example, Conways Game of Life has only 4 rules but can simulate a Turing machine.');
await ask(c3, 'What is emergent complexity?');

console.log('\n═══ ALL DONE ═══');
