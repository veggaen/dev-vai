/**
 * Full test of VAI new features: google-it, discussion mode, testing tools knowledge,
 * code patterns, and conversation flow.
 * Usage: node scripts/test-vai-v2.mjs
 */
import { WebSocket } from 'ws';

const WS_URL = 'ws://localhost:3006/api/chat';
const REST_URL = 'http://localhost:3006';

async function chatWithVai(conversationId, message, timeoutMs = 45000) {
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

function header(text) { console.log(`\n${'═'.repeat(60)}\n  ${text}\n${'═'.repeat(60)}`); }
function sep() { console.log(`${'─'.repeat(60)}`); }

async function ask(convId, msg) {
  sep();
  console.log(`>> You: ${msg}`);
  console.log(`<< VAI:`);
  const answer = await chatWithVai(convId, msg);
  if (!answer.endsWith('\n')) console.log('');
  console.log(`  [${answer.length} chars]`);
  return answer;
}

// ══════════════════════════════════
// TEST 1: "Google it" feature
// ══════════════════════════════════
header('TEST 1: "Just Google It" Feature');
const c1 = await createConv('Google It Test');

await ask(c1, 'google what is WebAssembly');
await ask(c1, 'What is Bun runtime?');
await ask(c1, 'just google it');  // should google the previous question
await ask(c1, 'search for Playwright testing framework 2026');

// ══════════════════════════════════
// TEST 2: Discussion Mode
// ══════════════════════════════════
header('TEST 2: Discussion Mode');
const c2 = await createConv('Discussion Mode');

await ask(c2, "let's discuss the future of local-first AI vs cloud AI");
await ask(c2, "I think local-first is important for privacy, but cloud has more compute power. What pattern do you see here?");
await ask(c2, "discuss microservices vs monolith architecture");

// ══════════════════════════════════
// TEST 3: Testing Tools Knowledge
// ══════════════════════════════════
header('TEST 3: Testing Tools Knowledge');
const c3 = await createConv('Testing Knowledge');

await ask(c3, 'What is Vitest and why should I use it?');
await ask(c3, 'What is Playwright?');
await ask(c3, 'What testing strategy do you recommend for a Next.js app in 2026?');
await ask(c3, 'What do you know about MSW?');
await ask(c3, 'Tell me about Rust testing tools');
await ask(c3, 'What is cargo nextest?');

// ══════════════════════════════════
// TEST 4: Code Pattern Knowledge
// ══════════════════════════════════
header('TEST 4: Code Pattern Knowledge');
const c4 = await createConv('Code Patterns');

await ask(c4, 'Show me a word counter script');
await ask(c4, 'How do I extract emails from text?');
await ask(c4, 'Show me how to parse key=value lines into JSON');
await ask(c4, 'What is the pattern focused mentor prompt?');
await ask(c4, 'What is a universal pattern decoder?');

// ══════════════════════════════════
// TEST 5: Code Generation (verify working)
// ══════════════════════════════════
header('TEST 5: Code Generation');
const c5 = await createConv('Code Gen');

await ask(c5, 'Write me hello world in TypeScript');
await ask(c5, 'Write a function in Python that takes two numbers and returns their sum');
await ask(c5, 'Write hello world in Rust');
await ask(c5, 'Write hello world in Elixir');

// ══════════════════════════════════
// TEST 6: Math (verify still working)
// ══════════════════════════════════
header('TEST 6: Math Verification');
const c6 = await createConv('Math');

const mathAns = await ask(c6, 'What is 555 + 123 + 251251243 minus 1 million?');
if (mathAns.includes('250251921')) console.log('  ✓ Math correct!');
else console.log('  ✗ Math WRONG');

await ask(c6, 'What is 42 times 1337?');
await ask(c6, '2 to the power of 10');

// ══════════════════════════════════
// TEST 7: Full Conversation Flow
// ══════════════════════════════════
header('TEST 7: Full Conversation Flow');
const c7 = await createConv('Full Conversation');

await ask(c7, 'Hey VAI!');
await ask(c7, 'What can you do?');
await ask(c7, 'VeggaAI is a local-first AI built by Vetle (v3gga). It learns from web pages, YouTube transcripts, and conversations.');
await ask(c7, 'Who built VeggaAI?');
await ask(c7, 'Write me hello world in JavaScript');
await ask(c7, 'What is 100 + 200 + 300?');
await ask(c7, 'google what is Deno 2.0');
await ask(c7, "let's discuss whether AI should be open source");
await ask(c7, 'What do you know about Vitest?');
await ask(c7, 'Thanks!');

header('ALL TESTS COMPLETE');
console.log('\nSummary: Tested google-it, discussion mode, testing tools knowledge,');
console.log('code patterns, code generation, math, and full conversation flow.\n');
