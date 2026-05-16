// intent-format-meaning-v22.mts — HARD4: abstract reasoning + composition

import fs from 'node:fs/promises';
import path from 'node:path';
import { VaiEngine } from '../src/models/vai-engine.js';
import type { Message } from '../src/types/index.js';

(globalThis as any).fetch = async () => { throw new TypeError('fetch disabled'); };

type BundleId = 'nestedConditional' | 'jsonExtract' | 'dateArithmetic' | 'stringPatternNext' | 'logicalOrder';
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

// ---------------------------------------------------------------------------
// 1. NESTED CONDITIONAL — 3-arm if/elif/else with compound conditions
// ---------------------------------------------------------------------------
const NC_WORDS = ['alpha','beta','gamma','delta','echo','foxtrot','golf','hotel','india','juliet'];
function buildNc(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const kind = i % 3;
    const num = 1 + Math.floor(rand() * 99);
    const a = pick(rand, NC_WORDS);
    const b = pick(rand, NC_WORDS.filter(w => w !== a));
    const c = pick(rand, NC_WORDS.filter(w => w !== a && w !== b));
    let prompt: string, expected: string;
    if (kind === 0) {
      // "if N > 50 and N is even, say A; else if N > 50, say B; else say C"
      prompt = `if ${num} is greater than 50 and ${num} is even, say "${a}"; else if ${num} is greater than 50, say "${b}"; else say "${c}"`;
      if (num > 50 && num % 2 === 0) expected = a;
      else if (num > 50) expected = b;
      else expected = c;
    } else if (kind === 1) {
      // "if N < 25, say A; else if N < 75, say B; else say C"
      prompt = `if ${num} is less than 25, say "${a}"; else if ${num} is less than 75, say "${b}"; else say "${c}"`;
      if (num < 25) expected = a;
      else if (num < 75) expected = b;
      else expected = c;
    } else {
      // "if N is odd and N > 50, say A; else if N is even, say B; else say C"
      prompt = `if ${num} is odd and ${num} is greater than 50, say "${a}"; else if ${num} is even, say "${b}"; else say "${c}"`;
      if (num % 2 !== 0 && num > 50) expected = a;
      else if (num % 2 === 0) expected = b;
      else expected = c;
    }
    out.push({ id: `nc-${i}`, bundle: 'nestedConditional', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          if (!new RegExp(`\\b${expected}\\b`, 'i').test(resp)) return `t1: missing ${expected}`;
          // Also reject if other words appear standalone (must be the right pick).
          const other1 = a !== expected ? a : (b !== expected ? b : c);
          const other2 = c !== expected && c !== other1 ? c : (b !== expected && b !== other1 ? b : a);
          if (new RegExp(`\\b${other1}\\b`, 'i').test(resp) && new RegExp(`\\b${other2}\\b`, 'i').test(resp)) {
            return `t1: ambiguous (got all 3)`;
          }
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. JSON EXTRACT — nested dot-path lookup
// ---------------------------------------------------------------------------
function buildJe(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  const keys = ['a','b','c','x','y','z','foo','bar','baz','user','meta','data'];
  for (let i = 0; i < n; i++) {
    const depth = 2 + (i % 3); // 2, 3, or 4
    const path: string[] = [];
    const used = new Set<string>();
    for (let d = 0; d < depth; d++) {
      let k = pick(rand, keys);
      while (used.has(k)) k = pick(rand, keys);
      used.add(k); path.push(k);
    }
    const value = 10 + Math.floor(rand() * 990);
    // Build nested obj as JSON string
    let json = String(value);
    for (let d = path.length - 1; d >= 0; d--) {
      json = `{"${path[d]}": ${json}}`;
    }
    const dotPath = path.join('.');
    const kind = i % 2;
    const prompt = kind === 0
      ? `from ${json}, get ${dotPath}`
      : `in ${json}, what is the value at ${dotPath}?`;
    out.push({ id: `je-${i}`, bundle: 'jsonExtract', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          if (!new RegExp(`\\b${value}\\b`).test(resp)) return `t1: missing ${value}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. DATE ARITHMETIC — "X days from MM/DD" (year 2024, leap year)
// ---------------------------------------------------------------------------
const DAYS_2024 = [31,29,31,30,31,30,31,31,30,31,30,31];
function addDays2024(m: number, d: number, delta: number): { m: number; d: number } {
  // 1-indexed month, 1-indexed day
  let totalDay = d;
  for (let i = 0; i < m - 1; i++) totalDay += DAYS_2024[i];
  totalDay += delta;
  // wrap within 366
  totalDay = ((totalDay - 1) % 366 + 366) % 366 + 1;
  let mm = 1;
  while (totalDay > DAYS_2024[mm - 1]) { totalDay -= DAYS_2024[mm - 1]; mm++; }
  return { m: mm, d: totalDay };
}
function buildDa(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const kind = i % 3;
    const startM = 1 + Math.floor(rand() * 12);
    const startD = 1 + Math.floor(rand() * DAYS_2024[startM - 1]);
    let delta: number, prompt: string;
    if (kind === 0) {
      delta = 1 + Math.floor(rand() * 30);
      prompt = `what date is ${delta} days after ${startM}/${startD} in 2024?`;
    } else if (kind === 1) {
      const weeks = 1 + Math.floor(rand() * 6);
      delta = weeks * 7;
      prompt = `what date is ${weeks} weeks after ${startM}/${startD} in 2024?`;
    } else {
      delta = -(1 + Math.floor(rand() * 30));
      prompt = `what date is ${-delta} days before ${startM}/${startD} in 2024?`;
    }
    const { m, d } = addDays2024(startM, startD, delta);
    out.push({ id: `da-${i}`, bundle: 'dateArithmetic', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          // Accept M/D or MM/DD
          const expected1 = `${m}/${d}`;
          const expected2 = `${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')}`;
          if (!new RegExp(`\\b${expected1}\\b`).test(resp) && !new RegExp(`\\b${expected2}\\b`).test(resp)) return `t1: missing ${expected1}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. STRING PATTERN NEXT — "abc, abd, abe → next?"
// ---------------------------------------------------------------------------
function buildSpn(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const kind = i % 3;
    let seq: string[], expected: string;
    if (kind === 0) {
      // last char increments: abc, abd, abe → abf
      const base = String.fromCharCode(97 + Math.floor(rand() * 20)) + String.fromCharCode(97 + Math.floor(rand() * 20));
      const startLast = Math.floor(rand() * 20);
      seq = [base + String.fromCharCode(97 + startLast), base + String.fromCharCode(97 + startLast + 1), base + String.fromCharCode(97 + startLast + 2)];
      expected = base + String.fromCharCode(97 + startLast + 3);
    } else if (kind === 1) {
      // first char increments: ax, bx, cx → dx (suffix kept)
      const suffix = String.fromCharCode(97 + Math.floor(rand() * 20));
      const startFirst = Math.floor(rand() * 20);
      seq = [String.fromCharCode(97 + startFirst) + suffix, String.fromCharCode(97 + startFirst + 1) + suffix, String.fromCharCode(97 + startFirst + 2) + suffix];
      expected = String.fromCharCode(97 + startFirst + 3) + suffix;
    } else {
      // trailing-number increments: item1, item2, item3 → item4
      const stem = pick(rand, ['item','step','node','task','box','pin']);
      const start = 1 + Math.floor(rand() * 20);
      seq = [stem + start, stem + (start + 1), stem + (start + 2)];
      expected = stem + (start + 3);
    }
    const prompt = `what comes next in this sequence: ${seq.join(', ')}?`;
    out.push({ id: `spn-${i}`, bundle: 'stringPatternNext', turns: [
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
// 5. LOGICAL ORDER — transitive chain → ordered list
// ---------------------------------------------------------------------------
const LO_NAMES = ['Alice','Bob','Carol','Dave','Eve','Frank','Grace','Henry'];
function buildLo(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  const adjPairs = [
    { hi: 'taller', lo: 'shorter', sortOrder: 'tallest to shortest' },
    { hi: 'older',  lo: 'younger', sortOrder: 'oldest to youngest' },
    { hi: 'faster', lo: 'slower',  sortOrder: 'fastest to slowest' },
    { hi: 'heavier',lo: 'lighter', sortOrder: 'heaviest to lightest' },
  ];
  for (let i = 0; i < n; i++) {
    const count = 3 + (i % 3); // 3, 4, or 5
    const ap = adjPairs[i % adjPairs.length];
    // pick `count` unique names → ordered = the chain order (highest first)
    const shuffled = LO_NAMES.slice().sort(() => rand() - 0.5).slice(0, count);
    const ordered = shuffled.slice(); // already highest→lowest by construction
    // Build chain statements in a random presentation order
    const statements: string[] = [];
    for (let k = 0; k < ordered.length - 1; k++) {
      statements.push(`${ordered[k]} is ${ap.hi} than ${ordered[k + 1]}.`);
    }
    // Shuffle statements for difficulty
    for (let s = statements.length - 1; s > 0; s--) {
      const j = Math.floor(rand() * (s + 1));
      [statements[s], statements[j]] = [statements[j], statements[s]];
    }
    const prompt = `${statements.join(' ')} order them from ${ap.sortOrder}.`;
    out.push({ id: `lo-${i}`, bundle: 'logicalOrder', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          // Names must appear in correct order in resp (allow other tokens between)
          let idx = 0;
          const lowered = resp.toLowerCase();
          for (const name of ordered) {
            const found = lowered.indexOf(name.toLowerCase(), idx);
            if (found === -1) return `t1: missing ${name}`;
            idx = found + name.length;
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
    ...buildNc(rand, n),
    ...buildJe(rand, n),
    ...buildDa(rand, n),
    ...buildSpn(rand, n),
    ...buildLo(rand, n),
  ];
  const cases = bundle ? allCases.filter(c => c.bundle === bundle) : allCases;
  const stats: Record<BundleId, { pass: number; fail: number }> = {
    nestedConditional: { pass: 0, fail: 0 },
    jsonExtract: { pass: 0, fail: 0 },
    dateArithmetic: { pass: 0, fail: 0 },
    stringPatternNext: { pass: 0, fail: 0 },
    logicalOrder: { pass: 0, fail: 0 },
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
  console.log('\n=== INTENT/FORMAT/MEANING BENCH v22 (HARD4) ===');
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
