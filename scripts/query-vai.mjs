/**
 * Query VAI knowledge base and chat with the engine
 * Usage: node scripts/query-vai.mjs
 */
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';

const DB_PATH = './packages/runtime/vai.db';
const WS_URL = 'ws://localhost:3006/api/chat';

const db = new Database(DB_PATH, { readonly: true });

// ---- DB Stats ----
const totalSources = db.prepare('SELECT COUNT(*) as c FROM sources').get().c;
const ytSources = db.prepare("SELECT COUNT(*) as c FROM sources WHERE source_type = 'youtube' OR url LIKE '%youtube.com%'").get().c;
const webSources = db.prepare("SELECT COUNT(*) as c FROM sources WHERE source_type = 'web' AND url NOT LIKE '%youtube.com%'").get().c;
const totalChunks = db.prepare('SELECT COUNT(*) as c FROM chunks').get().c;
const l0Chunks = db.prepare('SELECT COUNT(*) as c FROM chunks WHERE level = 0').get().c;
const l1Chunks = db.prepare('SELECT COUNT(*) as c FROM chunks WHERE level = 1').get().c;
const l2Chunks = db.prepare('SELECT COUNT(*) as c FROM chunks WHERE level = 2').get().c;

console.log('=== VAI Knowledge Base Stats ===');
console.log(`Total sources: ${totalSources}`);
console.log(`  YouTube: ${ytSources}`);
console.log(`  Web (non-YT): ${webSources}`);
console.log(`Total chunks: ${totalChunks}`);
console.log(`  L0 (full text): ${l0Chunks}`);
console.log(`  L1 (summaries): ${l1Chunks}`);
console.log(`  L2 (bullets): ${l2Chunks}`);

// ---- Check the specific video ----
console.log('\n=== Mehul Mohan Video (xRL9e1q8ndY) ===');
const src = db.prepare("SELECT * FROM sources WHERE url LIKE '%xRL9e1q8ndY%'").get();
if (src) {
  console.log(`Title: ${src.title}`);
  console.log(`Captured: ${new Date(src.captured_at).toISOString()}`);
  console.log(`Meta: ${src.meta}`);

  const videoChunks = db.prepare('SELECT level, ordinal, content FROM chunks WHERE source_id = ? ORDER BY level, ordinal').all(src.id);
  console.log(`Chunks: ${videoChunks.length}`);

  // Print L0 (full transcript)
  const l0 = videoChunks.filter(c => c.level === 0);
  if (l0.length > 0) {
    const transcript = l0.map(c => c.content).join('\n');
    console.log(`\n--- L0 Full Transcript (${transcript.length} chars) ---`);
    console.log(transcript.substring(0, 3000));
    if (transcript.length > 3000) console.log(`\n... [${transcript.length - 3000} more chars] ...`);
  }

  // Print L1 (summary)
  const l1 = videoChunks.find(c => c.level === 1);
  if (l1) {
    console.log(`\n--- L1 Summary ---`);
    console.log(l1.content);
  }

  // Print L2 (bullets)
  const l2 = videoChunks.find(c => c.level === 2);
  if (l2) {
    console.log(`\n--- L2 Bullets ---`);
    console.log(l2.content);
  }
} else {
  console.log('NOT FOUND in knowledge base!');
}

// ---- Chat with VAI ----
console.log('\n=== Chatting with VAI ===');

async function chatWithVai(conversationId, message) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let response = '';

    ws.on('open', () => {
      ws.send(JSON.stringify({ conversationId, content: message }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'token') {
        response += msg.token;
      } else if (msg.type === 'done') {
        ws.close();
        resolve(response);
      } else if (msg.type === 'error') {
        ws.close();
        reject(new Error(msg.error));
      }
    });

    ws.on('error', reject);
    setTimeout(() => { ws.close(); resolve(response || '[timeout]'); }, 15000);
  });
}

// Create a conversation first
const convRes = await fetch('http://localhost:3006/api/conversations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'VAI Knowledge Test', modelId: 'vai:v0' }),
});
const conv = await convRes.json();
const convId = conv.id;
console.log(`Conversation: ${convId}`);

// Question 1: Hello
console.log('\n>> Q1: Hello! What do you know about?');
const a1 = await chatWithVai(convId, 'Hello! What do you know about?');
console.log(`<< VAI: ${a1}`);

// Question 2: About the video
console.log('\n>> Q2: What did Mehul Mohan talk about in his video about building backend APIs?');
const a2 = await chatWithVai(convId, 'What did Mehul Mohan talk about in his video about building backend APIs?');
console.log(`<< VAI: ${a2}`);

// Question 3: Specific knowledge
console.log('\n>> Q3: What is the best way to build a backend API according to YouTube videos you learned from?');
const a3 = await chatWithVai(convId, 'What is the best way to build a backend API according to YouTube videos you learned from?');
console.log(`<< VAI: ${a3}`);

db.close();
console.log('\nDone!');
