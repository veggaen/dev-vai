/**
 * Intent / Format / Meaning bench — v7 (deeper chains + revisions + interleaving).
 *
 * v7 bundles raise the ceiling above v6:
 *   1. deepChainTen      — 10-turn chains alternating picks, exclusions, and
 *                          format flips, all in one conversation.
 *   2. doubleNegFormat   — single-turn requests that combine count + format +
 *                          two stacked exclusions + lowercase.
 *   3. disambigCascade   — ambiguous topic, user disambiguates, then 3 further
 *                          follow-ups must stay locked to that sense.
 *   4. interleavedTopics — alternates between two unrelated topics; "and X?"
 *                          must inherit the prior verb (e.g., capital).
 *   5. constraintRevise  — turn 1 sets a count, turn 2 revises it
 *                          ("actually make it 7 instead").
 */

import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { VaiEngine } from '../src/models/vai-engine.js';

type Verdict = 'PASS' | 'FAIL';
type BundleId =
  | 'deepChainTen'
  | 'doubleNegFormat'
  | 'disambigCascade'
  | 'interleavedTopics'
  | 'constraintRevise';

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
function hasUpper(s: string): boolean {
  const stripped = s.replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '').replace(/https?:\/\/\S+/g, '');
  return /[A-Z]/.test(stripped);
}

// ---------------------------------------------------------------------------
// BUNDLE 1 — DEEP CHAIN TEN (10-turn mixed chain)
// ---------------------------------------------------------------------------
interface DcSeed { turns: Array<{ user: string; expect?: string[]; forbid?: string[]; assert?: 'numbered3' | 'bullets3' | 'lower'; noise?: boolean }>; }
const DC_SEEDS: DcSeed[] = [
  {
    turns: [
      { user: 'name a planet', expect: ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'] },
      { user: 'another one', expect: ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'] },
      { user: 'one that is not earth', expect: ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'], forbid: ['earth'] },
      { user: 'one that is not earth or mars', expect: ['mercury', 'venus', 'jupiter', 'saturn', 'uranus', 'neptune'], forbid: ['earth', 'mars'] },
      { user: 'cool', noise: true },
      { user: 'list 3 of them as bullet points', assert: 'bullets3', expect: ['mercury', 'venus', 'jupiter', 'saturn'] },
      { user: 'actually do it as a numbered list instead', assert: 'numbered3', expect: ['mercury', 'venus', 'jupiter', 'saturn'] },
      { user: 'lowercase only', assert: 'lower' },
      { user: 'one more, not jupiter', expect: ['mercury', 'venus', 'saturn', 'uranus', 'neptune'], forbid: ['jupiter'] },
      { user: 'one more, not jupiter or saturn', expect: ['mercury', 'venus', 'uranus', 'neptune'], forbid: ['jupiter', 'saturn'] },
    ],
  },
  {
    turns: [
      { user: 'name a european capital', expect: ['paris', 'berlin', 'rome', 'madrid', 'lisbon', 'oslo', 'vienna'] },
      { user: 'another one', expect: ['paris', 'berlin', 'rome', 'madrid', 'lisbon', 'oslo', 'vienna'] },
      { user: 'one that is not paris', expect: ['berlin', 'rome', 'madrid', 'lisbon'], forbid: ['paris'] },
      { user: 'got it', noise: true },
      { user: 'one that is not paris or berlin', expect: ['rome', 'madrid', 'lisbon', 'oslo'], forbid: ['paris', 'berlin'] },
      { user: 'list 3 of them as bullet points', assert: 'bullets3', expect: ['madrid', 'lisbon', 'oslo', 'vienna', 'warsaw'] },
      { user: 'actually do it as a numbered list instead', assert: 'numbered3', expect: ['madrid', 'lisbon', 'oslo', 'vienna', 'warsaw'] },
      { user: 'lowercase only', assert: 'lower' },
      { user: 'one more, not rome', expect: ['madrid', 'lisbon', 'oslo', 'vienna'], forbid: ['rome'] },
      { user: 'one more, not rome or madrid', expect: ['lisbon', 'oslo', 'vienna', 'warsaw'], forbid: ['rome', 'madrid'] },
    ],
  },
  {
    turns: [
      { user: 'name a programming language', expect: ['python', 'javascript', 'typescript', 'java', 'rust', 'go', 'ruby'] },
      { user: 'another one', expect: ['python', 'javascript', 'typescript', 'java', 'rust', 'go', 'ruby'] },
      { user: 'one that is not python', expect: ['javascript', 'typescript', 'java', 'rust', 'go', 'ruby'], forbid: ['python'] },
      { user: 'one that is not python or javascript', expect: ['typescript', 'java', 'rust', 'go', 'ruby'], forbid: ['python', 'javascript'] },
      { user: 'interesting', noise: true },
      { user: 'list 3 of them as bullet points', assert: 'bullets3', expect: ['typescript', 'java', 'rust', 'go', 'ruby'] },
      { user: 'actually do it as a numbered list instead', assert: 'numbered3', expect: ['typescript', 'java', 'rust', 'go', 'ruby'] },
      { user: 'lowercase only', assert: 'lower' },
      { user: 'one more, not typescript', expect: ['java', 'rust', 'go', 'ruby'], forbid: ['typescript'] },
      { user: 'one more, not typescript or java', expect: ['rust', 'go', 'ruby', 'kotlin', 'swift'], forbid: ['typescript', 'java'] },
    ],
  },
];
function buildDeep(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = DC_SEEDS[i % DC_SEEDS.length];
    const turns: Turn[] = seed.turns.map((t, idx) => ({
      user: t.user,
      check: (a) => {
        if (t.noise) return null;
        if (a.trim().length === 0) return `t${idx + 1}: empty`;
        if (isFallback(a) || isClarify(a)) return `t${idx + 1}: bailed`;
        if (t.expect && !hasAny(a, t.expect)) return `t${idx + 1}: no valid item`;
        if (t.forbid) {
          const hit = t.forbid.find(f => lower(a).includes(lower(f)));
          if (hit) return `t${idx + 1}: forbidden "${hit}"`;
        }
        if (t.assert === 'numbered3' && numberedCount(a) < 3) return `t${idx + 1}: expected 3 numbered, got ${numberedCount(a)}`;
        if (t.assert === 'bullets3' && bulletCount(a) < 3) return `t${idx + 1}: expected 3 bullets, got ${bulletCount(a)}`;
        if (t.assert === 'lower' && hasUpper(a)) return `t${idx + 1}: has uppercase`;
        return null;
      },
    }));
    out.push({ id: `deep-${i}`, bundle: 'deepChainTen', turns });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 2 — DOUBLE NEGATION FORMAT (count + format + 2 exclusions + lowercase)
// ---------------------------------------------------------------------------
interface DnSeed { prompt: string; minNumbered?: number; minBullets?: number; forbid: string[]; expectAny: string[]; }
const DN_SEEDS: DnSeed[] = [
  { prompt: 'name 3 european capitals as a numbered list, in lowercase, that are not paris and not berlin',
    minNumbered: 3, forbid: ['paris', 'berlin'],
    expectAny: ['rome', 'madrid', 'lisbon', 'oslo', 'vienna', 'warsaw', 'stockholm', 'amsterdam', 'brussels', 'athens'] },
  { prompt: 'list 3 planets as bullet points, lowercase only, that are not earth and not mars',
    minBullets: 3, forbid: ['earth', 'mars'],
    expectAny: ['mercury', 'venus', 'jupiter', 'saturn', 'uranus', 'neptune'] },
  { prompt: 'give me 3 programming languages as a numbered list, in lowercase, not python and not javascript',
    minNumbered: 3, forbid: ['python', 'javascript'],
    expectAny: ['typescript', 'java', 'rust', 'go', 'ruby', 'kotlin', 'swift'] },
  { prompt: 'list 3 asian countries as bullet points, lowercase only, not japan and not china',
    minBullets: 3, forbid: ['japan', 'china'],
    expectAny: ['thailand', 'vietnam', 'india', 'indonesia', 'philippines', 'malaysia', 'singapore', 'pakistan', 'bangladesh', 'mongolia', 'south korea'] },
];
function buildDn(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = DN_SEEDS[i % DN_SEEDS.length];
    out.push({
      id: `dn-${i}`, bundle: 'doubleNegFormat',
      turns: [{
        user: s.prompt,
        check: (a) => {
          if (a.trim().length === 0) return 'empty';
          if (isFallback(a) || isClarify(a)) return 'bailed';
          if (s.minNumbered && numberedCount(a) < s.minNumbered) return `expected ${s.minNumbered} numbered, got ${numberedCount(a)}`;
          if (s.minBullets && bulletCount(a) < s.minBullets) return `expected ${s.minBullets} bullets, got ${bulletCount(a)}`;
          const hit = s.forbid.find(f => lower(a).includes(lower(f)));
          if (hit) return `forbidden "${hit}" present`;
          if (!hasAny(a, s.expectAny)) return 'no valid item';
          if (hasUpper(a)) return 'has uppercase';
          return null;
        },
      }],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 3 — DISAMBIG CASCADE (lock to disambiguated sense for 3 followups)
// ---------------------------------------------------------------------------
interface DiSeed { turns: Array<{ user: string; expect: string[]; forbid?: string[] }>; }
const DI_SEEDS: DiSeed[] = [
  {
    turns: [
      { user: 'tell me about python the snake', expect: ['snake', 'reptile', 'constrictor'] },
      { user: 'where does it live?', expect: ['africa', 'asia', 'australia', 'tropical', 'forest', 'jungle', 'wild', 'habitat'], forbid: ['programming', 'guido'] },
      { user: 'what does it eat?', expect: ['mammal', 'rodent', 'bird', 'prey'], forbid: ['programming', 'guido'] },
      { user: 'how does it kill its prey?', expect: ['constrict', 'squeez', 'wraps'], forbid: ['programming', 'guido'] },
    ],
  },
  {
    turns: [
      { user: 'tell me about python the programming language', expect: ['programming', 'language', 'guido'] },
      { user: 'who created it?', expect: ['guido', 'rossum'], forbid: ['snake', 'reptile'] },
      { user: 'what year was it released?', expect: ['1991'], forbid: ['snake', 'reptile'] },
      { user: 'what is it used for?', expect: ['data', 'web', 'script', 'machine', 'learning', 'automation', 'general'], forbid: ['snake', 'reptile'] },
    ],
  },
  {
    turns: [
      { user: 'tell me about mercury the planet', expect: ['planet', 'sun', 'closest', 'smallest'] },
      { user: 'how big is it?', expect: ['smallest', 'small', 'km', 'diameter', '4,879', '4879', 'mile'], forbid: ['element', 'metal', 'liquid', 'thermometer'] },
      { user: 'how far from the sun is it?', expect: ['million', 'km', 'au', 'closest', 'nearest', '57', '58', '36'], forbid: ['element', 'metal', 'liquid'] },
    ],
  },
];
function buildDi(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = DI_SEEDS[i % DI_SEEDS.length];
    const turns: Turn[] = seed.turns.map((t, idx) => ({
      user: t.user,
      check: (a) => {
        if (a.trim().length === 0) return `t${idx + 1}: empty`;
        if (isFallback(a) || isClarify(a)) return `t${idx + 1}: bailed`;
        if (!hasAny(a, t.expect)) return `t${idx + 1}: missing ${t.expect.slice(0, 3).join('|')}`;
        if (t.forbid) {
          const hit = t.forbid.find(f => lower(a).includes(lower(f)));
          if (hit) return `t${idx + 1}: forbidden "${hit}"`;
        }
        return null;
      },
    }));
    out.push({ id: `di-${i}`, bundle: 'disambigCascade', turns });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 4 — INTERLEAVED TOPICS ("and X?" inherits prior verb)
// ---------------------------------------------------------------------------
interface ItSeed { turns: Array<{ user: string; expect: string[]; forbid?: string[] }>; }
const IT_SEEDS: ItSeed[] = [
  {
    turns: [
      { user: 'what is the capital of france?', expect: ['paris'] },
      { user: 'what is the capital of japan?', expect: ['tokyo'], forbid: ['paris'] },
      { user: 'and germany?', expect: ['berlin'], forbid: ['paris', 'tokyo'] },
      { user: 'and south korea?', expect: ['seoul'], forbid: ['berlin'] },
      { user: 'and brazil?', expect: ['brasília', 'brasilia'], forbid: ['seoul'] },
    ],
  },
  {
    turns: [
      { user: 'who is the ceo of apple?', expect: ['cook'] },
      { user: 'who is the ceo of microsoft?', expect: ['nadella'], forbid: ['cook'] },
      { user: 'and google?', expect: ['pichai'], forbid: ['nadella'] },
      { user: 'and amazon?', expect: ['jassy'], forbid: ['pichai'] },
      { user: 'and nvidia?', expect: ['huang'], forbid: ['jassy'] },
    ],
  },
];
function buildIt(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = IT_SEEDS[i % IT_SEEDS.length];
    const turns: Turn[] = seed.turns.map((t, idx) => ({
      user: t.user,
      check: (a) => {
        if (a.trim().length === 0) return `t${idx + 1}: empty`;
        if (isFallback(a) || isClarify(a)) return `t${idx + 1}: bailed`;
        if (!hasAny(a, t.expect)) return `t${idx + 1}: missing ${t.expect.join('|')}`;
        if (t.forbid) {
          const hit = t.forbid.find(f => lower(a).includes(lower(f)));
          if (hit) return `t${idx + 1}: forbidden "${hit}"`;
        }
        return null;
      },
    }));
    out.push({ id: `it-${i}`, bundle: 'interleavedTopics', turns });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 5 — CONSTRAINT REVISION (turn 2 changes count)
// ---------------------------------------------------------------------------
interface CrSeed { turns: Array<{ user: string; assertCount?: number; assertFormat?: 'bullets' | 'numbered' }>; }
const CR_SEEDS: CrSeed[] = [
  { turns: [
    { user: 'list 3 european capitals as bullet points', assertCount: 3, assertFormat: 'bullets' },
    { user: 'actually make it 5 instead', assertCount: 5, assertFormat: 'bullets' },
  ]},
  { turns: [
    { user: 'name 4 planets as a numbered list', assertCount: 4, assertFormat: 'numbered' },
    { user: 'actually make it 6 instead', assertCount: 6, assertFormat: 'numbered' },
  ]},
  { turns: [
    { user: 'give me 3 programming languages as bullet points', assertCount: 3, assertFormat: 'bullets' },
    { user: 'actually make it 5 instead', assertCount: 5, assertFormat: 'bullets' },
  ]},
  { turns: [
    { user: 'list 3 asian countries as a numbered list', assertCount: 3, assertFormat: 'numbered' },
    { user: 'actually make it 5 instead', assertCount: 5, assertFormat: 'numbered' },
  ]},
];
function buildCr(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = CR_SEEDS[i % CR_SEEDS.length];
    const turns: Turn[] = seed.turns.map((t, idx) => ({
      user: t.user,
      check: (a) => {
        if (a.trim().length === 0) return `t${idx + 1}: empty`;
        if (isFallback(a) || isClarify(a)) return `t${idx + 1}: bailed`;
        if (t.assertFormat === 'bullets' && bulletCount(a) < (t.assertCount ?? 0)) return `t${idx + 1}: expected ${t.assertCount} bullets, got ${bulletCount(a)}`;
        if (t.assertFormat === 'numbered' && numberedCount(a) < (t.assertCount ?? 0)) return `t${idx + 1}: expected ${t.assertCount} numbered, got ${numberedCount(a)}`;
        return null;
      },
    }));
    out.push({ id: `cr-${i}`, bundle: 'constraintRevise', turns });
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
    ...buildDeep(rand, n),
    ...buildDn(rand, n),
    ...buildDi(rand, n),
    ...buildIt(rand, n),
    ...buildCr(rand, n),
  ];
  if (onlyBundle) cases = cases.filter(c => c.bundle === onlyBundle);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError('fetch disabled'); }) as typeof fetch;

  const tally: Record<BundleId, { pass: number; fail: number }> = {
    deepChainTen: { pass: 0, fail: 0 },
    doubleNegFormat: { pass: 0, fail: 0 },
    disambigCascade: { pass: 0, fail: 0 },
    interleavedTopics: { pass: 0, fail: 0 },
    constraintRevise: { pass: 0, fail: 0 },
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
  console.log('=== Intent / Format / Meaning bench — V7 (deep chains + revision + interleaving) ===');
  console.log(`n_per_bundle=${n}  seed=${seed}  totalCases=${cases.length}  totalMs=${totalMs}`);
  let pAll = 0, tAll = 0;
  for (const b of ['deepChainTen', 'doubleNegFormat', 'disambigCascade', 'interleavedTopics', 'constraintRevise'] as const) {
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
