/**
 * Intent / Format / Meaning bench — v5 (combined constraints).
 *
 * v5 bundles target combined / adversarial wedges:
 *   1. comboFormatNegation — list + negation + format in one shot
 *      ("5 european capitals as bullet points, excluding paris and rome").
 *   2. comboFormatLowercase — format + case constraint
 *      ("5 facts about france as bullet points, lowercase only").
 *   3. chainNegation — chain ending in negation
 *      ("name a planet" → "another one" → "not earth or mars").
 *   4. longChain — 7-turn capital chain.
 *   5. midSentenceClarify — disambig presented mid-sentence
 *      ("talk about python — the snake, not the language").
 */

import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { VaiEngine } from '../src/models/vai-engine.js';

type Verdict = 'PASS' | 'FAIL';
type BundleId = 'comboFormatNegation' | 'comboFormatLowercase' | 'chainNegation' | 'longChain' | 'midSentenceClarify';

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
function bulletCount(s: string): number { return (s.match(/^\s*[-*]\s+/gm) || []).length; }
function numberedCount(s: string): number { return (s.match(/^\s*\d+[.)]\s+/gm) || []).length; }

// ---------------------------------------------------------------------------
// BUNDLE 1 — COMBO: format + negation
// ---------------------------------------------------------------------------
interface CfnSeed { prompt: string; minBullets?: number; minNumbered?: number; forbid: string[]; expectAny: string[]; }
const CFN_SEEDS: CfnSeed[] = [
  { prompt: 'list 3 european capitals as bullet points, excluding paris and rome',
    minBullets: 3, forbid: ['paris', 'rome'],
    expectAny: ['berlin', 'madrid', 'lisbon', 'oslo', 'vienna', 'warsaw', 'stockholm', 'amsterdam', 'brussels', 'athens', 'dublin', 'helsinki', 'prague'] },
  { prompt: 'name 3 asian countries as a numbered list, but not japan or china',
    minNumbered: 3, forbid: ['japan', 'china'],
    expectAny: ['thailand', 'vietnam', 'india', 'indonesia', 'philippines', 'malaysia', 'singapore', 'pakistan', 'bangladesh', 'mongolia', 'south korea', 'north korea'] },
  { prompt: 'list 3 planets as bullet points, excluding earth and mars',
    minBullets: 3, forbid: ['earth', 'mars'],
    expectAny: ['mercury', 'venus', 'jupiter', 'saturn', 'uranus', 'neptune'] },
  { prompt: 'list 3 programming languages as bullet points, other than python and javascript',
    minBullets: 3, forbid: ['python', 'javascript'],
    expectAny: ['typescript', 'java', 'rust', 'go', 'ruby', 'kotlin', 'swift', 'c++', 'c#'] },
];
function buildComboFmtNeg(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = CFN_SEEDS[i % CFN_SEEDS.length];
    out.push({
      id: `cfn-${i}`, bundle: 'comboFormatNegation',
      turns: [{
        user: s.prompt,
        check: (a) => {
          if (a.trim().length === 0) return 'empty';
          if (isFallback(a) || isClarify(a)) return 'bailed';
          if (s.minBullets && bulletCount(a) < s.minBullets) return `expected ${s.minBullets} bullets, got ${bulletCount(a)}`;
          if (s.minNumbered && numberedCount(a) < s.minNumbered) return `expected ${s.minNumbered} numbered, got ${numberedCount(a)}`;
          const hit = s.forbid.find(f => lower(a).includes(lower(f)));
          if (hit) return `forbidden "${hit}" present`;
          if (!hasAny(a, s.expectAny)) return 'no valid alt';
          return null;
        },
      }],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 2 — COMBO: format + lowercase
// ---------------------------------------------------------------------------
interface CflSeed { prompt: string; minBullets?: number; minNumbered?: number; expect: string[]; }
const CFL_SEEDS: CflSeed[] = [
  { prompt: '5 facts about france as bullet points, lowercase only', minBullets: 3, expect: ['france'] },
  { prompt: '5 facts about japan as a numbered list, in lowercase',  minNumbered: 3, expect: ['japan'] },
  { prompt: '5 facts about germany as bullet points, lowercase only', minBullets: 3, expect: ['germany'] },
];
function buildComboFmtLower(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = CFL_SEEDS[i % CFL_SEEDS.length];
    out.push({
      id: `cfl-${i}`, bundle: 'comboFormatLowercase',
      turns: [{
        user: s.prompt,
        check: (a) => {
          if (a.trim().length === 0) return 'empty';
          if (isFallback(a) || isClarify(a)) return 'bailed';
          if (s.minBullets && bulletCount(a) < s.minBullets) return `expected ${s.minBullets} bullets, got ${bulletCount(a)}`;
          if (s.minNumbered && numberedCount(a) < s.minNumbered) return `expected ${s.minNumbered} numbered, got ${numberedCount(a)}`;
          // Lowercase check: strip markdown, list markers, and acronyms-from-content;
          // require zero uppercase Latin letters in the prose body.
          const stripped = a.replace(/[*_`#]/g, '').replace(/^\s*(?:\d+[.)]|[-*])\s+/gm, '');
          if (/[A-Z]/.test(stripped)) return 'has uppercase';
          if (!hasAll(a, s.expect)) return `missing topic`;
          return null;
        },
      }],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 3 — CHAIN ENDING IN NEGATION
// ---------------------------------------------------------------------------
interface CnSeed {
  turns: Array<{ user: string; expectAny?: string[]; forbid?: string[] }>;
}
const CN_SEEDS: CnSeed[] = [
  {
    turns: [
      { user: 'name a planet',           expectAny: ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'] },
      { user: 'another one',             expectAny: ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'] },
      { user: 'one that is not earth or mars', expectAny: ['mercury', 'venus', 'jupiter', 'saturn', 'uranus', 'neptune'], forbid: ['earth', 'mars'] },
    ],
  },
  {
    turns: [
      { user: 'name a programming language',                              expectAny: ['python', 'javascript', 'typescript', 'java', 'rust', 'go', 'ruby', 'kotlin', 'swift', 'c++'] },
      { user: 'another one',                                              expectAny: ['python', 'javascript', 'typescript', 'java', 'rust', 'go', 'ruby', 'kotlin', 'swift', 'c++'] },
      { user: 'one other than python or javascript',                      expectAny: ['typescript', 'java', 'rust', 'go', 'ruby', 'kotlin', 'swift', 'c++'], forbid: ['python', 'javascript'] },
    ],
  },
  {
    turns: [
      { user: 'name a european capital',                          expectAny: ['paris', 'berlin', 'rome', 'madrid', 'lisbon', 'oslo', 'vienna', 'warsaw', 'stockholm', 'amsterdam', 'brussels', 'athens', 'dublin'] },
      { user: 'another one',                                      expectAny: ['paris', 'berlin', 'rome', 'madrid', 'lisbon', 'oslo', 'vienna', 'warsaw', 'stockholm', 'amsterdam', 'brussels', 'athens', 'dublin'] },
      { user: 'one that is not paris, berlin, or rome',           expectAny: ['madrid', 'lisbon', 'oslo', 'vienna', 'warsaw', 'stockholm', 'amsterdam', 'brussels', 'athens', 'dublin'], forbid: ['paris', 'berlin', 'rome'] },
    ],
  },
];
function buildChainNeg(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = CN_SEEDS[i % CN_SEEDS.length];
    const turns: Turn[] = seed.turns.map((t, idx) => ({
      user: t.user,
      check: (a) => {
        if (a.trim().length === 0) return `turn${idx + 1}: empty`;
        if (isFallback(a) || isClarify(a)) return `turn${idx + 1}: bailed`;
        if (t.expectAny && !hasAny(a, t.expectAny)) return `turn${idx + 1}: no valid item`;
        if (t.forbid) {
          const hit = t.forbid.find(f => lower(a).includes(lower(f)));
          if (hit) return `turn${idx + 1}: forbidden "${hit}"`;
        }
        return null;
      },
    }));
    out.push({ id: `chainNeg-${i}`, bundle: 'chainNegation', turns });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 4 — LONG CHAIN (7 turns)
// ---------------------------------------------------------------------------
const LC_SEEDS: Array<Array<{ user: string; expect: string[]; forbid?: string[] }>> = [
  [
    { user: 'what is the capital of france?', expect: ['paris'] },
    { user: 'and germany?',                   expect: ['berlin'], forbid: ['paris'] },
    { user: 'and italy?',                     expect: ['rome'],   forbid: ['berlin'] },
    { user: 'and spain?',                     expect: ['madrid'], forbid: ['rome'] },
    { user: 'and portugal?',                  expect: ['lisbon'], forbid: ['madrid'] },
    { user: 'and norway?',                    expect: ['oslo'],   forbid: ['lisbon'] },
    { user: 'and japan?',                     expect: ['tokyo'],  forbid: ['oslo'] },
  ],
  [
    { user: 'who is the ceo of microsoft?', expect: ['nadella'] },
    { user: 'and apple?',                   expect: ['cook'],     forbid: ['nadella'] },
    { user: 'and google?',                  expect: ['pichai'],   forbid: ['cook'] },
    { user: 'and nvidia?',                  expect: ['huang'],    forbid: ['pichai'] },
    { user: 'and amazon?',                  expect: ['jassy'],    forbid: ['huang'] },
    { user: 'and meta?',                    expect: ['zuckerberg'], forbid: ['jassy'] },
    { user: 'and tesla?',                   expect: ['musk'],     forbid: ['zuckerberg'] },
  ],
];
function buildLongChain(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = LC_SEEDS[i % LC_SEEDS.length];
    const turns: Turn[] = seed.map((t, idx) => ({
      user: t.user,
      check: (a) => {
        if (a.trim().length === 0) return `turn${idx + 1}: empty`;
        if (isFallback(a) || isClarify(a)) return `turn${idx + 1}: bailed`;
        if (!hasAll(a, t.expect)) {
          const m = t.expect.find(e => !lower(a).includes(lower(e)));
          return `turn${idx + 1}: missing "${m}"`;
        }
        if (t.forbid) {
          const hit = t.forbid.find(f => lower(a).includes(lower(f)));
          if (hit) return `turn${idx + 1}: forbidden "${hit}"`;
        }
        return null;
      },
    }));
    out.push({ id: `longChain-${i}`, bundle: 'longChain', turns });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 5 — MID-SENTENCE DISAMBIG
// ---------------------------------------------------------------------------
interface MscSeed { prompt: string; expect: string[]; forbid: string[]; }
const MSC_SEEDS: MscSeed[] = [
  { prompt: 'tell me about python — the snake, not the language', expect: ['snake'], forbid: ['guido', 'rossum'] },
  { prompt: 'talk about python, the language not the snake',      expect: ['guido'], forbid: ['snake'] },
  { prompt: 'tell me about apple, the company not the fruit',     expect: ['cupertino'], forbid: ['fruit'] },
  { prompt: 'tell me about apple, the fruit not the company',     expect: ['fruit'], forbid: ['cupertino', 'tim cook'] },
  { prompt: 'tell me about mercury — the planet, not the element', expect: ['planet'], forbid: ['element', 'thermometer'] },
  { prompt: 'tell me about mercury, the element not the planet',   expect: ['element'], forbid: ['planet'] },
  { prompt: 'tell me about java — the island, not the language',   expect: ['island', 'indonesia'], forbid: ['programming', 'jvm'] },
  { prompt: 'tell me about java, the language not the island',     expect: ['programming'], forbid: ['island'] },
];
function buildMidSentence(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = MSC_SEEDS[i % MSC_SEEDS.length];
    out.push({
      id: `msc-${i}`, bundle: 'midSentenceClarify',
      turns: [{
        user: s.prompt,
        check: (a) => {
          if (a.trim().length === 0) return 'empty';
          if (isFallback(a) || isClarify(a)) return 'bailed';
          if (!hasAny(a, s.expect)) return `missing expected sense [${s.expect.join('|')}]`;
          const hit = s.forbid.find(f => lower(a).includes(lower(f)));
          if (hit) return `forbidden "${hit}" leaked`;
          return null;
        },
      }],
    });
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
    ...buildComboFmtNeg(rand, n),
    ...buildComboFmtLower(rand, n),
    ...buildChainNeg(rand, n),
    ...buildLongChain(rand, n),
    ...buildMidSentence(rand, n),
  ];
  if (onlyBundle) cases = cases.filter(c => c.bundle === onlyBundle);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError('fetch disabled'); }) as typeof fetch;

  const tally: Record<BundleId, { pass: number; fail: number }> = {
    comboFormatNegation: { pass: 0, fail: 0 },
    comboFormatLowercase: { pass: 0, fail: 0 },
    chainNegation: { pass: 0, fail: 0 },
    longChain: { pass: 0, fail: 0 },
    midSentenceClarify: { pass: 0, fail: 0 },
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
  console.log('=== Intent / Format / Meaning bench — V5 (combined constraints) ===');
  console.log(`n_per_bundle=${n}  seed=${seed}  totalCases=${cases.length}  totalMs=${totalMs}`);
  let pAll = 0, tAll = 0;
  for (const b of ['comboFormatNegation', 'comboFormatLowercase', 'chainNegation', 'longChain', 'midSentenceClarify'] as const) {
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
