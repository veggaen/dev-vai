#!/usr/bin/env node
/**
 * Debug: directly test VaiEngine strategy pipeline for tier queries.
 * This bypasses the server and tests the engine instance directly.
 */
import WebSocket from 'ws';

const BASE = 'ws://localhost:3006/api/chat';

async function createConv() {
  const r = await fetch('http://localhost:3006/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Debug tier queries', modelId: 'vai:v0' }),
  });
  const d = await r.json();
  return d.id;
}

function sendMsg(convId, content) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE);
    let result = '';
    ws.on('open', () => ws.send(JSON.stringify({ conversationId: convId, content })));
    ws.on('message', (data) => {
      const j = JSON.parse(data.toString());
      if (j.type === 'text_delta' && j.textDelta) result += j.textDelta;
      if (j.type === 'done') { ws.close(); resolve(result); }
    });
    ws.on('error', reject);
    setTimeout(() => { ws.close(); resolve(result || '[TIMEOUT]'); }, 10000);
  });
}

// Test each query in isolation (separate conversations to avoid context contamination)
const queries = [
  'MERN stack tiers',
  'T3 stack tiers',
  'Next.js tiers',
  'What is in PERN Vai tier?',
  'What is vai.config.ts?',
  'MERN vs PERN',
];

for (const q of queries) {
  // Fresh conversation for each to eliminate history effects
  const convId = await createConv();
  const response = await sendMsg(convId, q);
  const short = response.slice(0, 200).replace(/\n/g, ' ');
  
  // Check if it's the correct hardcoded response
  const isMernTier = /MERN Stack Tiers/i.test(response);
  const isT3Tier = /T3 Stack Tiers/i.test(response);
  const isNextTier = /Next\.js Full Stack Tiers/i.test(response);
  const isPernTier = /PERN Stack Tiers/i.test(response);
  const isVaiConfig = /vai\.config\.ts.*configuration/i.test(response) || /VeggaAI-specific configuration/i.test(response);
  const isMernVsPern = /MERN vs PERN/i.test(response);
  const isVeggaTier = /VeggaAI 4-Tier/i.test(response);
  
  const fromWebStack = isMernTier || isT3Tier || isNextTier || isPernTier || isVaiConfig || isMernVsPern || isVeggaTier;
  
  console.log(`Q: ${q}`);
  console.log(`  From tryWebStackKnowledge: ${fromWebStack}`);
  console.log(`  Detected: MERN=${isMernTier} T3=${isT3Tier} Next=${isNextTier} PERN=${isPernTier} Config=${isVaiConfig} MvP=${isMernVsPern} VaiTier=${isVeggaTier}`);
  console.log(`  Response: ${short}`);
  console.log();
}
