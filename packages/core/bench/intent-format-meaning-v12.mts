// intent-format-meaning-v12.mts
// Even harder follow-up arithmetic on lists:
//   1. replaceItem      — list 4, then "replace the 2nd with X"
//   2. duplicateItem    — list 4, then "duplicate the 1st one"
//   3. mergeLists       — list 3 A; list 3 B; "combine the two lists"
//   4. filterByLength   — list 5, then "keep only ones longer than 5 letters"
//   5. rangeRecall      — list 6, then "show items 2-4"
//
// Standard contract: in-process VaiEngine, fetch disabled, mulberry32 PRNG,
// fresh engine per case, --n / --seed / --report / --bundle flags.

import fs from 'node:fs/promises';
import path from 'node:path';
import { VaiEngine } from '../src/models/vai-engine.js';
import type { Message } from '../src/types/index.js';

(globalThis as any).fetch = async () => { throw new TypeError('fetch disabled'); };

type BundleId = 'replaceItem' | 'duplicateItem' | 'mergeLists' | 'filterByLength' | 'rangeRecall';

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
// BUNDLE 1 — REPLACE ITEM
// ---------------------------------------------------------------------------
interface RepSeed { setup: string; pos: number; newItem: string; replaced: string; keep: string[]; }
const REP_SEEDS: RepSeed[] = [
  { setup: 'list 4 planets as a numbered list', pos: 2, newItem: 'Saturn', replaced: 'venus', keep: ['mercury','earth','mars'] },
  { setup: 'list 4 european capitals as a numbered list', pos: 3, newItem: 'Lisbon', replaced: 'rome', keep: ['paris','berlin','madrid'] },
  { setup: 'list 4 programming languages as a numbered list', pos: 1, newItem: 'Rust', replaced: 'python', keep: ['javascript','typescript','java'] },
  { setup: 'list 4 asian countries as a numbered list', pos: 4, newItem: 'Vietnam', replaced: 'thailand', keep: ['japan','china','south korea'] },
  { setup: 'list 4 chemical elements as a numbered list', pos: 2, newItem: 'Carbon', replaced: 'helium', keep: ['hydrogen','oxygen','nitrogen'] },
];
function ord(n: number): string { return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`; }
function buildRep(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = REP_SEEDS[i % REP_SEEDS.length];
    out.push({ id: `rep-${i}`, bundle: 'replaceItem', turns: [
      { user: s.setup, check: (a) => isFallback(a)||isClarify(a) ? 't1: bailed' : (numberedCount(a)<3 ? 't1: not numbered' : null) },
      { user: `replace the ${ord(s.pos)} one with ${s.newItem}`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          const la = lower(a);
          if (!la.includes(lower(s.newItem))) return `t2: missing new ${s.newItem}`;
          if (la.includes(s.replaced)) return `t2: still contains replaced ${s.replaced}`;
          for (const k of s.keep) if (!la.includes(k)) return `t2: missing kept ${k}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 2 — DUPLICATE ITEM
// ---------------------------------------------------------------------------
interface DupSeed { setup: string; pos: number; targetItem: string; baseItems: string[]; }
const DUP_SEEDS: DupSeed[] = [
  { setup: 'list 4 planets as a numbered list', pos: 1, targetItem: 'mercury', baseItems: ['mercury','venus','earth','mars'] },
  { setup: 'list 4 european capitals as a numbered list', pos: 2, targetItem: 'berlin', baseItems: ['paris','berlin','rome','madrid'] },
  { setup: 'list 4 programming languages as a numbered list', pos: 3, targetItem: 'typescript', baseItems: ['python','javascript','typescript','java'] },
  { setup: 'list 4 asian countries as a numbered list', pos: 4, targetItem: 'thailand', baseItems: ['japan','china','south korea','thailand'] },
  { setup: 'list 4 chemical elements as a numbered list', pos: 1, targetItem: 'hydrogen', baseItems: ['hydrogen','helium','oxygen','nitrogen'] },
];
function buildDup(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = DUP_SEEDS[i % DUP_SEEDS.length];
    out.push({ id: `dup-${i}`, bundle: 'duplicateItem', turns: [
      { user: s.setup, check: (a) => isFallback(a)||isClarify(a) ? 't1: bailed' : (numberedCount(a)<3 ? 't1: not numbered' : null) },
      { user: `duplicate the ${ord(s.pos)} one`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          const la = lower(a);
          // All originals still present.
          for (const k of s.baseItems) if (!la.includes(k)) return `t2: missing ${k}`;
          // Target item appears at least twice (in list form).
          const occurrences = (la.match(new RegExp(`\\b${s.targetItem}\\b`, 'g')) || []).length;
          if (occurrences < 2) return `t2: ${s.targetItem} not duplicated`;
          // Now 5 items expected.
          if (numberedCount(a) < 4) return 't2: not numbered list';
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 3 — MERGE TWO LISTS
// ---------------------------------------------------------------------------
interface MergeSeed { setupA: string; itemsA: string[]; setupB: string; itemsB: string[]; }
const MERGE_SEEDS: MergeSeed[] = [
  { setupA: 'list 3 planets as a numbered list', itemsA: ['mercury','venus','earth'],
    setupB: 'list 3 asian countries as a numbered list', itemsB: ['japan','china','south korea'] },
  { setupA: 'list 3 european capitals as a numbered list', itemsA: ['paris','berlin','rome'],
    setupB: 'list 3 chemical elements as a numbered list', itemsB: ['hydrogen','helium','oxygen'] },
  { setupA: 'list 3 programming languages as a numbered list', itemsA: ['python','javascript','typescript'],
    setupB: 'list 3 planets as a numbered list', itemsB: ['mercury','venus','earth'] },
];
function buildMerge(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = MERGE_SEEDS[i % MERGE_SEEDS.length];
    out.push({ id: `mrg-${i}`, bundle: 'mergeLists', turns: [
      { user: s.setupA, check: (a) => isFallback(a)||isClarify(a) ? 't1: bailed' : (numberedCount(a)<2 ? 't1: not numbered' : null) },
      { user: s.setupB, check: (a) => isFallback(a)||isClarify(a) ? 't2: bailed' : (numberedCount(a)<2 ? 't2: not numbered' : null) },
      { user: 'combine those two lists into one', check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't3: bailed';
          const la = lower(a);
          for (const k of s.itemsA) if (!la.includes(k)) return `t3: missing A item ${k}`;
          for (const k of s.itemsB) if (!la.includes(k)) return `t3: missing B item ${k}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 4 — FILTER BY LENGTH
// ---------------------------------------------------------------------------
// Keep only items with length > 5 (case sensitive on the rendered name).
// planets 5: Mercury(7) Venus(5) Earth(5) Mars(4) Jupiter(7) → keep Mercury, Jupiter; drop Venus, Earth, Mars.
// euro caps 5: Paris(5) Berlin(6) Rome(4) Madrid(6) Lisbon(6) → keep Berlin, Madrid, Lisbon; drop Paris, Rome.
// langs 5: Python(6) JavaScript(10) TypeScript(10) Java(4) Rust(4) → keep Python, JavaScript, TypeScript; drop Java, Rust.
// asian 5 (case len; "South Korea" → 11 with space, treat without space => SouthKorea=10): Japan(5) China(5) "South Korea"(11) Thailand(8) Vietnam(7) → keep South Korea, Thailand, Vietnam; drop Japan, China.
// elements 5: Hydrogen(8) Helium(6) Oxygen(6) Nitrogen(8) Carbon(6) → keep all (all >5). Pick threshold 6 → keep Hydrogen, Nitrogen; drop Helium, Oxygen, Carbon.
interface FlenSeed { setup: string; threshold: number; kept: string[]; dropped: string[]; }
const FLEN_SEEDS: FlenSeed[] = [
  { setup: 'list 5 planets as a numbered list', threshold: 5, kept: ['mercury','jupiter'], dropped: ['venus','earth','mars'] },
  { setup: 'list 5 european capitals as a numbered list', threshold: 5, kept: ['berlin','madrid','lisbon'], dropped: ['paris','rome'] },
  { setup: 'list 5 programming languages as a numbered list', threshold: 5, kept: ['python','javascript','typescript'], dropped: ['java','rust'] },
  { setup: 'list 5 asian countries as a numbered list', threshold: 6, kept: ['south korea','thailand','vietnam'], dropped: ['japan','china'] },
  { setup: 'list 5 chemical elements as a numbered list', threshold: 6, kept: ['hydrogen','nitrogen'], dropped: ['helium','oxygen','carbon'] },
];
function buildFlen(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = FLEN_SEEDS[i % FLEN_SEEDS.length];
    out.push({ id: `flen-${i}`, bundle: 'filterByLength', turns: [
      { user: s.setup, check: (a) => isFallback(a)||isClarify(a) ? 't1: bailed' : (numberedCount(a)<4 ? 't1: not numbered' : null) },
      { user: `keep only the ones longer than ${s.threshold} letters`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          const la = lower(a);
          for (const k of s.kept) if (!la.includes(k)) return `t2: missing kept ${k}`;
          for (const d of s.dropped) {
            // Word-boundary check so "rome" doesn't false-positive in "romeo".
            if (new RegExp(`\\b${d}\\b`).test(la)) return `t2: still contains dropped ${d}`;
          }
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 5 — RANGE RECALL
// ---------------------------------------------------------------------------
interface RngSeed { setup: string; items: string[]; from: number; to: number; }
// list 6 items, then "show items 2-4" → items at index 1..3 (1-based 2..4).
const RNG_SEEDS: RngSeed[] = [
  // need a 6-item bench; engine may cap at 5 — pick 5 with range 2-4
  { setup: 'list 5 planets as a numbered list', items: ['mercury','venus','earth','mars','jupiter'], from: 2, to: 4 },
  { setup: 'list 5 european capitals as a numbered list', items: ['paris','berlin','rome','madrid','lisbon'], from: 2, to: 4 },
  { setup: 'list 5 programming languages as a numbered list', items: ['python','javascript','typescript','java','rust'], from: 1, to: 3 },
  { setup: 'list 5 asian countries as a numbered list', items: ['japan','china','south korea','thailand','vietnam'], from: 3, to: 5 },
  { setup: 'list 5 chemical elements as a numbered list', items: ['hydrogen','helium','oxygen','nitrogen','carbon'], from: 2, to: 4 },
];
function buildRng(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = RNG_SEEDS[i % RNG_SEEDS.length];
    const kept = s.items.slice(s.from - 1, s.to);
    const dropped = s.items.filter((_, i) => i + 1 < s.from || i + 1 > s.to);
    out.push({ id: `rng-${i}`, bundle: 'rangeRecall', turns: [
      { user: s.setup, check: (a) => isFallback(a)||isClarify(a) ? 't1: bailed' : (numberedCount(a)<4 ? 't1: not numbered' : null) },
      { user: `show items ${s.from}-${s.to}`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          const la = lower(a);
          for (const k of kept) if (!la.includes(k)) return `t2: missing kept ${k}`;
          for (const d of dropped) {
            if (new RegExp(`\\b${d}\\b`).test(la)) return `t2: still contains dropped ${d}`;
          }
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
    ...buildRep(rand, n),
    ...buildDup(rand, n),
    ...buildMerge(rand, n),
    ...buildFlen(rand, n),
    ...buildRng(rand, n),
  ];
  const cases = bundle ? allCases.filter(c => c.bundle === bundle) : allCases;

  const stats: Record<BundleId, { pass: number; fail: number }> = {
    replaceItem: { pass: 0, fail: 0 },
    duplicateItem: { pass: 0, fail: 0 },
    mergeLists: { pass: 0, fail: 0 },
    filterByLength: { pass: 0, fail: 0 },
    rangeRecall: { pass: 0, fail: 0 },
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
  console.log('\n=== INTENT/FORMAT/MEANING BENCH v12 ===');
  let totalPass = 0, totalFail = 0;
  for (const b of ['replaceItem','duplicateItem','mergeLists','filterByLength','rangeRecall'] as const) {
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
