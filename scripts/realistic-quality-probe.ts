/**
 * REALISTIC quality probe — loads the ACTUAL persisted knowledge store
 * (packages/runtime/vai-knowledge.json) to test what users really experience.
 *
 * Also compares each response against what Claude would say (the gold standard).
 */
import { VaiEngine } from '../packages/core/src/models/vai-engine.js';
import path from 'path';

// Load with the REAL knowledge store — the 1.3MB file with 948 entries incl. 433 YouTube
const KNOWLEDGE_PATH = path.resolve(import.meta.dirname, '..', 'packages', 'runtime', 'vai-knowledge.json');
const engine = new VaiEngine({ persistPath: KNOWLEDGE_PATH });

// These are the EXACT prompts from V3gga's screenshots + real-world prompts that matter
const realWorldPrompts: Array<{
  label: string;
  prompt: string;
  goldStandard: string; // What Claude/GPT would say (abbreviated)
  minQuality: string; // Minimum bar
}> = [
  // === FROM THE SCREENSHOTS ===
  {
    label: 'Screenshot 1: day query',
    prompt: 'what day is it today?',
    goldStandard: 'Today is Thursday, April 17, 2026.',
    minQuality: 'Should give the current date or acknowledge it cannot know real-time data',
  },
  {
    label: 'Screenshot 2: greeting + intent',
    prompt: 'hello',
    goldStandard: 'Hey! How can I help you today?',
    minQuality: 'Friendly greeting, offer to help',
  },
  {
    label: 'Screenshot 2: make an app',
    prompt: 'I want to make a app',
    goldStandard: 'What kind of app? Here are some popular stacks to start with: React + TypeScript for frontend, Next.js for full-stack, or React Native for mobile.',
    minQuality: 'Should ask what kind of app OR offer stack choices. Must NOT return YouTube transcript content.',
  },
  {
    label: 'Screenshot 2: photographer app',
    prompt: 'build me a single page app for a pro-photographer',
    goldStandard: 'For a pro photographer, start with a premium single-page portfolio: full-bleed hero, featured shoots, services, testimonials, and a booking CTA. Vinext or Vite + React is a strong SPA fit; Next.js if SEO matters.',
    minQuality: 'Should give photography-specific product direction, not a generic stack menu or fallback.',
  },
  {
    label: 'Screenshot 2: commerce store',
    prompt: 'I want to make a general store like finn.no or a commerce store...',
    goldStandard: 'For an e-commerce store like Finn.no, I recommend: Next.js + Stripe for payments, PostgreSQL for products, and Tailwind for UI. Here is the architecture...',
    minQuality: 'Should offer concrete e-commerce stack advice. Must NOT say "I couldn\'t find a strong match".',
  },
  {
    label: 'Screenshot 3: React 19 features',
    prompt: 'Explain React 19 features',
    goldStandard: 'React 19 key features: React Compiler (auto-memoization), Server Components stable, Actions for forms, use() hook, document metadata, asset loading...',
    minQuality: 'Should explain React 19 features. Must NOT say "I couldn\'t find a strong match" or return YouTube URLs.',
  },
  {
    label: 'Screenshot 3: React changes',
    prompt: 'What changed recently in React?',
    goldStandard: 'React 19 (Dec 2024): React Compiler, Server Components, Actions, use() hook, ref as prop, improved error reporting...',
    minQuality: 'Should describe recent React changes. Must NOT return YouTube URLs.',
  },

  // === REAL-WORLD PROMPTS THAT MATTER ===
  {
    label: 'Code request: debounce',
    prompt: 'write a debounce function in typescript',
    goldStandard: 'function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): (...args: Parameters<T>) => void { let timeout: ReturnType<typeof setTimeout>; return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => fn(...args), delay); }; }',
    minQuality: 'Must contain actual TypeScript debounce code with generics',
  },
  {
    label: 'Explain: closures',
    prompt: 'what is a closure in javascript',
    goldStandard: 'A closure is a function that retains access to its outer scope variables even after the outer function has returned. Example: function counter() { let count = 0; return () => ++count; }',
    minQuality: 'Must explain closures correctly. Must NOT return Google Closure Templates.',
  },
  {
    label: 'Practical: docker basics',
    prompt: 'what is docker and why should I use it',
    goldStandard: 'Docker packages apps into containers — lightweight, portable environments that run consistently everywhere. Key benefits: consistent dev/prod, isolation, easy deployment.',
    minQuality: 'Must explain Docker containers vs VMs, practical benefits',
  },
  {
    label: 'Build request: landing page',
    prompt: 'build me a landing page',
    goldStandard: 'Here is a responsive landing page with hero section, features grid, and CTA. Stack: HTML + Tailwind CSS...',
    minQuality: 'Should offer to build or redirect to builder mode. Must NOT return YouTube content.',
  },
  {
    label: 'Follow-up: context retention',
    prompt: 'tell me more about that',
    goldStandard: '(Depends on context — should acknowledge there is no prior context)',
    minQuality: 'Should ask what "that" refers to, NOT return random YouTube content',
  },
  {
    label: 'Error diagnosis',
    prompt: 'TypeError: Cannot read properties of undefined (reading "map")',
    goldStandard: 'This error means you\'re calling .map() on undefined. Common causes: 1) API data not loaded yet, 2) wrong variable name, 3) missing default value. Fix: use optional chaining (data?.map()) or default to empty array.',
    minQuality: 'Must diagnose the TypeError and offer practical fixes',
  },
  {
    label: 'Library: prisma',
    prompt: 'how do I set up prisma with postgresql',
    goldStandard: 'npm install prisma @prisma/client, npx prisma init, configure DATABASE_URL in .env, define schema, npx prisma migrate dev',
    minQuality: 'Must give Prisma setup steps with PostgreSQL',
  },
  {
    label: 'Comparison: SQL vs NoSQL',
    prompt: 'should I use SQL or NoSQL for my project',
    goldStandard: 'SQL (PostgreSQL, MySQL) for relational data, transactions, complex queries. NoSQL (MongoDB, Redis) for flexible schemas, high write throughput, document storage.',
    minQuality: 'Must compare both with use cases, not just definitions',
  },
  {
    label: 'Norwegian test',
    prompt: 'hva er typescript',
    goldStandard: 'TypeScript er JavaScript med statisk typing. Det fanger feil før koden kjører, og er utviklet av Microsoft.',
    minQuality: 'Should answer in Norwegian about TypeScript',
  },
  {
    label: 'Ambiguous short query',
    prompt: 'next.js',
    goldStandard: 'Next.js is a React framework for production. Key features: App Router, Server Components, file-based routing, API routes, SSR/SSG/ISR.',
    minQuality: 'Should give a Next.js overview. Must NOT return "I couldn\'t find a strong match".',
  },
  {
    label: 'Real question: auth',
    prompt: 'how do I add authentication to my next.js app',
    goldStandard: 'Options: NextAuth.js/Auth.js (easiest), Clerk (managed), Supabase Auth, or custom JWT. NextAuth setup: npm install next-auth, create [...nextauth].ts route...',
    minQuality: 'Must give auth options and basic setup steps',
  },
  {
    label: 'Vague creative request',
    prompt: 'give me something cool to build',
    goldStandard: 'Project ideas: 1) Real-time chat with WebSockets, 2) AI image generator, 3) Personal finance tracker, 4) Multiplayer game, 5) CLI tool...',
    minQuality: 'Should suggest concrete project ideas, not generic advice',
  },
];

interface Result {
  label: string;
  prompt: string;
  response: string;
  strategy: string;
  confidence: number;
  grade: 'PASS' | 'FAIL' | 'PARTIAL';
  failReason?: string;
  goldStandard: string;
}

function gradeRealistically(prompt: string, response: string, gold: string, minQuality: string): { grade: Result['grade']; reason?: string } {
  const lower = response.toLowerCase();
  const len = response.length;

  // Hard failures — these are automatic FAIL
  if (!response || len < 10) return { grade: 'FAIL', reason: 'Empty or near-empty response' };

  // YouTube leakage — automatic FAIL
  if (/youtube\.com\/watch/i.test(response) && !/source/i.test(response.slice(0, 50))) {
    return { grade: 'FAIL', reason: 'Response contains raw YouTube URLs as content (knowledge pollution)' };
  }

  // "I couldn't find a strong match" — automatic FAIL for anything except truly obscure queries
  if (/couldn.t find a strong match|couldn.t find a match/i.test(lower)) {
    return { grade: 'FAIL', reason: '"Couldn\'t find a strong match" — should have curated knowledge for this common topic' };
  }

  // YouTube transcript content leaking into response
  const ytSignals = [
    'obviously you know',
    'in the demo that',
    'was showing um online',
    'like agents working on',
    'you can go really easily within like minutes',
    'you can just collect the',
    'the first is more exciting and more wonderful',
    'we had like agents',
    'sort of in tandem',
  ];
  if (ytSignals.some(s => lower.includes(s))) {
    return { grade: 'FAIL', reason: 'Response contains YouTube transcript fragments' };
  }

  // Cop-out detection
  if (/i don.t have a solid answer|i.m still learning|beyond my current|teach me/i.test(lower)) {
    // Only acceptable for truly obscure topics
    if (/react|typescript|docker|next|prisma|auth|closure|sql|debounce/i.test(prompt)) {
      return { grade: 'FAIL', reason: 'Cop-out for a common topic Vai should know' };
    }
  }

  // Code requests must have code
  if (/write|create|implement|function|code/i.test(prompt) && /debounce|throttle|sort|filter/i.test(prompt)) {
    if (!/```|function\s|const\s|=>/m.test(response)) {
      return { grade: 'FAIL', reason: 'Code request but no code in response' };
    }
  }

  // Specific quality checks
  if (/closure/i.test(prompt) && /google.*closure.*templates|closure.*templates/i.test(lower)) {
    return { grade: 'FAIL', reason: 'Returned Google Closure Templates instead of JavaScript closures' };
  }

  if (/react\s*19|react.*features/i.test(prompt) && len < 100) {
    return { grade: 'FAIL', reason: 'React 19 features response too short' };
  }

  // Generic quality: is the response relevant to the prompt?
  const promptKeywords = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const responseWords = new Set(lower.split(/\s+/));
  const relevantHits = promptKeywords.filter(w => responseWords.has(w)).length;
  const relevance = promptKeywords.length > 0 ? relevantHits / promptKeywords.length : 1;

  if (relevance < 0.15 && len > 50) {
    return { grade: 'PARTIAL', reason: `Low topic relevance (${(relevance * 100).toFixed(0)}% keyword overlap)` };
  }

  // Length check — very short answers for substantial questions
  if (len < 60 && !/hello|hey|hi|sup|what.*day/i.test(prompt)) {
    return { grade: 'PARTIAL', reason: `Very short response (${len} chars) for a substantial question` };
  }

  return { grade: 'PASS' };
}

async function collectResponse(prompt: string): Promise<{ text: string; strategy: string; confidence: number }> {
  const messages = [{ role: 'user' as const, content: prompt }];
  let text = '';
  for await (const chunk of engine.chatStream({ messages })) {
    if (chunk.type === 'text_delta') text += chunk.textDelta;
  }
  const meta = (engine as any)._lastMeta;
  return {
    text: text.trim(),
    strategy: meta?.strategy ?? 'unknown',
    confidence: meta?.confidence ?? 0,
  };
}

async function main() {
  console.log(`\nLoading knowledge from: ${KNOWLEDGE_PATH}`);
  console.log(`Knowledge entries: ${engine.knowledge.entryCount}`);
  console.log(`Knowledge concepts: ${engine.knowledge.conceptCount}`);
  console.log('');

  const results: Result[] = [];

  for (const probe of realWorldPrompts) {
    const res = await collectResponse(probe.prompt);
    const { grade, reason } = gradeRealistically(probe.prompt, res.text, probe.goldStandard, probe.minQuality);

    const icon = grade === 'PASS' ? '✅' : grade === 'PARTIAL' ? '⚠️' : '❌';
    console.log(`${icon} [${grade}] ${probe.label}`);
    console.log(`   Prompt: "${probe.prompt}"`);
    console.log(`   Strategy: ${res.strategy} | Confidence: ${res.confidence.toFixed(2)} | Length: ${res.text.length}`);
    if (reason) console.log(`   ⛔ ${reason}`);
    // Show first 200 chars of response
    console.log(`   Response: ${res.text.slice(0, 200).replace(/\n/g, '\\n')}${res.text.length > 200 ? '...' : ''}`);
    // Show gold standard for comparison
    console.log(`   Claude would say: ${probe.goldStandard.slice(0, 150)}...`);
    console.log('');

    results.push({
      label: probe.label,
      prompt: probe.prompt,
      response: res.text,
      strategy: res.strategy,
      confidence: res.confidence,
      grade,
      failReason: reason,
      goldStandard: probe.goldStandard,
    });
  }

  // Summary
  const pass = results.filter(r => r.grade === 'PASS').length;
  const partial = results.filter(r => r.grade === 'PARTIAL').length;
  const fail = results.filter(r => r.grade === 'FAIL').length;
  const total = results.length;

  console.log('═'.repeat(70));
  console.log('REALISTIC QUALITY SUMMARY (with persisted knowledge)');
  console.log('═'.repeat(70));
  console.log(`Total:   ${total}`);
  console.log(`  PASS:    ${pass} (${(pass / total * 100).toFixed(1)}%)`);
  console.log(`  PARTIAL: ${partial} (${(partial / total * 100).toFixed(1)}%)`);
  console.log(`  FAIL:    ${fail} (${(fail / total * 100).toFixed(1)}%)`);
  console.log('');

  if (fail > 0) {
    console.log('═'.repeat(70));
    console.log('FAILURES — FULL RESPONSES');
    console.log('═'.repeat(70));
    for (const r of results.filter(r => r.grade === 'FAIL')) {
      console.log(`\n--- ❌ ${r.label} ---`);
      console.log(`Prompt: "${r.prompt}"`);
      console.log(`Strategy: ${r.strategy} | Confidence: ${r.confidence.toFixed(2)}`);
      console.log(`Reason: ${r.failReason}`);
      console.log(`Response (${r.response.length} chars):`);
      console.log(r.response);
      console.log(`\nClaude would say: ${r.goldStandard}`);
    }
  }

  // Strategy failure analysis
  console.log('\n' + '═'.repeat(70));
  console.log('STRATEGY FAILURE ANALYSIS');
  console.log('═'.repeat(70));
  const strategyGrades = new Map<string, { pass: number; fail: number; partial: number }>();
  for (const r of results) {
    const stats = strategyGrades.get(r.strategy) ?? { pass: 0, fail: 0, partial: 0 };
    stats[r.grade === 'PASS' ? 'pass' : r.grade === 'FAIL' ? 'fail' : 'partial']++;
    strategyGrades.set(r.strategy, stats);
  }
  for (const [strat, stats] of [...strategyGrades.entries()].sort((a, b) => b[1].fail - a[1].fail)) {
    const total = stats.pass + stats.fail + stats.partial;
    const failPct = (stats.fail / total * 100).toFixed(0);
    console.log(`  ${strat}: ${stats.pass}P/${stats.partial}W/${stats.fail}F (${failPct}% fail rate)`);
  }
}

main().catch(console.error);
