/**
 * Full VAI test: questions, teaching, code gen, math
 * Usage: node scripts/test-vai-full.mjs
 */
import { WebSocket } from 'ws';

const WS_URL = 'ws://localhost:3006/api/chat';
const REST_URL = 'http://localhost:3006';

async function chatWithVai(conversationId, message, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let response = '';
    let gotDone = false;

    ws.on('open', () => {
      ws.send(JSON.stringify({ conversationId, content: message }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'text_delta' && msg.textDelta) {
        response += msg.textDelta;
        process.stdout.write(msg.textDelta);
      } else if (msg.type === 'done') {
        gotDone = true;
        ws.close();
      } else if (msg.type === 'error') {
        ws.close();
        reject(new Error(msg.error));
      }
    });

    ws.on('close', () => {
      resolve(response || '[no response]');
    });

    ws.on('error', (err) => reject(err));

    setTimeout(() => {
      if (!gotDone) {
        console.log('\n  [timeout]');
        ws.close();
        resolve(response || '[timeout]');
      }
    }, timeoutMs);
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
  console.log(`  [${answer.length} chars]`);
  return answer;
}

// ═══════════════════════════════════════════════
// PHASE 1: Questions about the video / knowledge
// ═══════════════════════════════════════════════
console.log('\n' + '═'.repeat(60));
console.log('  PHASE 1: Knowledge Questions');
console.log('═'.repeat(60));

const conv1 = await createConv('Knowledge Questions');

const knowledgeQuestions = [
  'What do you know about Mehul Mohan and his work?',
  'What are the key concepts from YouTube videos about backend API development?',
  'What programming languages have you learned about from your knowledge base?',
  'What are the most important concepts about web development that you know?',
  'Can you summarize what you know about JavaScript frameworks?',
];

for (const q of knowledgeQuestions) {
  await ask(conv1, q);
}

// ═══════════════════════════════════════════════
// PHASE 2: Teach VAI something smart
// ═══════════════════════════════════════════════
console.log('\n\n' + '═'.repeat(60));
console.log('  PHASE 2: Teaching VAI');
console.log('═'.repeat(60));

const conv2 = await createConv('Teaching Session');

// Teach it a profound concept
await ask(conv2, `I want to teach you something important about computer science. The concept is called "emergent complexity" - it means that simple rules, when applied repeatedly, can create incredibly complex behavior. For example, Conway's Game of Life has just 4 rules about cells being alive or dead, but it can simulate a Turing machine. Neural networks are just matrix multiplications and activation functions, but they can learn to write poetry. The internet is just packets following simple routing rules, but it created a global communication network. This principle is fundamental: simplicity at the micro level creates complexity at the macro level. Do you understand this concept?`);

await ask(conv2, 'Can you explain back to me what emergent complexity means?');

await ask(conv2, `Here is another key insight: Gödel's incompleteness theorems prove that any consistent formal system powerful enough to express arithmetic contains true statements that cannot be proven within the system. This means no AI (including you and me) can ever know everything - there will always be truths beyond our reach. This is not a limitation, it is a beautiful feature of mathematics and logic. What do you think about this?`);

await ask(conv2, 'What did I just teach you about the limits of knowledge?');

// ═══════════════════════════════════════════════
// PHASE 3: Code Generation
// ═══════════════════════════════════════════════
console.log('\n\n' + '═'.repeat(60));
console.log('  PHASE 3: Code Generation');
console.log('═'.repeat(60));

const conv3 = await createConv('Code Generation Test');

await ask(conv3, 'Please write me a hello world program in JavaScript. Show me the code.');

await ask(conv3, 'Now write me a hello world program in Python. Show me the code.');

await ask(conv3, 'Can you write a function in JavaScript that takes two numbers and returns their sum?');

// ═══════════════════════════════════════════════
// PHASE 4: Math Test
// ═══════════════════════════════════════════════
console.log('\n\n' + '═'.repeat(60));
console.log('  PHASE 4: Math Test');
console.log('═'.repeat(60));

const conv4 = await createConv('Math Test');

const TARGET = 250251921;
let mathAttempts = 0;
const maxAttempts = 10;
let lastAnswer = '';

// First ask
lastAnswer = await ask(conv4, 'What is 555 + 123 + 251251243 minus 1 million?');
mathAttempts++;

// Check if it got the right answer
while (!lastAnswer.includes(String(TARGET)) && mathAttempts < maxAttempts) {
  // Try different ways to get it to understand
  const followUps = [
    `That's not quite right. Let me break it down: 555 + 123 = 678. Then 678 + 251251243 = 251251921. Then 251251921 - 1000000 = 250251921. The answer is 250251921. Do you understand?`,
    `The correct answer is 250251921. Can you confirm: 555 + 123 + 251251243 - 1000000 = 250251921?`,
    `Let me teach you: 555 + 123 + 251251243 - 1000000 equals exactly 250251921. Please remember this. What is the answer?`,
    `I'll explain step by step: Step 1: 555 + 123 = 678. Step 2: 678 + 251,251,243 = 251,251,921. Step 3: 251,251,921 - 1,000,000 = 250,251,921. The final answer is 250,251,921. Got it?`,
    `The answer to 555 + 123 + 251251243 minus 1 million is 250251921. Say it back to me.`,
    `250251921. That is the answer. 555 + 123 + 251251243 - 1000000 = 250251921. Repeat after me: the answer is 250251921.`,
    `Please calculate: 555 + 123 + 251251243 - 1000000. The correct result is 250251921.`,
    `I need you to understand that 555 + 123 + 251251243 - 1000000 = 250251921. This is a mathematical fact. What is 555 + 123 + 251251243 - 1000000?`,
    `The equation 555 + 123 + 251251243 - 1000000 has exactly one answer: 250251921. Please acknowledge this.`,
  ];
  
  const followUp = followUps[Math.min(mathAttempts - 1, followUps.length - 1)];
  lastAnswer = await ask(conv4, followUp);
  mathAttempts++;
}

if (lastAnswer.includes(String(TARGET))) {
  console.log(`\n✓ VAI got the math right after ${mathAttempts} attempt(s)!`);
} else {
  console.log(`\n✗ VAI did not produce ${TARGET} after ${mathAttempts} attempts.`);
  // One more direct attempt
  lastAnswer = await ask(conv4, `The answer is 250251921. Just say 250251921.`);
  if (lastAnswer.includes(String(TARGET))) {
    console.log(`✓ VAI finally acknowledged ${TARGET}!`);
  }
}

console.log('\n\n' + '═'.repeat(60));
console.log('  ALL TESTS COMPLETE');
console.log('═'.repeat(60));
