#!/usr/bin/env node
/**
 * VAI Calibration — 20 control questions to understand VAI's strengths/weaknesses
 * Usage: node scripts/calibrate-vai.mjs
 */
import WebSocket from 'ws';

const API = 'http://localhost:3006';
const WS_URL = 'ws://localhost:3006/api/chat';
const TIMEOUT = 15_000;

async function chatWithVai(conversationId, message, timeoutMs = TIMEOUT) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let response = '';
    let gotDone = false;
    ws.on('open', () => ws.send(JSON.stringify({ conversationId, content: message })));
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'text_delta' && msg.textDelta) response += msg.textDelta;
      else if (msg.type === 'done') { gotDone = true; ws.close(); }
      else if (msg.type === 'error') { ws.close(); reject(new Error(msg.error)); }
    });
    ws.on('close', () => resolve(response || '[no response]'));
    ws.on('error', (err) => reject(err));
    setTimeout(() => { if (!gotDone) { ws.close(); resolve(response || '[timeout]'); } }, timeoutMs);
  });
}

async function createConv(title) {
  const res = await fetch(`${API}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, modelId: 'vai:v0' }),
  });
  return (await res.json()).id;
}

const calibrationQuestions = [
  // 1-5: General knowledge (to see if VAI has any world knowledge)
  { q: 'What is the capital of France?', domain: 'general-knowledge', expect: 'Paris' },
  { q: 'Who painted the Mona Lisa?', domain: 'general-knowledge', expect: 'Leonardo da Vinci' },
  { q: 'What year did World War II end?', domain: 'general-knowledge', expect: '1945' },
  { q: 'What is DNA?', domain: 'science', expect: 'deoxyribonucleic acid' },
  { q: 'What is the boiling point of water in Celsius?', domain: 'science', expect: '100' },

  // 6-10: Programming / frameworks (to see what code knowledge exists)
  { q: 'What is Next.js and what does it do?', domain: 'framework', expect: 'React framework for SSR/SSG' },
  { q: 'Explain what Docker is and why developers use it.', domain: 'devops', expect: 'container/containerization' },
  { q: 'What is the difference between REST and GraphQL?', domain: 'web-api', expect: 'REST/GraphQL comparison' },
  { q: 'What is Tailwind CSS and how is it different from Bootstrap?', domain: 'css-framework', expect: 'utility-first' },
  { q: 'What is TypeScript and why use it over JavaScript?', domain: 'language', expect: 'type safety/static typing' },

  // 11-15: Architecture / best practices
  { q: 'What is WCAG and why is it important for web accessibility?', domain: 'accessibility', expect: 'Web Content Accessibility Guidelines' },
  { q: 'Explain GDPR and its impact on web development.', domain: 'privacy', expect: 'General Data Protection Regulation' },
  { q: 'What is a monorepo and when should you use one?', domain: 'architecture', expect: 'single repository for multiple projects' },
  { q: 'What is CI/CD and name some popular tools for it.', domain: 'devops', expect: 'continuous integration/deployment' },
  { q: 'What are design tokens and how are they used in modern CSS?', domain: 'design-system', expect: 'variables/tokens for design consistency' },

  // 16-18: Multi-language
  { q: 'How does Rust ensure memory safety without a garbage collector?', domain: 'rust', expect: 'ownership/borrowing' },
  { q: 'What is the GIL in Python and how does it affect concurrency?', domain: 'python', expect: 'Global Interpreter Lock' },
  { q: 'What are Go goroutines and how do they differ from OS threads?', domain: 'golang', expect: 'lightweight/green threads' },

  // 19-20: Norwegian context
  { q: 'Hva er universell utforming, og hvorfor er det viktig for norske nettsider?', domain: 'norwegian-web', expect: 'tilgjengelighet/WCAG' },
  { q: 'What is the Norwegian standard for a website MVP in 2026?', domain: 'norwegian-mvp', expect: 'WCAG/GDPR/responsive/HTTPS' },
];

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║     VAI Calibration — 20 Control Questions               ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  // Health check
  try {
    const h = await fetch(`${API}/health`);
    if (!h.ok) throw new Error(`${h.status}`);
    console.log('✓ Server healthy\n');
  } catch (e) {
    console.error(`✗ Server not reachable: ${e.message}`);
    process.exit(1);
  }

  const convId = await createConv('Calibration-20');
  const results = [];

  for (let i = 0; i < calibrationQuestions.length; i++) {
    const cq = calibrationQuestions[i];
    console.log(`\n${'━'.repeat(70)}`);
    console.log(`Q${i+1} [${cq.domain}]: ${cq.q}`);
    console.log(`   Expected keyword: ${cq.expect}`);
    console.log(`${'━'.repeat(70)}`);

    const answer = await chatWithVai(convId, cq.q);
    console.log(`VAI: ${answer.slice(0, 300)}${answer.length > 300 ? '...' : ''}`);

    // Classify
    const hasCodeBlock = /```/.test(answer);
    const hasFallback = /couldn't find|don't have|no.*match|try rephrasing/i.test(answer);
    const isHelloWorld = /hello.*world|console\.log/i.test(answer);
    const hasSubstance = answer.length > 100 && !hasFallback;

    let status;
    if (hasFallback) status = 'FALLBACK';
    else if (isHelloWorld && cq.domain !== 'language') status = 'WRONG-PATTERN';
    else if (hasCodeBlock && !['framework', 'devops', 'language', 'css-framework', 'architecture', 'design-system', 'rust', 'golang'].includes(cq.domain)) status = 'CODE-MISFIRE';
    else if (hasSubstance) status = 'ANSWERED';
    else status = 'WEAK';

    results.push({ idx: i+1, domain: cq.domain, status, len: answer.length, hasCodeBlock, hasFallback });
    console.log(`   → Status: ${status} | Length: ${answer.length} | Code: ${hasCodeBlock} | Fallback: ${hasFallback}`);
  }

  // Summary
  console.log('\n\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║               CALIBRATION SUMMARY                       ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');

  const groups = {};
  for (const r of results) {
    if (!groups[r.status]) groups[r.status] = [];
    groups[r.status].push(r);
  }

  for (const [status, items] of Object.entries(groups)) {
    const icon = status === 'ANSWERED' ? '✅' : status === 'FALLBACK' ? '🔴' : status === 'WRONG-PATTERN' ? '🟡' : status === 'CODE-MISFIRE' ? '🟠' : '⚪';
    console.log(`║  ${icon} ${status.padEnd(15)} ${String(items.length).padStart(2)}/20   Q${items.map(i => i.idx).join(', Q')}`.padEnd(59) + '║');
  }

  console.log('╠═══════════════════════════════════════════════════════════╣');

  // Domain breakdown
  const domainStatus = {};
  for (const r of results) {
    domainStatus[r.domain] = r.status;
  }
  console.log('║  Domain Breakdown:                                       ║');
  for (const [domain, status] of Object.entries(domainStatus)) {
    const icon = status === 'ANSWERED' ? '✅' : '❌';
    console.log(`║    ${icon} ${domain.padEnd(20)} ${status.padEnd(15)}`.padEnd(59) + '║');
  }

  console.log('╚═══════════════════════════════════════════════════════════╝');

  // Recommendations
  console.log('\n── Calibration Conclusions ──');
  const fallbackCount = (groups['FALLBACK'] || []).length;
  const wrongPatternCount = (groups['WRONG-PATTERN'] || []).length;
  const answeredCount = (groups['ANSWERED'] || []).length;

  console.log(`  Answered properly: ${answeredCount}/20`);
  console.log(`  Fell back to "no match": ${fallbackCount}/20`);
  console.log(`  Wrong pattern (code for non-code Q): ${wrongPatternCount}/20`);
  console.log(`  Domains that need knowledge handlers:`);

  const needsWork = results.filter(r => r.status !== 'ANSWERED').map(r => r.domain);
  const unique = [...new Set(needsWork)];
  unique.forEach(d => console.log(`    → ${d}`));
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
