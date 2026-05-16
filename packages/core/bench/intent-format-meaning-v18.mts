// intent-format-meaning-v18.mts
//   1. capitalCity        — "what's the capital of France?"
//   2. oppositeDirection  — "what's the opposite of north?"
//   3. monthDays          — "how many days in February?"
//   4. wordReverse        — "reverse the word elephant"
//   5. squareRoot         — "what is the square root of 144?"

import fs from 'node:fs/promises';
import path from 'node:path';
import { VaiEngine } from '../src/models/vai-engine.js';
import type { Message } from '../src/types/index.js';

(globalThis as any).fetch = async () => { throw new TypeError('fetch disabled'); };

type BundleId = 'capitalCity' | 'oppositeDirection' | 'monthDays' | 'wordReverse' | 'squareRoot';

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

function lower(s: string): string { return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function isFallback(a: string): boolean {
  const l = lower(a);
  return /(\bisn['’]?t in my\b|don['’]?t yet hold|don'?t have it (locally|yet)|stay on|pivot fully|in my (?:local )?(?:knowledge|memory)|don['’]?t have a solid answer|i (?:don'?t|do not) know about\b)/i.test(l);
}
function isClarify(a: string): boolean {
  return /(could you clarify|what do you mean|which one did you mean|are you asking about)/i.test(a);
}

// ---------------------------------------------------------------------------
// 1. CAPITAL CITY
// ---------------------------------------------------------------------------
const CAPITALS: Record<string, string> = {
  france: 'paris', germany: 'berlin', italy: 'rome', spain: 'madrid',
  japan: 'tokyo', china: 'beijing', india: 'new delhi', russia: 'moscow',
  canada: 'ottawa', australia: 'canberra', brazil: 'brasilia', egypt: 'cairo',
  greece: 'athens', portugal: 'lisbon',
};
function buildCap(_rand: () => number, n: number): Case[] {
  const keys = Object.keys(CAPITALS);
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const c = keys[i % keys.length];
    const exp = CAPITALS[c];
    out.push({ id: `cap-${i}`, bundle: 'capitalCity', turns: [
      { user: `what's the capital of ${c.charAt(0).toUpperCase() + c.slice(1)}?`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          if (!new RegExp(`\\b${exp.split(' ').join('\\s+')}\\b`, 'i').test(lower(a))) return `t1: missing ${exp}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. OPPOSITE DIRECTION
// ---------------------------------------------------------------------------
const OPP_DIR: Record<string, string> = {
  north: 'south', south: 'north', east: 'west', west: 'east',
  up: 'down', down: 'up', left: 'right', right: 'left',
  forward: 'backward', backward: 'forward',
  inside: 'outside', outside: 'inside',
};
function buildOppDir(_rand: () => number, n: number): Case[] {
  const keys = Object.keys(OPP_DIR);
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const d = keys[i % keys.length];
    const exp = OPP_DIR[d];
    out.push({ id: `od-${i}`, bundle: 'oppositeDirection', turns: [
      { user: `what's the opposite direction of ${d}?`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          if (!new RegExp(`\\b${exp}\\b`, 'i').test(lower(a))) return `t1: missing ${exp}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. MONTH DAYS
// ---------------------------------------------------------------------------
const MONTH_DAYS: Record<string, number> = {
  january: 31, february: 28, march: 31, april: 30, may: 31, june: 30,
  july: 31, august: 31, september: 30, october: 31, november: 30, december: 31,
};
function buildMd(_rand: () => number, n: number): Case[] {
  const keys = Object.keys(MONTH_DAYS);
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const m = keys[i % keys.length];
    const exp = MONTH_DAYS[m];
    out.push({ id: `md-${i}`, bundle: 'monthDays', turns: [
      { user: `how many days are in ${m.charAt(0).toUpperCase() + m.slice(1)}?`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          if (!new RegExp(`\\b${exp}\\b`).test(a)) return `t1: missing ${exp}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. WORD REVERSE
// ---------------------------------------------------------------------------
const REV_WORDS = ['elephant','keyboard','python','programming','algorithm','laptop','window','garden','mountain','river','planet','silver'];
function buildWr(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const w = REV_WORDS[i % REV_WORDS.length];
    const exp = w.split('').reverse().join('');
    out.push({ id: `wr-${i}`, bundle: 'wordReverse', turns: [
      { user: `reverse the word ${w}`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          if (!new RegExp(`\\b${exp}\\b`, 'i').test(lower(a))) return `t1: missing ${exp}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. SQUARE ROOT
// ---------------------------------------------------------------------------
interface SqSeed { n: number; expected: number; tol: number; }
const SQ_SEEDS: SqSeed[] = [
  { n: 144, expected: 12, tol: 0.01 },
  { n: 81, expected: 9, tol: 0.01 },
  { n: 25, expected: 5, tol: 0.01 },
  { n: 100, expected: 10, tol: 0.01 },
  { n: 64, expected: 8, tol: 0.01 },
  { n: 49, expected: 7, tol: 0.01 },
  { n: 169, expected: 13, tol: 0.01 },
  { n: 2, expected: 1.414, tol: 0.01 },
  { n: 200, expected: 14.142, tol: 0.05 },
];
function buildSq(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = SQ_SEEDS[i % SQ_SEEDS.length];
    out.push({ id: `sq-${i}`, bundle: 'squareRoot', turns: [
      { user: `what is the square root of ${s.n}?`, check: (a) => {
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
    ...buildCap(rand, n),
    ...buildOppDir(rand, n),
    ...buildMd(rand, n),
    ...buildWr(rand, n),
    ...buildSq(rand, n),
  ];
  const cases = bundle ? allCases.filter(c => c.bundle === bundle) : allCases;

  const stats: Record<BundleId, { pass: number; fail: number }> = {
    capitalCity: { pass: 0, fail: 0 },
    oppositeDirection: { pass: 0, fail: 0 },
    monthDays: { pass: 0, fail: 0 },
    wordReverse: { pass: 0, fail: 0 },
    squareRoot: { pass: 0, fail: 0 },
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
  console.log('\n=== INTENT/FORMAT/MEANING BENCH v18 ===');
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
