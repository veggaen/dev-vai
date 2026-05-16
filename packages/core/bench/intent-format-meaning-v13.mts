// intent-format-meaning-v13.mts
// Even harder follow-up arithmetic on lists:
//   1. negativeFilter   — list 5, "remove the ones starting with M"
//   2. indexLookup      — list 6, "what was at position 3?"
//   3. lengthQuery      — list 5, "which is the longest one?"
//   4. firstN / lastN   — list 5, "show the first 3" / "give me the last 2"
//   5. firstLetters     — list 5, "list just the first letter of each"

import fs from 'node:fs/promises';
import path from 'node:path';
import { VaiEngine } from '../src/models/vai-engine.js';
import type { Message } from '../src/types/index.js';

(globalThis as any).fetch = async () => { throw new TypeError('fetch disabled'); };

type BundleId = 'negFilter' | 'indexLookup' | 'lengthQuery' | 'firstLastN' | 'firstLetters';

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
  return /(\bisn't in my\b|don't yet hold|don'?t have it (locally|yet)|stay on|pivot fully|isn['’]t in my knowledge|in my local memory|help you discover|on the topic of)/i.test(l);
}
function isClarify(a: string): boolean {
  return /(could you clarify|what do you mean|which one did you mean|are you asking about)/i.test(a);
}
function numberedCount(a: string): number {
  return (a.match(/^[ \t]*\d+[.)]\s+\S/gm) || []).length;
}

// ---------------------------------------------------------------------------
// 1. NEGATIVE FILTER — "remove ones starting with M"
// ---------------------------------------------------------------------------
interface NfSeed { setup: string; letter: string; kept: string[]; dropped: string[]; }
const NF_SEEDS: NfSeed[] = [
  { setup: 'list 5 planets as a numbered list', letter: 'M', kept: ['venus','earth','jupiter'], dropped: ['mercury','mars'] },
  { setup: 'list 5 european capitals as a numbered list', letter: 'P', kept: ['berlin','rome','madrid','lisbon'], dropped: ['paris'] },
  { setup: 'list 5 programming languages as a numbered list', letter: 'J', kept: ['python','typescript','rust'], dropped: ['javascript','java'] },
  { setup: 'list 5 asian countries as a numbered list', letter: 'C', kept: ['japan','south korea','thailand','vietnam'], dropped: ['china'] },
  { setup: 'list 5 chemical elements as a numbered list', letter: 'H', kept: ['oxygen','nitrogen','carbon'], dropped: ['hydrogen','helium'] },
];
function buildNf(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = NF_SEEDS[i % NF_SEEDS.length];
    out.push({ id: `nf-${i}`, bundle: 'negFilter', turns: [
      { user: s.setup, check: (a) => isFallback(a)||isClarify(a) ? 't1: bailed' : (numberedCount(a)<4 ? 't1: not numbered' : null) },
      { user: `remove the ones starting with ${s.letter}`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          const la = lower(a);
          for (const k of s.kept) if (!la.includes(k)) return `t2: missing kept ${k}`;
          for (const d of s.dropped) if (new RegExp(`\\b${d}\\b`).test(la)) return `t2: still contains dropped ${d}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. INDEX LOOKUP — "what was at position 3?"
// ---------------------------------------------------------------------------
interface IdxSeed { setup: string; items: string[]; pos: number; expected: string; }
const IDX_SEEDS: IdxSeed[] = [
  { setup: 'list 5 planets as a numbered list', items: ['mercury','venus','earth','mars','jupiter'], pos: 3, expected: 'earth' },
  { setup: 'list 5 european capitals as a numbered list', items: ['paris','berlin','rome','madrid','lisbon'], pos: 4, expected: 'madrid' },
  { setup: 'list 5 programming languages as a numbered list', items: ['python','javascript','typescript','java','rust'], pos: 2, expected: 'javascript' },
  { setup: 'list 5 asian countries as a numbered list', items: ['japan','china','south korea','thailand','vietnam'], pos: 5, expected: 'vietnam' },
  { setup: 'list 5 chemical elements as a numbered list', items: ['hydrogen','helium','oxygen','nitrogen','carbon'], pos: 1, expected: 'hydrogen' },
];
function buildIdx(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = IDX_SEEDS[i % IDX_SEEDS.length];
    out.push({ id: `idx-${i}`, bundle: 'indexLookup', turns: [
      { user: s.setup, check: (a) => isFallback(a)||isClarify(a) ? 't1: bailed' : (numberedCount(a)<4 ? 't1: not numbered' : null) },
      { user: `what was at position ${s.pos}?`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          if (!lower(a).includes(s.expected)) return `t2: missing ${s.expected}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. LENGTH QUERY — "which is the longest?" / "shortest?"
// ---------------------------------------------------------------------------
interface LqSeed { setup: string; mode: 'longest' | 'shortest'; expected: string; }
const LQ_SEEDS: LqSeed[] = [
  // planets: Mercury(7) Venus(5) Earth(5) Mars(4) Jupiter(7) — longest tie Mercury/Jupiter; pick first found Mercury. shortest=Mars
  { setup: 'list 5 planets as a numbered list', mode: 'longest', expected: 'mercury' },
  { setup: 'list 5 planets as a numbered list', mode: 'shortest', expected: 'mars' },
  // euro caps: Paris(5) Berlin(6) Rome(4) Madrid(6) Lisbon(6) — longest tie; pick Berlin (first len-6). shortest=Rome
  { setup: 'list 5 european capitals as a numbered list', mode: 'longest', expected: 'berlin' },
  { setup: 'list 5 european capitals as a numbered list', mode: 'shortest', expected: 'rome' },
  // langs: Python(6) JavaScript(10) TypeScript(10) Java(4) Rust(4) — longest=JavaScript (first); shortest=Java (first)
  { setup: 'list 5 programming languages as a numbered list', mode: 'longest', expected: 'javascript' },
  { setup: 'list 5 programming languages as a numbered list', mode: 'shortest', expected: 'java' },
];
function buildLq(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = LQ_SEEDS[i % LQ_SEEDS.length];
    out.push({ id: `lq-${i}`, bundle: 'lengthQuery', turns: [
      { user: s.setup, check: (a) => isFallback(a)||isClarify(a) ? 't1: bailed' : (numberedCount(a)<4 ? 't1: not numbered' : null) },
      { user: `which is the ${s.mode} one?`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          if (!lower(a).includes(s.expected)) return `t2: missing ${s.expected}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. FIRST/LAST N — "show the first 3" / "the last 2"
// ---------------------------------------------------------------------------
interface FlSeed { setup: string; items: string[]; mode: 'first' | 'last'; n: number; }
const FL_SEEDS: FlSeed[] = [
  { setup: 'list 5 planets as a numbered list', items: ['mercury','venus','earth','mars','jupiter'], mode: 'first', n: 3 },
  { setup: 'list 5 european capitals as a numbered list', items: ['paris','berlin','rome','madrid','lisbon'], mode: 'last', n: 2 },
  { setup: 'list 5 programming languages as a numbered list', items: ['python','javascript','typescript','java','rust'], mode: 'first', n: 2 },
  { setup: 'list 5 asian countries as a numbered list', items: ['japan','china','south korea','thailand','vietnam'], mode: 'last', n: 3 },
  { setup: 'list 5 chemical elements as a numbered list', items: ['hydrogen','helium','oxygen','nitrogen','carbon'], mode: 'first', n: 4 },
];
function buildFl(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = FL_SEEDS[i % FL_SEEDS.length];
    const kept = s.mode === 'first' ? s.items.slice(0, s.n) : s.items.slice(-s.n);
    const dropped = s.mode === 'first' ? s.items.slice(s.n) : s.items.slice(0, s.items.length - s.n);
    out.push({ id: `fl-${i}`, bundle: 'firstLastN', turns: [
      { user: s.setup, check: (a) => isFallback(a)||isClarify(a) ? 't1: bailed' : (numberedCount(a)<4 ? 't1: not numbered' : null) },
      { user: `show the ${s.mode} ${s.n}`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          const la = lower(a);
          for (const k of kept) if (!la.includes(k)) return `t2: missing kept ${k}`;
          for (const d of dropped) if (new RegExp(`\\b${d}\\b`).test(la)) return `t2: still contains dropped ${d}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. FIRST LETTERS — "list just the first letter of each"
// ---------------------------------------------------------------------------
interface FlrSeed { setup: string; items: string[]; }
const FLR_SEEDS: FlrSeed[] = [
  { setup: 'list 5 planets as a numbered list', items: ['mercury','venus','earth','mars','jupiter'] },
  { setup: 'list 5 european capitals as a numbered list', items: ['paris','berlin','rome','madrid','lisbon'] },
  { setup: 'list 5 programming languages as a numbered list', items: ['python','javascript','typescript','java','rust'] },
  { setup: 'list 5 asian countries as a numbered list', items: ['japan','china','south korea','thailand','vietnam'] },
  { setup: 'list 5 chemical elements as a numbered list', items: ['hydrogen','helium','oxygen','nitrogen','carbon'] },
];
function buildFlr(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = FLR_SEEDS[i % FLR_SEEDS.length];
    const initials = s.items.map(it => it[0].toUpperCase());
    out.push({ id: `flr-${i}`, bundle: 'firstLetters', turns: [
      { user: s.setup, check: (a) => isFallback(a)||isClarify(a) ? 't1: bailed' : (numberedCount(a)<4 ? 't1: not numbered' : null) },
      { user: 'list just the first letter of each', check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          // All initials must appear (uppercase or lowercase) and the original full names should NOT appear (must be initials only).
          const la = lower(a);
          for (const ini of initials) {
            // Each initial appears as a standalone letter (with non-letter on either side) somewhere in the response.
            if (!new RegExp(`(^|[^a-z])${ini.toLowerCase()}(?:[^a-z]|$)`, 'i').test(la)) return `t2: missing initial ${ini}`;
          }
          // None of the full original names should still appear (otherwise just regurgitating the list).
          let fullCount = 0;
          for (const it of s.items) {
            if (new RegExp(`\\b${it}\\b`, 'i').test(la)) fullCount++;
          }
          if (fullCount >= 3) return 't2: still listing full names';
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
    ...buildNf(rand, n),
    ...buildIdx(rand, n),
    ...buildLq(rand, n),
    ...buildFl(rand, n),
    ...buildFlr(rand, n),
  ];
  const cases = bundle ? allCases.filter(c => c.bundle === bundle) : allCases;

  const stats: Record<BundleId, { pass: number; fail: number }> = {
    negFilter: { pass: 0, fail: 0 },
    indexLookup: { pass: 0, fail: 0 },
    lengthQuery: { pass: 0, fail: 0 },
    firstLastN: { pass: 0, fail: 0 },
    firstLetters: { pass: 0, fail: 0 },
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
  console.log('\n=== INTENT/FORMAT/MEANING BENCH v13 ===');
  let totalPass = 0, totalFail = 0;
  for (const b of ['negFilter','indexLookup','lengthQuery','firstLastN','firstLetters'] as const) {
    const s = stats[b]; const tot = s.pass + s.fail;
    if (tot === 0) continue;
    const pct = tot ? (s.pass / tot * 100).toFixed(2) : '0.00';
    console.log(`  ${b.padEnd(16)} ${s.pass}/${tot} (${pct}%)`);
    totalPass += s.pass; totalFail += s.fail;
  }
  const total = totalPass + totalFail;
  const pct = total ? (totalPass / total * 100).toFixed(2) : '0.00';
  console.log(`  OVERALL          ${totalPass}/${total} (${pct}%)`);
  if (report) {
    await fs.writeFile(path.resolve(report), JSON.stringify({ seed, n, stats, failures }, null, 2));
    console.log(`\n  report -> ${report}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
