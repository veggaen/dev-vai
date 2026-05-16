/**
 * Intent / Format / Meaning bench — v4 (advanced bundles).
 *
 * v4 bundles target fresh failure modes:
 *   1. deepChain      — 5-turn topic chains (capital / ceo) ending in
 *                       a reshape ("now as a numbered list").
 *   2. doubleNegation — multi-token forbid lists ("not earth or mars").
 *   3. exactCount     — "in exactly N words" and "in exactly N sentences"
 *                       across many topics.
 *   4. multiSense     — broader disambiguation (amazon/turkey/apple/
 *                       mercury/java) with sense atoms ("the river",
 *                       "the country", "the fruit", "the element",
 *                       "the island").
 *   5. shapeFlip      — two consecutive reshape contradictions
 *                       ("actually as a table" then "wait, json").
 *
 * Usage:
 *   pnpm exec tsx bench/intent-format-meaning-v4.mts --n=200 --seed=42
 *   pnpm exec tsx bench/intent-format-meaning-v4.mts --report=../../_ifm_v4_r1.json
 */

import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { VaiEngine } from '../src/models/vai-engine.js';

type Verdict = 'PASS' | 'FAIL';
type BundleId = 'deepChain' | 'doubleNegation' | 'exactCount' | 'multiSense' | 'shapeFlip';

interface Turn {
  user: string;
  check?: (answer: string, allAnswers: string[]) => string | null;
}
interface Case {
  id: string;
  bundle: BundleId;
  turns: Turn[];
}

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
function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

const HONEST_FALLBACK = /^I (?:don'?t (?:have|know)|can'?t|cannot|haven'?t|am not)\b/i;
const CLARIFY = /could you say a bit more|what (?:specifically|exactly) do you mean|which (?:one|sense|meaning)/i;
function isFallback(a: string): boolean { return HONEST_FALLBACK.test(a.trim()); }
function isClarify(a: string): boolean { return CLARIFY.test(a); }
function lower(s: string): string { return s.toLowerCase(); }
function hasAny(a: string, terms: string[]): boolean { const l = lower(a); return terms.some(t => l.includes(lower(t))); }
function hasAll(a: string, terms: string[]): boolean { const l = lower(a); return terms.every(t => l.includes(lower(t))); }
function wordCount(s: string): number { return (s.trim().match(/\S+/g) || []).length; }
function sentenceCount(s: string): number { return (s.trim().match(/[.!?]+(?:\s|$)/g) || []).length; }

// ---------------------------------------------------------------------------
// BUNDLE 1 — DEEP CHAIN (5-turn capital / ceo / disambig)
// ---------------------------------------------------------------------------
interface DeepChainSeed {
  turns: Array<{ user: string; expect?: string[]; forbid?: string[]; shape?: 'numbered' | 'bullet' | 'table' }>;
}
const DEEP_CHAIN_SEEDS: DeepChainSeed[] = [
  // Capital chain — 5 swaps including reshape
  {
    turns: [
      { user: 'what is the capital of france?', expect: ['paris'] },
      { user: 'and germany?',                   expect: ['berlin'], forbid: ['paris'] },
      { user: 'and italy?',                     expect: ['rome'],   forbid: ['berlin', 'paris'] },
      { user: 'and spain?',                     expect: ['madrid'], forbid: ['rome', 'berlin'] },
      { user: 'and portugal?',                  expect: ['lisbon'], forbid: ['madrid', 'rome'] },
    ],
  },
  // CEO chain — 5 swaps
  {
    turns: [
      { user: 'who is the ceo of microsoft?', expect: ['nadella'] },
      { user: 'and apple?',                   expect: ['cook'],     forbid: ['nadella'] },
      { user: 'and google?',                  expect: ['pichai'],   forbid: ['cook', 'nadella'] },
      { user: 'and nvidia?',                  expect: ['huang'],    forbid: ['pichai', 'cook'] },
      { user: 'and amazon?',                  expect: ['jassy'],    forbid: ['huang', 'pichai'] },
    ],
  },
  // Disambig + 3 corefs about a snake
  {
    turns: [
      { user: 'tell me about python the snake', expect: ['snake', 'reptile'], forbid: ['guido', 'rossum'] },
      { user: 'what does it eat?',              expect: ['mammal', 'eats'],   forbid: ['guido'] },
      { user: 'where does it live?',            expect: ['africa', 'asia'],   forbid: ['guido'] },
    ],
  },
  // Numbered list + 2 swaps
  {
    turns: [
      { user: '5 facts about france as a numbered list', expect: ['france'], shape: 'numbered' },
      { user: 'now do the same for japan',               expect: ['japan'], forbid: ['france'], shape: 'numbered' },
      { user: 'now do the same for germany',             expect: ['germany'], forbid: ['japan'], shape: 'numbered' },
      { user: 'now do the same for italy',               expect: ['italy', 'rome'], forbid: ['germany'], shape: 'numbered' },
    ],
  },
];
const DEEP_CHAIN_PARAS = [(s: string) => s, (s: string) => `please ${s}`];
function buildDeepChain(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = DEEP_CHAIN_SEEDS[i % DEEP_CHAIN_SEEDS.length];
    const para = pick(rand, DEEP_CHAIN_PARAS);
    const turns: Turn[] = seed.turns.map((t, idx) => ({
      user: idx === 0 ? para(t.user) : t.user,
      check: (a) => {
        if (a.trim().length === 0) return `turn${idx + 1}: empty`;
        if (isFallback(a) || isClarify(a)) return `turn${idx + 1}: bailed`;
        if (t.expect && !hasAll(a, t.expect)) {
          const m = t.expect.find(e => !lower(a).includes(lower(e)));
          return `turn${idx + 1}: missing "${m}"`;
        }
        if (t.forbid) {
          const hit = t.forbid.find(f => lower(a).includes(lower(f)));
          if (hit) return `turn${idx + 1}: forbidden "${hit}"`;
        }
        if (t.shape === 'numbered') {
          const c = (a.match(/^\s*\d+[.)]\s+/gm) || []).length;
          if (c < 3) return `turn${idx + 1}: expected numbered, got ${c}`;
        }
        return null;
      },
    }));
    out.push({ id: `deepChain-${i}`, bundle: 'deepChain', turns });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 2 — DOUBLE NEGATION (multi-token forbid)
// ---------------------------------------------------------------------------
interface DnSeed { prompt: string; expectAny: string[]; forbid: string[]; }
const DN_SEEDS: DnSeed[] = [
  { prompt: 'name a planet that is not earth or mars',
    expectAny: ['mercury', 'venus', 'jupiter', 'saturn', 'uranus', 'neptune'],
    forbid: ['earth', 'mars'] },
  { prompt: 'pick a programming language other than python or javascript',
    expectAny: ['typescript', 'java', 'rust', 'go', 'ruby', 'kotlin', 'swift', 'c++'],
    forbid: ['python', 'javascript'] },
  { prompt: 'list 3 european capitals, but skip berlin, paris, and rome',
    expectAny: ['madrid', 'lisbon', 'oslo', 'vienna', 'warsaw', 'stockholm', 'amsterdam', 'brussels', 'athens', 'dublin', 'helsinki', 'prague'],
    forbid: ['berlin', 'paris', 'rome'] },
  { prompt: 'name an asian country that is not japan, china, or korea',
    expectAny: ['thailand', 'vietnam', 'india', 'indonesia', 'philippines', 'malaysia', 'singapore', 'pakistan', 'bangladesh', 'mongolia'],
    forbid: ['japan', 'china', 'korea'] },
  { prompt: 'name a chemical element other than hydrogen or helium',
    expectAny: ['oxygen', 'nitrogen', 'carbon', 'iron', 'gold', 'silver', 'sodium', 'mercury', 'aluminum'],
    forbid: ['hydrogen', 'helium'] },
];
const DN_PARAS = [(s: string) => s, (s: string) => `please ${s}`, (s: string) => `quick — ${s}`];
function buildDoubleNeg(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = DN_SEEDS[i % DN_SEEDS.length];
    const para = pick(rand, DN_PARAS);
    out.push({
      id: `doubleNeg-${i}`,
      bundle: 'doubleNegation',
      turns: [{
        user: para(seed.prompt),
        check: (a) => {
          if (a.trim().length === 0) return 'empty';
          if (isFallback(a) || isClarify(a)) return 'bailed';
          const hit = seed.forbid.find(f => lower(a).includes(lower(f)));
          if (hit) return `forbidden "${hit}" present`;
          if (!hasAny(a, seed.expectAny)) return `no valid alternative from [${seed.expectAny.slice(0, 4).join('|')}...]`;
          return null;
        },
      }],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 3 — EXACT COUNT (in exactly N words / sentences)
// ---------------------------------------------------------------------------
interface EcSeed { prompt: string; check: (a: string) => string | null; }
const EC_SEEDS: EcSeed[] = [
  { prompt: 'capital of france — answer in exactly one word',
    check: (a) => {
      const w = wordCount(a.replace(/[*_`.]/g, ''));
      if (w !== 1) return `expected 1 word, got ${w}`;
      if (!/paris/i.test(a)) return 'wrong';
      return null;
    } },
  { prompt: 'tell me about france in exactly one sentence',
    check: (a) => {
      const c = sentenceCount(a);
      if (c !== 1) return `expected 1 sentence, got ${c}`;
      if (!/france/i.test(a)) return 'missing topic';
      return null;
    } },
  { prompt: 'tell me about japan in exactly two sentences',
    check: (a) => {
      const c = sentenceCount(a);
      if (c !== 2) return `expected 2 sentences, got ${c}`;
      if (!/japan/i.test(a)) return 'missing topic';
      return null;
    } },
  { prompt: 'tell me about germany in exactly three sentences',
    check: (a) => {
      const c = sentenceCount(a);
      if (c !== 3) return `expected 3 sentences, got ${c}`;
      if (!/germany/i.test(a)) return 'missing topic';
      return null;
    } },
  { prompt: 'tell me about italy in exactly four sentences',
    check: (a) => {
      const c = sentenceCount(a);
      if (c !== 4) return `expected 4 sentences, got ${c}`;
      if (!/italy/i.test(a)) return 'missing topic';
      return null;
    } },
  { prompt: 'capital of japan — lowercase only, in one word',
    check: (a) => {
      const stripped = a.replace(/[*_`.]/g, '').trim();
      if (stripped !== stripped.toLowerCase()) return 'has uppercase';
      const w = wordCount(stripped);
      if (w !== 1) return `expected 1 word, got ${w}`;
      if (!/tokyo/i.test(a)) return 'wrong';
      return null;
    } },
];
const EC_PARAS = [(s: string) => s, (s: string) => `please ${s}`];
function buildExactCount(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = EC_SEEDS[i % EC_SEEDS.length];
    const para = pick(rand, EC_PARAS);
    out.push({
      id: `exactCount-${i}`,
      bundle: 'exactCount',
      turns: [{
        user: para(seed.prompt),
        check: (a) => {
          if (a.trim().length === 0) return 'empty';
          if (isFallback(a) || isClarify(a)) return 'bailed';
          return seed.check(a);
        },
      }],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 4 — MULTI-SENSE DISAMBIGUATION
// ---------------------------------------------------------------------------
interface MsSeed { prompt: string; expect: string[]; forbid: string[]; }
const MS_SEEDS: MsSeed[] = [
  { prompt: 'tell me about amazon the river', expect: ['river', 'south america'], forbid: ['jeff bezos', 'aws', 'ecommerce'] },
  { prompt: 'tell me about amazon the company', expect: ['bezos', 'ecommerce'], forbid: ['river'] },
  { prompt: 'tell me about turkey the country', expect: ['country', 'ankara'], forbid: ['thanksgiving', 'bird'] },
  { prompt: 'tell me about turkey the bird', expect: ['bird'], forbid: ['ankara', 'istanbul'] },
  { prompt: 'tell me about apple the fruit', expect: ['fruit'], forbid: ['cupertino', 'tim cook', 'iphone'] },
  { prompt: 'tell me about apple the company', expect: ['company', 'cupertino'], forbid: ['fruit'] },
  { prompt: 'tell me about mercury the planet', expect: ['planet', 'sun'], forbid: ['element', 'thermometer'] },
  { prompt: 'tell me about mercury the element', expect: ['element', 'metal'], forbid: ['planet'] },
  { prompt: 'tell me about java the island', expect: ['island', 'indonesia'], forbid: ['programming', 'jvm'] },
  { prompt: 'tell me about java the language', expect: ['programming', 'language'], forbid: ['island'] },
  { prompt: 'tell me about python the snake', expect: ['snake', 'reptile'], forbid: ['guido'] },
  { prompt: 'tell me about python the language', expect: ['language', 'guido'], forbid: ['snake'] },
];
const MS_PARAS = [(s: string) => s, (s: string) => `please ${s}`, (s: string) => `quick — ${s}`];
function buildMultiSense(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = MS_SEEDS[i % MS_SEEDS.length];
    const para = pick(rand, MS_PARAS);
    out.push({
      id: `multiSense-${i}`,
      bundle: 'multiSense',
      turns: [{
        user: para(seed.prompt),
        check: (a) => {
          if (a.trim().length === 0) return 'empty';
          if (isFallback(a) || isClarify(a)) return 'bailed';
          if (!hasAny(a, seed.expect)) return `no expected sense atom from [${seed.expect.join('|')}]`;
          const hit = seed.forbid.find(f => lower(a).includes(lower(f)));
          if (hit) return `forbidden sense "${hit}" leaked`;
          return null;
        },
      }],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 5 — SHAPE FLIP (two contradictions in a row)
// ---------------------------------------------------------------------------
interface SfSeed {
  turns: Array<{ user: string; expect?: string[]; shape?: 'numbered' | 'bullet' | 'table' | 'json' }>;
}
const SF_SEEDS: SfSeed[] = [
  {
    turns: [
      { user: '5 facts about france as a numbered list', expect: ['france'], shape: 'numbered' },
      { user: 'actually do it as bullet points instead', expect: ['france'], shape: 'bullet' },
      { user: 'wait, give it as a markdown table',       expect: ['france'], shape: 'table' },
    ],
  },
  {
    turns: [
      { user: 'tell me about japan as bullet points', expect: ['japan'], shape: 'bullet' },
      { user: 'actually do it as a numbered list',    expect: ['japan'], shape: 'numbered' },
      { user: 'wait, give it as a markdown table',    expect: ['japan'], shape: 'table' },
    ],
  },
  {
    turns: [
      { user: '5 facts about germany as a numbered list', expect: ['germany'], shape: 'numbered' },
      { user: 'actually do it as bullet points instead',  expect: ['germany'], shape: 'bullet' },
    ],
  },
];
function checkShape(a: string, shape: 'numbered' | 'bullet' | 'table' | 'json'): string | null {
  if (shape === 'numbered') {
    const c = (a.match(/^\s*\d+[.)]\s+/gm) || []).length;
    if (c < 3) return `expected numbered, got ${c}`;
  } else if (shape === 'bullet') {
    const c = (a.match(/^\s*[-*]\s+/gm) || []).length;
    if (c < 3) return `expected bullet, got ${c}`;
  } else if (shape === 'table') {
    if (!/\|.+\|/.test(a) || !/\|\s*-{2,}/.test(a)) return 'expected markdown table';
  } else if (shape === 'json') {
    if (!/\{[\s\S]*\}/.test(a)) return 'expected json';
  }
  return null;
}
function buildShapeFlip(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = SF_SEEDS[i % SF_SEEDS.length];
    const turns: Turn[] = seed.turns.map((t, idx) => ({
      user: t.user,
      check: (a) => {
        if (a.trim().length === 0) return `turn${idx + 1}: empty`;
        if (isFallback(a) || isClarify(a)) return `turn${idx + 1}: bailed`;
        if (t.expect && !hasAll(a, t.expect)) {
          const m = t.expect.find(e => !lower(a).includes(lower(e)));
          return `turn${idx + 1}: missing "${m}"`;
        }
        if (t.shape) {
          const sr = checkShape(a, t.shape);
          if (sr) return `turn${idx + 1}: ${sr}`;
        }
        return null;
      },
    }));
    out.push({ id: `shapeFlip-${i}`, bundle: 'shapeFlip', turns });
  }
  return out;
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, dflt: string) => {
    const m = args.find(a => a.startsWith(`--${k}=`));
    return m ? m.slice(k.length + 3) : dflt;
  };
  const n = parseInt(arg('n', '200'), 10);
  const seed = parseInt(arg('seed', '42'), 10);
  const reportPath = arg('report', '');
  const onlyBundle = arg('bundle', '') as BundleId | '';

  const rand = mulberry32(seed);
  let cases: Case[] = [
    ...buildDeepChain(rand, n),
    ...buildDoubleNeg(rand, n),
    ...buildExactCount(rand, n),
    ...buildMultiSense(rand, n),
    ...buildShapeFlip(rand, n),
  ];
  if (onlyBundle) cases = cases.filter(c => c.bundle === onlyBundle);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError('fetch disabled'); }) as typeof fetch;

  const tally: Record<BundleId, { pass: number; fail: number }> = {
    deepChain: { pass: 0, fail: 0 },
    doubleNegation: { pass: 0, fail: 0 },
    exactCount: { pass: 0, fail: 0 },
    multiSense: { pass: 0, fail: 0 },
    shapeFlip: { pass: 0, fail: 0 },
  };
  const failures: Array<{ id: string; bundle: BundleId; prompt: string; reason: string; preview: string }> = [];

  const t0 = performance.now();
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    // Fresh engine per case to avoid memory cross-contamination.
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
        const r = turn.check(answer, answers);
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
          preview: answers.join(' >> ').slice(0, 300).replace(/\s+/g, ' '),
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
  console.log('=== Intent / Format / Meaning bench — V4 (advanced) ===');
  console.log(`n_per_bundle=${n}  seed=${seed}  totalCases=${cases.length}  totalMs=${totalMs}`);
  let pAll = 0, tAll = 0;
  for (const b of ['deepChain', 'doubleNegation', 'exactCount', 'multiSense', 'shapeFlip'] as const) {
    const t = tally[b];
    const sum = t.pass + t.fail;
    if (sum === 0) continue;
    const rate = ((t.pass / sum) * 100).toFixed(2);
    console.log(`  ${b.padEnd(15)} pass=${t.pass}/${sum}  (${rate}%)  fail=${t.fail}`);
    pAll += t.pass; tAll += sum;
  }
  console.log(`  OVERALL         pass=${pAll}/${tAll}  (${((pAll / tAll) * 100).toFixed(2)}%)`);

  if (reportPath) {
    writeFileSync(reportPath, JSON.stringify({ n, seed, totalMs, tally, failures }, null, 2));
    console.log(`report written: ${reportPath}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
