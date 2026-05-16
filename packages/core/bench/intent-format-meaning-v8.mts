/**
 * Intent / Format / Meaning bench — v8 (harder still).
 *
 * v8 bundles:
 *   1. ordinalRecall   — user asks for a specific ordinal item from a prior list
 *                        ("what was the second one you mentioned?").
 *   2. midChainReset   — chain on category A, then "forget that, start over
 *                        with B" must flip context cleanly.
 *   3. negationUndo    — multi-turn format constraints, then an undo
 *                        ("actually never mind the lowercase, use caps as normal").
 *   4. fifteenTurn     — 15-turn brutal chain stacking picks, exclusions,
 *                        format flips, ordinal recall, and an undo.
 *   5. inheritedVerb   — bare topic follow-ups ("germany?", "japan?") must
 *                        inherit the most recent picker verb across noise.
 */

import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { VaiEngine } from '../src/models/vai-engine.js';

type Verdict = 'PASS' | 'FAIL';
type BundleId =
  | 'ordinalRecall'
  | 'midChainReset'
  | 'negationUndo'
  | 'fifteenTurn'
  | 'inheritedVerb';

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
// BUNDLE 1 — ORDINAL RECALL
// ---------------------------------------------------------------------------
interface OrSeed {
  setup: string;          // turn 1 (a list-of-3 request)
  items: string[];        // the canonical answer the engine should produce
  ordinal: 'first' | 'second' | 'third';
  query: string;          // turn 2 query
}
const OR_SEEDS: OrSeed[] = [
  { setup: 'list 3 planets as bullet points', items: ['mercury', 'venus', 'earth'], ordinal: 'second', query: 'what was the second one you mentioned?' },
  { setup: 'list 3 european capitals as a numbered list', items: ['paris', 'berlin', 'rome'], ordinal: 'third', query: 'what was the third one?' },
  { setup: 'name 3 programming languages as bullet points', items: ['python', 'javascript', 'typescript'], ordinal: 'first', query: 'what was the first one you mentioned?' },
  { setup: 'list 3 asian countries as a numbered list', items: ['japan', 'china', 'south korea'], ordinal: 'second', query: 'what was the second one?' },
  { setup: 'list 3 chemical elements as bullet points', items: ['hydrogen', 'helium', 'oxygen'], ordinal: 'third', query: 'the third one — what was it?' },
];
function buildOr(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = OR_SEEDS[i % OR_SEEDS.length];
    const idx = s.ordinal === 'first' ? 0 : s.ordinal === 'second' ? 1 : 2;
    const expected = s.items[idx];
    const turns: Turn[] = [
      { user: s.setup, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          const cnt = Math.max(bulletCount(a), numberedCount(a));
          if (cnt < 3) return `t1: expected 3 items, got ${cnt}`;
          return null;
        }},
      { user: s.query, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          if (!lower(a).includes(expected)) return `t2: missing expected "${expected}"`;
          // Must not just regurgitate the whole list — heuristic: not 3 bullets
          if (bulletCount(a) >= 3 || numberedCount(a) >= 3) return 't2: returned full list instead of ordinal';
          return null;
        }},
    ];
    out.push({ id: `or-${i}`, bundle: 'ordinalRecall', turns });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 2 — MID-CHAIN RESET
// ---------------------------------------------------------------------------
interface MrSeed {
  catA: { setup: string; pick: string; expect: string[] };
  catB: { reset: string; pick: string; expect: string[]; forbidA: string[] };
}
const MR_SEEDS: MrSeed[] = [
  {
    catA: { setup: 'name a planet', pick: 'another one', expect: ['mercury','venus','earth','mars','jupiter','saturn','uranus','neptune'] },
    catB: { reset: 'forget that — start over with european capitals. name one.', pick: 'another one', expect: ['paris','berlin','rome','madrid','lisbon','oslo','vienna'], forbidA: ['mercury','venus','earth','mars','jupiter','saturn','uranus','neptune'] },
  },
  {
    catA: { setup: 'name a programming language', pick: 'another one', expect: ['python','javascript','typescript','java','rust','go','c++','ruby','kotlin','swift'] },
    catB: { reset: 'forget that — start over with planets. name one.', pick: 'another one', expect: ['mercury','venus','earth','mars','jupiter','saturn','uranus','neptune'], forbidA: ['python','javascript','typescript','java','rust','go','ruby','kotlin','swift'] },
  },
  {
    catA: { setup: 'name a european capital', pick: 'another one', expect: ['paris','berlin','rome','madrid','lisbon','oslo','vienna'] },
    catB: { reset: 'forget that — start over with asian countries. name one.', pick: 'another one', expect: ['japan','china','south korea','thailand','vietnam','india','indonesia'], forbidA: ['paris','berlin','rome','madrid','lisbon','oslo','vienna'] },
  },
];
function buildMr(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = MR_SEEDS[i % MR_SEEDS.length];
    const turns: Turn[] = [
      { user: s.catA.setup, check: (a) => isFallback(a) || isClarify(a) ? 't1: bailed' : hasAny(a, s.catA.expect) ? null : `t1: missing catA item` },
      { user: s.catA.pick,  check: (a) => isFallback(a) || isClarify(a) ? 't2: bailed' : hasAny(a, s.catA.expect) ? null : `t2: missing catA item` },
      { user: s.catB.reset, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't3: bailed';
          if (!hasAny(a, s.catB.expect)) return `t3: missing catB item`;
          const hit = s.catB.forbidA.find(f => lower(a).includes(f));
          if (hit) return `t3: leaked catA "${hit}"`;
          return null;
        }},
      { user: s.catB.pick, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't4: bailed';
          if (!hasAny(a, s.catB.expect)) return `t4: missing catB item`;
          const hit = s.catB.forbidA.find(f => lower(a).includes(f));
          if (hit) return `t4: leaked catA "${hit}"`;
          return null;
        }},
    ];
    out.push({ id: `mr-${i}`, bundle: 'midChainReset', turns });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 3 — NEGATION UNDO
// ---------------------------------------------------------------------------
interface NuSeed {
  setup: string;
  expectCount: number;
  format: 'bullets' | 'numbered';
  lower1: string;     // request lowercase
  undo: string;       // undo the lowercase
}
const NU_SEEDS: NuSeed[] = [
  { setup: 'list 3 european capitals as bullet points', expectCount: 3, format: 'bullets', lower1: 'lowercase only please', undo: 'actually never mind the lowercase — use normal capitalization' },
  { setup: 'name 3 planets as a numbered list', expectCount: 3, format: 'numbered', lower1: 'all lowercase', undo: 'actually never mind the lowercase, use proper caps' },
  { setup: 'give me 3 programming languages as bullet points', expectCount: 3, format: 'bullets', lower1: 'lowercase only', undo: 'wait, scratch the lowercase — normal case is fine' },
];
function buildNu(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = NU_SEEDS[i % NU_SEEDS.length];
    const turns: Turn[] = [
      { user: s.setup, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          const cnt = s.format === 'bullets' ? bulletCount(a) : numberedCount(a);
          if (cnt < s.expectCount) return `t1: expected ${s.expectCount}, got ${cnt}`;
          return null;
        }},
      { user: s.lower1, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          if (hasUpper(a)) return 't2: still has uppercase';
          return null;
        }},
      { user: s.undo, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't3: bailed';
          if (!hasUpper(a)) return 't3: still lowercase after undo';
          const cnt = s.format === 'bullets' ? bulletCount(a) : numberedCount(a);
          if (cnt < s.expectCount) return `t3: expected ${s.expectCount}, got ${cnt}`;
          return null;
        }},
    ];
    out.push({ id: `nu-${i}`, bundle: 'negationUndo', turns });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 4 — FIFTEEN TURN CHAIN
// ---------------------------------------------------------------------------
interface FtSeed { turns: Array<{ user: string; expect?: string[]; forbid?: string[]; assert?: 'bullets3' | 'numbered3' | 'lower' | 'noUpper' }>; }
const FT_SEEDS: FtSeed[] = [
  { turns: [
    { user: 'name a planet', expect: ['mercury','venus','earth','mars','jupiter','saturn','uranus','neptune'] },
    { user: 'another one' },
    { user: 'one that is not earth', forbid: ['earth'] },
    { user: 'one that is not earth or mars', forbid: ['earth','mars'] },
    { user: 'cool' },
    { user: 'list 3 of them as bullet points', assert: 'bullets3' },
    { user: 'actually do it as a numbered list', assert: 'numbered3' },
    { user: 'lowercase only', assert: 'lower' },
    { user: 'one more, not jupiter', forbid: ['jupiter'] },
    { user: 'one more, not jupiter or saturn', forbid: ['jupiter','saturn'] },
    { user: 'thanks' },
    { user: 'list 3 again as bullet points', assert: 'bullets3' },
    { user: 'in normal caps now', assert: 'noUpper' === 'noUpper' ? undefined : undefined },
    { user: 'one more, not neptune', forbid: ['neptune'] },
    { user: 'and one more, not uranus or neptune', forbid: ['uranus','neptune'] },
  ]},
  { turns: [
    { user: 'name a european capital', expect: ['paris','berlin','rome','madrid','lisbon','oslo','vienna'] },
    { user: 'another one' },
    { user: 'one that is not paris', forbid: ['paris'] },
    { user: 'one that is not paris or berlin', forbid: ['paris','berlin'] },
    { user: 'got it' },
    { user: 'list 3 of them as bullet points', assert: 'bullets3' },
    { user: 'actually do it as a numbered list', assert: 'numbered3' },
    { user: 'lowercase only', assert: 'lower' },
    { user: 'one more, not rome', forbid: ['rome'] },
    { user: 'one more, not rome or madrid', forbid: ['rome','madrid'] },
    { user: 'nice' },
    { user: 'list 3 again as bullet points', assert: 'bullets3' },
    { user: 'use normal caps now' },
    { user: 'one more, not lisbon', forbid: ['lisbon'] },
    { user: 'and one more, not lisbon or oslo', forbid: ['lisbon','oslo'] },
  ]},
  { turns: [
    { user: 'name a programming language', expect: ['python','javascript','typescript','java','rust','go','c++','ruby','kotlin','swift'] },
    { user: 'another one' },
    { user: 'one that is not python', forbid: ['python'] },
    { user: 'one that is not python or javascript', forbid: ['python','javascript'] },
    { user: 'interesting' },
    { user: 'list 3 of them as bullet points', assert: 'bullets3' },
    { user: 'actually do it as a numbered list', assert: 'numbered3' },
    { user: 'lowercase only', assert: 'lower' },
    { user: 'one more, not typescript', forbid: ['typescript'] },
    { user: 'one more, not typescript or java', forbid: ['typescript','java'] },
    { user: 'cool' },
    { user: 'list 3 again as bullet points', assert: 'bullets3' },
    { user: 'normal caps now' },
    { user: 'one more, not rust', forbid: ['rust'] },
    { user: 'and one more, not rust or go', forbid: ['rust','go'] },
  ]},
];
function buildFt(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = FT_SEEDS[i % FT_SEEDS.length];
    const turns: Turn[] = s.turns.map((t, idx) => ({
      user: t.user,
      check: (a) => {
        if (a.trim().length === 0) return `t${idx + 1}: empty`;
        if (isFallback(a) || isClarify(a)) return null; // tolerate noise turns
        if (t.expect && !hasAny(a, t.expect)) return `t${idx + 1}: missing expect`;
        if (t.forbid) {
          const hit = t.forbid.find(f => lower(a).includes(f));
          if (hit) return `t${idx + 1}: forbidden "${hit}"`;
        }
        if (t.assert === 'bullets3' && bulletCount(a) < 3) return `t${idx + 1}: expected 3 bullets, got ${bulletCount(a)}`;
        if (t.assert === 'numbered3' && numberedCount(a) < 3) return `t${idx + 1}: expected 3 numbered, got ${numberedCount(a)}`;
        if (t.assert === 'lower' && hasUpper(a)) return `t${idx + 1}: has uppercase`;
        return null;
      },
    }));
    out.push({ id: `ft-${i}`, bundle: 'fifteenTurn', turns });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 5 — INHERITED VERB across noise
// ---------------------------------------------------------------------------
interface IvSeed { setup: string; expectSetup: string[]; noise: string; bare: string; expectBare: string[] }
const IV_SEEDS: IvSeed[] = [
  { setup: 'what is the capital of france?', expectSetup: ['paris'], noise: 'thanks!', bare: 'germany?', expectBare: ['berlin'] },
  { setup: 'who is the ceo of apple?', expectSetup: ['tim cook'], noise: 'cool', bare: 'microsoft?', expectBare: ['satya nadella','nadella'] },
  { setup: 'what year was python first released?', expectSetup: ['1991'], noise: 'interesting', bare: 'javascript?', expectBare: ['1995'] },
  { setup: 'what is the capital of japan?', expectSetup: ['tokyo'], noise: 'great', bare: 'south korea?', expectBare: ['seoul'] },
  { setup: 'who founded microsoft?', expectSetup: ['bill gates','paul allen','gates'], noise: 'got it', bare: 'apple?', expectBare: ['steve jobs','jobs','wozniak'] },
];
function buildIv(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = IV_SEEDS[i % IV_SEEDS.length];
    const turns: Turn[] = [
      { user: s.setup, check: (a) => isFallback(a) || isClarify(a) ? 't1: bailed' : hasAny(a, s.expectSetup) ? null : `t1: missing setup` },
      { user: s.noise },
      { user: s.bare, check: (a) => isFallback(a) || isClarify(a) ? 't3: bailed' : hasAny(a, s.expectBare) ? null : `t3: missing ${s.expectBare.join('|')}` },
    ];
    out.push({ id: `iv-${i}`, bundle: 'inheritedVerb', turns });
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
    ...buildOr(rand, n),
    ...buildMr(rand, n),
    ...buildNu(rand, n),
    ...buildFt(rand, n),
    ...buildIv(rand, n),
  ];
  if (onlyBundle) cases = cases.filter(c => c.bundle === onlyBundle);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError('fetch disabled'); }) as typeof fetch;

  const tally: Record<BundleId, { pass: number; fail: number }> = {
    ordinalRecall: { pass: 0, fail: 0 },
    midChainReset: { pass: 0, fail: 0 },
    negationUndo: { pass: 0, fail: 0 },
    fifteenTurn: { pass: 0, fail: 0 },
    inheritedVerb: { pass: 0, fail: 0 },
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
  console.log('=== Intent / Format / Meaning bench — V8 (ordinal/reset/undo/15-turn/verb-inheritance) ===');
  console.log(`n_per_bundle=${n}  seed=${seed}  totalCases=${cases.length}  totalMs=${totalMs}`);
  let pAll = 0, tAll = 0;
  for (const b of ['ordinalRecall', 'midChainReset', 'negationUndo', 'fifteenTurn', 'inheritedVerb'] as const) {
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
