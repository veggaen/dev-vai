// intent-format-meaning-v11.mts
// Harder follow-up arithmetic on lists:
//   1. insertItem      — list 4, then "add X as the 3rd one"
//   2. filterByLetter  — list 5, then "only keep ones starting with M"
//   3. sortAlpha       — list 5, then "sort them alphabetically"
//   4. countItems      — list N, then "how many were there?"
//   5. multiOpChain    — 6-turn: list → remove → sort → reverse → add → count
//
// Standard contract: in-process VaiEngine, fetch disabled, mulberry32 PRNG,
// fresh engine per case, --n / --seed / --report / --bundle flags.

import fs from 'node:fs/promises';
import path from 'node:path';
import { VaiEngine } from '../src/models/vai-engine.js';
import type { Message } from '../src/types/index.js';

(globalThis as any).fetch = async () => { throw new TypeError('fetch disabled'); };

type BundleId = 'insertItem' | 'filterByLetter' | 'sortAlpha' | 'countItems' | 'multiOpChain';

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
function bulletCount(a: string): number {
  return (a.match(/^[ \t]*[-*]\s+\S/gm) || []).length;
}
function numberedCount(a: string): number {
  return (a.match(/^[ \t]*\d+[.)]\s+\S/gm) || []).length;
}

// ---------------------------------------------------------------------------
// BUNDLE 1 — INSERT ITEM
// ---------------------------------------------------------------------------
interface InsSeed { setup: string; insertItem: string; pos: number; baseItems: string[]; }
const INS_SEEDS: InsSeed[] = [
  { setup: 'list 4 planets as a numbered list', insertItem: 'Saturn', pos: 3, baseItems: ['mercury','venus','earth','mars'] },
  { setup: 'list 4 european capitals as a numbered list', insertItem: 'Lisbon', pos: 2, baseItems: ['paris','berlin','rome','madrid'] },
  { setup: 'list 4 programming languages as a numbered list', insertItem: 'Rust', pos: 4, baseItems: ['python','javascript','typescript','java'] },
  { setup: 'list 4 asian countries as a numbered list', insertItem: 'Vietnam', pos: 1, baseItems: ['japan','china','south korea','thailand'] },
  { setup: 'list 4 chemical elements as a numbered list', insertItem: 'Carbon', pos: 5, baseItems: ['hydrogen','helium','oxygen','nitrogen'] },
];
function ord(n: number): string { return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`; }
function buildIns(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = INS_SEEDS[i % INS_SEEDS.length];
    out.push({ id: `ins-${i}`, bundle: 'insertItem', turns: [
      { user: s.setup, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          if (numberedCount(a) < 3) return 't1: not numbered';
          return null;
        }},
      { user: `add ${s.insertItem} as the ${ord(s.pos)} one`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          const la = lower(a);
          if (!la.includes(lower(s.insertItem))) return `t2: missing ${s.insertItem}`;
          for (const k of s.baseItems) if (!la.includes(k)) return `t2: missing base ${k}`;
          // Must be 5 numbered items now.
          if (numberedCount(a) < 4) return 't2: not numbered list';
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 2 — FILTER BY LETTER
// ---------------------------------------------------------------------------
interface FilSeed { setup: string; letter: string; kept: string[]; dropped: string[]; }
const FIL_SEEDS: FilSeed[] = [
  // planets starting with M: Mercury, Mars  (from Mercury,Venus,Earth,Mars,Jupiter)
  { setup: 'list 5 planets as a numbered list', letter: 'M', kept: ['mercury','mars'], dropped: ['venus','earth','jupiter'] },
  // european capitals starting with B: Berlin (from Paris,Berlin,Rome,Madrid,Lisbon)
  { setup: 'list 5 european capitals as a numbered list', letter: 'B', kept: ['berlin'], dropped: ['paris','rome','madrid','lisbon'] },
  // programming langs starting with J: JavaScript, Java (Python,JavaScript,TypeScript,Java,Rust)
  { setup: 'list 5 programming languages as a numbered list', letter: 'J', kept: ['javascript','java'], dropped: ['python','typescript','rust'] },
  // asian countries starting with C: China (Japan,China,South Korea,Thailand,Vietnam)
  { setup: 'list 5 asian countries as a numbered list', letter: 'C', kept: ['china'], dropped: ['japan','south korea','thailand','vietnam'] },
  // chemical elements starting with H: Hydrogen, Helium (Hydrogen,Helium,Oxygen,Nitrogen,Carbon)
  { setup: 'list 5 chemical elements as a numbered list', letter: 'H', kept: ['hydrogen','helium'], dropped: ['oxygen','nitrogen','carbon'] },
];
function buildFil(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = FIL_SEEDS[i % FIL_SEEDS.length];
    out.push({ id: `fil-${i}`, bundle: 'filterByLetter', turns: [
      { user: s.setup, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          if (numberedCount(a) < 4) return 't1: not numbered';
          return null;
        }},
      { user: `only keep the ones starting with ${s.letter}`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          const la = lower(a);
          for (const k of s.kept) if (!la.includes(k)) return `t2: missing kept ${k}`;
          for (const d of s.dropped) if (la.includes(d)) return `t2: still contains dropped ${d}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 3 — SORT ALPHABETICALLY
// ---------------------------------------------------------------------------
interface SortSeed { setup: string; sortedOrder: string[]; }
const SORT_SEEDS: SortSeed[] = [
  // planets sorted: Earth, Jupiter, Mars, Mercury, Venus
  { setup: 'list 5 planets as a numbered list', sortedOrder: ['earth','jupiter','mars','mercury','venus'] },
  // european capitals sorted: Berlin, Lisbon, Madrid, Paris, Rome
  { setup: 'list 5 european capitals as a numbered list', sortedOrder: ['berlin','lisbon','madrid','paris','rome'] },
  // programming langs sorted: Java, JavaScript, Python, Rust, TypeScript
  { setup: 'list 5 programming languages as a numbered list', sortedOrder: ['java','javascript','python','rust','typescript'] },
  // asian countries sorted: China, Japan, South Korea, Thailand, Vietnam
  { setup: 'list 5 asian countries as a numbered list', sortedOrder: ['china','japan','south korea','thailand','vietnam'] },
  // chemical elements sorted: Carbon, Helium, Hydrogen, Nitrogen, Oxygen
  { setup: 'list 5 chemical elements as a numbered list', sortedOrder: ['carbon','helium','hydrogen','nitrogen','oxygen'] },
];
function buildSort(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = SORT_SEEDS[i % SORT_SEEDS.length];
    out.push({ id: `sort-${i}`, bundle: 'sortAlpha', turns: [
      { user: s.setup, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          if (numberedCount(a) < 4) return 't1: not numbered';
          return null;
        }},
      { user: 'sort them alphabetically', check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          const la = lower(a);
          for (const k of s.sortedOrder) if (!la.includes(k)) return `t2: missing ${k}`;
          // Must appear in sorted order in the text.
          let lastIdx = -1;
          for (const k of s.sortedOrder) {
            const idx = la.indexOf(k, lastIdx + 1);
            if (idx <= lastIdx) return `t2: out of order at ${k}`;
            lastIdx = idx;
          }
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 4 — COUNT ITEMS
// ---------------------------------------------------------------------------
interface CntSeed { setup: string; expected: number; }
const CNT_SEEDS: CntSeed[] = [
  { setup: 'list 3 planets as a numbered list', expected: 3 },
  { setup: 'list 4 european capitals as a numbered list', expected: 4 },
  { setup: 'list 5 programming languages as a numbered list', expected: 5 },
  { setup: 'list 6 asian countries as a numbered list', expected: 6 },
  { setup: 'list 4 chemical elements as a numbered list', expected: 4 },
];
function buildCnt(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = CNT_SEEDS[i % CNT_SEEDS.length];
    out.push({ id: `cnt-${i}`, bundle: 'countItems', turns: [
      { user: s.setup, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          if (numberedCount(a) < Math.min(3, s.expected)) return 't1: not numbered';
          return null;
        }},
      { user: 'how many were there?', check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          // Find number tokens (digits or words). Accept "There were 5" / "5 items" / just "5".
          const wordMap: Record<string, number> = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10 };
          const la = lower(a);
          // Match the expected count anywhere.
          const digitMatch = new RegExp(`\\b${s.expected}\\b`).test(a);
          let wordMatch = false;
          for (const [w, v] of Object.entries(wordMap)) {
            if (v === s.expected && new RegExp(`\\b${w}\\b`, 'i').test(la)) { wordMatch = true; break; }
          }
          if (!digitMatch && !wordMatch) return `t2: count ${s.expected} not stated`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 5 — MULTI-OP CHAIN (6 turns)
// ---------------------------------------------------------------------------
interface McSeed { setup: string; baseItems: string[]; removeOrd: 'first'|'second'|'third'|'fourth'|'fifth'; addItem: string; }
const MC_SEEDS: McSeed[] = [
  { setup: 'list 4 planets as a numbered list', baseItems: ['mercury','venus','earth','mars'], removeOrd: 'second', addItem: 'Saturn' },
  { setup: 'list 4 european capitals as a numbered list', baseItems: ['paris','berlin','rome','madrid'], removeOrd: 'third', addItem: 'Lisbon' },
  { setup: 'list 4 programming languages as a numbered list', baseItems: ['python','javascript','typescript','java'], removeOrd: 'first', addItem: 'Rust' },
];
function buildMc(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = MC_SEEDS[i % MC_SEEDS.length];
    const removedIdx = ({first:0,second:1,third:2,fourth:3,fifth:4})[s.removeOrd];
    const removed = s.baseItems[removedIdx];
    const afterRemove = s.baseItems.filter((_, i) => i !== removedIdx);
    out.push({ id: `mc-${i}`, bundle: 'multiOpChain', turns: [
      { user: s.setup, check: (a) => isFallback(a)||isClarify(a) ? 't1: bailed' : (numberedCount(a)<3 ? 't1: not numbered' : null) },
      { user: `remove the ${s.removeOrd} one`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          if (lower(a).includes(removed)) return `t2: still contains ${removed}`;
          for (const k of afterRemove) if (!lower(a).includes(k)) return `t2: missing ${k}`;
          return null;
        }},
      { user: 'sort them alphabetically', check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't3: bailed';
          const la = lower(a);
          for (const k of afterRemove) if (!la.includes(k)) return `t3: missing ${k}`;
          const sorted = [...afterRemove].sort();
          let li = -1;
          for (const k of sorted) {
            const idx = la.indexOf(k, li + 1);
            if (idx <= li) return `t3: out of order at ${k}`;
            li = idx;
          }
          return null;
        }},
      { user: 'now reverse the order', check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't4: bailed';
          const la = lower(a);
          const sorted = [...afterRemove].sort().reverse();
          let li = -1;
          for (const k of sorted) {
            const idx = la.indexOf(k, li + 1);
            if (idx <= li) return `t4: out of reverse order at ${k}`;
            li = idx;
          }
          return null;
        }},
      { user: `add ${s.addItem} as the 1st one`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't5: bailed';
          if (!lower(a).includes(lower(s.addItem))) return `t5: missing ${s.addItem}`;
          for (const k of afterRemove) if (!lower(a).includes(k)) return `t5: missing ${k}`;
          return null;
        }},
      { user: 'how many were there?', check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't6: bailed';
          // After remove (3) + add (1) = 4.
          if (!/\b4\b|\bfour\b/i.test(a)) return 't6: count 4 not stated';
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
    ...buildIns(rand, n),
    ...buildFil(rand, n),
    ...buildSort(rand, n),
    ...buildCnt(rand, n),
    ...buildMc(rand, n),
  ];
  const cases = bundle ? allCases.filter(c => c.bundle === bundle) : allCases;

  const stats: Record<BundleId, { pass: number; fail: number }> = {
    insertItem: { pass: 0, fail: 0 },
    filterByLetter: { pass: 0, fail: 0 },
    sortAlpha: { pass: 0, fail: 0 },
    countItems: { pass: 0, fail: 0 },
    multiOpChain: { pass: 0, fail: 0 },
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
  console.log('\n=== INTENT/FORMAT/MEANING BENCH v11 ===');
  let totalPass = 0, totalFail = 0;
  for (const b of ['insertItem','filterByLetter','sortAlpha','countItems','multiOpChain'] as const) {
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
