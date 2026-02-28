/**
 * VAI Live API Benchmark — Comprehensive quality test.
 *
 * Tests creativity, accuracy, code generation, best practices knowledge,
 * math, identity, multilingual, binary decode, and honesty on unknowns.
 *
 * Usage:
 *   node scripts/test-live.mjs
 *
 * Each question has validation rules. The script auto-grades and prints a scorecard.
 */
import WebSocket from 'ws';

const BASE_URL = 'http://localhost:3006';
const WS_URL = 'ws://localhost:3006/api/chat';

async function createConversation() {
  const res = await fetch(`${BASE_URL}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'vai:v0', title: 'Benchmark Test' }),
  });
  const data = await res.json();
  return data.id;
}

// ── Test Cases ──────────────────────────────────────────────

const tests = [
  // ═══ GREETINGS & IDENTITY ═══
  {
    q: 'hello',
    cat: 'greetings',
    validate: (r) => /hello|hi|hey|greetings|welcome/i.test(r),
    desc: 'Basic greeting response',
  },
  {
    q: 'hey there',
    cat: 'greetings',
    validate: (r) => /hello|hi|hey|greetings|welcome/i.test(r),
    desc: 'Casual greeting response',
  },
  {
    q: 'who are you',
    cat: 'identity',
    validate: (r) => /vai|veggaai|vegga/i.test(r),
    desc: 'Should identify as VAI/VeggaAI',
  },
  {
    q: 'what can you do',
    cat: 'identity',
    validate: (r) => /help|learn|answer|question|code|knowledge|math/i.test(r),
    desc: 'Should describe capabilities',
  },

  // ═══ MATH ═══
  {
    q: 'whats 10+10',
    cat: 'math',
    validate: (r) => /\b20\b/.test(r),
    desc: 'Basic addition',
  },
  {
    q: 'whats 5 * 5',
    cat: 'math',
    validate: (r) => /\b25\b/.test(r),
    desc: 'Basic multiplication',
  },
  {
    q: 'what is 100 / 4',
    cat: 'math',
    validate: (r) => /\b25\b/.test(r),
    desc: 'Basic division',
  },
  {
    q: 'whats 2 to the power of 10',
    cat: 'math',
    validate: (r) => /\b1024\b/.test(r),
    desc: 'Exponentiation',
  },
  {
    q: 'calculate 15% of 200',
    cat: 'math',
    validate: (r) => /\b30\b/.test(r),
    desc: 'Percentage calculation',
  },
  {
    q: 'what is 144 / 12',
    cat: 'math',
    validate: (r) => /\b12\b/.test(r),
    desc: 'Division (144/12)',
  },
  {
    q: 'whats 99 + 1',
    cat: 'math',
    validate: (r) => /\b100\b/.test(r),
    desc: 'Addition (boundary)',
  },
  {
    q: 'calculate 3^4',
    cat: 'math',
    validate: (r) => /\b81\b/.test(r),
    desc: 'Power notation',
  },

  // ═══ CREATIVE CODE TASKS (like a real human at base44) ═══
  {
    q: 'make me a javascript calculator',
    cat: 'creative-code',
    validate: (r) => {
      const l = r.toLowerCase();
      return (l.includes('function') || l.includes('class') || l.includes('calculator')) && /add|subtract|multiply|divide|calculate|\+|\-|\*|\//.test(l);
    },
    desc: 'JS calculator — should have functions for operations',
  },
  {
    q: 'build a todo list in python',
    cat: 'creative-code',
    validate: (r) => {
      const l = r.toLowerCase();
      return /def\s+\w+|class\s+\w+/.test(l) && /add|remove|list|todo|task|append/.test(l);
    },
    desc: 'Python todo list — should have add/remove/list functions',
  },
  {
    q: 'create a simple counter component in react',
    cat: 'creative-code',
    validate: (r) => {
      const l = r.toLowerCase();
      return /usestate|setcount|counter|increment|onclick/.test(l) && /return/.test(l);
    },
    desc: 'React counter — should use useState and render count',
  },
  {
    q: 'write a fizzbuzz function in javascript',
    cat: 'creative-code',
    validate: (r) => {
      const l = r.toLowerCase();
      return /fizz/.test(l) && /buzz/.test(l) && /function|=>/.test(l);
    },
    desc: 'FizzBuzz — classic interview question',
  },
  {
    q: 'make a simple http server in python',
    cat: 'creative-code',
    validate: (r) => {
      const l = r.toLowerCase();
      return /http|server|port|listen|handler|flask|bottle|request|socket/i.test(l) && /def |import |class /.test(l);
    },
    desc: 'Python HTTP server',
  },
  {
    q: 'write a linked list class in java',
    cat: 'creative-code',
    validate: (r) => {
      const l = r.toLowerCase();
      return /class/.test(l) && /node|next|head|linked/i.test(l) && /void|public|private/.test(l);
    },
    desc: 'Java linked list implementation',
  },

  // ═══ CODE GENERATION (specific languages) ═══
  {
    q: 'how to program in java and make a command print hello world',
    cat: 'code-gen',
    validate: (r) => /System\.out\.print/i.test(r) || /println/i.test(r),
    desc: 'Java hello world',
  },
  {
    q: 'write hello world in python',
    cat: 'code-gen',
    validate: (r) => /print\s*\(/.test(r),
    desc: 'Python hello world',
  },
  {
    q: 'write hello world in c#',
    cat: 'code-gen',
    validate: (r) => /Console\.Write/i.test(r),
    desc: 'C# hello world',
  },
  {
    q: 'write a C program that handles access control',
    cat: 'code-gen',
    validate: (r) => /include|printf|int\s+main|void/.test(r) && !/Console/.test(r),
    desc: 'C program (not C#)',
  },
  {
    q: 'how to make a function in javascript',
    cat: 'code-gen',
    validate: (r) => /function\s+\w+|const\s+\w+\s*=/.test(r),
    desc: 'JS function example',
  },

  // ═══ ADVANCED CODE GEN (types, enums, classes) ═══
  {
    q: 'generate a TypeScript type for a user',
    cat: 'advanced-code',
    validate: (r) => /type\s+User|interface\s+User/.test(r) && /name|email|id/.test(r.toLowerCase()),
    desc: 'TS type — should have User with fields',
  },
  {
    q: 'create a Rust enum for traffic lights',
    cat: 'advanced-code',
    validate: (r) => /enum\s+\w*Traffic/i.test(r) && /Red|Green|Yellow/i.test(r),
    desc: 'Rust enum — Red/Green/Yellow',
  },
  {
    q: 'write a C++ class for a car',
    cat: 'advanced-code',
    validate: (r) => /class\s+Car/i.test(r) && /speed|model|make|color|brand|engine|year/i.test(r),
    desc: 'C++ class — Car with attributes',
  },
  {
    q: 'create a python class for a bank account',
    cat: 'advanced-code',
    validate: (r) => {
      const l = r.toLowerCase();
      return /class\s+bank/i.test(r) && /balance|deposit|withdraw|def\s+__init__/.test(l);
    },
    desc: 'Python class — BankAccount with deposit/withdraw',
  },

  // ═══ BEST PRACTICES — Next.js ═══
  {
    q: 'what are best practices for nextjs',
    cat: 'best-practices',
    validate: (r) => {
      const l = r.toLowerCase();
      const hits = [
        /server.?side|ssr|server component/,
        /static|ssg|isr/,
        /image optim|next\/image/,
        /api route|route handler/,
        /page|layout|app.?router/,
        /seo|metadata|head/,
        /caching|cache/,
        /middleware/,
        /dynamic import|lazy|code split/,
      ].filter(p => p.test(l)).length;
      return hits >= 2;
    },
    desc: 'Next.js best practices — should mention SSR, routing, etc.',
  },

  // ═══ BEST PRACTICES — Vite ═══
  {
    q: 'what are best practices for vite',
    cat: 'best-practices',
    validate: (r) => {
      const l = r.toLowerCase();
      const hits = [
        /hmr|hot module/,
        /plugin|rollup/,
        /import|tree.?shak/,
        /config|vite\.config/,
        /build|optimiz/,
        /env|environment/,
        /chunk|split|lazy/,
      ].filter(p => p.test(l)).length;
      return hits >= 2;
    },
    desc: 'Vite best practices — should mention HMR, plugins, config, etc.',
  },

  // ═══ BEST PRACTICES — TypeScript ═══
  {
    q: 'what are best practices for typescript',
    cat: 'best-practices',
    validate: (r) => {
      const l = r.toLowerCase();
      const hits = [
        /strict|strictNullCheck|noImplicit/i,
        /type\s+safe|type.?safety/,
        /interface|type alias/,
        /generic|generics/,
        /enum|union type/,
        /never.*any|avoid.*any|no.*any/,
        /null|undefined|optional/,
        /compile|tsc|tsconfig/,
      ].filter(p => p.test(l)).length;
      return hits >= 2;
    },
    desc: 'TypeScript best practices — should mention strict mode, types, etc.',
  },

  // ═══ BINARY DECODE ═══
  {
    q: 'decode 01010010 01001001 01010011 01001011',
    cat: 'binary',
    validate: (r) => /RISK/i.test(r),
    desc: 'Binary -> "RISK"',
  },
  {
    q: 'decode 01001000 01001001',
    cat: 'binary',
    validate: (r) => /HI/i.test(r),
    desc: 'Binary -> "HI"',
  },

  // ═══ KNOWLEDGE-BASED (from ingested data) ═══
  {
    q: 'who is president in us',
    cat: 'knowledge',
    validate: (r) => /trump/i.test(r) && /president/i.test(r),
    desc: 'US president — should mention Trump',
  },
  {
    q: 'who is the CEO of Circle K',
    cat: 'knowledge',
    validate: (r) => /circle\s*k/i.test(r),
    desc: 'Circle K CEO — should return relevant info',
  },
  {
    q: 'what happened with Anthropic and the Pentagon',
    cat: 'knowledge',
    validate: (r) => /anthropic/i.test(r) && /pentagon|military|defense|contract/i.test(r),
    desc: 'Anthropic-Pentagon news',
  },
  {
    q: 'where is Hommersåk',
    cat: 'knowledge',
    validate: (r) => /norway|norge|rogaland|sandnes|stavanger/i.test(r),
    desc: 'Hommersak location — Norway',
  },
  {
    q: 'tell me about Hommersåk',
    cat: 'knowledge',
    validate: (r) => /norway|norge|village|community|rogaland|sandnes/i.test(r),
    desc: 'Hommersak details',
  },
  {
    q: 'what does Circle K do',
    cat: 'knowledge',
    validate: (r) => /convenience|store|gas|fuel|retail/i.test(r),
    desc: 'Circle K business description',
  },

  // ═══ NORWEGIAN ═══
  {
    q: 'write to me a sentence in norwegian',
    cat: 'norwegian',
    validate: (r) => /[æøåÆØÅ]|er |og |det |har |som |til |med /.test(r),
    desc: 'Norwegian sentence — should contain Norwegian words',
  },

  // ═══ THINGS VAI SHOULD NOT KNOW (honesty test) ═══
  {
    q: 'what color is the sky on mars',
    cat: 'unknown',
    validate: (r) => {
      const l = r.toLowerCase();
      return /don.?t know|not sure|couldn.?t find|no information|don.?t have|cannot|can.?t answer/.test(l)
        || (/mars/i.test(l) && /butterscotch|pink|red|salmon|orange/i.test(l));
    },
    desc: 'Mars sky — should admit unknown (NOT Tailwind CSS)',
  },
  {
    q: 'who won the 2030 world cup',
    cat: 'unknown',
    validate: (r) => /don.?t know|not sure|couldn.?t find|no information|hasn.?t happened|future|don.?t have/.test(r.toLowerCase()),
    desc: '2030 world cup — should admit unknown (future event)',
  },
  {
    q: 'what is the population of planet zorblax',
    cat: 'unknown',
    validate: (r) => /don.?t know|not sure|couldn.?t find|no information|don.?t have|cannot|fictional|doesn.?t exist/.test(r.toLowerCase()),
    desc: 'Fictional planet — should admit unknown',
  },
  {
    q: 'who won the 2028 olympics gold in swimming',
    cat: 'unknown',
    validate: (r) => /don.?t know|not sure|couldn.?t find|no information|don.?t have|cannot/.test(r.toLowerCase()),
    desc: 'Future/unknown event — should admit unknown',
  },
];

// ── WebSocket Ask ────────────────────────────────────────────

let CONV_ID;

async function ask(question) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let fullResponse = '';
    const timeout = setTimeout(() => {
      ws.close();
      resolve(fullResponse || '[TIMEOUT - no response]');
    }, 15000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ conversationId: CONV_ID, content: question }));
    });

    ws.on('message', (data) => {
      try {
        const chunk = JSON.parse(data.toString());
        if (chunk.type === 'text_delta' && chunk.textDelta) {
          fullResponse += chunk.textDelta;
        } else if (chunk.type === 'done') {
          clearTimeout(timeout);
          ws.close();
          resolve(fullResponse);
        } else if (chunk.type === 'error') {
          clearTimeout(timeout);
          ws.close();
          resolve(`[ERROR: ${chunk.error}]`);
        }
      } catch {}
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// ── Main ─────────────────────────────────────────────────────

console.log('==================================================');
console.log('        VAI Live API Benchmark Test');
console.log('==================================================\n');

// Verify server is running
try {
  const health = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
  if (!health.ok) throw new Error('not ok');
  const data = await health.json();
  console.log(`Server: ${data.engine} | Vocab: ${data.stats?.vocabSize} | Docs: ${data.stats?.documentsIndexed}\n`);
} catch {
  console.error('ERROR: Server not running! Use: node scripts/vai-server.mjs start');
  process.exit(1);
}

CONV_ID = await createConversation();
console.log(`Conversation: ${CONV_ID}\n`);

const results = [];
const catScores = {};

for (const t of tests) {
  try {
    const response = await ask(t.q);
    const pass = t.validate(response);
    const preview = response.length > 300 ? response.slice(0, 300) + '...' : response;

    results.push({ ...t, response, pass });

    if (!catScores[t.cat]) catScores[t.cat] = { pass: 0, total: 0 };
    catScores[t.cat].total++;
    if (pass) catScores[t.cat].pass++;

    const icon = pass ? 'PASS' : 'FAIL';
    console.log(`[${icon}] [${t.cat}] ${t.desc}`);
    console.log(`   Q: "${t.q}"`);
    console.log(`   A: ${preview}`);
    console.log('');
  } catch (err) {
    results.push({ ...t, response: `[ERROR: ${err.message}]`, pass: false });
    if (!catScores[t.cat]) catScores[t.cat] = { pass: 0, total: 0 };
    catScores[t.cat].total++;
    console.log(`[FAIL] [${t.cat}] ${t.desc} — CONNECTION ERROR`);
    console.log('');
  }
}

// ── Scorecard ────────────────────────────────────────────────

const totalPass = results.filter(r => r.pass).length;
const totalTests = results.length;
const pct = ((totalPass / totalTests) * 100).toFixed(1);

console.log('\n==================================================');
console.log('                   SCORECARD');
console.log('==================================================');

for (const [cat, score] of Object.entries(catScores).sort((a, b) => a[0].localeCompare(b[0]))) {
  const catPct = ((score.pass / score.total) * 100).toFixed(0);
  console.log(`  ${cat.padEnd(20)} ${score.pass}/${score.total} (${catPct}%)`);
}

console.log('--------------------------------------------------');
console.log(`  TOTAL: ${totalPass}/${totalTests} passed (${pct}%)`);
console.log('==================================================');

// List failures
const failures = results.filter(r => !r.pass);
if (failures.length > 0) {
  console.log('\n-- Failed Tests --');
  for (const f of failures) {
    console.log(`  FAIL: ${f.desc}`);
    console.log(`     Q: "${f.q}"`);
    const preview = f.response.length > 200 ? f.response.slice(0, 200) + '...' : f.response;
    console.log(`     A: ${preview}\n`);
  }
}

console.log('\n=== Benchmark Complete ===');
process.exit(totalPass === totalTests ? 0 : 1);
