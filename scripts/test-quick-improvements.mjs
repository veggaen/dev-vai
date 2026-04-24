#!/usr/bin/env node
/**
 * Quick test for the 6 codebase improvements:
 * 1. Greeting: oyoy, myyh, fese, ey
 * 2. Correction handler: "Actually, X is Y"
 * 3. YouTube penalty: should reduce junk results
 * 4. Iceland capital: deterministic answer
 * 5. PERN tier knowledge
 * 6. Tier comparison
 */
import WebSocket from 'ws';

const BASE = 'http://localhost:3006';

async function createConv() {
  const r = await fetch(`${BASE}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Quick test', modelId: 'vai:v0' }),
  });
  const d = await r.json();
  return d.id;
}

function sendMsg(convId, content) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:3006/api/chat`);
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

const tests = [
  // Greetings
  { q: 'oyoy', expect: 'greeting', keywords: ['veggaai', 'learned', 'sources', 'hello', 'hey'] },
  { q: 'myyh', expect: 'greeting', keywords: ['veggaai', 'learned', 'sources', 'hello', 'hey'] },
  { q: 'fese', expect: 'greeting', keywords: ['veggaai', 'learned', 'sources', 'hello', 'hey'] },
  { q: 'ey', expect: 'greeting', keywords: ['veggaai', 'learned', 'sources', 'hello', 'hey'] },
  { q: 'ey!', expect: 'greeting', keywords: ['veggaai', 'learned', 'sources', 'hello', 'hey'] },

  // General knowledge
  { q: 'What is the capital of Iceland?', expect: 'Reykjavík', keywords: ['reykjav'] },
  { q: 'Capital of Finland', expect: 'Helsinki', keywords: ['helsinki'] },
  { q: 'Capital of Denmark', expect: 'Copenhagen', keywords: ['copenhagen', 'københavn'] },

  // Tier knowledge
  { q: 'What are the VeggaAI tiers?', expect: 'tier table', keywords: ['basic', 'solid', 'battle-tested', 'vai'] },
  { q: 'What does the PERN Basic tier include?', expect: 'task board', keywords: ['task', 'react', 'typescript', 'tailwind'] },
  { q: 'What is in PERN Vai tier?', expect: 'monitor + ErrorBoundary', keywords: ['monitor', 'errorboundary', 'useapi'] },
  { q: 'MERN stack tiers', expect: 'bookmark manager', keywords: ['bookmark', 'basic', 'solid', 'docker'] },
  { q: 'T3 stack tiers', expect: 'expense tracker', keywords: ['expense', 'trpc', 'zod'] },
  { q: 'Next.js tiers', expect: 'notes dashboard', keywords: ['notes', 'app router', 'prisma'] },
  { q: 'Difference between Basic and Vai tier', expect: 'comparison table', keywords: ['basic', 'vai', 'docker', 'vitest'] },
  { q: 'What is vai.config.ts?', expect: 'configuration', keywords: ['vai', 'config', 'optimization'] },
  { q: 'What does Basic tier include?', expect: 'scaffold', keywords: ['react', 'typescript', 'tailwind', 'framer'] },

  // Correction handler
  { q: 'Actually, oyoy is a Norwegian greeting meaning hey', expect: 'correction', keywords: ['correction', 'updated', 'learned'] },
  { q: 'No, myyh means a casual hello in Norwegian slang', expect: 'correction', keywords: ['correction', 'updated', 'learned'] },

  // Existing: MERN vs PERN (should still work)
  { q: 'MERN vs PERN', expect: 'comparison', keywords: ['mongodb', 'postgresql', 'nosql', 'sql'] },
];

async function run() {
  console.log('=== Quick Improvement Test ===\n');
  const convId = await createConv();
  let pass = 0, fail = 0;

  for (const t of tests) {
    const response = await sendMsg(convId, t.q);
    const lower = response.toLowerCase();
    
    // Check if greeting response
    const isGreeting = t.expect === 'greeting';
    const isCorrection = t.expect === 'correction';
    
    let matched = false;
    if (isGreeting) {
      matched = /veggaai|learned|sources|hello|hey|i('|')m\b/i.test(response) &&
                !(/duckduckgo|youtube|couldn't find/i.test(response));
    } else if (isCorrection) {
      matched = /correc|updated|learned|got it|remember/i.test(lower);
    } else {
      const keyHits = t.keywords.filter(k => lower.includes(k.toLowerCase()));
      matched = keyHits.length >= Math.ceil(t.keywords.length * 0.4);
    }

    const status = matched ? '✅ PASS' : '❌ FAIL';
    if (matched) pass++; else fail++;
    
    const shortResp = response.slice(0, 100).replace(/\n/g, ' ');
    console.log(`${status} | "${t.q}"`);
    if (!matched) {
      console.log(`       Expected: ${t.expect}`);
      console.log(`       Got: ${shortResp}...`);
    }
  }

  console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed (${((pass / (pass + fail)) * 100).toFixed(1)}%) ===`);
}

run().catch(console.error);
