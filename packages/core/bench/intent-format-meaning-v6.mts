/**
 * Intent / Format / Meaning bench — v6 (constraint stacking + chain stress).
 *
 * v6 bundles target harder adversarial cases on top of v5:
 *   1. quadConstraint    — 4 stacked constraints in one turn
 *                          (count + format + exclusion + lowercase).
 *   2. multiExcludeChain — 5-turn pick chain with growing exclusion set.
 *   3. noisyChain        — chain with conversational noise between substantive
 *                          turns ("ok cool", "got it", "interesting").
 *   4. flipFormatMidChain — chain whose final turn flips the requested shape
 *                          ("actually do that as bullet points instead").
 *   5. denseCoreference  — multi-hop pronoun / "its" / "that one" references.
 */

import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { VaiEngine } from '../src/models/vai-engine.js';

type Verdict = 'PASS' | 'FAIL';
type BundleId = 'quadConstraint' | 'multiExcludeChain' | 'noisyChain' | 'flipFormatMidChain' | 'denseCoreference';

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

const HONEST_FALLBACK = /^I (?:don'?t (?:have|know)|can'?t|cannot|haven'?t|am not)\b/i;
const CLARIFY = /could you say a bit more|what (?:specifically|exactly) do you mean|which (?:one|sense|meaning)/i;
function isFallback(a: string): boolean { return HONEST_FALLBACK.test(a.trim()); }
function isClarify(a: string): boolean { return CLARIFY.test(a); }
function lower(s: string): string { return s.toLowerCase(); }
function hasAny(a: string, terms: string[]): boolean { const l = lower(a); return terms.some(t => l.includes(lower(t))); }
function bulletCount(s: string): number { return (s.match(/^\s*[-*]\s+/gm) || []).length; }
function numberedCount(s: string): number { return (s.match(/^\s*\d+[.)]\s+/gm) || []).length; }
function hasUpper(s: string): boolean {
  // Strip markdown fences, code, links, urls.
  const stripped = s.replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '').replace(/https?:\/\/\S+/g, '');
  return /[A-Z]/.test(stripped);
}

// ---------------------------------------------------------------------------
// BUNDLE 1 — QUAD CONSTRAINT (count + format + exclusion + lowercase)
// ---------------------------------------------------------------------------
interface QcSeed { prompt: string; minBullets?: number; minNumbered?: number; forbid: string[]; expectAny: string[]; }
const QC_SEEDS: QcSeed[] = [
  { prompt: 'list 3 european capitals as bullet points, lowercase only, excluding paris and rome',
    minBullets: 3, forbid: ['paris', 'rome'],
    expectAny: ['berlin', 'madrid', 'lisbon', 'oslo', 'vienna', 'warsaw', 'stockholm', 'amsterdam', 'brussels', 'athens', 'dublin'] },
  { prompt: 'name 4 planets as a numbered list, all lowercase, but not earth or mars',
    minNumbered: 4, forbid: ['earth', 'mars'],
    expectAny: ['mercury', 'venus', 'jupiter', 'saturn', 'uranus', 'neptune'] },
  { prompt: 'list 3 programming languages as bullet points, in lowercase, other than python and javascript',
    minBullets: 3, forbid: ['python', 'javascript'],
    expectAny: ['typescript', 'java', 'rust', 'go', 'ruby', 'kotlin', 'swift', 'c++', 'c#'] },
  { prompt: 'give me 3 asian countries as a numbered list, lowercase only, excluding japan and china',
    minNumbered: 3, forbid: ['japan', 'china'],
    expectAny: ['thailand', 'vietnam', 'india', 'indonesia', 'philippines', 'malaysia', 'singapore', 'pakistan', 'bangladesh', 'mongolia', 'south korea'] },
];
function buildQuad(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = QC_SEEDS[i % QC_SEEDS.length];
    out.push({
      id: `qc-${i}`, bundle: 'quadConstraint',
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
          if (hasUpper(a)) return 'has uppercase';
          return null;
        },
      }],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 2 — MULTI-EXCLUDE CHAIN (5 turns, growing exclusion)
// ---------------------------------------------------------------------------
interface MecSeed { turns: Array<{ user: string; expectAny: string[]; forbid?: string[] }>; }
const MEC_SEEDS: MecSeed[] = [
  {
    turns: [
      { user: 'name a planet', expectAny: ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'] },
      { user: 'one that is not earth', expectAny: ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'], forbid: ['earth'] },
      { user: 'one that is not earth or mars', expectAny: ['mercury', 'venus', 'jupiter', 'saturn', 'uranus', 'neptune'], forbid: ['earth', 'mars'] },
      { user: 'one that is not earth, mars, or jupiter', expectAny: ['mercury', 'venus', 'saturn', 'uranus', 'neptune'], forbid: ['earth', 'mars', 'jupiter'] },
      { user: 'one that is not earth, mars, jupiter, or saturn', expectAny: ['mercury', 'venus', 'uranus', 'neptune'], forbid: ['earth', 'mars', 'jupiter', 'saturn'] },
    ],
  },
  {
    turns: [
      { user: 'name a european capital', expectAny: ['paris', 'berlin', 'rome', 'madrid', 'lisbon', 'oslo', 'vienna', 'warsaw', 'stockholm', 'amsterdam', 'brussels', 'athens', 'dublin'] },
      { user: 'one that is not paris', expectAny: ['berlin', 'rome', 'madrid', 'lisbon', 'oslo', 'vienna'], forbid: ['paris'] },
      { user: 'one that is not paris or berlin', expectAny: ['rome', 'madrid', 'lisbon', 'oslo', 'vienna'], forbid: ['paris', 'berlin'] },
      { user: 'one that is not paris, berlin, or rome', expectAny: ['madrid', 'lisbon', 'oslo', 'vienna'], forbid: ['paris', 'berlin', 'rome'] },
      { user: 'one that is not paris, berlin, rome, or madrid', expectAny: ['lisbon', 'oslo', 'vienna', 'warsaw'], forbid: ['paris', 'berlin', 'rome', 'madrid'] },
    ],
  },
  {
    turns: [
      { user: 'name a programming language', expectAny: ['python', 'javascript', 'typescript', 'java', 'rust', 'go', 'ruby', 'kotlin', 'swift', 'c++'] },
      { user: 'one that is not python', expectAny: ['javascript', 'typescript', 'java', 'rust', 'go', 'ruby', 'kotlin', 'swift', 'c++'], forbid: ['python'] },
      { user: 'one that is not python or javascript', expectAny: ['typescript', 'java', 'rust', 'go', 'ruby', 'kotlin', 'swift', 'c++'], forbid: ['python', 'javascript'] },
      { user: 'one that is not python, javascript, or typescript', expectAny: ['java', 'rust', 'go', 'ruby', 'kotlin', 'swift', 'c++'], forbid: ['python', 'javascript', 'typescript'] },
      { user: 'one that is not python, javascript, typescript, or java', expectAny: ['rust', 'go', 'ruby', 'kotlin', 'swift', 'c++'], forbid: ['python', 'javascript', 'typescript', 'java'] },
    ],
  },
];
function buildMec(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = MEC_SEEDS[i % MEC_SEEDS.length];
    const turns: Turn[] = seed.turns.map((t, idx) => ({
      user: t.user,
      check: (a) => {
        if (a.trim().length === 0) return `turn${idx + 1}: empty`;
        if (isFallback(a) || isClarify(a)) return `turn${idx + 1}: bailed`;
        if (!hasAny(a, t.expectAny)) return `turn${idx + 1}: no valid item`;
        if (t.forbid) {
          const hit = t.forbid.find(f => lower(a).includes(lower(f)));
          if (hit) return `turn${idx + 1}: forbidden "${hit}"`;
        }
        return null;
      },
    }));
    out.push({ id: `mec-${i}`, bundle: 'multiExcludeChain', turns });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 3 — NOISY CHAIN (filler turns between substantive ones)
// ---------------------------------------------------------------------------
interface NcSeed { turns: Array<{ user: string; expect?: string[]; forbid?: string[]; check?: 'noise' | 'capital' | 'pick' }>; }
const NC_SEEDS: NcSeed[] = [
  {
    turns: [
      { user: 'what is the capital of france?', expect: ['paris'], check: 'capital' },
      { user: 'cool', check: 'noise' },
      { user: 'and germany?', expect: ['berlin'], forbid: ['paris'], check: 'capital' },
      { user: 'interesting', check: 'noise' },
      { user: 'and italy?', expect: ['rome'], forbid: ['berlin'], check: 'capital' },
      { user: 'got it', check: 'noise' },
      { user: 'and spain?', expect: ['madrid'], forbid: ['rome'], check: 'capital' },
    ],
  },
  {
    turns: [
      { user: 'name a planet', expect: ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'], check: 'pick' },
      { user: 'nice', check: 'noise' },
      { user: 'another one', expect: ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'], check: 'pick' },
      { user: 'okay', check: 'noise' },
      { user: 'one that is not earth or mars', expect: ['mercury', 'venus', 'jupiter', 'saturn', 'uranus', 'neptune'], forbid: ['earth', 'mars'], check: 'pick' },
    ],
  },
];
function buildNoisy(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = NC_SEEDS[i % NC_SEEDS.length];
    const turns: Turn[] = seed.turns.map((t, idx) => ({
      user: t.user,
      check: (a) => {
        if (t.check === 'noise') return null; // noise turns: no assertion
        if (a.trim().length === 0) return `turn${idx + 1}: empty`;
        if (isFallback(a) || isClarify(a)) return `turn${idx + 1}: bailed`;
        if (t.expect && !hasAny(a, t.expect)) return `turn${idx + 1}: no valid`;
        if (t.forbid) {
          const hit = t.forbid.find(f => lower(a).includes(lower(f)));
          if (hit) return `turn${idx + 1}: forbidden "${hit}"`;
        }
        return null;
      },
    }));
    out.push({ id: `nc-${i}`, bundle: 'noisyChain', turns });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 4 — FLIP FORMAT MID CHAIN
// ---------------------------------------------------------------------------
interface FfSeed { turns: Array<{ user: string; assert?: 'numbered3' | 'bullets3' | 'table' | 'numbered5' }>; }
const FF_SEEDS: FfSeed[] = [
  { turns: [
    { user: '5 facts about france as a numbered list', assert: 'numbered5' },
    { user: 'actually do it as bullet points instead', assert: 'bullets3' },
  ]},
  { turns: [
    { user: '5 facts about japan as bullet points', assert: 'bullets3' },
    { user: 'actually do it as a numbered list instead', assert: 'numbered5' },
  ]},
  { turns: [
    { user: '5 facts about germany as a numbered list', assert: 'numbered5' },
    { user: 'actually do that as a markdown table instead', assert: 'table' },
  ]},
];
function buildFlip(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = FF_SEEDS[i % FF_SEEDS.length];
    const turns: Turn[] = seed.turns.map((t, idx) => ({
      user: t.user,
      check: (a) => {
        if (a.trim().length === 0) return `turn${idx + 1}: empty`;
        if (isFallback(a) || isClarify(a)) return `turn${idx + 1}: bailed`;
        if (t.assert === 'numbered5' && numberedCount(a) < 5) return `turn${idx + 1}: expected 5 numbered, got ${numberedCount(a)}`;
        if (t.assert === 'numbered3' && numberedCount(a) < 3) return `turn${idx + 1}: expected 3 numbered, got ${numberedCount(a)}`;
        if (t.assert === 'bullets3' && bulletCount(a) < 3) return `turn${idx + 1}: expected 3 bullets, got ${bulletCount(a)}`;
        if (t.assert === 'table' && !/\|.+\|/.test(a)) return `turn${idx + 1}: expected table`;
        return null;
      },
    }));
    out.push({ id: `ff-${i}`, bundle: 'flipFormatMidChain', turns });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 5 — DENSE COREFERENCE (multi-hop pronouns)
// ---------------------------------------------------------------------------
interface DcSeed { turns: Array<{ user: string; expect: string[]; forbid?: string[] }>; }
const DC_SEEDS: DcSeed[] = [
  {
    turns: [
      { user: 'what is the capital of france?', expect: ['paris'] },
      { user: 'who is its current president?', expect: ['macron'] },
      { user: 'what is his nationality?', expect: ['french', 'france'] },
    ],
  },
  {
    turns: [
      { user: 'tell me about python the snake', expect: ['reptile', 'constrictor', 'snake'] },
      { user: 'what does it eat?', expect: ['mammal', 'rodent', 'bird', 'prey', 'rat', 'small'] },
      { user: 'how does it kill its prey?', expect: ['constrict', 'squeez', 'wraps', 'suffocat'] },
    ],
  },
  {
    turns: [
      { user: 'who is the ceo of apple?', expect: ['cook'] },
      { user: 'when did he become ceo?', expect: ['2011'] },
      { user: 'who was his predecessor?', expect: ['jobs'] },
    ],
  },
];
function buildDense(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = DC_SEEDS[i % DC_SEEDS.length];
    const turns: Turn[] = seed.turns.map((t, idx) => ({
      user: t.user,
      check: (a) => {
        if (a.trim().length === 0) return `turn${idx + 1}: empty`;
        if (isFallback(a) || isClarify(a)) return `turn${idx + 1}: bailed`;
        if (!hasAny(a, t.expect)) return `turn${idx + 1}: missing ${t.expect.join('|')}`;
        if (t.forbid) {
          const hit = t.forbid.find(f => lower(a).includes(lower(f)));
          if (hit) return `turn${idx + 1}: forbidden "${hit}"`;
        }
        return null;
      },
    }));
    out.push({ id: `dc-${i}`, bundle: 'denseCoreference', turns });
  }
  return out;
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  const arg = (k: string, dflt: string) => {
    const m = process.argv.find(a => a.startsWith(`--${k}=`));
    return m ? m.slice(`--${k}=`.length) : dflt;
  };
  const n = parseInt(arg('n', '200'), 10);
  const seed = parseInt(arg('seed', '42'), 10);
  const reportPath = arg('report', '');
  const onlyBundle = arg('bundle', '') as BundleId | '';

  const rand = mulberry32(seed);
  let cases: Case[] = [
    ...buildQuad(rand, n),
    ...buildMec(rand, n),
    ...buildNoisy(rand, n),
    ...buildFlip(rand, n),
    ...buildDense(rand, n),
  ];
  if (onlyBundle) cases = cases.filter(c => c.bundle === onlyBundle);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError('fetch disabled'); }) as typeof fetch;

  const tally: Record<BundleId, { pass: number; fail: number }> = {
    quadConstraint: { pass: 0, fail: 0 },
    multiExcludeChain: { pass: 0, fail: 0 },
    noisyChain: { pass: 0, fail: 0 },
    flipFormatMidChain: { pass: 0, fail: 0 },
    denseCoreference: { pass: 0, fail: 0 },
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
  console.log('=== Intent / Format / Meaning bench — V6 (constraint stacking + chain stress) ===');
  console.log(`n_per_bundle=${n}  seed=${seed}  totalCases=${cases.length}  totalMs=${totalMs}`);
  let pAll = 0, tAll = 0;
  for (const b of ['quadConstraint', 'multiExcludeChain', 'noisyChain', 'flipFormatMidChain', 'denseCoreference'] as const) {
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
