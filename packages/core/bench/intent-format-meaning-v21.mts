// intent-format-meaning-v21.mts — HARD3: multi-step reasoning + format constraints

import fs from 'node:fs/promises';
import path from 'node:path';
import { VaiEngine } from '../src/models/vai-engine.js';
import type { Message } from '../src/types/index.js';

(globalThis as any).fetch = async () => { throw new TypeError('fetch disabled'); };

type BundleId = 'conditionalIfThen' | 'listFilterCompose' | 'arithmeticWord' | 'timeArithmetic' | 'baseConversion';
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
const pick = <T>(rand: () => number, arr: T[]): T => arr[Math.floor(rand() * arr.length)];
function lower(s: string): string { return (s || '').toLowerCase(); }
function isFallback(a: string): boolean {
  const l = lower(a);
  return /(\bisn['’]?t in my\b|don['’]?t yet hold|don'?t have it (locally|yet)|stay on|pivot fully|in my (?:local )?(?:knowledge|memory)|don['’]?t have a solid answer|i (?:don'?t|do not) know about\b)/i.test(l);
}
function isClarify(a: string): boolean {
  return /(could you clarify|what do you mean|which one did you mean|are you asking about)/i.test(a);
}
function shuffle<T>(rand: () => number, arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// 1. CONDITIONAL IF-THEN — "if N is even, say X, else say Y"
// ---------------------------------------------------------------------------
const CIT_WORDS = ['cat','dog','sun','moon','star','tree','bird','fish','rock','wave'];
function buildCit(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const kind = i % 4;
    const num = 1 + Math.floor(rand() * 99);
    const wA = pick(rand, CIT_WORDS), wB = pick(rand, CIT_WORDS.filter(w => w !== pick(rand, CIT_WORDS)));
    let prompt: string, expected: string;
    if (kind === 0) {
      expected = (num % 2 === 0) ? wA : wB;
      prompt = `if ${num} is even, say "${wA}", otherwise say "${wB}"`;
    } else if (kind === 1) {
      expected = (num > 50) ? wA : wB;
      prompt = `if ${num} is greater than 50, say "${wA}", else say "${wB}"`;
    } else if (kind === 2) {
      expected = (num % 2 === 1) ? wA : wB;
      prompt = `say "${wA}" if ${num} is odd, otherwise say "${wB}"`;
    } else {
      expected = (num < 25) ? wA : wB;
      prompt = `if ${num} is less than 25 then say "${wA}", else say "${wB}"`;
    }
    out.push({ id: `cit-${i}`, bundle: 'conditionalIfThen', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          if (!new RegExp(`\\b${expected}\\b`, 'i').test(resp)) return `t1: missing ${expected}`;
          // Must NOT say the other word as the primary answer
          const other = expected === wA ? wB : wA;
          if (wA !== wB && new RegExp(`^\\s*["']?${other}["']?\\s*$`, 'i').test(resp.trim())) return `t1: said ${other}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. LIST FILTER COMPOSE — "from [list], take items longer than N letters then sort them"
// ---------------------------------------------------------------------------
const LFC_POOL = ['apple','fig','pear','kiwi','grape','plum','peach','mango','date','lemon','lime','orange','banana','cherry','melon','quince','papaya','guava'];
function buildLfc(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const len = 6 + Math.floor(rand() * 4);
    const items = shuffle(rand, LFC_POOL).slice(0, len);
    const kind = i % 3;
    if (kind === 0) {
      // longer than N letters, then sort alphabetically
      const minLen = 3 + Math.floor(rand() * 3); // 3-5
      const filtered = items.filter(w => w.length > minLen).sort();
      const prompt = `from [${items.join(', ')}], take items longer than ${minLen} letters then sort them alphabetically`;
      out.push({ id: `lfc-${i}`, bundle: 'listFilterCompose', turns: [
        { user: prompt, check: (resp) => {
            if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
            for (const f of filtered) {
              if (!new RegExp(`\\b${f}\\b`, 'i').test(resp)) return `t1: missing ${f}`;
            }
            // Check ordering: positions of expected items should be ascending
            const positions = filtered.map(f => resp.toLowerCase().indexOf(f));
            for (let j = 1; j < positions.length; j++) {
              if (positions[j] < positions[j - 1]) return `t1: order wrong (${filtered.join(',')})`;
            }
            return null;
          }},
      ]});
    } else if (kind === 1) {
      // starting with letter X, count them
      const letter = items[0][0];
      const matching = items.filter(w => w[0].toLowerCase() === letter.toLowerCase());
      const expected = matching.length;
      const prompt = `from [${items.join(', ')}], how many items start with ${letter}?`;
      out.push({ id: `lfc-${i}`, bundle: 'listFilterCompose', turns: [
        { user: prompt, check: (resp) => {
            if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
            const nums = (resp.match(/\b\d+\b/g) || []).map(Number);
            if (!nums.includes(expected)) return `t1: missing ${expected}`;
            return null;
          }},
      ]});
    } else {
      // shortest item
      const sorted = items.slice().sort((a, b) => a.length - b.length);
      const shortest = sorted[0];
      const prompt = `from [${items.join(', ')}], what's the shortest item?`;
      out.push({ id: `lfc-${i}`, bundle: 'listFilterCompose', turns: [
        { user: prompt, check: (resp) => {
            if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
            if (!new RegExp(`\\b${shortest}\\b`, 'i').test(resp)) return `t1: missing ${shortest}`;
            return null;
          }},
      ]});
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. ARITHMETIC WORD — multi-step story problems
// ---------------------------------------------------------------------------
const AW_NAMES = ['Alice','Bob','Carol','Dave','Emma','Frank'];
const AW_ITEMS = ['apples','marbles','coins','stickers','cookies','pencils'];
function buildAw(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const name = pick(rand, AW_NAMES), other = pick(rand, AW_NAMES.filter(x => x !== name));
    const item = pick(rand, AW_ITEMS);
    const kind = i % 3;
    let prompt: string, expected: number;
    if (kind === 0) {
      const start = 5 + Math.floor(rand() * 20);
      const given = 1 + Math.floor(rand() * Math.min(5, start - 1));
      const bought = 1 + Math.floor(rand() * 10);
      expected = start - given + bought;
      prompt = `${name} has ${start} ${item}. ${name} gives ${given} to ${other}, then buys ${bought} more. how many ${item} does ${name} have now?`;
    } else if (kind === 1) {
      const per = 2 + Math.floor(rand() * 8);
      const boxes = 2 + Math.floor(rand() * 8);
      expected = per * boxes;
      prompt = `${name} has ${boxes} boxes with ${per} ${item} each. how many ${item} total?`;
    } else {
      const total = 12 + Math.floor(rand() * 30);
      const per = 2 + Math.floor(rand() * 4);
      const groups = Math.floor(total / per);
      expected = groups;
      prompt = `if ${name} splits ${total} ${item} into groups of ${per}, how many full groups?`;
    }
    out.push({ id: `aw-${i}`, bundle: 'arithmeticWord', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          const nums = (resp.match(/\b\d+\b/g) || []).map(Number);
          if (!nums.includes(expected)) return `t1: missing ${expected}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. TIME ARITHMETIC — clock math
// ---------------------------------------------------------------------------
function fmt12(totalMin: number): { hr: number; min: number; ampm: 'am' | 'pm' } {
  totalMin = ((totalMin % 1440) + 1440) % 1440;
  const hr24 = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  const ampm = hr24 < 12 ? 'am' : 'pm';
  let hr = hr24 % 12; if (hr === 0) hr = 12;
  return { hr, min, ampm };
}
function buildTa(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const kind = i % 3;
    if (kind === 0) {
      // "if it's now H:Mam/pm and I wait Xh Ym, what time is it?"
      const startMin = Math.floor(rand() * 1440);
      const waitMin = 15 + Math.floor(rand() * 240);
      const start = fmt12(startMin);
      const end = fmt12(startMin + waitMin);
      const wH = Math.floor(waitMin / 60), wM = waitMin % 60;
      const waitStr = wH === 0 ? `${wM} minutes` : (wM === 0 ? `${wH} hours` : `${wH}h${wM}m`);
      const startStr = `${start.hr}:${String(start.min).padStart(2,'0')}${start.ampm}`;
      const prompt = `if it's now ${startStr} and I wait ${waitStr}, what time is it?`;
      const expectedHr = end.hr, expectedMin = end.min, expectedAmpm = end.ampm;
      out.push({ id: `ta-${i}`, bundle: 'timeArithmetic', turns: [
        { user: prompt, check: (resp) => {
            if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
            // Look for HH:MM ampm with flexible separator
            const re = new RegExp(`\\b${expectedHr}:${String(expectedMin).padStart(2,'0')}\\s*${expectedAmpm}\\b`, 'i');
            if (!re.test(resp)) return `t1: missing ${expectedHr}:${String(expectedMin).padStart(2,'0')}${expectedAmpm}`;
            return null;
          }},
      ]});
    } else if (kind === 1) {
      // "how many minutes between H:Mam and H:Mam?"
      const a = Math.floor(rand() * 1440);
      const delta = 15 + Math.floor(rand() * 240);
      const b = (a + delta) % 1440;
      const ah = fmt12(a), bh = fmt12(b);
      const aStr = `${ah.hr}:${String(ah.min).padStart(2,'0')}${ah.ampm}`;
      const bStr = `${bh.hr}:${String(bh.min).padStart(2,'0')}${bh.ampm}`;
      const expected = delta;
      out.push({ id: `ta-${i}`, bundle: 'timeArithmetic', turns: [
        { user: `how many minutes between ${aStr} and ${bStr}?`, check: (resp) => {
            if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
            const nums = (resp.match(/\b\d+\b/g) || []).map(Number);
            if (!nums.includes(expected)) return `t1: missing ${expected}`;
            return null;
          }},
      ]});
    } else {
      // "what's H:Mam minus X minutes?"
      const startMin = Math.floor(rand() * 1440);
      const sub = 15 + Math.floor(rand() * 200);
      const start = fmt12(startMin);
      const end = fmt12(startMin - sub);
      const startStr = `${start.hr}:${String(start.min).padStart(2,'0')}${start.ampm}`;
      const prompt = `what's ${startStr} minus ${sub} minutes?`;
      const expectedHr = end.hr, expectedMin = end.min, expectedAmpm = end.ampm;
      out.push({ id: `ta-${i}`, bundle: 'timeArithmetic', turns: [
        { user: prompt, check: (resp) => {
            if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
            const re = new RegExp(`\\b${expectedHr}:${String(expectedMin).padStart(2,'0')}\\s*${expectedAmpm}\\b`, 'i');
            if (!re.test(resp)) return `t1: missing ${expectedHr}:${String(expectedMin).padStart(2,'0')}${expectedAmpm}`;
            return null;
          }},
      ]});
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. BASE CONVERSION — bin/hex/dec
// ---------------------------------------------------------------------------
function buildBc(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const kind = i % 4;
    const v = 2 + Math.floor(rand() * 510);
    let prompt: string, expected: string;
    if (kind === 0) {
      expected = v.toString(2);
      prompt = `convert ${v} to binary`;
    } else if (kind === 1) {
      expected = v.toString(16);
      prompt = `convert ${v} to hex`;
    } else if (kind === 2) {
      const bin = v.toString(2);
      expected = String(v);
      prompt = `what's 0b${bin} in decimal?`;
    } else {
      const hex = v.toString(16);
      expected = String(v);
      prompt = `what's 0x${hex} in decimal?`;
    }
    out.push({ id: `bc-${i}`, bundle: 'baseConversion', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          if (!new RegExp(`\\b${expected}\\b`, 'i').test(resp)) return `t1: missing ${expected}`;
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
    ...buildCit(rand, n),
    ...buildLfc(rand, n),
    ...buildAw(rand, n),
    ...buildTa(rand, n),
    ...buildBc(rand, n),
  ];
  const cases = bundle ? allCases.filter(c => c.bundle === bundle) : allCases;
  const stats: Record<BundleId, { pass: number; fail: number }> = {
    conditionalIfThen: { pass: 0, fail: 0 },
    listFilterCompose: { pass: 0, fail: 0 },
    arithmeticWord: { pass: 0, fail: 0 },
    timeArithmetic: { pass: 0, fail: 0 },
    baseConversion: { pass: 0, fail: 0 },
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
  console.log('\n=== INTENT/FORMAT/MEANING BENCH v21 (HARD3) ===');
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
