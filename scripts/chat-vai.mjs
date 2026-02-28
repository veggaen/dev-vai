/**
 * Chat with VAI engine and test its knowledge
 * Usage: node scripts/chat-vai.mjs
 */
import { WebSocket } from 'ws';

const WS_URL = 'ws://localhost:3006/api/chat';
const REST_URL = 'http://localhost:3006';

async function chatWithVai(conversationId, message) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let response = '';
    let gotDone = false;

    ws.on('open', () => {
      console.log(`  [ws] connected, sending message...`);
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
      } else {
        // Unknown chunk type - log it
        console.log(`  [ws] unknown chunk:`, JSON.stringify(msg));
      }
    });

    ws.on('close', () => {
      if (!gotDone && response === '') {
        resolve('[no response received]');
      } else {
        resolve(response);
      }
    });

    ws.on('error', (err) => {
      console.error(`  [ws] error:`, err.message);
      reject(err);
    });

    setTimeout(() => { 
      if (!gotDone) {
        console.log('\n  [ws] timeout after 20s');
        ws.close();
        resolve(response || '[timeout - no response]');
      }
    }, 20000);
  });
}

// Create a conversation first
console.log('Creating conversation...');
const convRes = await fetch(`${REST_URL}/api/conversations`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'VAI Knowledge Test', modelId: 'vai:v0' }),
});
const conv = await convRes.json();
const convId = conv.id;
console.log(`Conversation: ${convId}\n`);

const questions = [
  'Hello!',
  'What do you know about Mehul Mohan?',
  'What did Mehul Mohan talk about regarding building backend APIs?',
  'What is the best way to build a backend API?',
  'Tell me about YouTube videos you learned from.',
  'What do you know about Elixir?',
];

for (const q of questions) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`>> You: ${q}`);
  console.log(`<< VAI: `);
  try {
    const answer = await chatWithVai(convId, q);
    if (!answer.endsWith('\n')) console.log('');
    console.log(`[${answer.length} chars]`);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
  }
}

console.log('\n\nDone!');
