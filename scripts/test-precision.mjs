/**
 * VAI Precision Benchmark — 33 deterministic tests from programming textbooks.
 *
 * Every test has exactly ONE correct answer.  Max 4 of same type, rotating methods.
 *
 * Categories:
 *   exact-math(4)   — factorial, GCD, fibonacci, sqrt
 *   base-convert(4)  — decimal↔binary, hex, conversions
 *   recursive-algo(4) — factorial/fib/gcd/power code generation
 *   sort-algo(4)      — bubble, selection, insertion, merge sort
 *   search-algo(1)    — binary search
 *   data-struct(3)    — stack, queue, BST
 *   string-proc(4)    — reverse, palindrome, vowels, anagram
 *   math-func(4)      — is_prime, sieve, LCM, find_max
 *   utility-func(2)   — flatten array, matrix transpose
 *   combo-math(3)     — percentage, power, LCM computation
 *
 * Usage:
 *   node scripts/test-precision.mjs
 */
import WebSocket from 'ws';

const BASE_URL = 'http://localhost:3006';
const WS_URL = 'ws://localhost:3006/api/chat';

async function createConversation() {
  const res = await fetch(`${BASE_URL}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'vai:v0', title: 'Precision Benchmark' }),
  });
  const data = await res.json();
  return data.id;
}

// ── 33 Precision Tests ──────────────────────────────────────

const tests = [
  // ═══ EXACT MATH (4) — one unique numerical answer ═══
  {
    q: 'what is the factorial of 7',
    cat: 'exact-math',
    validate: (r) => /5,?040/.test(r),
    desc: 'Factorial 7! = 5040',
  },
  {
    q: 'what is the GCD of 48 and 18',
    cat: 'exact-math',
    validate: (r) => /\b6\b/.test(r) && /gcd/i.test(r),
    desc: 'GCD(48, 18) = 6',
  },
  {
    q: 'what is the 10th fibonacci number',
    cat: 'exact-math',
    validate: (r) => /\b55\b/.test(r),
    desc: 'Fibonacci(10) = 55',
  },
  {
    q: 'what is the square root of 144',
    cat: 'exact-math',
    validate: (r) => /\b12\b/.test(r),
    desc: '√144 = 12',
  },

  // ═══ BASE CONVERSION (4) — exact binary/hex/decimal ═══
  {
    q: 'convert 255 to binary',
    cat: 'base-convert',
    validate: (r) => /11111111/.test(r),
    desc: '255 in binary = 11111111',
  },
  {
    q: 'convert binary 10110 to decimal',
    cat: 'base-convert',
    validate: (r) => /\b22\b/.test(r),
    desc: 'Binary 10110 = decimal 22',
  },
  {
    q: 'convert hex FF to decimal',
    cat: 'base-convert',
    validate: (r) => /\b255\b/.test(r),
    desc: 'Hex FF = decimal 255',
  },
  {
    q: 'decode hex 56 41 49',
    cat: 'base-convert',
    validate: (r) => /VAI/i.test(r),
    desc: 'Hex 56 41 49 = "VAI"',
  },

  // ═══ RECURSIVE ALGORITHM CODE (4) — canonical implementations ═══
  {
    q: 'write a recursive factorial function in python',
    cat: 'recursive-algo',
    validate: (r) => {
      const l = r.toLowerCase();
      return /```python/.test(r)
        && /def\s+factorial/.test(l)
        && /n\s*\*\s*factorial\(n\s*-\s*1\)/.test(l)
        && /<=?\s*1|==\s*[01]/.test(l);  // base case
    },
    desc: 'Recursive factorial in Python with base case and n*factorial(n-1)',
  },
  {
    q: 'write a recursive fibonacci function in javascript',
    cat: 'recursive-algo',
    validate: (r) => {
      const l = r.toLowerCase();
      return /```javascript/.test(r)
        && /function\s+fibonacci/.test(l)
        && /fibonacci\(n\s*-\s*1\)\s*\+\s*fibonacci\(n\s*-\s*2\)/.test(l);
    },
    desc: 'Recursive fibonacci in JS with fib(n-1) + fib(n-2)',
  },
  {
    q: 'write a recursive GCD function in python',
    cat: 'recursive-algo',
    validate: (r) => {
      const l = r.toLowerCase();
      return /```python/.test(r)
        && /def\s+gcd/.test(l)
        && /gcd\(b,\s*a\s*%\s*b\)/.test(l)
        && /b\s*==\s*0/.test(l);  // base case
    },
    desc: 'Recursive GCD (Euclidean) in Python: gcd(b, a%b)',
  },
  {
    q: 'write a recursive power function in javascript',
    cat: 'recursive-algo',
    validate: (r) => {
      const l = r.toLowerCase();
      return /```javascript/.test(r)
        && /function\s+power/.test(l)
        && /exp\s*===?\s*0/.test(l)   // base case
        && /power\(/.test(l);          // recursive call
    },
    desc: 'Recursive power function in JS with base case exp===0',
  },

  // ═══ SORTING ALGORITHMS (4) — canonical textbook sorts ═══
  {
    q: 'implement bubble sort in python',
    cat: 'sort-algo',
    validate: (r) => {
      const l = r.toLowerCase();
      return /```python/.test(r)
        && /def\s+bubble_sort/.test(l)
        && /swapped/.test(l)           // early termination flag
        && /arr\[j\].*arr\[j\s*\+\s*1\]/.test(l); // adjacent comparison
    },
    desc: 'Bubble sort in Python with swapped flag and adjacent comparison',
  },
  {
    q: 'implement selection sort in javascript',
    cat: 'sort-algo',
    validate: (r) => {
      const l = r.toLowerCase();
      return /```javascript/.test(r)
        && /function\s+selectionSort/.test(r)
        && /min/.test(l)               // finding minimum
        && /for\s*\(/.test(l);         // nested loops
    },
    desc: 'Selection sort in JS — find minimum element, swap to front',
  },
  {
    q: 'implement insertion sort in python',
    cat: 'sort-algo',
    validate: (r) => {
      const l = r.toLowerCase();
      return /```python/.test(r)
        && /def\s+insertion_sort/.test(l)
        && /key/.test(l)               // key element pattern
        && /while.*j\s*>=?\s*0/.test(l); // shift elements
    },
    desc: 'Insertion sort in Python — key element and shift pattern',
  },
  {
    q: 'implement merge sort in javascript',
    cat: 'sort-algo',
    validate: (r) => {
      const l = r.toLowerCase();
      return /```javascript/.test(r)
        && /function\s+mergeSort/.test(r)
        && /function\s+merge\b/.test(r) // separate merge function
        && /\.slice\(/.test(l)          // divide
        && /left.*right/i.test(l);      // merge two halves
    },
    desc: 'Merge sort in JS — divide (slice) and merge two sorted halves',
  },

  // ═══ SEARCH ALGORITHM (1) ═══
  {
    q: 'write a binary search function in python',
    cat: 'search-algo',
    validate: (r) => {
      const l = r.toLowerCase();
      return /```python/.test(r)
        && /def\s+binary_search/.test(l)
        && /mid/.test(l)
        && /while\s+left\s*<=?\s*right/.test(l)
        && /return\s+(-1|none)/i.test(l); // not found case
    },
    desc: 'Binary search in Python with mid calc, while loop, -1/None not-found',
  },

  // ═══ DATA STRUCTURES (3) — stack, queue, BST ═══
  {
    q: 'implement a stack class in javascript',
    cat: 'data-struct',
    validate: (r) => {
      const l = r.toLowerCase();
      return /```javascript/.test(r)
        && /class\s+Stack/.test(r)
        && /push/.test(l) && /pop/.test(l) && /peek/.test(l)
        && /isEmpty|is_empty/.test(r);
    },
    desc: 'Stack class in JS with push, pop, peek, isEmpty',
  },
  {
    q: 'implement a queue class in python',
    cat: 'data-struct',
    validate: (r) => {
      const l = r.toLowerCase();
      return /```python/.test(r)
        && /class\s+Queue/.test(r)
        && /enqueue/.test(l) && /dequeue/.test(l) && /peek/.test(l);
    },
    desc: 'Queue class in Python with enqueue, dequeue, peek',
  },
  {
    q: 'implement a binary search tree in javascript',
    cat: 'data-struct',
    validate: (r) => {
      const l = r.toLowerCase();
      return /```javascript/.test(r)
        && /class\s+(?:BST|BinarySearchTree|TreeNode)/.test(r)
        && /insert/.test(l)
        && /left/.test(l) && /right/.test(l)
        && /val|value|data|key/.test(l);
    },
    desc: 'BST class in JS with insert, left/right children',
  },

  // ═══ STRING PROCESSING (4) — canonical string functions ═══
  {
    q: 'write a function to reverse a string in python',
    cat: 'string-proc',
    validate: (r) => {
      const l = r.toLowerCase();
      return /```python/.test(r)
        && /def\s+reverse/.test(l)
        && /\[::\s*-1\]|reversed|\.reverse\(\)|while|for/.test(l); // any valid reversal approach
    },
    desc: 'Reverse string function in Python (slicing, reversed, or loop)',
  },
  {
    q: 'write a palindrome checker function in javascript',
    cat: 'string-proc',
    validate: (r) => {
      const l = r.toLowerCase();
      return /```javascript/.test(r)
        && /function\s+isPalindrome/.test(r)
        && /reverse/.test(l)           // reverse to compare
        && /===/.test(r);              // equality check
    },
    desc: 'Palindrome checker in JS — reverse and compare',
  },
  {
    q: 'write a function to count vowels in python',
    cat: 'string-proc',
    validate: (r) => {
      const l = r.toLowerCase();
      return /```python/.test(r)
        && /def\s+count_vowels/.test(l)
        && /[aeiou]/.test(l);          // vowel set/string
    },
    desc: 'Count vowels function in Python checking aeiou',
  },
  {
    q: 'write an anagram checker function in javascript',
    cat: 'string-proc',
    validate: (r) => {
      const l = r.toLowerCase();
      return /```javascript/.test(r)
        && /function\s+isAnagram/.test(r)
        && /sort/.test(l)              // sort + compare approach
        && /===/.test(r);
    },
    desc: 'Anagram checker in JS — sort characters and compare',
  },

  // ═══ MATH FUNCTIONS CODE (4) — prime, sieve, LCM, find_max ═══
  {
    q: 'write a function to check if a number is prime in python',
    cat: 'math-func',
    validate: (r) => {
      const l = r.toLowerCase();
      return /```python/.test(r)
        && /def\s+is_prime/.test(l)
        && /n\s*%\s*\w+\s*==\s*0/.test(l)  // modulo divisibility check
        && /return\s+(?:true|false)/i.test(l);
    },
    desc: 'Prime check function in Python using modulo divisibility',
  },
  {
    q: 'write a sieve of eratosthenes function in javascript',
    cat: 'math-func',
    validate: (r) => {
      const l = r.toLowerCase();
      return /```javascript/.test(r)
        && /sieve|eratosthenes/i.test(r)
        && /true|false/.test(l)        // boolean sieve array
        && /for\s*\(/.test(l)          // nested loops
        && /\*\s*\w|i\s*\*\s*i/.test(l);  // i*i optimization or multiplication
    },
    desc: 'Sieve of Eratosthenes in JS with boolean array and nested loops',
  },
  {
    q: 'write a function to find the LCM of two numbers in python',
    cat: 'math-func',
    validate: (r) => {
      const l = r.toLowerCase();
      return /```python/.test(r)
        && (/def\s+lcm/.test(l) || /def\s+gcd/.test(l))
        && /gcd/.test(l)              // uses GCD internally
        && /a\s*\*\s*b|\*/.test(l);   // LCM = a*b / gcd(a,b)
    },
    desc: 'LCM function in Python using GCD: a*b/gcd(a,b)',
  },
  {
    q: 'write a function to find the maximum element in an array in javascript',
    cat: 'math-func',
    validate: (r) => {
      const l = r.toLowerCase();
      return /```javascript/.test(r)
        && /function\s+findMax/.test(r)
        && /max/.test(l)
        && /for|while|reduce/.test(l)  // iteration
        && /return/.test(l);
    },
    desc: 'Find max in array in JS — iterate and track maximum',
  },

  // ═══ UTILITY FUNCTIONS (2) ═══
  {
    q: 'write a function to flatten a nested array in javascript',
    cat: 'utility-func',
    validate: (r) => {
      const l = r.toLowerCase();
      return /```javascript/.test(r)
        && /function\s+flatten/.test(r)
        && /Array\.isArray|isarray/.test(r)  // type check for recursion
        && /flatten\(/.test(l);              // recursive call
    },
    desc: 'Flatten nested array in JS — recursive with Array.isArray check',
  },
  {
    q: 'write a matrix transpose function in python',
    cat: 'utility-func',
    validate: (r) => {
      const l = r.toLowerCase();
      return /```python/.test(r)
        && /def\s+transpose/.test(l)
        && /\[i\]\[j\]|\[j\]\[i\]|zip/.test(l); // indexing swap or zip
    },
    desc: 'Matrix transpose in Python — swap [i][j] ↔ [j][i] or use zip',
  },

  // ═══ COMBO MATH (3) — different types, exact answers ═══
  {
    q: 'what is the LCM of 12 and 18',
    cat: 'combo-math',
    validate: (r) => /\b36\b/.test(r),
    desc: 'LCM(12, 18) = 36',
  },
  {
    q: 'what is the factorial of 10',
    cat: 'combo-math',
    validate: (r) => /3,?628,?800/.test(r),
    desc: 'Factorial 10! = 3628800',
  },
  {
    q: 'convert 42 to binary',
    cat: 'combo-math',
    validate: (r) => /101010/.test(r),
    desc: '42 in binary = 101010',
  },
];

// ── WebSocket Chat Helper ────────────────────────────────────

function askVAI(conversationId, question) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let fullResponse = '';
    const timeout = setTimeout(() => {
      ws.terminate();
      resolve(fullResponse || '[TIMEOUT]');
    }, 30_000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'message',
        conversationId,
        content: question,
      }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'text_delta') fullResponse += msg.textDelta;
        if (msg.type === 'done') {
          clearTimeout(timeout);
          ws.close();
          resolve(fullResponse);
        }
        if (msg.type === 'error') {
          clearTimeout(timeout);
          ws.close();
          resolve(`[ERROR] ${msg.error}`);
        }
      } catch { /* ignore parse errors */ }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// ── Main Runner ──────────────────────────────────────────────

async function main() {
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║     VAI PRECISION BENCHMARK — 33 Deterministic    ║');
  console.log('║     Real-world programming textbook tasks         ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  // Health check
  try {
    const res = await fetch(`${BASE_URL}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const h = await res.json();
    console.log(`Server healthy — vocab: ${h.vocabSize?.toLocaleString()}, knowledge: ${h.knowledgeEntries}\n`);
  } catch {
    console.error('❌ Server not reachable at', BASE_URL);
    console.error('   Start it with:  pnpm vai:start');
    process.exit(1);
  }

  const conversationId = await createConversation();
  console.log(`Conversation: ${conversationId}\n`);

  const results = [];
  const catScores = {};
  let pass = 0, fail = 0;

  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    const num = String(i + 1).padStart(2, '0');
    process.stdout.write(`  [${num}/33] ${t.desc.padEnd(62)} `);

    try {
      const response = await askVAI(conversationId, t.q);
      const ok = t.validate(response);

      if (ok) {
        console.log('✅ PASS');
        pass++;
      } else {
        console.log('❌ FAIL');
        // Show first 200 chars of response for debugging
        const snippet = response.replace(/\n/g, ' ').slice(0, 200);
        console.log(`       ↳ Got: ${snippet}...`);
        fail++;
      }

      results.push({ ...t, response, ok });

      if (!catScores[t.cat]) catScores[t.cat] = { pass: 0, total: 0 };
      catScores[t.cat].total++;
      if (ok) catScores[t.cat].pass++;
    } catch (err) {
      console.log('❌ ERROR:', err.message);
      fail++;
      results.push({ ...t, response: '', ok: false });
      if (!catScores[t.cat]) catScores[t.cat] = { pass: 0, total: 0 };
      catScores[t.cat].total++;
    }
  }

  // ── Scorecard ──────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('                    PRECISION SCORECARD');
  console.log('═'.repeat(60));

  const cats = Object.entries(catScores).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [cat, sc] of cats) {
    const pct = Math.round((sc.pass / sc.total) * 100);
    const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
    const emoji = pct === 100 ? '🟢' : pct >= 75 ? '🟡' : '🔴';
    console.log(`  ${emoji} ${cat.padEnd(16)} ${bar} ${sc.pass}/${sc.total} (${pct}%)`);
  }

  const total = pass + fail;
  const pct = Math.round((pass / total) * 100);
  console.log('\n' + '─'.repeat(60));
  console.log(`  TOTAL:  ${pass}/${total}  (${pct}%)`);
  console.log('─'.repeat(60));

  if (fail === 0) {
    console.log('\n  🏆 PERFECT SCORE — 33/33 precision tasks correct!\n');
  } else {
    console.log(`\n  ⚠️  ${fail} task(s) need attention.\n`);

    // Show failures grouped by category
    const failures = results.filter(r => !r.ok);
    console.log('  Failed tasks:');
    for (const f of failures) {
      console.log(`    • [${f.cat}] ${f.desc}`);
    }
    console.log();
  }

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
