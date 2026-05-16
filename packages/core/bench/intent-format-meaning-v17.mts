// intent-format-meaning-v17.mts
//   1. rhymeRequest      — "give me 3 words that rhyme with cat"
//   2. fractionToDecimal — "what is 3/4 as a decimal?"
//   3. romanNumeral      — "write 47 in roman numerals"
//   4. dayOfWeekMath     — "what day is 3 days after Monday?"
//   5. simpleSolve       — "solve x + 5 = 12"

import fs from 'node:fs/promises';
import path from 'node:path';
import { VaiEngine } from '../src/models/vai-engine.js';
import type { Message } from '../src/types/index.js';

(globalThis as any).fetch = async () => { throw new TypeError('fetch disabled'); };

type BundleId = 'rhymeRequest' | 'fractionToDecimal' | 'romanNumeral' | 'dayOfWeekMath' | 'simpleSolve';

interface Turn { user: string; check: (a: string, hist: Message[]) => string | null; }
interface Case { id: string; bundle: BundleId; turns: Turn[]; }

function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lower(s: string): string { return (s || '').toLowerCase(); }
function isFallback(a: string): boolean {
  const l = lower(a);
  return /(\bisn['’]?t in my\b|don['’]?t yet hold|don'?t have it (locally|yet)|stay on|pivot fully|in my (?:local )?(?:knowledge|memory)|don['’]?t have a solid answer|i (?:don'?t|do not) know about\b)/i.test(l);
}
function isClarify(a: string): boolean {
  return /(could you clarify|what do you mean|which one did you mean|are you asking about)/i.test(a);
}

// ---------------------------------------------------------------------------
// 1. RHYME REQUEST
// ---------------------------------------------------------------------------
const RHYME_MAP: Record<string, string[]> = {
  cat: ['bat','hat','mat','rat','sat','pat','flat','that'],
  dog: ['log','fog','frog','jog','cog','bog','hog'],
  star: ['car','far','bar','jar','tar','scar','guitar'],
  light: ['bright','fight','night','sight','flight','right','tight','might'],
  sun: ['fun','run','bun','done','one','none','gun'],
  blue: ['true','clue','glue','new','shoe','flew','knew'],
  cake: ['lake','make','bake','take','snake','rake','wake'],
  tree: ['free','bee','sea','three','knee','flee','agree'],
};
function buildRhyme(_rand: () => number, n: number): Case[] {
  const keys = Object.keys(RHYME_MAP);
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const w = keys[i % keys.length];
    const opts = RHYME_MAP[w];
    out.push({ id: `rhy-${i}`, bundle: 'rhymeRequest', turns: [
      { user: `give me 3 words that rhyme with ${w}`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          const la = lower(a);
          const hits = opts.filter(o => new RegExp(`\\b${o}\\b`).test(la)).length;
          if (hits < 3) return `t1: only ${hits} rhyme matches`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. FRACTION TO DECIMAL
// ---------------------------------------------------------------------------
interface FrSeed { num: number; den: number; expected: number; tol: number; }
const FR_SEEDS: FrSeed[] = [
  { num: 3, den: 4,  expected: 0.75,   tol: 0.005 },
  { num: 1, den: 2,  expected: 0.5,    tol: 0.005 },
  { num: 1, den: 4,  expected: 0.25,   tol: 0.005 },
  { num: 7, den: 8,  expected: 0.875,  tol: 0.005 },
  { num: 1, den: 5,  expected: 0.2,    tol: 0.005 },
  { num: 2, den: 3,  expected: 0.667,  tol: 0.01 },
  { num: 5, den: 16, expected: 0.3125, tol: 0.005 },
  { num: 9, den: 10, expected: 0.9,    tol: 0.005 },
];
function buildFr(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = FR_SEEDS[i % FR_SEEDS.length];
    out.push({ id: `fr-${i}`, bundle: 'fractionToDecimal', turns: [
      { user: `what is ${s.num}/${s.den} as a decimal?`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          const nums = (a.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
          if (!nums.some(v => Math.abs(v - s.expected) <= s.tol)) return `t1: missing ${s.expected}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. ROMAN NUMERAL — "write 47 in roman numerals"
// ---------------------------------------------------------------------------
function toRoman(n: number): string {
  const map: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let s = '';
  for (const [v, sym] of map) {
    while (n >= v) { s += sym; n -= v; }
  }
  return s;
}
function buildRoman(_rand: () => number, n: number): Case[] {
  const seeds = [4, 9, 14, 40, 47, 90, 99, 100, 444, 1999, 2024];
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const num = seeds[i % seeds.length];
    const expected = toRoman(num);
    out.push({ id: `rom-${i}`, bundle: 'romanNumeral', turns: [
      { user: `write ${num} in roman numerals`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          // Look for the exact roman string as a token (uppercase).
          if (!new RegExp(`\\b${expected}\\b`).test(a)) return `t1: missing ${expected}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. DAY OF WEEK MATH — "what day is 3 days after Monday?"
// ---------------------------------------------------------------------------
const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
interface DowSeed { base: string; addD: number; expected: string; }
const DOW_SEEDS: DowSeed[] = [
  { base: 'Monday',    addD: 3, expected: 'thursday' },
  { base: 'Friday',    addD: 4, expected: 'tuesday' },
  { base: 'Wednesday', addD: 5, expected: 'monday' },
  { base: 'Sunday',    addD: 1, expected: 'monday' },
  { base: 'Saturday',  addD: 7, expected: 'saturday' },
  { base: 'Tuesday',   addD: 10, expected: 'friday' },
];
function buildDow(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = DOW_SEEDS[i % DOW_SEEDS.length];
    out.push({ id: `dow-${i}`, bundle: 'dayOfWeekMath', turns: [
      { user: `what day is ${s.addD} days after ${s.base}?`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          const la = lower(a);
          if (!new RegExp(`\\b${s.expected}\\b`).test(la)) return `t1: missing ${s.expected}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. SIMPLE SOLVE — "solve x + 5 = 12"
// ---------------------------------------------------------------------------
interface SolveSeed { prompt: string; expected: number; }
const SOLVE_SEEDS: SolveSeed[] = [
  { prompt: 'solve x + 5 = 12',  expected: 7 },
  { prompt: 'solve x - 3 = 10',  expected: 13 },
  { prompt: 'solve 2x = 14',     expected: 7 },
  { prompt: 'solve x / 4 = 5',   expected: 20 },
  { prompt: 'solve x + 9 = 9',   expected: 0 },
  { prompt: 'solve 3x + 1 = 10', expected: 3 },
  { prompt: 'solve 5x - 2 = 13', expected: 3 },
  { prompt: 'solve x - 7 = -2',  expected: 5 },
];
function buildSolve(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = SOLVE_SEEDS[i % SOLVE_SEEDS.length];
    out.push({ id: `slv-${i}`, bundle: 'simpleSolve', turns: [
      { user: s.prompt, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          const nums = (a.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
          if (!nums.some(v => Math.abs(v - s.expected) <= 0.01)) return `t1: missing ${s.expected}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function runCase(c: Case): Promise<{ pass: boolean; reason: string | null; preview: string; prompt: string }> {
  const engine = new VaiEngine();
  const history: Message[] = [];
  const promptParts: string[] = [];
  const previewParts: string[] = [];
  for (let i = 0; i < c.turns.length; i++) {
    const t = c.turns[i];
    promptParts.push(t.user);
    history.push({ role: 'user', content: t.user });
    let resp: any;
    try {
      resp = await engine.chat({ messages: history, noLearn: true });
    } catch (err) {
      return { pass: false, reason: `t${i+1}: threw ${(err as Error).message}`, preview: previewParts.join(' >> '), prompt: promptParts.join(' || ') };
    }
    const text: string = (resp?.content ?? resp?.message?.content ?? '').toString();
    previewParts.push(text.replace(/\r?\n/g, ' '));
    history.push({ role: 'assistant', content: text });
    const r = t.check(text, history);
    if (r) return { pass: false, reason: r, preview: previewParts.join(' >> '), prompt: promptParts.join(' || ') };
  }
  return { pass: true, reason: null, preview: previewParts.join(' >> '), prompt: promptParts.join(' || ') };
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
  const n = parseInt(arg('n', '200'), 10);
  const seed = parseInt(arg('seed', '42'), 10);
  const report = arg('report', '');
  const bundle = arg('bundle', '');

  const rand = mulberry32(seed);
  const allCases: Case[] = [
    ...buildRhyme(rand, n),
    ...buildFr(rand, n),
    ...buildRoman(rand, n),
    ...buildDow(rand, n),
    ...buildSolve(rand, n),
  ];
  const cases = bundle ? allCases.filter(c => c.bundle === bundle) : allCases;

  const stats: Record<BundleId, { pass: number; fail: number }> = {
    rhymeRequest: { pass: 0, fail: 0 },
    fractionToDecimal: { pass: 0, fail: 0 },
    romanNumeral: { pass: 0, fail: 0 },
    dayOfWeekMath: { pass: 0, fail: 0 },
    simpleSolve: { pass: 0, fail: 0 },
  };
  const failures: Array<{ id: string; bundle: BundleId; prompt: string; reason: string; preview: string }> = [];
  let done = 0;
  for (const c of cases) {
    const r = await runCase(c);
    if (r.pass) stats[c.bundle].pass++;
    else { stats[c.bundle].fail++; failures.push({ id: c.id, bundle: c.bundle, prompt: r.prompt, reason: r.reason || '?', preview: r.preview }); }
    done++;
    if (done % 100 === 0) console.log(`  [${done}/${cases.length}]`);
  }
  console.log('\n=== INTENT/FORMAT/MEANING BENCH v17 ===');
  let totPass = 0, totFail = 0;
  for (const k of Object.keys(stats) as BundleId[]) {
    const s = stats[k];
    const pct = s.pass + s.fail === 0 ? 0 : (100 * s.pass / (s.pass + s.fail));
    console.log(`  ${k.padEnd(20)} ${s.pass}/${s.pass + s.fail} (${pct.toFixed(2)}%)`);
    totPass += s.pass; totFail += s.fail;
  }
  const overallPct = totPass + totFail === 0 ? 0 : (100 * totPass / (totPass + totFail));
  console.log(`  OVERALL              pass=${totPass}/${totPass + totFail} (${overallPct.toFixed(2)}%)`);
  if (report) {
    await fs.writeFile(path.resolve(report), JSON.stringify({ stats, failures }, null, 2));
    console.log(`  report: ${report}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
