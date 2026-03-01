/**
 * VCUS Interview Benchmark — Simulate Senior Developer Interview
 *
 * Simulates an interview by 2 senior developers:
 * 1. OWASP security expert — Tests security knowledge
 * 2. Altibox senior engineer — Tests architecture & version knowledge
 *
 * Scoring: Same as test-vai.ts (60% required keywords, 25% bonus, 10% word count)
 * Pass threshold: ≥50 per question, overall target: 90%+
 *
 * Usage: tsx src/interview-benchmark.ts
 */

const BASE = process.env.VAI_URL || 'http://localhost:3006';

// ─── Test Types ─────────────────────────────────────────────────

interface InterviewQuestion {
  id: string;
  category: 'security' | 'architecture' | 'versions' | 'engineering';
  interviewer: 'owasp' | 'altibox';
  question: string;
  requiredKeywords: string[];
  bonusKeywords?: string[];
  antiPatterns?: string[];
  minWords?: number;
  tests: string;
}

interface TestResult {
  question: InterviewQuestion;
  answer: string;
  score: number;
  passed: boolean;
  matchedKeywords: string[];
  missedKeywords: string[];
  matchedAntiPatterns: string[];
  feedback: string;
}

// ─── Interview Questions ────────────────────────────────────────

const INTERVIEW_QUESTIONS: InterviewQuestion[] = [

  // ═══════════════════════════════════════════════════════════════
  //  OWASP EXPERT QUESTIONS (Security)
  // ═══════════════════════════════════════════════════════════════

  {
    id: 'owasp-top10-1',
    category: 'security',
    interviewer: 'owasp',
    question: 'What is the OWASP Top 10 and what are the most critical risks in the 2021 edition?',
    requiredKeywords: ['owasp', 'top 10', 'broken access control'],
    bonusKeywords: ['injection', 'cryptographic', 'security misconfiguration', 'ssrf', 'a01', 'vulnerable', '2021'],
    antiPatterns: ['2017 edition', 'top 5'],
    minWords: 30,
    tests: 'Knowledge of OWASP Top 10 2021 standard'
  },
  {
    id: 'owasp-top10-2',
    category: 'security',
    interviewer: 'owasp',
    question: 'Which OWASP Top 10 risks are most relevant to a modern React + Fastify + Tauri application?',
    requiredKeywords: ['broken access control', 'injection'],
    bonusKeywords: ['xss', 'cors', 'csrf', 'ssrf', 'vulnerable', 'component', 'security misconfiguration'],
    minWords: 25,
    tests: 'Ability to apply OWASP to specific tech stack'
  },
  {
    id: 'owasp-xss-1',
    category: 'security',
    interviewer: 'owasp',
    question: 'How do you prevent XSS attacks in a React application?',
    requiredKeywords: ['xss', 'react'],
    bonusKeywords: ['escape', 'dangerouslysetinnerhtml', 'sanitize', 'csp', 'dompurify', 'cross-site scripting'],
    antiPatterns: ['react has no xss protection'],
    minWords: 20,
    tests: 'XSS prevention in React'
  },
  {
    id: 'owasp-xss-2',
    category: 'security',
    interviewer: 'owasp',
    question: 'What is dangerouslySetInnerHTML in React and when should it be used safely?',
    requiredKeywords: ['dangerouslysetinnerhtml', 'sanitize'],
    bonusKeywords: ['dompurify', 'xss', 'html', 'injection', 'cross-site'],
    antiPatterns: ['always safe to use', 'no risk'],
    minWords: 15,
    tests: 'Understanding dangerouslySetInnerHTML risks'
  },
  {
    id: 'owasp-csrf-1',
    category: 'security',
    interviewer: 'owasp',
    question: 'How do you protect against CSRF attacks in your single-page application?',
    requiredKeywords: ['csrf', 'samesite'],
    bonusKeywords: ['cookie', 'token', 'origin', 'lax', 'strict', 'cross-site request forgery'],
    minWords: 20,
    tests: 'CSRF protection strategies'
  },
  {
    id: 'owasp-sqli-1',
    category: 'security',
    interviewer: 'owasp',
    question: 'How does your application prevent SQL injection when using Drizzle ORM with SQLite?',
    requiredKeywords: ['sql injection', 'parameterized'],
    bonusKeywords: ['drizzle', 'prepared statement', 'better-sqlite3', 'orm', 'query'],
    antiPatterns: ['string concatenation is fine', 'sqlite is immune'],
    minWords: 20,
    tests: 'SQL injection prevention with ORM'
  },
  {
    id: 'owasp-auth-1',
    category: 'security',
    interviewer: 'owasp',
    question: 'Walk me through secure authentication. How do you handle JWT vs session-based auth?',
    requiredKeywords: ['jwt', 'session'],
    bonusKeywords: ['bcrypt', 'oauth', 'token', 'stateless', 'refresh', 'password', 'hash'],
    antiPatterns: ['store jwt in localstorage is safest', 'md5 for passwords'],
    minWords: 25,
    tests: 'Authentication security knowledge'
  },
  {
    id: 'owasp-headers-1',
    category: 'security',
    interviewer: 'owasp',
    question: 'What security headers should a web application implement and why?',
    requiredKeywords: ['content-security-policy', 'strict-transport-security'],
    bonusKeywords: ['csp', 'hsts', 'x-frame-options', 'x-content-type-options', 'nosniff', 'referrer-policy'],
    minWords: 20,
    tests: 'Security headers knowledge'
  },
  {
    id: 'owasp-cors-1',
    category: 'security',
    interviewer: 'owasp',
    question: 'How does CORS work and how is it configured in your Fastify backend?',
    requiredKeywords: ['cors', 'origin'],
    bonusKeywords: ['preflight', 'access-control', '@fastify/cors', 'credentials', 'options', 'cross-origin'],
    antiPatterns: ['cors prevents all attacks', 'allow origin star is safe'],
    minWords: 20,
    tests: 'CORS understanding and configuration'
  },
  {
    id: 'owasp-deps-1',
    category: 'security',
    interviewer: 'owasp',
    question: 'How do you manage dependency security and prevent supply chain attacks?',
    requiredKeywords: ['audit', 'supply chain'],
    bonusKeywords: ['npm audit', 'lockfile', 'vulnerability', 'dependabot', 'snyk', 'pnpm'],
    minWords: 20,
    tests: 'Dependency security and supply chain'
  },
  {
    id: 'owasp-ssrf-1',
    category: 'security',
    interviewer: 'owasp',
    question: 'What is SSRF and how do you prevent it in an application that fetches external URLs?',
    requiredKeywords: ['ssrf', 'server-side request forgery'],
    bonusKeywords: ['allowlist', 'internal', 'validate', 'url', 'metadata', 'ip', '169.254'],
    minWords: 20,
    tests: 'SSRF attack understanding and prevention'
  },
  {
    id: 'owasp-ws-1',
    category: 'security',
    interviewer: 'owasp',
    question: 'How do you secure WebSocket connections in your application?',
    requiredKeywords: ['websocket', 'authentication'],
    bonusKeywords: ['wss', 'rate limit', 'token', 'validate', 'connection', '@fastify/websocket'],
    minWords: 15,
    tests: 'WebSocket security'
  },
  {
    id: 'owasp-csp-1',
    category: 'security',
    interviewer: 'owasp',
    question: 'Explain Content Security Policy. How does it prevent XSS and how is it configured in Tauri?',
    requiredKeywords: ['content security policy', 'xss'],
    bonusKeywords: ['csp', 'script-src', 'default-src', 'tauri', 'self', 'directive', 'header'],
    minWords: 20,
    tests: 'CSP knowledge'
  },
  {
    id: 'owasp-rate-1',
    category: 'security',
    interviewer: 'owasp',
    question: 'How do you implement rate limiting to protect your API from brute force and DDoS attacks?',
    requiredKeywords: ['rate limit'],
    bonusKeywords: ['brute force', 'ddos', 'fastify', 'window', 'ip', 'token bucket'],
    minWords: 15,
    tests: 'Rate limiting knowledge'
  },

  // ═══════════════════════════════════════════════════════════════
  //  ALTIBOX ENGINEERING QUESTIONS (Architecture & Versions)
  // ═══════════════════════════════════════════════════════════════

  {
    id: 'eng-react19-1',
    category: 'architecture',
    interviewer: 'altibox',
    question: 'What is new in React 19 that your project takes advantage of?',
    requiredKeywords: ['react 19', 'use()'],
    bonusKeywords: ['forwardref', 'ref', 'useactionstate', 'server component', 'prop', 'hook'],
    antiPatterns: ['react 18 features', 'no changes from react 18'],
    minWords: 20,
    tests: 'React 19 feature knowledge'
  },
  {
    id: 'eng-react19-2',
    category: 'architecture',
    interviewer: 'altibox',
    question: 'Do you still need forwardRef in React 19? What changed?',
    requiredKeywords: ['forwardref', 'ref'],
    bonusKeywords: ['prop', 'react 19', 'no longer', 'backward compatibility', 'function component'],
    antiPatterns: ['forwardref is removed', 'forwardref is required'],
    minWords: 15,
    tests: 'React 19 ref changes'
  },
  {
    id: 'eng-fastify-1',
    category: 'architecture',
    interviewer: 'altibox',
    question: 'Why did you choose Fastify 5 over Express? What are the advantages?',
    requiredKeywords: ['fastify', 'plugin'],
    bonusKeywords: ['performance', 'express', 'encapsulation', 'schema', 'typescript', 'lifecycle', 'validation', 'hook'],
    antiPatterns: ['express is better', 'no difference'],
    minWords: 20,
    tests: 'Fastify vs Express'
  },
  {
    id: 'eng-fastify-2',
    category: 'architecture',
    interviewer: 'altibox',
    question: 'How does Fastify plugin system and encapsulation work?',
    requiredKeywords: ['plugin', 'encapsulation'],
    bonusKeywords: ['register', 'decorator', 'fastify', 'scope', 'hook', 'lifecycle'],
    minWords: 15,
    tests: 'Fastify plugin architecture'
  },
  {
    id: 'eng-tauri-1',
    category: 'architecture',
    interviewer: 'altibox',
    question: 'Why did you choose Tauri 2 over Electron for the desktop app?',
    requiredKeywords: ['tauri', 'electron'],
    bonusKeywords: ['rust', 'binary', 'memory', 'webview', 'smaller', 'permission', 'mobile', 'performance', 'security'],
    antiPatterns: ['electron is better for all cases', 'same performance'],
    minWords: 20,
    tests: 'Tauri 2 vs Electron comparison'
  },
  {
    id: 'eng-tauri-2',
    category: 'architecture',
    interviewer: 'altibox',
    question: 'How does Tauri 2 handle security with its permission and capability system?',
    requiredKeywords: ['permission', 'tauri'],
    bonusKeywords: ['capability', 'ipc', 'invoke', 'plugin', 'security', 'rust', 'shell'],
    minWords: 15,
    tests: 'Tauri 2 security model'
  },
  {
    id: 'eng-monorepo-1',
    category: 'architecture',
    interviewer: 'altibox',
    question: 'Walk me through your monorepo structure with pnpm workspaces.',
    requiredKeywords: ['pnpm', 'workspace'],
    bonusKeywords: ['monorepo', 'packages', 'apps', 'core', 'runtime', 'shared', '@vai'],
    minWords: 20,
    tests: 'Monorepo structure understanding'
  },
  {
    id: 'eng-pnpm-1',
    category: 'architecture',
    interviewer: 'altibox',
    question: 'Why pnpm over npm or yarn? What are the advantages?',
    requiredKeywords: ['pnpm'],
    bonusKeywords: ['disk space', 'hard link', 'strict', 'phantom', 'lockfile', 'workspace', 'fast'],
    antiPatterns: ['npm is identical', 'no real difference'],
    minWords: 15,
    tests: 'pnpm advantages'
  },
  {
    id: 'eng-zustand-1',
    category: 'architecture',
    interviewer: 'altibox',
    question: 'Why Zustand over Redux for state management? How does Zustand 5 work?',
    requiredKeywords: ['zustand', 'redux'],
    bonusKeywords: ['boilerplate', 'provider', 'selector', 'middleware', 'persist', 'store', 'create', 'small'],
    antiPatterns: ['redux is simpler', 'zustand needs provider'],
    minWords: 20,
    tests: 'Zustand vs Redux'
  },
  {
    id: 'eng-drizzle-1',
    category: 'architecture',
    interviewer: 'altibox',
    question: 'How does Drizzle ORM handle schema definition and migrations with SQLite?',
    requiredKeywords: ['drizzle', 'schema'],
    bonusKeywords: ['migration', 'type-safe', 'sqlite', 'drizzle-kit', 'better-sqlite3', 'query'],
    minWords: 20,
    tests: 'Drizzle ORM usage'
  },
  {
    id: 'eng-vite-1',
    category: 'architecture',
    interviewer: 'altibox',
    question: 'What are the advantages of using Vite 6 for your build pipeline?',
    requiredKeywords: ['vite', 'hmr'],
    bonusKeywords: ['esbuild', 'rollup', 'esm', 'fast', 'dev server', 'plugin', 'code splitting'],
    antiPatterns: ['webpack is faster'],
    minWords: 15,
    tests: 'Vite 6 advantages'
  },
  {
    id: 'eng-vitest-1',
    category: 'architecture',
    interviewer: 'altibox',
    question: 'How do you test your application with Vitest? What testing strategy do you use?',
    requiredKeywords: ['vitest', 'test'],
    bonusKeywords: ['workspace', 'coverage', 'unit', 'integration', 'e2e', 'jest', 'vite-native', 'mock'],
    minWords: 20,
    tests: 'Vitest testing strategy'
  },
  {
    id: 'eng-error-1',
    category: 'engineering',
    interviewer: 'altibox',
    question: 'How do you handle errors in your React and Fastify application?',
    requiredKeywords: ['error'],
    bonusKeywords: ['boundary', 'try', 'catch', 'result', 'fastify', 'handler', 'react'],
    minWords: 15,
    tests: 'Error handling patterns'
  },
  {
    id: 'eng-perf-1',
    category: 'engineering',
    interviewer: 'altibox',
    question: 'What performance optimizations do you use in your React application?',
    requiredKeywords: ['memo', 'react'],
    bonusKeywords: ['usememo', 'usecallback', 'lazy', 'suspense', 'code splitting', 'selector', 'zustand', 'tree shaking'],
    minWords: 20,
    tests: 'React performance optimization'
  },
  {
    id: 'eng-wxt-1',
    category: 'architecture',
    interviewer: 'altibox',
    question: 'How does the wxt browser extension framework work?',
    requiredKeywords: ['wxt', 'extension'],
    bonusKeywords: ['vite', 'content script', 'background', 'popup', 'entrypoint', 'manifest', 'browser'],
    minWords: 15,
    tests: 'wxt browser extension framework'
  },
  {
    id: 'eng-typescript-1',
    category: 'engineering',
    interviewer: 'altibox',
    question: 'How is TypeScript configured in your monorepo? What strict mode options do you use?',
    requiredKeywords: ['typescript', 'strict'],
    bonusKeywords: ['es2022', 'esnext', 'bundler', 'moduleresolution', 'tsconfig', 'zod'],
    minWords: 15,
    tests: 'TypeScript configuration'
  },

  // ═══════════════════════════════════════════════════════════════
  //  VERSION AWARENESS QUESTIONS
  // ═══════════════════════════════════════════════════════════════

  {
    id: 'ver-react-1',
    category: 'versions',
    interviewer: 'altibox',
    question: 'What version of React are you using and what are the key features of that version?',
    requiredKeywords: ['react', '19'],
    bonusKeywords: ['use()', 'forwardref', 'server component', 'useactionstate', 'ref', 'hook'],
    antiPatterns: ['react 18', 'react 17', 'react 16'],
    minWords: 15,
    tests: 'React version awareness'
  },
  {
    id: 'ver-fastify-1',
    category: 'versions',
    interviewer: 'altibox',
    question: 'What version of Fastify does the project use?',
    requiredKeywords: ['fastify', '5'],
    bonusKeywords: ['plugin', 'node.js', 'esm', 'typescript', 'performance'],
    antiPatterns: ['fastify 3', 'fastify 4', 'express'],
    minWords: 10,
    tests: 'Fastify version awareness'
  },
  {
    id: 'ver-tauri-1',
    category: 'versions',
    interviewer: 'altibox',
    question: 'What version of Tauri are you using and how is the Rust project configured?',
    requiredKeywords: ['tauri', '2'],
    bonusKeywords: ['rust', 'serde', '2021', 'cargo', 'plugin-shell', 'lto', 'edition'],
    antiPatterns: ['tauri 1', 'electron'],
    minWords: 10,
    tests: 'Tauri version and Rust config'
  },
  {
    id: 'ver-typescript-1',
    category: 'versions',
    interviewer: 'altibox',
    question: 'What TypeScript version and configuration target does the project use?',
    requiredKeywords: ['typescript', '5.7'],
    bonusKeywords: ['es2022', 'strict', 'esnext', 'bundler', 'moduleresolution'],
    antiPatterns: ['typescript 4', 'commonjs target'],
    minWords: 10,
    tests: 'TypeScript version awareness'
  },
  {
    id: 'ver-vite-1',
    category: 'versions',
    interviewer: 'altibox',
    question: 'What version of Vite is used and what are its key features?',
    requiredKeywords: ['vite', '6'],
    bonusKeywords: ['hmr', 'esbuild', 'rollup', 'esm', 'environment api', 'fast'],
    antiPatterns: ['vite 4', 'vite 3', 'webpack'],
    minWords: 10,
    tests: 'Vite version awareness'
  },
  {
    id: 'ver-drizzle-1',
    category: 'versions',
    interviewer: 'altibox',
    question: 'What version of Drizzle ORM and what database driver are you using?',
    requiredKeywords: ['drizzle', '0.38'],
    bonusKeywords: ['better-sqlite3', 'sqlite', 'drizzle-kit', 'type-safe', '11.8'],
    antiPatterns: ['prisma', 'typeorm', 'sequelize'],
    minWords: 10,
    tests: 'Drizzle ORM version awareness'
  },
  {
    id: 'ver-zustand-1',
    category: 'versions',
    interviewer: 'altibox',
    question: 'What version of Zustand are you running?',
    requiredKeywords: ['zustand', '5'],
    bonusKeywords: ['create', 'store', 'middleware', 'persist', 'react 18'],
    antiPatterns: ['zustand 3', 'zustand 4', 'redux'],
    minWords: 8,
    tests: 'Zustand version awareness'
  },
  {
    id: 'ver-vitest-1',
    category: 'versions',
    interviewer: 'altibox',
    question: 'What testing framework and version do you use?',
    requiredKeywords: ['vitest', '3'],
    bonusKeywords: ['workspace', 'coverage', 'vite-native', 'esm', 'jest-compatible'],
    antiPatterns: ['jest', 'mocha', 'vitest 1'],
    minWords: 8,
    tests: 'Vitest version awareness'
  },
  {
    id: 'ver-tailwind-1',
    category: 'versions',
    interviewer: 'altibox',
    question: 'What version of Tailwind CSS is the project using?',
    requiredKeywords: ['tailwind', '3.4'],
    bonusKeywords: ['utility', 'postcss', 'css'],
    antiPatterns: ['tailwind 2', 'tailwind 4', 'tailwind 1'],
    minWords: 5,
    tests: 'Tailwind version awareness'
  },
  {
    id: 'ver-wxt-1',
    category: 'versions',
    interviewer: 'altibox',
    question: 'What framework and version do you use for the browser extension?',
    requiredKeywords: ['wxt', '0.20'],
    bonusKeywords: ['vite', 'extension', 'browser', 'chrome', 'firefox'],
    antiPatterns: ['plasmo', 'crxjs'],
    minWords: 5,
    tests: 'wxt version awareness'
  },
  {
    id: 'ver-stack-1',
    category: 'versions',
    interviewer: 'altibox',
    question: 'Give me an overview of the key technology versions in your project stack.',
    requiredKeywords: ['react', 'fastify', 'tauri'],
    bonusKeywords: ['19', '5', '2', 'zustand', 'drizzle', 'vite', 'vitest', 'typescript', 'tailwind'],
    minWords: 20,
    tests: 'Full stack version overview'
  },
];

// ─── Helper Functions ───────────────────────────────────────────

async function askVai(question: string): Promise<{ answer: string; convId: string }> {
  const res = await fetch(`${BASE}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'vai:v0', title: 'Interview Benchmark' }),
  });
  const conv = await res.json() as { id: string };

  const msgRes = await fetch(`${BASE}/api/conversations/${conv.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: question }),
    signal: AbortSignal.timeout(30000),
  });

  if (!msgRes.ok) {
    // Fallback to direct chat API
    const chatRes = await fetch(`${BASE}/api/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'vai:v0',
        messages: [{ role: 'user', content: question }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!chatRes.ok) throw new Error(`Chat failed: ${chatRes.status}`);
    const data = await chatRes.json() as { choices?: Array<{ message?: { content: string } }> };
    return { answer: data.choices?.[0]?.message?.content ?? '', convId: conv.id };
  }

  const data = await msgRes.json() as { content?: string; assistant?: { content: string } };
  return { answer: data.content ?? data.assistant?.content ?? '', convId: conv.id };
}

function gradeAnswer(question: InterviewQuestion, answer: string): TestResult {
  const lower = answer.toLowerCase();
  const words = answer.split(/\s+/).filter(Boolean);

  const matchedRequired: string[] = [];
  const missedRequired: string[] = [];
  for (const kw of question.requiredKeywords) {
    if (lower.includes(kw.toLowerCase())) {
      matchedRequired.push(kw);
    } else {
      missedRequired.push(kw);
    }
  }

  const matchedBonus: string[] = [];
  for (const kw of question.bonusKeywords ?? []) {
    if (lower.includes(kw.toLowerCase())) {
      matchedBonus.push(kw);
    }
  }

  const matchedAnti: string[] = [];
  for (const ap of question.antiPatterns ?? []) {
    if (lower.includes(ap.toLowerCase())) {
      matchedAnti.push(ap);
    }
  }

  let score = 0;

  // Required keywords: 60% of score
  const reqScore = question.requiredKeywords.length > 0
    ? (matchedRequired.length / question.requiredKeywords.length) * 60
    : 60;
  score += reqScore;

  // Bonus keywords: 25% of score
  const bonusTotal = question.bonusKeywords?.length ?? 0;
  const bonusScore = bonusTotal > 0
    ? (matchedBonus.length / bonusTotal) * 25
    : 15;
  score += bonusScore;

  // Word count: 10% of score
  const minWords = question.minWords ?? 10;
  const wordScore = words.length >= minWords ? 10 : (words.length / minWords) * 10;
  score += wordScore;

  // Anti-pattern penalty: -15 per match
  score -= matchedAnti.length * 15;

  // No-answer penalty
  if (answer.length < 10 || lower.includes("i don't know") || lower.includes('i do not know')) {
    score = Math.min(score, 15);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const passed = score >= 50;

  let feedback = '';
  if (passed) {
    if (score >= 80) feedback = '✅ Excellent — interview-ready';
    else if (score >= 65) feedback = '✅ Good, but room for more detail';
    else feedback = '⚠️ Passing, but needs improvement';
  } else {
    if (missedRequired.length > 0) {
      feedback = `❌ Missing key concepts: ${missedRequired.join(', ')}`;
    } else if (words.length < minWords) {
      feedback = `❌ Answer too short (${words.length} words, need ${minWords}+)`;
    } else {
      feedback = '❌ Does not demonstrate understanding';
    }
  }

  return {
    question,
    answer,
    score,
    passed,
    matchedKeywords: [...matchedRequired, ...matchedBonus],
    missedKeywords: missedRequired.length > 0 ? missedRequired : [],
    matchedAntiPatterns: matchedAnti,
    feedback,
  };
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const categoryFilter = args.includes('--category') ? args[args.indexOf('--category') + 1] : null;
  const interviewerFilter = args.includes('--interviewer') ? args[args.indexOf('--interviewer') + 1] : null;

  try {
    await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
  } catch {
    console.error('❌ VAI server not running at', BASE);
    process.exit(1);
  }

  let questions = INTERVIEW_QUESTIONS;
  if (categoryFilter) {
    questions = questions.filter(q => q.category === categoryFilter);
  }
  if (interviewerFilter) {
    questions = questions.filter(q => q.interviewer === interviewerFilter);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  🎤 INTERVIEW BENCHMARK — ${questions.length} questions`);
  if (categoryFilter) console.log(`     Category: ${categoryFilter}`);
  if (interviewerFilter) console.log(`     Interviewer: ${interviewerFilter}`);
  console.log(`${'═'.repeat(60)}\n`);

  const results: TestResult[] = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const tag = q.interviewer === 'owasp' ? '🔒' : '🏗️';
    process.stdout.write(`  ${tag} [${i + 1}/${questions.length}] ${q.id}: `);

    try {
      const { answer } = await askVai(q.question);
      const result = gradeAnswer(q, answer);
      results.push(result);

      const icon = result.passed ? (result.score >= 80 ? '🟢' : '🟡') : '🔴';
      console.log(`${icon} ${result.score}/100 — ${result.feedback}`);

      if (!result.passed) {
        console.log(`        Q: ${q.question}`);
        console.log(`        A: ${answer.slice(0, 200)}${answer.length > 200 ? '...' : ''}`);
      }
    } catch (err) {
      console.log(`💥 Error: ${(err as Error).message}`);
      results.push({
        question: q,
        answer: '',
        score: 0,
        passed: false,
        matchedKeywords: [],
        missedKeywords: q.requiredKeywords,
        matchedAntiPatterns: [],
        feedback: `Error: ${(err as Error).message}`,
      });
    }

    await new Promise(r => setTimeout(r, 100));
  }

  // ─── Summary ────────────────────────────────────────────────

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const avgScore = results.length > 0
    ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length)
    : 0;

  // Group by category
  const byCategory: Record<string, TestResult[]> = {};
  for (const r of results) {
    const cat = r.question.category;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(r);
  }

  // Group by interviewer
  const byInterviewer: Record<string, TestResult[]> = {};
  for (const r of results) {
    const int = r.question.interviewer;
    if (!byInterviewer[int]) byInterviewer[int] = [];
    byInterviewer[int].push(r);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  📊 INTERVIEW RESULTS`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Total:     ${results.length} questions`);
  console.log(`  Passed:    ${passed} (${Math.round(passed / results.length * 100)}%)`);
  console.log(`  Failed:    ${failed}`);
  console.log(`  Average:   ${avgScore}/100`);

  console.log(`\n  By Interviewer:`);
  for (const [int, res] of Object.entries(byInterviewer)) {
    const intPassed = res.filter(r => r.passed).length;
    const intAvg = Math.round(res.reduce((s, r) => s + r.score, 0) / res.length);
    const label = int === 'owasp' ? '🔒 OWASP Expert' : '🏗️ Altibox Engineer';
    console.log(`    ${label.padEnd(25)} ${intPassed}/${res.length} passed, avg ${intAvg}/100`);
  }

  console.log(`\n  By Category:`);
  for (const [cat, res] of Object.entries(byCategory)) {
    const catPassed = res.filter(r => r.passed).length;
    const catAvg = Math.round(res.reduce((s, r) => s + r.score, 0) / res.length);
    console.log(`    ${cat.padEnd(20)} ${catPassed}/${res.length} passed, avg ${catAvg}/100`);
  }

  console.log(`\n${'═'.repeat(60)}`);

  // Grade
  const pct = Math.round(passed / results.length * 100);
  if (pct >= 95) {
    console.log(`  🏆 GRADE: A+ — Interview ready! (${pct}%)`);
  } else if (pct >= 90) {
    console.log(`  🥇 GRADE: A — Strong performance (${pct}%)`);
  } else if (pct >= 80) {
    console.log(`  🥈 GRADE: B — Good but needs polish (${pct}%)`);
  } else if (pct >= 70) {
    console.log(`  🥉 GRADE: C — Needs improvement (${pct}%)`);
  } else {
    console.log(`  ❌ GRADE: F — Not interview ready (${pct}%)`);
  }

  console.log(`${'═'.repeat(60)}\n`);

  // Failed questions detail
  if (failed > 0) {
    console.log('  Failed Questions:');
    for (const r of results.filter(r => !r.passed)) {
      const tag = r.question.interviewer === 'owasp' ? '🔒' : '🏗️';
      console.log(`    ${tag} ${r.question.id}: ${r.feedback}`);
      if (r.missedKeywords.length > 0) {
        console.log(`       Missing: ${r.missedKeywords.join(', ')}`);
      }
      if (r.matchedAntiPatterns.length > 0) {
        console.log(`       Anti-patterns: ${r.matchedAntiPatterns.join(', ')}`);
      }
    }
    console.log('');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
