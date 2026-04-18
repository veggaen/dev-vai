/**
 * Honest Quality Probe — tests Vai with varied, real-world prompts
 * and prints the FULL responses for human evaluation.
 *
 * This is NOT a pass/fail test. It's a mirror.
 * Read every response and judge: would you be happy if Vai said this?
 */
import { VaiEngine } from '../packages/core/src/models/vai-engine.js';

const engine = new VaiEngine();

// ── Prompt categories with varied phrasings of the same intent ──

const probes: Array<{ category: string; prompts: string[] }> = [
  {
    category: '🔧 PRACTICAL CODE REQUEST',
    prompts: [
      'write a debounce function in typescript',
      'can you make me a ts debounce utility',
      'i need debounce in typescript please',
      'how do I debounce in ts',
      'typescript debounce implementation',
    ],
  },
  {
    category: '🏗️ BUILD ME SOMETHING',
    prompts: [
      'build me a todo app',
      'make a simple todo list app',
      'create a todo application',
      'i want a basic task manager app',
      'scaffold a todo app for me',
    ],
  },
  {
    category: '💡 EXPLAIN A CONCEPT',
    prompts: [
      'what is a closure',
      'explain closures to me',
      'how do closures work in javascript',
      'can you explain what a closure is',
      'closures in js explained simply',
    ],
  },
  {
    category: '🆚 COMPARISON',
    prompts: [
      'react vs vue',
      'should I use react or vue',
      'compare react and vue for me',
      'what are the differences between react and vue',
      'react or vue which is better',
    ],
  },
  {
    category: '🐛 DEBUG HELP',
    prompts: [
      'TypeError: Cannot read properties of undefined',
      'my code says cannot read properties of undefined',
      'getting undefined error in javascript',
      'why am i getting TypeError undefined',
      'help me fix TypeError cannot read property of undefined',
    ],
  },
  {
    category: '🌐 REAL WORLD QUESTION',
    prompts: [
      'how do I deploy a next.js app to vercel',
      'deploy nextjs to vercel',
      'whats the process to ship a nextjs app on vercel',
      'how to put my next app on vercel',
      'nextjs vercel deployment steps',
    ],
  },
  {
    category: '🧠 FOLLOW-UP / CONTEXT',
    prompts: [
      'what is docker',
      // then follow up:
      'how is it different from a virtual machine',
      'when should I use it',
    ],
  },
  {
    category: '🗣️ CASUAL / AMBIGUOUS',
    prompts: [
      'hey',
      'sup',
      'whats good',
      'yo vai',
      'hello there',
    ],
  },
  {
    category: '📝 SHORT SPECIFIC QUESTION',
    prompts: [
      'what port does postgres use',
      'default port for postgresql',
      'postgres port number',
      'which port is postgres on',
      'what is the default postgresql port',
    ],
  },
  {
    category: '🔥 HARD / NUANCED',
    prompts: [
      'explain the event loop in node.js',
      'how does the node event loop actually work',
      'what is the node.js event loop and why does it matter',
      'break down the event loop for me',
      'node event loop explained in depth',
    ],
  },
  {
    category: '🎨 CREATIVE / OPEN-ENDED',
    prompts: [
      'give me some project ideas',
      'what should I build to learn coding',
      'suggest some side project ideas for a developer',
      'I want to build something cool, any ideas',
      'what are good beginner programming projects',
    ],
  },
  {
    category: '📦 SPECIFIC LIBRARY QUESTION',
    prompts: [
      'how do I use zustand for state management',
      'zustand tutorial',
      'show me how zustand works',
      'zustand react state management example',
      'getting started with zustand',
    ],
  },
];

// ── Quality metrics ──
interface ProbeResult {
  category: string;
  prompt: string;
  response: string;
  length: number;
  strategy: string;
  confidence: number;
  grade: 'GOOD' | 'WEAK' | 'BAD' | 'EMPTY';
}

function gradeResponse(prompt: string, response: string, confidence: number): ProbeResult['grade'] {
  // Empty or near-empty
  if (!response || response.trim().length < 15) return 'EMPTY';

  // Generic cop-outs
  const copOuts = [
    'I am still learning',
    'I don\'t have enough',
    'I\'m not sure',
    'I cannot',
    'I can\'t help',
    'beyond my current',
    'I don\'t know enough',
    'teach me',
    'feed me',
    'my training',
  ];
  const lower = response.toLowerCase();
  const hasCopOut = copOuts.some(c => lower.includes(c.toLowerCase()));

  // Is it just echoing the question back?
  const promptWords = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const responseWords = response.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const overlap = promptWords.filter(w => responseWords.includes(w)).length;
  const isEcho = promptWords.length > 0 && overlap / promptWords.length > 0.8 && response.length < prompt.length * 2;

  // Too short for a substantive answer
  const tooShort = response.length < 80 && !['hey', 'sup', 'whats good', 'yo vai', 'hello there'].includes(prompt.toLowerCase().trim());

  if (hasCopOut && confidence < 0.5) return 'BAD';
  if (hasCopOut) return 'WEAK';
  if (isEcho) return 'WEAK';
  if (tooShort) return 'WEAK';

  // For code requests, check if it actually has code
  const isCodeRequest = /\b(write|make|create|build|implement|code|function|example|show me)\b/i.test(prompt);
  const hasCode = /```|function\s|const\s|let\s|var\s|class\s|import\s|export\s|=>\s*{|def\s|return\s/m.test(response);
  if (isCodeRequest && !hasCode && response.length < 300) return 'WEAK';

  return 'GOOD';
}

async function collectResponse(prompt: string, history: Array<{ role: string; content: string }> = []): Promise<{ text: string; strategy: string; confidence: number }> {
  const messages = [...history, { role: 'user' as const, content: prompt }];
  let text = '';
  for await (const chunk of engine.chatStream({ messages })) {
    if (chunk.type === 'text_delta') text += chunk.textDelta;
  }
  // Access internal meta
  const meta = (engine as any)._lastMeta;
  return {
    text: text.trim(),
    strategy: meta?.strategy ?? 'unknown',
    confidence: meta?.confidence ?? 0,
  };
}

async function main() {
  const results: ProbeResult[] = [];
  let total = 0;
  let good = 0;
  let weak = 0;
  let bad = 0;
  let empty = 0;

  for (const category of probes) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`${category.category}`);
    console.log(`${'═'.repeat(70)}`);

    // For follow-up category, build conversation history
    if (category.category.includes('FOLLOW-UP')) {
      const history: Array<{ role: string; content: string }> = [];
      for (const prompt of category.prompts) {
        const res = await collectResponse(prompt, history);
        const grade = gradeResponse(prompt, res.text, res.confidence);

        console.log(`\n  📩 "${prompt}"`);
        console.log(`  📊 strategy=${res.strategy} confidence=${res.confidence.toFixed(2)} len=${res.text.length} grade=${grade}`);
        console.log(`  📝 ${res.text.slice(0, 300)}${res.text.length > 300 ? '...' : ''}`);

        results.push({ category: category.category, prompt, response: res.text, length: res.text.length, strategy: res.strategy, confidence: res.confidence, grade });
        history.push({ role: 'user', content: prompt });
        history.push({ role: 'assistant', content: res.text });
        total++;
        if (grade === 'GOOD') good++;
        else if (grade === 'WEAK') weak++;
        else if (grade === 'BAD') bad++;
        else empty++;
      }
      continue;
    }

    for (const prompt of category.prompts) {
      const res = await collectResponse(prompt);
      const grade = gradeResponse(prompt, res.text, res.confidence);

      console.log(`\n  📩 "${prompt}"`);
      console.log(`  📊 strategy=${res.strategy} confidence=${res.confidence.toFixed(2)} len=${res.text.length} grade=${grade}`);
      console.log(`  📝 ${res.text.slice(0, 300)}${res.text.length > 300 ? '...' : ''}`);

      results.push({ category: category.category, prompt, response: res.text, length: res.text.length, strategy: res.strategy, confidence: res.confidence, grade });
      total++;
      if (grade === 'GOOD') good++;
      else if (grade === 'WEAK') weak++;
      else if (grade === 'BAD') bad++;
      else empty++;
    }
  }

  // ── Summary ──
  console.log(`\n${'═'.repeat(70)}`);
  console.log('HONEST QUALITY SUMMARY');
  console.log(`${'═'.repeat(70)}`);
  console.log(`Total: ${total}`);
  console.log(`  GOOD:  ${good} (${(good/total*100).toFixed(1)}%)`);
  console.log(`  WEAK:  ${weak} (${(weak/total*100).toFixed(1)}%)`);
  console.log(`  BAD:   ${bad} (${(bad/total*100).toFixed(1)}%)`);
  console.log(`  EMPTY: ${empty} (${(empty/total*100).toFixed(1)}%)`);

  // Show all WEAK and BAD responses in full
  const failures = results.filter(r => r.grade === 'WEAK' || r.grade === 'BAD' || r.grade === 'EMPTY');
  if (failures.length > 0) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log('PROBLEM RESPONSES (full text)');
    console.log(`${'═'.repeat(70)}`);
    for (const f of failures) {
      console.log(`\n--- ${f.grade} | ${f.category} ---`);
      console.log(`Prompt: "${f.prompt}"`);
      console.log(`Strategy: ${f.strategy} | Confidence: ${f.confidence.toFixed(2)}`);
      console.log(`Response (${f.length} chars):`);
      console.log(f.response);
    }
  }

  // Consistency check: do same-intent prompts get same quality?
  console.log(`\n${'═'.repeat(70)}`);
  console.log('CONSISTENCY CHECK (same intent → same quality?)');
  console.log(`${'═'.repeat(70)}`);
  for (const category of probes) {
    if (category.category.includes('FOLLOW-UP')) continue;
    const catResults = results.filter(r => r.category === category.category);
    const strategies = [...new Set(catResults.map(r => r.strategy))];
    const grades = [...new Set(catResults.map(r => r.grade))];
    const avgLen = Math.round(catResults.reduce((a, r) => a + r.length, 0) / catResults.length);
    const lenRange = `${Math.min(...catResults.map(r => r.length))}-${Math.max(...catResults.map(r => r.length))}`;
    const consistent = grades.length === 1 ? '✓' : '✗ INCONSISTENT';
    console.log(`  ${category.category}`);
    console.log(`    Strategies: ${strategies.join(', ')}`);
    console.log(`    Grades: ${grades.join(', ')} ${consistent}`);
    console.log(`    Length range: ${lenRange} (avg ${avgLen})`);
  }
}

main().catch(console.error);
