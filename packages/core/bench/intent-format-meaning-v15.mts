// intent-format-meaning-v15.mts
//   1. rotateList     — list 5 X, then "rotate left/right by N"
//   2. dedupe         — list with seeded duplicates, then "remove duplicates"
//   3. synonymRequest — "give me 3 synonyms for fast"
//   4. antonymRequest — "what's the opposite of hot?"
//   5. numberInWords  — "write 47 in words"

import fs from 'node:fs/promises';
import path from 'node:path';
import { VaiEngine } from '../src/models/vai-engine.js';
import type { Message } from '../src/types/index.js';

(globalThis as any).fetch = async () => { throw new TypeError('fetch disabled'); };

type BundleId = 'rotateList' | 'dedupe' | 'synonymRequest' | 'antonymRequest' | 'numberInWords';

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
function numberedCount(a: string): number {
  return (a.match(/^[ \t]*\d+[.)]\s+\S/gm) || []).length;
}
function bulletCount(a: string): number {
  return (a.match(/^[ \t]*[-*]\s+\S/gm) || []).length;
}

// ---------------------------------------------------------------------------
// 1. ROTATE LIST — "rotate left/right by N"
// ---------------------------------------------------------------------------
interface RotSeed { items: string[]; }
const ROT_SEEDS: RotSeed[] = [
  { items: ['Mercury','Venus','Earth','Mars','Jupiter'] },
  { items: ['Paris','Berlin','Rome','Madrid','Vienna'] },
  { items: ['Python','JavaScript','TypeScript','Rust','Go'] },
  { items: ['Apple','Banana','Cherry','Date','Elderberry'] },
  { items: ['Red','Orange','Yellow','Green','Blue'] },
];
function parseListItems(text: string): string[] {
  const out: string[] = [];
  for (const ln of text.split(/\r?\n/)) {
    const m = ln.match(/^\s*\d+[.)]\s+(.+?)\s*$/);
    if (m) out.push(m[1].replace(/^\*+|\*+$/g, '').replace(/\s+[—\-:].*$/, '').trim());
  }
  return out;
}
function buildRot(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = ROT_SEEDS[i % ROT_SEEDS.length];
    const dir: 'left' | 'right' = rand() < 0.5 ? 'left' : 'right';
    const k = 1 + Math.floor(rand() * 3); // 1..3
    const numberedList = s.items.map((it, j) => `${j + 1}. ${it}`).join('\n');
    const setup = `here's a list:\n${numberedList}\n\nplease echo this list back as a numbered list`;
    let actualItems: string[] = [];
    out.push({ id: `rot-${i}`, bundle: 'rotateList', turns: [
      { user: setup, check: (a) => {
          if (isFallback(a)||isClarify(a)) return 't1: bailed';
          if (numberedCount(a) < 3) return 't1: not numbered';
          actualItems = parseListItems(a);
          if (actualItems.length < 4) return `t1: parsed only ${actualItems.length} items`;
          return null;
        }},
      { user: `rotate ${dir} by ${k}`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          const len = actualItems.length;
          const off = ((k % len) + len) % len;
          const expected = dir === 'left'
            ? [...actualItems.slice(off), ...actualItems.slice(0, off)]
            : [...actualItems.slice(len - off), ...actualItems.slice(0, len - off)];
          const la = lower(a);
          let pos = -1;
          for (const it of expected) {
            const p = la.indexOf(lower(it), pos + 1);
            if (p < 0) return `t2: out-of-order ${it}`;
            pos = p;
          }
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. DEDUPE — list seeded with duplicates, then "remove duplicates"
// ---------------------------------------------------------------------------
interface DedupSeed { setup: string; uniques: string[]; }
const DEDUP_SEEDS: DedupSeed[] = [
  { setup: 'pick 3 fruits and repeat one of them so the list has 4 entries (numbered)', uniques: ['Apple','Banana','Cherry'] },
];
// We can't rely on the engine producing exact duplicates from a freeform "repeat" prompt.
// Instead, seed the duplicate list directly via a synthesized assistant turn — simulate by user typing a numbered list themselves (then engine answers, then we ask dedupe).
// Approach: user prompt #1 IS the list (no engine list construction needed) — we phrase it as "consider this list:".
const DEDUP_LISTS: { items: string[]; uniques: string[] }[] = [
  { items: ['Apple','Banana','Apple','Cherry'], uniques: ['Apple','Banana','Cherry'] },
  { items: ['Red','Blue','Red','Green','Blue'], uniques: ['Red','Blue','Green'] },
  { items: ['Python','Rust','Python','Go'], uniques: ['Python','Rust','Go'] },
  { items: ['Paris','Rome','Paris','Berlin','Rome'], uniques: ['Paris','Rome','Berlin'] },
  { items: ['cat','dog','cat','bird','dog'], uniques: ['cat','dog','bird'] },
];
function buildDedup(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = DEDUP_LISTS[i % DEDUP_LISTS.length];
    const numberedList = s.items.map((it, j) => `${j + 1}. ${it}`).join('\n');
    const setup = `here's a list:\n${numberedList}`;
    out.push({ id: `dedup-${i}`, bundle: 'dedupe', turns: [
      // Prime the assistant with a known list by sending it as user content; engine just acks.
      // To get an assistant list turn for extractPriorList(), we ask the engine to "echo this list":
      { user: `${setup}\n\nplease echo this list back as a numbered list`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          // Loose check: each unique item must appear, and total numbered lines >= 3.
          const la = lower(a);
          for (const u of s.items) if (!la.includes(lower(u))) return `t1: missing ${u}`;
          if (numberedCount(a) < 3 && bulletCount(a) < 3) return 't1: not list-shaped';
          return null;
        }},
      { user: 'remove duplicates', check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't2: bailed';
          const la = lower(a);
          // Must contain every unique item exactly once.
          for (const u of s.uniques) {
            const re = new RegExp(`\\b${u.toLowerCase()}\\b`, 'g');
            const cnt = (la.match(re) || []).length;
            if (cnt < 1) return `t2: missing ${u}`;
            if (cnt > 1) return `t2: duplicate of ${u} (count ${cnt})`;
          }
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. SYNONYM REQUEST — "give me 3 synonyms for fast"
// ---------------------------------------------------------------------------
interface SynSeed { word: string; pool: string[]; }
const SYN_SEEDS: SynSeed[] = [
  { word: 'fast', pool: ['quick','rapid','swift','speedy','brisk','hasty'] },
  { word: 'happy', pool: ['joyful','glad','content','cheerful','pleased','delighted'] },
  { word: 'big', pool: ['large','huge','enormous','massive','great','sizeable'] },
  { word: 'smart', pool: ['intelligent','clever','bright','sharp','wise','brilliant'] },
  { word: 'quiet', pool: ['silent','calm','still','peaceful','hushed','muted'] },
];
function buildSyn(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = SYN_SEEDS[i % SYN_SEEDS.length];
    out.push({ id: `syn-${i}`, bundle: 'synonymRequest', turns: [
      { user: `give me 3 synonyms for "${s.word}"`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          const la = lower(a);
          const hits = s.pool.filter(p => la.includes(p)).length;
          if (hits < 3) return `t1: only ${hits} valid synonyms found`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. ANTONYM REQUEST — "what's the opposite of hot?"
// ---------------------------------------------------------------------------
interface AntSeed { word: string; opposites: string[]; }
const ANT_SEEDS: AntSeed[] = [
  { word: 'hot', opposites: ['cold','cool','chilly'] },
  { word: 'big', opposites: ['small','tiny','little'] },
  { word: 'fast', opposites: ['slow','sluggish'] },
  { word: 'happy', opposites: ['sad','unhappy','miserable'] },
  { word: 'up', opposites: ['down'] },
  { word: 'light', opposites: ['dark','heavy'] }, // ambiguous but either is fine
  { word: 'open', opposites: ['closed','shut'] },
];
function buildAnt(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = ANT_SEEDS[i % ANT_SEEDS.length];
    out.push({ id: `ant-${i}`, bundle: 'antonymRequest', turns: [
      { user: `what's the opposite of "${s.word}"?`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          const la = lower(a);
          if (!s.opposites.some(o => la.includes(o))) return `t1: no expected antonym`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. NUMBER IN WORDS — "write 47 in words"
// ---------------------------------------------------------------------------
interface NumSeed { n: number; words: string; }
const NUM_SEEDS: NumSeed[] = [
  { n: 7,   words: 'seven' },
  { n: 12,  words: 'twelve' },
  { n: 21,  words: 'twenty-one' },
  { n: 47,  words: 'forty-seven' },
  { n: 99,  words: 'ninety-nine' },
  { n: 100, words: 'one hundred' },
  { n: 256, words: 'two hundred fifty-six' },
  { n: 500, words: 'five hundred' },
  { n: 1000, words: 'one thousand' },
  { n: 1234, words: 'one thousand two hundred thirty-four' },
];
function buildNum(_rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const s = NUM_SEEDS[i % NUM_SEEDS.length];
    out.push({ id: `num-${i}`, bundle: 'numberInWords', turns: [
      { user: `write ${s.n} in words`, check: (a) => {
          if (isFallback(a) || isClarify(a)) return 't1: bailed';
          const la = lower(a);
          // Accept either hyphenated or space-separated (forty-seven OR forty seven), and
          // accept "and" between hundred and tens (one hundred AND fifty-six).
          const want = s.words.toLowerCase();
          const variants = new Set<string>([
            want,
            want.replace(/-/g, ' '),
            want.replace(/-/g, ''),
            want.replace(/\b(hundred)\s+/g, '$1 and '),
            want.replace(/-/g, ' ').replace(/\b(hundred)\s+/g, '$1 and '),
          ]);
          if ([...variants].some(v => la.includes(v))) return null;
          return `t1: missing words form "${want}"`;
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
    ...buildRot(rand, n),
    ...buildDedup(rand, n),
    ...buildSyn(rand, n),
    ...buildAnt(rand, n),
    ...buildNum(rand, n),
  ];
  const cases = bundle ? allCases.filter(c => c.bundle === bundle) : allCases;

  const stats: Record<BundleId, { pass: number; fail: number }> = {
    rotateList: { pass: 0, fail: 0 },
    dedupe: { pass: 0, fail: 0 },
    synonymRequest: { pass: 0, fail: 0 },
    antonymRequest: { pass: 0, fail: 0 },
    numberInWords: { pass: 0, fail: 0 },
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
  console.log('\n=== INTENT/FORMAT/MEANING BENCH v15 ===');
  let totalPass = 0, totalFail = 0;
  for (const b of ['rotateList','dedupe','synonymRequest','antonymRequest','numberInWords'] as const) {
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
