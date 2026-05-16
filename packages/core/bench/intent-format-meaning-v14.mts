// intent-format-meaning-v14.mts
//   1. acronymBuild     — list 4, then "make an acronym from those"
//   2. wordCountQuery   — "how many words were in your last response?"
//   3. letterCount      — "how many letters are in 'hippopotamus'?"
//   4. definitionShort  — "define <word> in one sentence"
//   5. abbreviationExpand — "what does NASA stand for?"

import fs from 'node:fs/promises';
import path from 'node:path';
import { VaiEngine } from '../src/models/vai-engine.js';
import type { Message } from '../src/types/index.js';

(globalThis as any).fetch = async () => { throw new TypeError('fetch disabled'); };

type BundleId = 'acronymBuild' | 'wordCountQuery' | 'letterCount' | 'definitionShort' | 'abbrevExpand';

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
// 1. ACRONYM BUILD — first letters joined
// ---------------------------------------------------------------------------
interface AcSeed { setup: string; items: string[]; acronym: string; }
const AC_SEEDS: AcSeed[] = [
  { setup: 'list 4 planets as a numbered list', items: ['mercury','venus','earth','mars'], acronym: 'MVEM' },
  { setup: 'list 4 european capitals as a numbered list', items: ['paris','berlin','rome','madrid'], acronym: 'PBRM' },
  { setup: 'list 4 programming languages as a numbered list', items: ['python','javascript','typescript','java'], acronym: 'PJTJ' },
  { setup: 'list 4 asian countries as a numbered list', items: ['japan','china','south korea','thailand'], acronym: 'JCST' },
  { setup: 'list 4 chemical elements as a numbered list', items: ['hydrogen','helium','oxygen','nitrogen'], acronym: 'HHON' },
];
function buildAc(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = AC_SEEDS[i % AC_SEEDS.length];
    out.push({ id: `ac-${i}`, bundle: 'acronymBuild', turns: [
      { user: s.setup, check: (a) => isFallback(a)||isClarify(a) ? 't1: bailed' : (numberedCount(a)<3 ? 't1: not numbered' : null) },
      { user: 'make an acronym from those', check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          // Acronym must appear as a contiguous string (case-insensitive).
          if (!new RegExp(`\\b${s.acronym}\\b`, 'i').test(a)) return `t2: missing acronym ${s.acronym}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. WORD COUNT QUERY — "how many words were in your last response?"
// ---------------------------------------------------------------------------
// Trick: t1 produces a known short response, t2 asks for word count.
interface WcSeed { setup: string; expectedRange: [number, number]; }
const WC_SEEDS: WcSeed[] = [
  // "list 3 planets as a numbered list" — numbered output with bold names. Hard to predict exact.
  // Use a dedicated short prompt where engine response shape is well-defined.
  { setup: 'name three planets', expectedRange: [3, 50] },
  { setup: 'name three european capitals', expectedRange: [3, 50] },
  { setup: 'name three programming languages', expectedRange: [3, 50] },
];
function buildWc(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = WC_SEEDS[i % WC_SEEDS.length];
    out.push({ id: `wc-${i}`, bundle: 'wordCountQuery', turns: [
      { user: s.setup, check: (a) => isFallback(a)||isClarify(a) ? 't1: bailed' : null },
      { user: 'how many words were in your last response?', check: (a, hist) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          // Get the last assistant turn (just before this user) — that's hist[-3] now.
          const lastAssistant = hist[hist.length - 3];
          if (!lastAssistant || lastAssistant.role !== 'assistant') return 't2: no prior assistant';
          const actualWords = String(lastAssistant.content).split(/\s+/).filter(Boolean).length;
          // Engine's stated number must equal actualWords (with ±1 tolerance).
          const m = a.match(/\b(\d+)\b/);
          if (!m) return 't2: no number stated';
          const stated = parseInt(m[1], 10);
          if (Math.abs(stated - actualWords) > 1) return `t2: stated ${stated} vs actual ${actualWords}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. LETTER COUNT — "how many letters are in 'X'?"
// ---------------------------------------------------------------------------
interface LcSeed { word: string; }
const LC_SEEDS: LcSeed[] = [
  { word: 'hippopotamus' }, // 12
  { word: 'banana' }, // 6
  { word: 'algorithm' }, // 9
  { word: 'computer' }, // 8
  { word: 'understanding' }, // 13
];
function buildLc(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = LC_SEEDS[i % LC_SEEDS.length];
    const expected = s.word.length;
    out.push({ id: `lc-${i}`, bundle: 'letterCount', turns: [
      { user: `how many letters are in "${s.word}"?`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          if (!new RegExp(`\\b${expected}\\b`).test(a)) return `t1: count ${expected} not stated`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. DEFINITION SHORT — "define X in one sentence"
// ---------------------------------------------------------------------------
interface DfSeed { word: string; mustInclude: string[]; }
const DF_SEEDS: DfSeed[] = [
  { word: 'algorithm', mustInclude: ['step', 'instruct', 'procedure', 'rules', 'process'] }, // any one
  { word: 'database', mustInclude: ['data', 'store', 'collect'] },
  { word: 'compiler', mustInclude: ['source', 'code', 'translate', 'machine'] },
  { word: 'function', mustInclude: ['block', 'code', 'reusable', 'task', 'computation', 'input'] },
  { word: 'variable', mustInclude: ['value', 'store', 'memory', 'name'] },
];
function buildDf(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = DF_SEEDS[i % DF_SEEDS.length];
    out.push({ id: `df-${i}`, bundle: 'definitionShort', turns: [
      { user: `define "${s.word}" in one sentence`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          const la = lower(a);
          if (!la.includes(s.word)) return `t1: missing word ${s.word}`;
          if (!s.mustInclude.some(k => la.includes(k))) return `t1: no expected concept`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. ABBREVIATION EXPAND — "what does X stand for?"
// ---------------------------------------------------------------------------
interface AbSeed { abbr: string; mustInclude: string[]; }
const AB_SEEDS: AbSeed[] = [
  { abbr: 'NASA', mustInclude: ['national', 'aeronautics', 'space'] },
  { abbr: 'HTML', mustInclude: ['hypertext', 'markup', 'language'] },
  { abbr: 'CPU', mustInclude: ['central', 'processing', 'unit'] },
  { abbr: 'URL', mustInclude: ['uniform', 'resource', 'locator'] },
  { abbr: 'API', mustInclude: ['application', 'programming', 'interface'] },
  { abbr: 'DNA', mustInclude: ['deoxyribonucleic', 'acid'] },
];
function buildAb(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = AB_SEEDS[i % AB_SEEDS.length];
    out.push({ id: `ab-${i}`, bundle: 'abbrevExpand', turns: [
      { user: `what does ${s.abbr} stand for?`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          const la = lower(a);
          for (const k of s.mustInclude) if (!la.includes(k)) return `t1: missing ${k}`;
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
    ...buildAc(rand, n),
    ...buildWc(rand, n),
    ...buildLc(rand, n),
    ...buildDf(rand, n),
    ...buildAb(rand, n),
  ];
  const cases = bundle ? allCases.filter(c => c.bundle === bundle) : allCases;

  const stats: Record<BundleId, { pass: number; fail: number }> = {
    acronymBuild: { pass: 0, fail: 0 },
    wordCountQuery: { pass: 0, fail: 0 },
    letterCount: { pass: 0, fail: 0 },
    definitionShort: { pass: 0, fail: 0 },
    abbrevExpand: { pass: 0, fail: 0 },
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
  console.log('\n=== INTENT/FORMAT/MEANING BENCH v14 ===');
  let totalPass = 0, totalFail = 0;
  for (const b of ['acronymBuild','wordCountQuery','letterCount','definitionShort','abbrevExpand'] as const) {
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
