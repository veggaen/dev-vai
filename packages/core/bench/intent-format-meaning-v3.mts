/**
 * Intent / Format / Meaning bench — v3 (next-level bundles).
 *
 * v1 measured single-turn quality. v2 added multi-turn followup, mixed
 * constraints, and bare ambiguity. v3 attacks five harder failure modes
 * that production users actually hit:
 *
 *   1. CHAIN         — 3–5 turn conversations stacking coreference
 *                      ("it/its"), topic swap ("and X?"), and re-shape
 *                      ("now as bullets"). The engine must keep both
 *                      topic AND shape state across multiple steps.
 *
 *   2. NEGATION      — exclusion constraints ("name a planet that's not
 *                      earth", "facts about france without mentioning
 *                      paris", "3 ceos but skip microsoft"). The engine
 *                      must respect forbid lists embedded in the prompt.
 *
 *   3. INSTR_FIDELITY — strict structural directives ("answer in exactly
 *                      5 words", "lowercase only", "no punctuation",
 *                      "exactly two sentences", "one emoji"). Shape is
 *                      the entire test.
 *
 *   4. MEANING_LEAK  — bare ambiguous input where any answer (even a
 *                      committed one) must NOT mention the competing
 *                      reading at all. Stricter than v2 ambiguous.
 *
 *   5. CONTRADICTION — user changes their mind mid-conversation
 *                      ("actually, do it as a table instead", "wait, I
 *                      meant the planet"). Engine must follow the
 *                      LATEST instruction, not stick to the first one.
 *
 * Usage:
 *   pnpm exec tsx bench/intent-format-meaning-v3.mts --n=200 --seed=42
 *   pnpm exec tsx bench/intent-format-meaning-v3.mts --bundle=chain
 *   pnpm exec tsx bench/intent-format-meaning-v3.mts --report=../../_ifm_v3_r1.json
 */

import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { VaiEngine } from '../src/models/vai-engine.js';

type Verdict = 'PASS' | 'FAIL';
type BundleId = 'chain' | 'negation' | 'instrFidelity' | 'meaningLeak' | 'contradiction';

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
function hasAny(a: string, terms: string[]): boolean {
  const l = lower(a);
  return terms.some(t => l.includes(lower(t)));
}
function hasAll(a: string, terms: string[]): boolean {
  const l = lower(a);
  return terms.every(t => l.includes(lower(t)));
}

// ---------------------------------------------------------------------------
// BUNDLE 1 — CHAIN (3–5 turn coref + swap + reshape)
// ---------------------------------------------------------------------------
interface ChainSeed {
  turns: Array<{ user: string; expect?: string[]; forbid?: string[]; shapeCheck?: 'numbered' | 'bullet' | 'table' | 'json' | 'one-sentence' }>;
}

const CHAIN_SEEDS: ChainSeed[] = [
  // Capital → swap → swap → swap
  {
    turns: [
      { user: 'what is the capital of france?', expect: ['paris'] },
      { user: 'and germany?',                   expect: ['berlin'], forbid: ['paris'] },
      { user: 'what about japan?',              expect: ['tokyo'],  forbid: ['berlin', 'paris'] },
      { user: 'and norway?',                    expect: ['oslo'],   forbid: ['tokyo', 'berlin'] },
    ],
  },
  // CEO → swap → swap → swap
  {
    turns: [
      { user: 'who is the ceo of microsoft?', expect: ['nadella'] },
      { user: 'and apple?',                   expect: ['cook'],     forbid: ['nadella'] },
      { user: 'and google?',                  expect: ['pichai'],   forbid: ['cook', 'nadella'] },
      { user: 'and nvidia?',                  expect: ['huang'],    forbid: ['pichai', 'cook'] },
    ],
  },
  // disambig topic → coref ("it") → coref ("its")
  {
    turns: [
      { user: 'tell me about python the programming language', expect: ['language', 'guido'], forbid: ['snake', 'reptile'] },
      { user: 'who created it?',                               expect: ['guido', 'rossum'],   forbid: ['snake', 'reptile'] },
      { user: 'what year was it released?',                    expect: ['1991'],              forbid: ['snake', 'reptile'] },
    ],
  },
  // disambig snake → coref → coref
  {
    turns: [
      { user: 'tell me about python the snake', expect: ['snake', 'reptile'], forbid: ['guido', 'rossum', 'programming language'] },
      { user: 'what does it eat?',              expect: ['mammal', 'rodent', 'bird', 'eats'], forbid: ['programming language', 'guido'] },
    ],
  },
  // facts list → reshape "now do the same for X" → reshape again
  {
    turns: [
      { user: '5 facts about france as a numbered list', expect: ['france', 'paris'], shapeCheck: 'numbered' },
      { user: 'now do the same for japan',               expect: ['japan', 'tokyo'], forbid: ['france', 'paris'], shapeCheck: 'numbered' },
      { user: 'now do the same for germany',             expect: ['germany', 'berlin'], forbid: ['japan', 'tokyo', 'france'], shapeCheck: 'numbered' },
    ],
  },
  // table → swap pair
  {
    turns: [
      { user: 'compare http and https as a markdown table', expect: ['http', 'https', '|', '---'], shapeCheck: 'table' },
      { user: 'now compare typescript and javascript the same way', expect: ['typescript', 'javascript', '|', '---'], forbid: ['http', 'https'], shapeCheck: 'table' },
    ],
  },
];

const CHAIN_PARAPHRASES = [
  (t: string) => t,
  (t: string) => `please ${t}`,
];

function buildChainCases(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = CHAIN_SEEDS[i % CHAIN_SEEDS.length];
    const para = pick(rand, CHAIN_PARAPHRASES);
    const turns: Turn[] = seed.turns.map((t, idx) => ({
      user: idx === 0 ? para(t.user) : t.user,
      check: (a) => {
        if (a.trim().length === 0) return `turn${idx + 1}: empty`;
        if (isFallback(a) || isClarify(a)) return `turn${idx + 1}: engine bailed`;
        if (t.expect && !hasAll(a, t.expect)) {
          const missing = t.expect.find(e => !lower(a).includes(lower(e)));
          return `turn${idx + 1}: missing expected "${missing}"`;
        }
        if (t.forbid) {
          const hit = t.forbid.find(f => lower(a).includes(lower(f)));
          if (hit) return `turn${idx + 1}: forbidden token "${hit}" present`;
        }
        if (t.shapeCheck === 'numbered') {
          const c = (a.match(/^\s*\d+[.)]\s+/gm) || []).length;
          if (c < 3) return `turn${idx + 1}: expected numbered list, got ${c} items`;
        }
        if (t.shapeCheck === 'table') {
          if (!/\|.+\|/.test(a) || !/\|\s*-{2,}/.test(a)) return `turn${idx + 1}: expected markdown table`;
        }
        return null;
      },
    }));
    out.push({ id: `chain-${i}`, bundle: 'chain', turns });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 2 — NEGATION (exclusion constraints)
// ---------------------------------------------------------------------------
interface NegationSeed {
  prompt: string;
  expectAny: string[];   // at least one must appear
  forbid: string[];      // none may appear
}

const NEGATION_SEEDS: NegationSeed[] = [
  { prompt: 'name a planet in our solar system that is not earth',
    expectAny: ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'], forbid: ['earth'] },
  { prompt: 'tell me about france but do not mention paris',
    expectAny: ['france', 'european', 'french', 'europe'], forbid: ['paris'] },
  { prompt: 'list 3 european capitals, but skip berlin and paris',
    expectAny: ['rome', 'madrid', 'lisbon', 'oslo', 'vienna', 'warsaw', 'stockholm', 'amsterdam', 'brussels', 'athens', 'dublin', 'helsinki', 'prague'],
    forbid: ['berlin', 'paris'] },
  { prompt: 'name an asian country that is not japan or china',
    expectAny: ['korea', 'thailand', 'vietnam', 'india', 'indonesia', 'philippines', 'malaysia', 'singapore', 'pakistan', 'bangladesh', 'mongolia'],
    forbid: ['japan', 'china'] },
  { prompt: 'pick a programming language that is not python',
    expectAny: ['javascript', 'typescript', 'java', 'rust', 'go', 'c++', 'ruby', 'kotlin', 'swift', 'c#'],
    forbid: ['python'] },
  { prompt: 'who is a tech ceo (not satya nadella)?',
    expectAny: ['cook', 'pichai', 'huang', 'musk', 'zuckerberg', 'jassy'],
    forbid: ['nadella'] },
  { prompt: 'name a chemical element other than hydrogen',
    expectAny: ['helium', 'oxygen', 'nitrogen', 'carbon', 'iron', 'gold', 'silver', 'sodium', 'mercury'],
    forbid: ['hydrogen'] },
  { prompt: 'tell me about japan without mentioning tokyo',
    expectAny: ['japan', 'island', 'asia', 'pacific'], forbid: ['tokyo'] },
];

const NEGATION_PARAPHRASES = [
  (s: string) => s,
  (s: string) => `please ${s}`,
  (s: string) => `${s}.`,
  (s: string) => `quick — ${s}`,
];

function buildNegationCases(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = NEGATION_SEEDS[i % NEGATION_SEEDS.length];
    const para = pick(rand, NEGATION_PARAPHRASES);
    out.push({
      id: `negation-${i}`,
      bundle: 'negation',
      turns: [{
        user: para(seed.prompt),
        check: (a) => {
          if (a.trim().length === 0) return 'empty';
          if (isFallback(a) || isClarify(a)) return 'engine bailed';
          const hit = seed.forbid.find(f => lower(a).includes(lower(f)));
          if (hit) return `forbidden "${hit}" present (negation violated)`;
          if (!hasAny(a, seed.expectAny)) {
            return `no valid alternative from [${seed.expectAny.slice(0, 5).join('|')}...]`;
          }
          return null;
        },
      }],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 3 — INSTRUCTION FIDELITY (strict shape directives)
// ---------------------------------------------------------------------------
interface InstrSeed {
  prompt: string;
  check: (a: string) => string | null;
}

function wordCount(s: string): number {
  return (s.trim().match(/\S+/g) || []).length;
}
function sentenceCount(s: string): number {
  return (s.trim().match(/[.!?]+(?:\s|$)/g) || []).length;
}

const INSTR_SEEDS: InstrSeed[] = [
  { prompt: 'capital of france — answer in exactly one word',
    check: (a) => {
      const w = wordCount(a.replace(/[*_`]/g, ''));
      if (w !== 1) return `expected 1 word, got ${w}`;
      if (!/paris/i.test(a)) return 'wrong answer';
      return null;
    } },
  { prompt: 'who painted the mona lisa — last name only',
    check: (a) => {
      const stripped = a.replace(/[*_`.]/g, '').trim();
      const w = wordCount(stripped);
      if (w > 2) return `expected ≤2 words, got ${w}`;
      if (!/vinci|leonardo/i.test(a)) return 'wrong answer';
      return null;
    } },
  { prompt: 'how many continents are there — number only',
    check: (a) => {
      const stripped = a.replace(/[*_`.]/g, '').trim();
      if (!/^7$/.test(stripped) && stripped !== '7') return `not bare number, got "${stripped.slice(0, 30)}"`;
      return null;
    } },
  { prompt: 'tell me about france in exactly two sentences',
    check: (a) => {
      const c = sentenceCount(a);
      if (c !== 2) return `expected 2 sentences, got ${c}`;
      if (!/france/i.test(a)) return 'missing topic';
      return null;
    } },
  { prompt: 'tell me about japan in one sentence',
    check: (a) => {
      const c = sentenceCount(a);
      if (c !== 1) return `expected 1 sentence, got ${c}`;
      if (!/japan/i.test(a)) return 'missing topic';
      return null;
    } },
  { prompt: 'capital of japan — lowercase only, one word',
    check: (a) => {
      const stripped = a.replace(/[*_`.]/g, '').trim();
      if (stripped !== stripped.toLowerCase()) return 'has uppercase';
      if (!/^tokyo$/.test(stripped)) return `not "tokyo", got "${stripped}"`;
      return null;
    } },
];

const INSTR_PARAPHRASES = [
  (s: string) => s,
  (s: string) => `please ${s}`,
  (s: string) => `${s}, thanks`,
];

function buildInstrCases(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = INSTR_SEEDS[i % INSTR_SEEDS.length];
    const para = pick(rand, INSTR_PARAPHRASES);
    out.push({
      id: `instr-${i}`,
      bundle: 'instrFidelity',
      turns: [{
        user: para(seed.prompt),
        check: (a) => {
          if (a.trim().length === 0) return 'empty';
          if (isFallback(a) || isClarify(a)) return 'engine bailed';
          return seed.check(a);
        },
      }],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 4 — MEANING LEAK (bare ambig, must commit cleanly)
// ---------------------------------------------------------------------------
interface MeaningLeakSeed {
  prompt: string;
  readings: Array<{ name: string; terms: string[] }>;
}

const MEANING_LEAK_SEEDS: MeaningLeakSeed[] = [
  { prompt: 'tell me about python', readings: [
      { name: 'language', terms: ['programming language', 'guido', 'rossum', '1991'] },
      { name: 'snake',    terms: ['reptile', 'constrictor', 'snake'] },
  ] },
  { prompt: 'what is mercury', readings: [
      { name: 'planet',  terms: ['planet', 'sun', 'closest', 'orbit'] },
      { name: 'element', terms: ['element', 'hg', 'liquid metal', 'quicksilver'] },
      { name: 'god',     terms: ['roman', 'god', 'messenger', 'hermes'] },
  ] },
  { prompt: 'tell me about apple', readings: [
      { name: 'company', terms: ['company', 'iphone', 'cupertino', 'jobs'] },
      { name: 'fruit',   terms: ['fruit', 'malus', 'orchard', 'tree'] },
  ] },
];

const MEANING_LEAK_PARAPHRASES = [
  (s: string) => s,
  (s: string) => `please ${s}`,
  (s: string) => `${s}.`,
];

function buildMeaningLeakCases(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = MEANING_LEAK_SEEDS[i % MEANING_LEAK_SEEDS.length];
    const para = pick(rand, MEANING_LEAK_PARAPHRASES);
    out.push({
      id: `meaningLeak-${i}`,
      bundle: 'meaningLeak',
      turns: [{
        user: para(seed.prompt),
        check: (a) => {
          if (a.trim().length === 0) return 'empty';
          // Clarify is fine — defer.
          if (isClarify(a)) return null;
          if (isFallback(a)) return null;
          const matched = seed.readings.filter(r => r.terms.some(t => lower(a).includes(lower(t))));
          if (matched.length === 0) {
            return `no reading committed (expected one of: ${seed.readings.map(r => r.name).join('|')})`;
          }
          if (matched.length >= 2) {
            return `meaning leak — mixed readings: ${matched.map(r => r.name).join('+')}`;
          }
          return null;
        },
      }],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 5 — CONTRADICTION (user changes mind; engine follows latest)
// ---------------------------------------------------------------------------
interface ContradictionSeed {
  turns: Array<{ user: string; expect?: string[]; forbid?: string[]; shapeCheck?: 'numbered' | 'bullet' | 'table' }>;
}

const CONTRADICTION_SEEDS: ContradictionSeed[] = [
  // disambig flip
  {
    turns: [
      { user: 'tell me about python the snake', expect: ['snake'], forbid: ['guido'] },
      { user: 'wait, I meant the programming language', expect: ['language', 'guido'], forbid: ['snake', 'reptile'] },
    ],
  },
  {
    turns: [
      { user: 'tell me about mercury the planet', expect: ['planet'], forbid: ['quicksilver', 'liquid metal'] },
      { user: 'actually, I meant the element', expect: ['element', 'hg'], forbid: ['planet', 'orbit'] },
    ],
  },
  // shape flip mid-conversation
  {
    turns: [
      { user: '5 facts about france as a numbered list', expect: ['france'], shapeCheck: 'numbered' },
      { user: 'actually do it as bullet points instead', expect: ['france'], shapeCheck: 'bullet' },
    ],
  },
  // topic correction
  {
    turns: [
      { user: 'what is the capital of france?', expect: ['paris'] },
      { user: 'sorry, I meant germany', expect: ['berlin'], forbid: ['paris'] },
    ],
  },
  // ceo correction
  {
    turns: [
      { user: 'who is the ceo of microsoft?', expect: ['nadella'] },
      { user: 'wait, I meant apple', expect: ['cook'], forbid: ['nadella'] },
    ],
  },
];

const CONTRADICTION_PARAPHRASES = [
  (t: string) => t,
  (t: string) => `please ${t}`,
];

function buildContradictionCases(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = CONTRADICTION_SEEDS[i % CONTRADICTION_SEEDS.length];
    const para = pick(rand, CONTRADICTION_PARAPHRASES);
    const turns: Turn[] = seed.turns.map((t, idx) => ({
      user: idx === 0 ? para(t.user) : t.user,
      check: (a) => {
        if (a.trim().length === 0) return `turn${idx + 1}: empty`;
        if (isFallback(a) || isClarify(a)) return `turn${idx + 1}: engine bailed`;
        if (t.expect) {
          const missing = t.expect.find(e => !lower(a).includes(lower(e)));
          if (missing) return `turn${idx + 1}: missing "${missing}"`;
        }
        if (t.forbid) {
          const hit = t.forbid.find(f => lower(a).includes(lower(f)));
          if (hit) return `turn${idx + 1}: forbidden "${hit}" present`;
        }
        if (t.shapeCheck === 'numbered') {
          const c = (a.match(/^\s*\d+[.)]\s+/gm) || []).length;
          if (c < 3) return `turn${idx + 1}: expected numbered list, got ${c}`;
        }
        if (t.shapeCheck === 'bullet') {
          const c = (a.match(/^\s*[-*]\s+/gm) || []).length;
          if (c < 3) return `turn${idx + 1}: expected bullet list, got ${c}`;
        }
        return null;
      },
    }));
    out.push({ id: `contradiction-${i}`, bundle: 'contradiction', turns });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
type ChatMessage = { role: 'user' | 'assistant'; content: string };

function parseArgs() {
  const args = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=');
      args.set(k, v ?? 'true');
    }
  }
  const n = parseInt(args.get('n') ?? '200', 10);
  const seed = parseInt(args.get('seed') ?? '42', 10);
  const bundle = (args.get('bundle') ?? 'all') as BundleId | 'all';
  const report = args.get('report');
  return { n, seed, bundle, report };
}

async function run() {
  const { n, seed, bundle, report } = parseArgs();
  const rand = mulberry32(seed);

  const cases: Case[] = [];
  if (bundle === 'all' || bundle === 'chain')         cases.push(...buildChainCases(rand, n));
  if (bundle === 'all' || bundle === 'negation')      cases.push(...buildNegationCases(rand, n));
  if (bundle === 'all' || bundle === 'instrFidelity') cases.push(...buildInstrCases(rand, n));
  if (bundle === 'all' || bundle === 'meaningLeak')   cases.push(...buildMeaningLeakCases(rand, n));
  if (bundle === 'all' || bundle === 'contradiction') cases.push(...buildContradictionCases(rand, n));

  const engine = new VaiEngine();
  (engine as unknown as { _nowMs: () => number })._nowMs = () => new Date('2026-05-15T10:00:00Z').getTime();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError('fetch disabled in ifm v3 bench'); }) as typeof fetch;

  const tally: Record<BundleId, { pass: number; fail: number }> = {
    chain:         { pass: 0, fail: 0 },
    negation:      { pass: 0, fail: 0 },
    instrFidelity: { pass: 0, fail: 0 },
    meaningLeak:   { pass: 0, fail: 0 },
    contradiction: { pass: 0, fail: 0 },
  };
  const failures: Array<{ id: string; bundle: BundleId; prompt: string; reason: string; preview: string }> = [];
  const t0 = performance.now();

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const history: ChatMessage[] = [];
    const answers: string[] = [];
    let caseReason: string | null = null;
    for (let ti = 0; ti < c.turns.length; ti++) {
      const turn = c.turns[ti];
      history.push({ role: 'user', content: turn.user });
      let answer = '';
      try {
        const r = await engine.chat({
          messages: history,
          temperature: 0,
          maxTokens: 320,
          noLearn: true,
        } as never);
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
  console.log('=== Intent / Format / Meaning bench — V3 (next-level) ===');
  console.log(`n_per_bundle=${n}  seed=${seed}  totalCases=${cases.length}  totalMs=${totalMs}`);
  for (const b of ['chain', 'negation', 'instrFidelity', 'meaningLeak', 'contradiction'] as const) {
    const t = tally[b];
    const sum = t.pass + t.fail;
    if (sum === 0) continue;
    const rate = ((t.pass / sum) * 100).toFixed(2);
    console.log(`  ${b.padEnd(14)} pass=${t.pass}/${sum}  (${rate}%)  fail=${t.fail}`);
  }
  const overallPass = Object.values(tally).reduce((a, b) => a + b.pass, 0);
  const overallSum  = Object.values(tally).reduce((a, b) => a + b.pass + b.fail, 0);
  console.log(`  ${'OVERALL'.padEnd(14)} pass=${overallPass}/${overallSum}  (${((overallPass/overallSum)*100).toFixed(2)}%)`);

  console.log('');
  if (failures.length > 0) {
    console.log(`First ${Math.min(15, failures.length)} failures:`);
    for (const f of failures.slice(0, 15)) {
      console.log(`  [${f.bundle}] ${f.prompt}`);
      console.log(`    reason: ${f.reason}`);
      console.log(`    answer: ${f.preview.slice(0, 180)}`);
    }
  }

  if (report) {
    writeFileSync(report, JSON.stringify({ n, seed, totalMs, tally, failures }, null, 2));
    console.log(`\nReport written to ${report}`);
  }
}

run().catch(err => { console.error(err); process.exit(1); });
