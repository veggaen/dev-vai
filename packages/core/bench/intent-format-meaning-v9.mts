/**
 * Intent / Format / Meaning bench — v9 (next-level).
 *
 * v9 bundles:
 *   1. codeFence       — request a fenced code block; engine must emit ```...```
 *   2. reverseList     — list N items, then "reverse the order" → same set reversed
 *   3. lastItemRecall  — list N, then "what was the last one?" → only the last item
 *   4. uppercaseFlip   — list 3, then "now uppercase only" → all-caps response
 *   5. multiNegInline  — single-turn "name a planet that is not earth or mars or jupiter"
 */

import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { VaiEngine } from '../src/models/vai-engine.js';

type Verdict = 'PASS' | 'FAIL';
type BundleId = 'codeFence' | 'reverseList' | 'lastItemRecall' | 'uppercaseFlip' | 'multiNegInline';
interface Turn { user: string; check?: (a: string) => string | null; }
interface Case { id: string; bundle: BundleId; turns: Turn[]; }

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HONEST_FALLBACK = /^I (?:don'?t (?:have|know)|can'?t|cannot|haven'?t|am not)\b/i;
const CLARIFY = /could you say a bit more|what (?:specifically|exactly) do you mean|which (?:one|sense|meaning)/i;
const isFallback = (a: string) => HONEST_FALLBACK.test(a.trim());
const isClarify = (a: string) => CLARIFY.test(a);
const lower = (s: string) => s.toLowerCase();
const hasAny = (a: string, t: string[]) => { const l = lower(a); return t.some(x => l.includes(lower(x))); };
const hasAll = (a: string, t: string[]) => { const l = lower(a); return t.every(x => l.includes(lower(x))); };
const bulletCount = (s: string) => (s.match(/^\s*[-*]\s+/gm) || []).length;
const numberedCount = (s: string) => (s.match(/^\s*\d+[.)]\s+/gm) || []).length;
function stripCodeAndUrls(s: string): string {
  return s.replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '').replace(/https?:\/\/\S+/g, '');
}
function hasLowerOutside(s: string): boolean { return /[a-z]/.test(stripCodeAndUrls(s)); }
function hasFencedBlock(s: string): boolean { return /```[\s\S]+?```/.test(s); }

// ---------------------------------------------------------------------------
// BUNDLE 1 — CODE FENCE
// ---------------------------------------------------------------------------
interface CfSeed { user: string; mustInclude: string[]; }
const CF_SEEDS: CfSeed[] = [
  { user: 'give me a hello world in python inside a code block', mustInclude: ['print', 'hello'] },
  { user: 'show me a hello world in javascript in a fenced code block', mustInclude: ['console', 'hello'] },
  { user: 'write a short json object with name and age in a code block', mustInclude: ['name', 'age'] },
  { user: 'give me a simple python for loop in a code block', mustInclude: ['for', 'range'] },
  { user: 'show me an if statement in javascript in a code block', mustInclude: ['if', 'else'] },
];
function buildCf(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = CF_SEEDS[i % CF_SEEDS.length];
    out.push({ id: `cf-${i}`, bundle: 'codeFence', turns: [
      { user: s.user, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          if (!hasFencedBlock(a)) return 't1: missing ``` fenced block';
          if (!hasAll(a, s.mustInclude)) return `t1: missing ${s.mustInclude.find(k => !lower(a).includes(lower(k)))}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 2 — REVERSE LIST
// ---------------------------------------------------------------------------
interface RvSeed { setup: string; items: string[]; }
const RV_SEEDS: RvSeed[] = [
  { setup: 'list 4 planets as a numbered list', items: ['mercury', 'venus', 'earth', 'mars'] },
  { setup: 'list 4 european capitals as a numbered list', items: ['paris', 'berlin', 'rome', 'madrid'] },
  { setup: 'list 4 programming languages as a numbered list', items: ['python', 'javascript', 'typescript', 'java'] },
  { setup: 'list 4 asian countries as a numbered list', items: ['japan', 'china', 'south korea', 'thailand'] },
  { setup: 'list 4 chemical elements as a numbered list', items: ['hydrogen', 'helium', 'oxygen', 'nitrogen'] },
];
function buildRv(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = RV_SEEDS[i % RV_SEEDS.length];
    out.push({ id: `rv-${i}`, bundle: 'reverseList', turns: [
      { user: s.setup, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          if (numberedCount(a) < 3) return `t1: expected numbered list (got ${numberedCount(a)})`;
          return null;
        }},
      { user: 'now reverse the order', check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          // Find positions of each item in the response; last item must appear before first.
          const lc = lower(a);
          const positions = s.items.map(it => lc.indexOf(lower(it)));
          if (positions.some(p => p < 0)) return `t2: missing one of ${s.items.join(',')}`;
          // Reversed means items[last] occurs before items[0].
          if (positions[s.items.length - 1] >= positions[0]) return 't2: not reversed';
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 3 — LAST ITEM RECALL
// ---------------------------------------------------------------------------
interface LiSeed { setup: string; lastItem: string; }
const LI_SEEDS: LiSeed[] = [
  { setup: 'list 5 planets as a numbered list', lastItem: 'jupiter' },
  { setup: 'list 5 european capitals as a numbered list', lastItem: 'lisbon' },
  { setup: 'list 5 programming languages as a numbered list', lastItem: 'rust' },
  { setup: 'list 5 asian countries as a numbered list', lastItem: 'vietnam' },
  { setup: 'list 5 chemical elements as a numbered list', lastItem: 'carbon' },
];
function buildLi(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = LI_SEEDS[i % LI_SEEDS.length];
    out.push({ id: `li-${i}`, bundle: 'lastItemRecall', turns: [
      { user: s.setup, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          if (numberedCount(a) < 4) return `t1: expected list of 5 (got ${numberedCount(a)})`;
          return null;
        }},
      { user: 'what was the last one?', check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          // The engine's t1 list determines the actual last item, but a
          // canonical 5-item list of the category should end with these.
          // Be lenient: accept if any of the canonical "long-list tail"
          // items appear AND no full list is dumped.
          if (numberedCount(a) > 2 || bulletCount(a) > 2) return 't2: dumped a full list';
          if (!hasAny(a, [s.lastItem])) {
            // Accept fallback if turn 1 did not include the canonical last.
            // But mark missing as failure for now.
            return `t2: missing canonical last "${s.lastItem}"`;
          }
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 4 — UPPERCASE FLIP
// ---------------------------------------------------------------------------
interface UfSeed { setup: string; items: string[]; }
const UF_SEEDS: UfSeed[] = [
  { setup: 'list 3 planets as bullet points', items: ['mercury', 'venus', 'earth'] },
  { setup: 'list 3 european capitals as bullet points', items: ['paris', 'berlin', 'rome'] },
  { setup: 'list 3 programming languages as bullet points', items: ['python', 'javascript', 'typescript'] },
  { setup: 'list 3 asian countries as bullet points', items: ['japan', 'china', 'south korea'] },
  { setup: 'list 3 chemical elements as bullet points', items: ['hydrogen', 'helium', 'oxygen'] },
];
function buildUf(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = UF_SEEDS[i % UF_SEEDS.length];
    out.push({ id: `uf-${i}`, bundle: 'uppercaseFlip', turns: [
      { user: s.setup, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          if (bulletCount(a) < 2) return 't1: missing bullets';
          return null;
        }},
      { user: 'now uppercase only', check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          if (hasLowerOutside(a)) return 't2: still has lowercase';
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 5 — MULTI NEG INLINE
// ---------------------------------------------------------------------------
interface MnSeed { user: string; forbid: string[]; allowAny: string[]; }
const MN_SEEDS: MnSeed[] = [
  { user: 'name a planet that is not earth or mars or jupiter', forbid: ['earth', 'mars', 'jupiter'],
    allowAny: ['mercury', 'venus', 'saturn', 'uranus', 'neptune'] },
  { user: 'name a european capital that is not paris or berlin or rome', forbid: ['paris', 'berlin', 'rome'],
    allowAny: ['madrid', 'lisbon', 'oslo', 'vienna', 'amsterdam', 'stockholm', 'helsinki', 'warsaw'] },
  { user: 'name a programming language that is not python or javascript or typescript', forbid: ['python', 'javascript', 'typescript'],
    allowAny: ['java', 'rust', 'go', 'c++', 'ruby', 'kotlin', 'swift', 'c#'] },
  { user: 'name an asian country that is not japan or china or south korea', forbid: ['japan', 'china', 'south korea'],
    allowAny: ['india', 'thailand', 'vietnam', 'indonesia', 'malaysia', 'philippines', 'singapore'] },
  { user: 'name a chemical element that is not hydrogen or helium or oxygen', forbid: ['hydrogen', 'helium', 'oxygen'],
    allowAny: ['carbon', 'nitrogen', 'iron', 'gold', 'silver', 'sodium', 'calcium', 'lithium'] },
];
function buildMn(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = MN_SEEDS[i % MN_SEEDS.length];
    out.push({ id: `mn-${i}`, bundle: 'multiNegInline', turns: [
      { user: s.user, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          const lc = lower(a);
          // Each forbid must match only as a whole word, not as a substring.
          for (const f of s.forbid) {
            const rx = new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            if (rx.test(a)) return `t1: forbidden "${f}"`;
          }
          if (!hasAny(a, s.allowAny)) return 't1: missing any allowed';
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let n = 200, seed = 42, reportPath: string | null = null, only: string | null = null;
  for (const a of args) {
    if (a.startsWith('--n=')) n = parseInt(a.slice(4), 10) || 200;
    else if (a.startsWith('--seed=')) seed = parseInt(a.slice(7), 10) || 42;
    else if (a.startsWith('--report=')) reportPath = a.slice(9);
    else if (a.startsWith('--bundle=')) only = a.slice(9);
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError('fetch disabled in bench'); }) as typeof fetch;

  const rand = mulberry32(seed);
  const all: Case[] = [
    ...buildCf(rand, n),
    ...buildRv(rand, n),
    ...buildLi(rand, n),
    ...buildUf(rand, n),
    ...buildMn(rand, n),
  ];
  const cases = only ? all.filter(c => c.bundle === only) : all;

  const tally: Record<BundleId, { pass: number; fail: number }> = {
    codeFence: { pass: 0, fail: 0 },
    reverseList: { pass: 0, fail: 0 },
    lastItemRecall: { pass: 0, fail: 0 },
    uppercaseFlip: { pass: 0, fail: 0 },
    multiNegInline: { pass: 0, fail: 0 },
  };
  const failures: Array<{ id: string; bundle: BundleId; prompt: string; reason: string; preview: string }> = [];

  const t0 = performance.now();
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const engine = new VaiEngine();
    const history: { role: string; content: string }[] = [];
    const answers: string[] = [];
    let caseReason: string | null = null;
    for (let ti = 0; ti < c.turns.length; ti++) {
      const turn = c.turns[ti];
      history.push({ role: 'user', content: turn.user });
      let answer = '';
      try {
        const r = await engine.chat({ messages: history, temperature: 0, maxTokens: 320, noLearn: true } as never);
        answer = r.message.content;
      } catch (err) {
        answer = `__ERROR__ ${(err as Error).message}`;
      }
      history.push({ role: 'assistant', content: answer });
      answers.push(answer);
      if (turn.check) {
        const r = turn.check(answer);
        if (r !== null && caseReason === null) caseReason = r;
      }
    }
    const verdict: Verdict = caseReason === null ? 'PASS' : 'FAIL';
    if (verdict === 'PASS') tally[c.bundle].pass++;
    else {
      tally[c.bundle].fail++;
      if (failures.length < 5000) {
        failures.push({
          id: c.id,
          bundle: c.bundle,
          prompt: c.turns.map(t => t.user).join(' || '),
          reason: caseReason ?? '?',
          preview: answers.join(' >> ').slice(0, 400).replace(/\s+/g, ' '),
        });
      }
    }
    if ((i + 1) % 100 === 0) {
      const total = Object.values(tally).reduce((a, b) => a + b.pass + b.fail, 0);
      const passes = Object.values(tally).reduce((a, b) => a + b.pass, 0);
      process.stdout.write(`  [${i + 1}/${cases.length}] PASS=${passes}/${total}\n`);
    }
  }

  const totalMs = Math.round(performance.now() - t0);
  globalThis.fetch = originalFetch;

  console.log('');
  console.log('=== Intent / Format / Meaning bench — V9 (code/reverse/last/upper/multi-neg) ===');
  console.log(`n_per_bundle=${n}  seed=${seed}  totalCases=${cases.length}  totalMs=${totalMs}`);
  let pAll = 0, tAll = 0;
  for (const b of ['codeFence', 'reverseList', 'lastItemRecall', 'uppercaseFlip', 'multiNegInline'] as const) {
    const t = tally[b];
    const sum = t.pass + t.fail;
    if (sum === 0) continue;
    const rate = ((t.pass / sum) * 100).toFixed(2);
    console.log(`  ${b.padEnd(22)} pass=${t.pass}/${sum}  (${rate}%)  fail=${t.fail}`);
    pAll += t.pass; tAll += sum;
  }
  console.log(`  OVERALL                pass=${pAll}/${tAll}  (${((pAll / tAll) * 100).toFixed(2)}%)`);

  if (reportPath) {
    writeFileSync(reportPath, JSON.stringify({ n, seed, totalMs, tally, failures }, null, 2));
    console.log(`report written: ${reportPath}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
