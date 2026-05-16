// intent-format-meaning-v16.mts
//   1. partitionByLetter — list 5 words, "split into vowel-start vs consonant-start"
//   2. interleaveLists   — 2 lists, "interleave them"
//   3. timeMath          — "what time is 3 hours after 11am?"
//   4. percentOf         — "what's 25% of 80?"
//   5. unitConvert       — "convert 5 km to miles" / "10 miles in km"

import fs from 'node:fs/promises';
import path from 'node:path';
import { VaiEngine } from '../src/models/vai-engine.js';
import type { Message } from '../src/types/index.js';

(globalThis as any).fetch = async () => { throw new TypeError('fetch disabled'); };

type BundleId = 'partitionByLetter' | 'interleaveLists' | 'timeMath' | 'percentOf' | 'unitConvert';

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
function numberedCount(a: string): number { return (a.match(/^[ \t]*\d+[.)]\s+\S/gm) || []).length; }
function makePrimedList(items: string[]): string {
  const numberedList = items.map((it, j) => `${j + 1}. ${it}`).join('\n');
  return `here's a list:\n${numberedList}\n\nplease echo this list back as a numbered list`;
}

// ---------------------------------------------------------------------------
// 1. PARTITION BY LETTER — vowel-start vs consonant-start
// ---------------------------------------------------------------------------
const PART_LISTS: string[][] = [
  ['Apple','Banana','Orange','Cherry','Eggplant'],
  ['India','Brazil','Egypt','China','Australia'],
  ['Iron','Copper','Aluminum','Zinc','Oxygen'],
  ['Owl','Cat','Eagle','Dog','Iguana'],
  ['Earth','Mars','Uranus','Saturn','Neptune'],
];
const VOWELS = new Set(['a','e','i','o','u']);
function buildPart(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const items = PART_LISTS[i % PART_LISTS.length];
    const vowelItems = items.filter(it => VOWELS.has(it[0].toLowerCase()));
    const consItems = items.filter(it => !VOWELS.has(it[0].toLowerCase()));
    out.push({ id: `part-${i}`, bundle: 'partitionByLetter', turns: [
      { user: makePrimedList(items), check: (a) => isFallback(a)||isClarify(a) ? 't1: bailed' : (numberedCount(a)<3 ? 't1: not numbered' : null) },
      { user: 'split into ones starting with a vowel and ones starting with a consonant', check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          const la = lower(a);
          // Both groups must be present.
          if (!/vowel/.test(la)) return 't2: no vowel label';
          if (!/consonant/.test(la)) return 't2: no consonant label';
          // Each vowel item must be on the vowel side, each cons item on cons side.
          const vIdx = la.indexOf('vowel');
          const cIdx = la.indexOf('consonant');
          if (vIdx < 0 || cIdx < 0) return 't2: labels missing';
          // Heuristic: chunk = text after each label until the other label.
          const [first, second] = vIdx < cIdx ? ['vowel','consonant'] : ['consonant','vowel'];
          const fStart = la.indexOf(first), sStart = la.indexOf(second);
          const fSeg = la.slice(fStart, sStart);
          const sSeg = la.slice(sStart);
          const vSeg = first === 'vowel' ? fSeg : sSeg;
          const cSeg = first === 'consonant' ? fSeg : sSeg;
          for (const it of vowelItems) if (!vSeg.includes(lower(it))) return `t2: ${it} not in vowel group`;
          for (const it of consItems) if (!cSeg.includes(lower(it))) return `t2: ${it} not in consonant group`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. INTERLEAVE LISTS — two lists primed, then "interleave them"
// ---------------------------------------------------------------------------
const INTER_PAIRS: { a: string[]; b: string[] }[] = [
  { a: ['Apple','Banana','Cherry'], b: ['One','Two','Three'] },
  { a: ['Red','Green','Blue'], b: ['Cat','Dog','Bird'] },
  { a: ['Mercury','Venus','Earth'], b: ['Sun','Moon','Star'] },
  { a: ['Python','Rust','Go'], b: ['Vim','Emacs','Nano'] },
  { a: ['North','South','East'], b: ['Up','Down','Left'] },
];
function buildInter(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const p = INTER_PAIRS[i % INTER_PAIRS.length];
    const expected: string[] = [];
    for (let j = 0; j < Math.max(p.a.length, p.b.length); j++) {
      if (j < p.a.length) expected.push(p.a[j]);
      if (j < p.b.length) expected.push(p.b[j]);
    }
    out.push({ id: `inter-${i}`, bundle: 'interleaveLists', turns: [
      { user: makePrimedList(p.a), check: (a) => isFallback(a)||isClarify(a) ? 't1: bailed' : (numberedCount(a)<3 ? 't1: not numbered' : null) },
      { user: makePrimedList(p.b), check: (a) => isFallback(a)||isClarify(a) ? 't2: bailed' : (numberedCount(a)<3 ? 't2: not numbered' : null) },
      { user: 'interleave the two lists', check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't3: bailed';
          const la = lower(a);
          let pos = -1;
          for (const it of expected) {
            const q = la.indexOf(lower(it), pos + 1);
            if (q < 0) return `t3: out-of-order ${it}`;
            pos = q;
          }
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. TIME MATH — "what time is 3 hours after 11am?"
// ---------------------------------------------------------------------------
interface TmSeed { hr: number; ampm: 'am'|'pm'; addH: number; expHr: number; expAmpm: 'am'|'pm'; }
const TM_SEEDS: TmSeed[] = [
  { hr: 11, ampm: 'am', addH: 3, expHr: 2,  expAmpm: 'pm' },
  { hr: 9,  ampm: 'am', addH: 5, expHr: 2,  expAmpm: 'pm' },
  { hr: 1,  ampm: 'pm', addH: 4, expHr: 5,  expAmpm: 'pm' },
  { hr: 10, ampm: 'pm', addH: 5, expHr: 3,  expAmpm: 'am' },
  { hr: 7,  ampm: 'am', addH: 2, expHr: 9,  expAmpm: 'am' },
  { hr: 8,  ampm: 'pm', addH: 6, expHr: 2,  expAmpm: 'am' },
];
function buildTm(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = TM_SEEDS[i % TM_SEEDS.length];
    out.push({ id: `tm-${i}`, bundle: 'timeMath', turns: [
      { user: `what time is ${s.addH} hours after ${s.hr}${s.ampm}?`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          const la = lower(a);
          // Must contain "<expHr>" near "<expAmpm>".
          const re = new RegExp(`\\b${s.expHr}(?::00)?\\s*${s.expAmpm}\\b`);
          if (!re.test(la)) return `t1: missing ${s.expHr}${s.expAmpm}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. PERCENT OF — "what's 25% of 80?"
// ---------------------------------------------------------------------------
interface PctSeed { pct: number; of: number; expected: number; }
const PCT_SEEDS: PctSeed[] = [
  { pct: 25, of: 80, expected: 20 },
  { pct: 10, of: 50, expected: 5 },
  { pct: 50, of: 200, expected: 100 },
  { pct: 75, of: 40, expected: 30 },
  { pct: 5,  of: 1000, expected: 50 },
  { pct: 20, of: 35, expected: 7 },
  { pct: 33, of: 99, expected: 32.67 }, // tolerance
];
function buildPct(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = PCT_SEEDS[i % PCT_SEEDS.length];
    out.push({ id: `pct-${i}`, bundle: 'percentOf', turns: [
      { user: `what's ${s.pct}% of ${s.of}?`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          // Find any number in answer; must equal expected within ±0.5.
          const nums = (a.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
          if (!nums.some(v => Math.abs(v - s.expected) <= 0.5)) return `t1: missing ${s.expected}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. UNIT CONVERT — "convert 5 km to miles" / "10 miles in km" / "100 cm in m"
// ---------------------------------------------------------------------------
interface UcSeed { prompt: string; expected: number; tol: number; }
const UC_SEEDS: UcSeed[] = [
  { prompt: 'convert 5 km to miles',   expected: 3.107, tol: 0.1 },
  { prompt: 'convert 10 miles to km',  expected: 16.09, tol: 0.2 },
  { prompt: 'convert 100 cm to meters', expected: 1, tol: 0.01 },
  { prompt: 'convert 2 meters to feet', expected: 6.56, tol: 0.1 },
  { prompt: 'convert 1 kg to pounds', expected: 2.205, tol: 0.05 },
  { prompt: 'convert 32 fahrenheit to celsius', expected: 0, tol: 0.1 },
  { prompt: 'convert 100 celsius to fahrenheit', expected: 212, tol: 0.1 },
  { prompt: 'convert 1 hour to minutes', expected: 60, tol: 0.1 },
  { prompt: 'convert 1 day to hours', expected: 24, tol: 0.1 },
  { prompt: 'convert 1 mile to feet', expected: 5280, tol: 1 },
];
function buildUc(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = UC_SEEDS[i % UC_SEEDS.length];
    out.push({ id: `uc-${i}`, bundle: 'unitConvert', turns: [
      { user: s.prompt, check: (a) => {
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
    ...buildPart(rand, n),
    ...buildInter(rand, n),
    ...buildTm(rand, n),
    ...buildPct(rand, n),
    ...buildUc(rand, n),
  ];
  const cases = bundle ? allCases.filter(c => c.bundle === bundle) : allCases;

  const stats: Record<BundleId, { pass: number; fail: number }> = {
    partitionByLetter: { pass: 0, fail: 0 },
    interleaveLists: { pass: 0, fail: 0 },
    timeMath: { pass: 0, fail: 0 },
    percentOf: { pass: 0, fail: 0 },
    unitConvert: { pass: 0, fail: 0 },
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
  console.log('\n=== INTENT/FORMAT/MEANING BENCH v16 ===');
  let totalPass = 0, totalFail = 0;
  for (const b of ['partitionByLetter','interleaveLists','timeMath','percentOf','unitConvert'] as const) {
    const s = stats[b]; const tot = s.pass + s.fail;
    if (tot === 0) continue;
    const pct = tot ? (s.pass / tot * 100).toFixed(2) : '0.00';
    console.log(`  ${b.padEnd(18)} ${s.pass}/${tot} (${pct}%)`);
    totalPass += s.pass; totalFail += s.fail;
  }
  const total = totalPass + totalFail;
  const pct = total ? (totalPass / total * 100).toFixed(2) : '0.00';
  console.log(`  OVERALL            ${totalPass}/${total} (${pct}%)`);
  if (report) {
    await fs.writeFile(path.resolve(report), JSON.stringify({ seed, n, stats, failures }, null, 2));
    console.log(`\n  report -> ${report}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
