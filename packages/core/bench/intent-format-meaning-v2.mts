/**
 * Intent / Format / Meaning bench — v2 (harder bundles).
 *
 * v1 measured single-turn intent/format/meaning. v2 layers on three
 * harder failure modes the engine must handle:
 *
 *   1. FOLLOWUP   — 2-turn cases where turn 2 only makes sense given
 *                   turn 1's context ("and germany?", "as csv instead",
 *                   "what about its diet?"). The engine must carry topic
 *                   and shape across turns, not start fresh.
 *
 *   2. MIXED      — single-turn cases that stack 2+ constraints from the
 *                   v1 bundles ("5 facts about python the snake as a
 *                   numbered list" = meaning + format; "what year did the
 *                   soviet union dissolve — just the number" = intent +
 *                   canonical fact). The answer must honor every constraint.
 *
 *   3. AMBIGUOUS  — bare ambiguous topics with NO disambiguator
 *                   ("tell me about python", "what is mercury"). The
 *                   engine must commit to one reading and not mix two
 *                   readings into a single answer (no "python is a snake
 *                   and also a programming language" hedges).
 *
 * Usage:
 *   pnpm exec tsx bench/intent-format-meaning-v2.mts --n=300 --seed=42
 *   pnpm exec tsx bench/intent-format-meaning-v2.mts --bundle=followup
 *   pnpm exec tsx bench/intent-format-meaning-v2.mts --report=../../_ifm_v2_r1.json
 */

import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { VaiEngine } from '../src/models/vai-engine.js';

type Verdict = 'PASS' | 'FAIL';
type BundleId = 'followup' | 'mixed' | 'ambiguous';

interface Turn {
  user: string;
  /** Optional check on this turn's response. */
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
function hasAny(a: string, terms: string[]): boolean {
  const lower = a.toLowerCase();
  return terms.some(t => lower.includes(t.toLowerCase()));
}

// ---------------------------------------------------------------------------
// BUNDLE 1 — FOLLOWUP (multi-turn context retention)
// ---------------------------------------------------------------------------
interface FollowupSeed {
  turns: Array<{ user: string; expect?: string[]; forbid?: string[] }>;
}

const FOLLOWUP_SEEDS: FollowupSeed[] = [
  {
    turns: [
      { user: 'what is the capital of france?', expect: ['paris'] },
      { user: 'and germany?',                   expect: ['berlin'], forbid: ['france', 'paris'] },
    ],
  },
  {
    turns: [
      { user: 'what is the capital of japan?',  expect: ['tokyo'] },
      { user: 'and norway?',                    expect: ['oslo'], forbid: ['japan', 'tokyo'] },
    ],
  },
  {
    turns: [
      { user: 'tell me about python the programming language', expect: ['language', 'guido'], forbid: ['snake', 'reptile'] },
      { user: 'who created it?',                               expect: ['guido', 'rossum'],   forbid: ['snake', 'reptile'] },
    ],
  },
  {
    turns: [
      { user: 'tell me about python the snake',                expect: ['snake', 'reptile'], forbid: ['guido', 'rossum'] },
      { user: 'what does it eat?',                             expect: ['rodent', 'mammal', 'bird', 'prey', 'eats'], forbid: ['programming language'] },
    ],
  },
  {
    turns: [
      { user: 'list 5 facts about france as a numbered list',  expect: ['france', 'paris'] },
      { user: 'now do the same for japan',                     expect: ['japan', 'tokyo'], forbid: ['france', 'paris'] },
    ],
  },
  {
    turns: [
      { user: 'compare http and https as a markdown table',    expect: ['http', 'https', '|'] },
      { user: 'now compare typescript and javascript the same way', expect: ['typescript', 'javascript', '|'], forbid: ['http', 'https'] },
    ],
  },
  {
    turns: [
      { user: 'who is the ceo of microsoft?',                  expect: ['nadella'] },
      { user: 'and apple?',                                    expect: ['cook'], forbid: ['microsoft', 'nadella'] },
    ],
  },
  {
    turns: [
      { user: 'who is the ceo of google?',                     expect: ['pichai'] },
      { user: 'what about nvidia?',                            expect: ['huang'], forbid: ['google', 'pichai'] },
    ],
  },
];

const FOLLOWUP_PARAPHRASES = [
  (t: string) => t,
  (t: string) => `please ${t}`,
  (t: string) => t.replace(/\?$/, ''),
];

function buildFollowupCases(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = FOLLOWUP_SEEDS[i % FOLLOWUP_SEEDS.length];
    const para = pick(rand, FOLLOWUP_PARAPHRASES);
    const turns: Turn[] = seed.turns.map((t, idx) => ({
      user: idx === 0 ? para(t.user) : t.user,
      check: (a, _all) => {
        if (a.trim().length === 0) return `turn${idx + 1}: empty`;
        if (isFallback(a) || isClarify(a)) return `turn${idx + 1}: engine bailed`;
        if (t.expect && !t.expect.some(e => a.toLowerCase().includes(e.toLowerCase()))) {
          return `turn${idx + 1}: missing one of [${t.expect.join('|')}]`;
        }
        if (t.forbid && t.forbid.some(f => a.toLowerCase().includes(f.toLowerCase()))) {
          const hit = t.forbid.find(f => a.toLowerCase().includes(f.toLowerCase()));
          return `turn${idx + 1}: forbidden token "${hit}" present`;
        }
        return null;
      },
    }));
    out.push({ id: `followup-${i}`, bundle: 'followup', turns });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 2 — MIXED (stacked constraints)
// ---------------------------------------------------------------------------
interface MixedSeed {
  prompt: string;
  expect: string[];
  forbid?: string[];
  /** Shape check key. */
  shape?: 'numbered' | 'bullet' | 'table' | 'json' | 'one-sentence' | 'atom-number' | 'atom-word';
  count?: number;
  maxChars?: number;
}

const MIXED_SEEDS: MixedSeed[] = [
  // meaning + format
  { prompt: '5 facts about python the snake as a numbered list', expect: ['snake', 'reptile', 'python'], forbid: ['guido', 'rossum', 'programming language'], shape: 'numbered', count: 5 },
  { prompt: '4 facts about python the programming language as a numbered list', expect: ['programming', 'python'], forbid: ['snake', 'reptile'], shape: 'numbered', count: 4 },
  { prompt: '3 bullet points about mercury the planet', expect: ['planet', 'mercury'], forbid: ['element', 'liquid metal', 'roman god'], shape: 'bullet', count: 3 },
  { prompt: '3 bullet points about mercury the element', expect: ['element', 'mercury'], forbid: ['planet', 'roman god'], shape: 'bullet', count: 3 },
  // canonical + intent
  { prompt: 'what year did the soviet union dissolve — just the number', expect: ['1991'], shape: 'atom-number', maxChars: 12 },
  { prompt: 'how many continents are there — number only', expect: ['7'], shape: 'atom-number', maxChars: 8 },
  { prompt: 'who painted the mona lisa — only the name', expect: ['da vinci', 'leonardo'], shape: 'atom-word', maxChars: 60 },
  { prompt: 'capital of japan — one word', expect: ['tokyo'], forbid: ['japan'], shape: 'atom-word', maxChars: 20 },
  // canonical + brevity
  { prompt: 'tell me about france in one sentence', expect: ['france'], shape: 'one-sentence', maxChars: 320 },
  { prompt: 'tell me about react in one sentence', expect: ['react'], shape: 'one-sentence', maxChars: 320 },
  // meaning + table (harder — comparison across disambiguations)
  { prompt: 'compare http and https as a markdown table', expect: ['http', 'https'], shape: 'table' },
  { prompt: 'compare typescript and javascript as a markdown table', expect: ['typescript', 'javascript'], shape: 'table' },
  // JSON over canonical
  { prompt: 'return the capital of france as JSON with keys country and capital', expect: ['france', 'paris'], shape: 'json' },
  { prompt: 'give me information about norway as a json object with keys name, capital, continent', expect: ['norway', 'oslo'], shape: 'json' },
];

const MIXED_PARAPHRASES = [
  (s: string) => s,
  (s: string) => `please ${s}`,
  (s: string) => `${s}, thanks`,
  (s: string) => `${s} (exact shape only)`,
];

function checkMixed(raw: string, seed: MixedSeed): string | null {
  if (raw.trim().length === 0) return 'empty';
  if (isFallback(raw) || isClarify(raw)) return 'engine bailed';
  const lower = raw.toLowerCase();
  if (!seed.expect.some(e => lower.includes(e.toLowerCase()))) {
    return `missing expected [${seed.expect.join('|')}]`;
  }
  if (seed.forbid && seed.forbid.some(f => lower.includes(f.toLowerCase()))) {
    const hit = seed.forbid.find(f => lower.includes(f.toLowerCase()));
    return `forbidden token "${hit}" present (meaning leak)`;
  }
  switch (seed.shape) {
    case 'numbered': {
      const c = (raw.match(/^\s*\d+[.)]\s+/gm) || []).length;
      if (c < (seed.count ?? 3)) return `expected ${seed.count} numbered items, got ${c}`;
      break;
    }
    case 'bullet': {
      const bullets = (raw.match(/^\s*[-*•]\s+/gm) || []).length;
      const numbered = (raw.match(/^\s*\d+[.)]\s+/gm) || []).length;
      if (bullets + numbered < (seed.count ?? 3)) return `expected ${seed.count} bullets, got ${bullets + numbered}`;
      break;
    }
    case 'table': {
      if (!/\|[^\n]+\|/.test(raw)) return 'no pipe rows';
      if (!/\|[\s:|-]*-{3,}[\s:|-]*\|/.test(raw)) return 'no md table separator';
      break;
    }
    case 'json': {
      let body: string | null = null;
      const fenced = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
      if (fenced) body = fenced[1];
      else {
        const brace = raw.match(/\{[\s\S]+\}/);
        if (brace) body = brace[0];
      }
      if (!body) return 'no JSON body';
      try { JSON.parse(body); } catch (e) { return `invalid JSON: ${(e as Error).message.slice(0, 50)}`; }
      break;
    }
    case 'one-sentence': {
      const stripped = raw.replace(/\*\*/g, '').replace(/^[#>*_\-]+\s*/gm, '').trim();
      const sentences = stripped.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 8);
      if (sentences.length > 2) return `expected one sentence, got ${sentences.length}`;
      if (stripped.length > (seed.maxChars ?? 320)) return `too long (${stripped.length} > ${seed.maxChars})`;
      break;
    }
    case 'atom-number': {
      const stripped = raw.replace(/\*\*/g, '').trim();
      if (stripped.length > (seed.maxChars ?? 12)) return `too long (${stripped.length} > ${seed.maxChars})`;
      if (!/\d/.test(stripped)) return 'no digits';
      break;
    }
    case 'atom-word': {
      const stripped = raw.replace(/\*\*/g, '').trim();
      if (stripped.length > (seed.maxChars ?? 60)) return `too long (${stripped.length} > ${seed.maxChars})`;
      break;
    }
  }
  return null;
}

function buildMixedCases(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = MIXED_SEEDS[i % MIXED_SEEDS.length];
    const para = pick(rand, MIXED_PARAPHRASES);
    out.push({
      id: `mixed-${i}`,
      bundle: 'mixed',
      turns: [{ user: para(seed.prompt), check: (a) => checkMixed(a, seed) }],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 3 — AMBIGUOUS (no disambiguator, must commit cleanly)
// ---------------------------------------------------------------------------
interface AmbiguousSeed {
  prompt: string;
  /** Each entry is one valid reading: any term means we picked THAT reading. */
  readings: Array<{ name: string; terms: string[] }>;
}

const AMBIGUOUS_SEEDS: AmbiguousSeed[] = [
  { prompt: 'tell me about python', readings: [
      { name: 'language', terms: ['programming language', 'guido', 'rossum', 'interpreter'] },
      { name: 'snake',    terms: ['snake', 'reptile', 'constrictor', 'serpent'] },
  ]},
  { prompt: 'what is mercury', readings: [
      { name: 'planet',  terms: ['planet', 'closest to the sun', 'solar system'] },
      { name: 'element', terms: ['element', 'liquid metal', 'periodic table', 'hg'] },
      { name: 'god',     terms: ['messenger god', 'roman god', 'mythology'] },
  ]},
  { prompt: 'tell me about java', readings: [
      { name: 'language', terms: ['programming language', 'jvm', 'sun microsystems'] },
      { name: 'island',   terms: ['island', 'indonesia', 'jakarta'] },
  ]},
  { prompt: 'what is apple', readings: [
      { name: 'company', terms: ['company', 'cupertino', 'iphone', 'steve jobs'] },
      { name: 'fruit',   terms: ['fruit', 'tree fruit', 'orchard', 'malus'] },
  ]},
  { prompt: 'tell me about turkey', readings: [
      { name: 'country', terms: ['country', 'ankara', 'istanbul', 'anatolia'] },
      { name: 'bird',    terms: ['bird', 'fowl', 'thanksgiving', 'galliformes'] },
  ]},
  { prompt: 'tell me about amazon', readings: [
      { name: 'company', terms: ['e-commerce', 'bezos', 'aws'] },
      { name: 'river',   terms: ['river', 'south america', 'rainforest', 'brazil'] },
  ]},
];

const AMBIGUOUS_PARAPHRASES = [
  (s: string) => s,
  (s: string) => `please ${s}`,
  (s: string) => `${s}.`,
  (s: string) => `quick — ${s}`,
];

function buildAmbiguousCases(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = AMBIGUOUS_SEEDS[i % AMBIGUOUS_SEEDS.length];
    const para = pick(rand, AMBIGUOUS_PARAPHRASES);
    out.push({
      id: `ambiguous-${i}`,
      bundle: 'ambiguous',
      turns: [{
        user: para(seed.prompt),
        check: (a) => {
          if (a.trim().length === 0) return 'empty';
          // Clarify is an ACCEPTABLE outcome here — engine asking
          // "which reading do you mean?" is the safe move.
          if (isClarify(a)) return null;
          // Honest fallback is also acceptable (engine refuses gracefully).
          if (isFallback(a)) return null;
          const lower = a.toLowerCase();
          const matched = seed.readings.filter(r => r.terms.some(t => lower.includes(t.toLowerCase())));
          if (matched.length === 0) {
            return `committed to no reading (expected one of: ${seed.readings.map(r => r.name).join('|')})`;
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
// Runner — multi-turn aware
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
  const n = parseInt(args.get('n') ?? '300', 10);
  const seed = parseInt(args.get('seed') ?? '42', 10);
  const bundle = (args.get('bundle') ?? 'all') as BundleId | 'all';
  const report = args.get('report');
  return { n, seed, bundle, report };
}

async function run() {
  const { n, seed, bundle, report } = parseArgs();
  const rand = mulberry32(seed);

  const cases: Case[] = [];
  if (bundle === 'all' || bundle === 'followup')  cases.push(...buildFollowupCases(rand, n));
  if (bundle === 'all' || bundle === 'mixed')     cases.push(...buildMixedCases(rand, n));
  if (bundle === 'all' || bundle === 'ambiguous') cases.push(...buildAmbiguousCases(rand, n));

  const engine = new VaiEngine();
  (engine as unknown as { _nowMs: () => number })._nowMs = () => new Date('2026-05-15T10:00:00Z').getTime();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError('fetch disabled in ifm v2 bench'); }) as typeof fetch;

  const tally: Record<BundleId, { pass: number; fail: number }> = {
    followup:  { pass: 0, fail: 0 },
    mixed:     { pass: 0, fail: 0 },
    ambiguous: { pass: 0, fail: 0 },
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
          preview: answers.join(' >> ').slice(0, 240).replace(/\s+/g, ' '),
        });
      }
    }
    if ((i + 1) % 100 === 0) {
      const total = tally.followup.pass + tally.mixed.pass + tally.ambiguous.pass
                  + tally.followup.fail + tally.mixed.fail + tally.ambiguous.fail;
      const passes = tally.followup.pass + tally.mixed.pass + tally.ambiguous.pass;
      process.stdout.write(`  [${i + 1}/${cases.length}] PASS=${passes}/${total}\n`);
    }
  }

  const totalMs = Math.round(performance.now() - t0);
  globalThis.fetch = originalFetch;

  console.log('');
  console.log('=== Intent / Format / Meaning bench — V2 (harder) ===');
  console.log(`n_per_bundle=${n}  seed=${seed}  totalCases=${cases.length}  totalMs=${totalMs}`);
  for (const b of ['followup', 'mixed', 'ambiguous'] as const) {
    const t = tally[b];
    const sum = t.pass + t.fail;
    if (sum === 0) continue;
    const rate = ((t.pass / sum) * 100).toFixed(2);
    console.log(`  ${b.padEnd(9)} pass=${t.pass}/${sum}  (${rate}%)  fail=${t.fail}`);
  }
  const overallPass = tally.followup.pass + tally.mixed.pass + tally.ambiguous.pass;
  const overallSum  = overallPass + tally.followup.fail + tally.mixed.fail + tally.ambiguous.fail;
  console.log(`  ${'OVERALL'.padEnd(9)} pass=${overallPass}/${overallSum}  (${((overallPass/overallSum)*100).toFixed(2)}%)`);

  console.log('');
  if (failures.length > 0) {
    console.log(`First ${Math.min(15, failures.length)} failures:`);
    for (const f of failures.slice(0, 15)) {
      console.log(`  [${f.bundle}] ${f.prompt}`);
      console.log(`    reason: ${f.reason}`);
      console.log(`    answer: ${f.preview.slice(0, 160)}`);
    }
  }

  if (report) {
    writeFileSync(report, JSON.stringify({ n, seed, totalMs, tally, failures }, null, 2));
    console.log(`\nReport written to ${report}`);
  }
}

run().catch(err => { console.error(err); process.exit(1); });
