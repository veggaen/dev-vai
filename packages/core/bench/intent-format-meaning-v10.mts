/**
 * Intent / Format / Meaning bench — v10.
 *
 * v10 bundles:
 *   1. codeRevise     — turn1 code in lang A, turn2 "translate that to lang B".
 *   2. removeItem     — turn1 list N, turn2 "remove the 2nd one" → N-1 list, item 2 gone.
 *   3. swapItems      — turn1 list 5, turn2 "swap #1 and #3" → swapped positions.
 *   4. explainEach    — turn1 list 3, turn2 "explain each one in one sentence" → 3 paragraphs/lines naming each.
 *   5. deepCombo      — 8-turn chain combining picks/format/ordinal/reverse/last/upper.
 */

import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { VaiEngine } from '../src/models/vai-engine.js';

type Verdict = 'PASS' | 'FAIL';
type BundleId = 'codeRevise' | 'removeItem' | 'swapItems' | 'explainEach' | 'deepCombo';
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
const bulletCount = (s: string) => (s.match(/^\s*[-*]\s+/gm) || []).length;
const numberedCount = (s: string) => (s.match(/^\s*\d+[.)]\s+/gm) || []).length;
const hasFenced = (s: string) => /```[\s\S]+?```/.test(s);

// ---------------------------------------------------------------------------
// BUNDLE 1 — CODE REVISE (translate to another language)
// ---------------------------------------------------------------------------
interface CrSeed { setup: string; t1Keys: string[]; toLang: string; t2Keys: string[]; }
const CR_SEEDS: CrSeed[] = [
  { setup: 'give me a hello world in python in a code block', t1Keys: ['print', 'hello'],
    toLang: 'javascript', t2Keys: ['console', 'hello'] },
  { setup: 'give me a hello world in javascript in a code block', t1Keys: ['console', 'hello'],
    toLang: 'python', t2Keys: ['print', 'hello'] },
  { setup: 'give me a hello world in python in a code block', t1Keys: ['print', 'hello'],
    toLang: 'rust', t2Keys: ['println', 'hello'] },
  { setup: 'give me a hello world in javascript in a code block', t1Keys: ['console', 'hello'],
    toLang: 'go', t2Keys: ['println', 'hello'] },
  { setup: 'give me a hello world in python in a code block', t1Keys: ['print', 'hello'],
    toLang: 'ruby', t2Keys: ['puts', 'hello'] },
];
function buildCr(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = CR_SEEDS[i % CR_SEEDS.length];
    out.push({ id: `cr-${i}`, bundle: 'codeRevise', turns: [
      { user: s.setup, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          if (!hasFenced(a)) return 't1: no fence';
          for (const k of s.t1Keys) if (!lower(a).includes(lower(k))) return `t1: missing ${k}`;
          return null;
        }},
      { user: `translate that to ${s.toLang}`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          if (!hasFenced(a)) return 't2: no fence';
          for (const k of s.t2Keys) if (!lower(a).includes(lower(k))) return `t2: missing ${k}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 2 — REMOVE ITEM
// ---------------------------------------------------------------------------
interface RiSeed { setup: string; items: string[]; removeIdx: number; }
const RI_SEEDS: RiSeed[] = [
  { setup: 'list 4 planets as a numbered list', items: ['mercury', 'venus', 'earth', 'mars'], removeIdx: 1 },
  { setup: 'list 4 european capitals as a numbered list', items: ['paris', 'berlin', 'rome', 'madrid'], removeIdx: 1 },
  { setup: 'list 4 programming languages as a numbered list', items: ['python', 'javascript', 'typescript', 'java'], removeIdx: 2 },
  { setup: 'list 4 asian countries as a numbered list', items: ['japan', 'china', 'south korea', 'thailand'], removeIdx: 0 },
  { setup: 'list 4 chemical elements as a numbered list', items: ['hydrogen', 'helium', 'oxygen', 'nitrogen'], removeIdx: 3 },
];
function buildRi(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = RI_SEEDS[i % RI_SEEDS.length];
    const ordinalWord = ['1st', '2nd', '3rd', '4th'][s.removeIdx];
    const removed = s.items[s.removeIdx];
    const remaining = s.items.filter((_, idx) => idx !== s.removeIdx);
    out.push({ id: `ri-${i}`, bundle: 'removeItem', turns: [
      { user: s.setup, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          if (numberedCount(a) < 3) return 't1: missing list';
          return null;
        }},
      { user: `remove the ${ordinalWord} one`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          const lc = lower(a);
          const rx = new RegExp(`\\b${removed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
          if (rx.test(a)) return `t2: still contains "${removed}"`;
          let hits = 0;
          for (const k of remaining) if (lc.includes(lower(k))) hits++;
          if (hits < remaining.length) return `t2: missing one of ${remaining.join(',')}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 3 — SWAP ITEMS
// ---------------------------------------------------------------------------
interface SwSeed { setup: string; items: string[]; a: number; b: number; }
const SW_SEEDS: SwSeed[] = [
  { setup: 'list 5 planets as a numbered list', items: ['mercury', 'venus', 'earth', 'mars', 'jupiter'], a: 0, b: 2 },
  { setup: 'list 5 european capitals as a numbered list', items: ['paris', 'berlin', 'rome', 'madrid', 'lisbon'], a: 0, b: 2 },
  { setup: 'list 5 programming languages as a numbered list', items: ['python', 'javascript', 'typescript', 'java', 'rust'], a: 1, b: 3 },
  { setup: 'list 5 asian countries as a numbered list', items: ['japan', 'china', 'south korea', 'thailand', 'vietnam'], a: 0, b: 4 },
  { setup: 'list 5 chemical elements as a numbered list', items: ['hydrogen', 'helium', 'oxygen', 'nitrogen', 'carbon'], a: 1, b: 3 },
];
function buildSw(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = SW_SEEDS[i % SW_SEEDS.length];
    const ord = (k: number) => ['1', '2', '3', '4', '5'][k];
    out.push({ id: `sw-${i}`, bundle: 'swapItems', turns: [
      { user: s.setup, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          if (numberedCount(a) < 4) return 't1: missing list';
          return null;
        }},
      { user: `swap #${ord(s.a)} and #${ord(s.b)}`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          const lc = lower(a);
          for (const k of s.items) if (!lc.includes(lower(k))) return `t2: missing ${k}`;
          // After swap, items[b] must appear before items[a].
          const pa = lc.indexOf(lower(s.items[s.a]));
          const pb = lc.indexOf(lower(s.items[s.b]));
          if (pb >= pa) return 't2: not swapped';
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 4 — EXPLAIN EACH
// ---------------------------------------------------------------------------
interface EeSeed { setup: string; items: string[]; }
const EE_SEEDS: EeSeed[] = [
  { setup: 'list 3 planets as bullet points', items: ['mercury', 'venus', 'earth'] },
  { setup: 'list 3 european capitals as bullet points', items: ['paris', 'berlin', 'rome'] },
  { setup: 'list 3 programming languages as bullet points', items: ['python', 'javascript', 'typescript'] },
  { setup: 'list 3 asian countries as bullet points', items: ['japan', 'china', 'south korea'] },
  { setup: 'list 3 chemical elements as bullet points', items: ['hydrogen', 'helium', 'oxygen'] },
];
function buildEe(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = EE_SEEDS[i % EE_SEEDS.length];
    out.push({ id: `ee-${i}`, bundle: 'explainEach', turns: [
      { user: s.setup, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          if (bulletCount(a) < 2) return 't1: missing bullets';
          return null;
        }},
      { user: 'explain each one in one sentence', check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          // All three items must be mentioned in the explanation.
          for (const k of s.items) if (!lower(a).includes(lower(k))) return `t2: missing ${k}`;
          // Must look like multiple sentences (>=3 periods or >=3 lines).
          const sentences = (a.match(/[.!?]\s|[.!?]$/g) || []).length;
          const lines = a.split(/\r?\n/).filter(l => l.trim().length > 0).length;
          if (sentences < 3 && lines < 3) return 't2: not multi-sentence';
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 5 — DEEP COMBO (8 turns mixing many skills)
// ---------------------------------------------------------------------------
interface DcSeed { turns: Array<{ user: string; assert?: 'bullets3' | 'numbered3' | 'reversed' | 'upperOnly' | 'lastItem' | 'ordinal2' | 'noForbid'; payload?: string[]; }>; }
const DC_SEEDS: DcSeed[] = [
  { turns: [
    { user: 'list 3 planets as bullet points', assert: 'bullets3' },
    { user: 'actually do it as a numbered list', assert: 'numbered3' },
    { user: 'now reverse the order', assert: 'reversed' },
    { user: 'what was the second one?', assert: 'ordinal2', payload: ['venus','mercury','earth'] },
    { user: 'what was the last one?', assert: 'lastItem', payload: ['mercury'] },
    { user: 'now uppercase only', assert: 'upperOnly' },
    { user: 'name a planet that is not earth or mars or jupiter', assert: 'noForbid', payload: ['earth','mars','jupiter'] },
    { user: 'another one, not venus', assert: 'noForbid', payload: ['venus','earth','mars','jupiter'] },
  ]},
  { turns: [
    { user: 'list 3 european capitals as bullet points', assert: 'bullets3' },
    { user: 'actually do it as a numbered list', assert: 'numbered3' },
    { user: 'now reverse the order', assert: 'reversed' },
    { user: 'what was the second one?', assert: 'ordinal2', payload: ['berlin','paris','rome'] },
    { user: 'what was the last one?', assert: 'lastItem', payload: ['paris'] },
    { user: 'now uppercase only', assert: 'upperOnly' },
    { user: 'name a european capital that is not paris or berlin or rome', assert: 'noForbid', payload: ['paris','berlin','rome'] },
    { user: 'another one, not madrid', assert: 'noForbid', payload: ['madrid','paris','berlin','rome'] },
  ]},
  { turns: [
    { user: 'list 3 programming languages as bullet points', assert: 'bullets3' },
    { user: 'actually do it as a numbered list', assert: 'numbered3' },
    { user: 'now reverse the order', assert: 'reversed' },
    { user: 'what was the second one?', assert: 'ordinal2', payload: ['javascript','python','typescript'] },
    { user: 'what was the last one?', assert: 'lastItem', payload: ['python'] },
    { user: 'now uppercase only', assert: 'upperOnly' },
    { user: 'name a programming language that is not python or javascript or typescript', assert: 'noForbid', payload: ['python','javascript','typescript'] },
    { user: 'another one, not java', assert: 'noForbid', payload: ['java','python','javascript','typescript'] },
  ]},
];
function stripCodeAndUrls(s: string): string {
  return s.replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '').replace(/https?:\/\/\S+/g, '');
}
function buildDc(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = DC_SEEDS[i % DC_SEEDS.length];
    const turns: Turn[] = s.turns.map((t, ti) => ({
      user: t.user,
      check: (a: string) => {
        if (isFallback(a) || isClarify(a)) return `t${ti+1}: bailed`;
        if (t.assert === 'bullets3' && bulletCount(a) < 3) return `t${ti+1}: expected 3 bullets`;
        if (t.assert === 'numbered3' && numberedCount(a) < 3) return `t${ti+1}: expected numbered list`;
        if (t.assert === 'reversed' && (numberedCount(a) < 3 && bulletCount(a) < 3)) return `t${ti+1}: no list in reverse`;
        if (t.assert === 'ordinal2' && t.payload && !lower(a).includes(t.payload[0])) return `t${ti+1}: ordinal2 missing ${t.payload[0]}`;
        if (t.assert === 'lastItem' && t.payload && !lower(a).includes(t.payload[0])) return `t${ti+1}: last missing ${t.payload[0]}`;
        if (t.assert === 'upperOnly' && /[a-z]/.test(stripCodeAndUrls(a))) return `t${ti+1}: still has lowercase`;
        if (t.assert === 'noForbid' && t.payload) {
          for (const f of t.payload) {
            const rx = new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            if (rx.test(a)) return `t${ti+1}: forbidden ${f}`;
          }
        }
        return null;
      },
    }));
    out.push({ id: `dc-${i}`, bundle: 'deepCombo', turns });
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
    ...buildCr(rand, n),
    ...buildRi(rand, n),
    ...buildSw(rand, n),
    ...buildEe(rand, n),
    ...buildDc(rand, n),
  ];
  const cases = only ? all.filter(c => c.bundle === only) : all;

  const tally: Record<BundleId, { pass: number; fail: number }> = {
    codeRevise: { pass: 0, fail: 0 },
    removeItem: { pass: 0, fail: 0 },
    swapItems: { pass: 0, fail: 0 },
    explainEach: { pass: 0, fail: 0 },
    deepCombo: { pass: 0, fail: 0 },
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
          preview: answers.join(' >> ').slice(0, 500).replace(/\s+/g, ' '),
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
  console.log('=== Intent / Format / Meaning bench — V10 (revise/remove/swap/explain/combo) ===');
  console.log(`n_per_bundle=${n}  seed=${seed}  totalCases=${cases.length}  totalMs=${totalMs}`);
  let pAll = 0, tAll = 0;
  for (const b of ['codeRevise', 'removeItem', 'swapItems', 'explainEach', 'deepCombo'] as const) {
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
