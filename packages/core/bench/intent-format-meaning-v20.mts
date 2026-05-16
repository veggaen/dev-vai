// intent-format-meaning-v20.mts — HARDER v2: abstract reasoning + composition
// 1. sequenceNext        — arithmetic/geometric/fibonacci, random params, 6 paraphrases
// 2. transitiveCompare   — "if A > B and B > C, which is biggest?", 5 paraphrases
// 3. setIntersection     — two random lists, find common items, 6 paraphrases
// 4. twoStepWord         — compose reverse + uppercase / lowercase + reverse / etc, 5 paraphrases
// 5. nthFromEnd          — "3rd from the end of [list]", random list + index, 6 paraphrases

import fs from 'node:fs/promises';
import path from 'node:path';
import { VaiEngine } from '../src/models/vai-engine.js';
import type { Message } from '../src/types/index.js';

(globalThis as any).fetch = async () => { throw new TypeError('fetch disabled'); };

type BundleId = 'sequenceNext' | 'transitiveCompare' | 'setIntersection' | 'twoStepWord' | 'nthFromEnd';

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
// 1. SEQUENCE NEXT — arithmetic / geometric / fibonacci
// ---------------------------------------------------------------------------
const SEQ_TEMPLATES: ((s: string) => string)[] = [
  (s) => `what comes next in this sequence: ${s}?`,
  (s) => `what's the next number: ${s}?`,
  (s) => `continue the sequence: ${s}`,
  (s) => `what number follows ${s}?`,
  (s) => `next in series: ${s}`,
  (s) => `predict the next value: ${s}`,
];
function genSequence(rand: () => number): { seq: number[]; next: number } {
  const kind = Math.floor(rand() * 3);
  const len = 4 + Math.floor(rand() * 3); // 4-6 terms shown
  if (kind === 0) {
    // arithmetic
    const start = Math.floor(rand() * 20) - 5;
    const step = 1 + Math.floor(rand() * 9);
    const seq: number[] = [];
    for (let i = 0; i < len; i++) seq.push(start + i * step);
    return { seq, next: start + len * step };
  } else if (kind === 1) {
    // geometric
    const start = 1 + Math.floor(rand() * 5);
    const ratio = 2 + Math.floor(rand() * 3); // 2, 3, 4
    const seq: number[] = [];
    for (let i = 0; i < len; i++) seq.push(start * Math.pow(ratio, i));
    return { seq, next: start * Math.pow(ratio, len) };
  } else {
    // fibonacci-like
    let a = 1 + Math.floor(rand() * 4);
    let b = a + Math.floor(rand() * 4);
    const seq: number[] = [a, b];
    for (let i = 2; i < len; i++) {
      const c = seq[i - 1] + seq[i - 2];
      seq.push(c);
    }
    return { seq, next: seq[seq.length - 1] + seq[seq.length - 2] };
  }
}
function buildSeq(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const { seq, next } = genSequence(rand);
    const s = seq.join(', ');
    const tpl = SEQ_TEMPLATES[i % SEQ_TEMPLATES.length];
    out.push({ id: `seq-${i}`, bundle: 'sequenceNext', turns: [
      { user: tpl(s), check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          const nums = (resp.match(/-?\d+/g) || []).map(Number);
          if (!nums.includes(next)) return `t1: missing ${next} (seq=${s})`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. TRANSITIVE COMPARE — A > B > C reasoning
// ---------------------------------------------------------------------------
const NAMES = ['Alice','Bob','Carol','Dave','Emma','Frank','Grace','Henry','Ivy','Jack'];
const TC_TEMPLATES_MAX: ((a: string, b: string, c: string) => string)[] = [
  (a, b, c) => `if ${a} is taller than ${b}, and ${b} is taller than ${c}, who is tallest?`,
  (a, b, c) => `${a} is older than ${b}. ${b} is older than ${c}. Who is the oldest?`,
  (a, b, c) => `${a} is faster than ${b}, and ${b} is faster than ${c}. who is the fastest?`,
  (a, b, c) => `if ${a} > ${b} and ${b} > ${c}, which is biggest?`,
  (a, b, c) => `given ${a} is heavier than ${b} and ${b} is heavier than ${c}, who's heaviest?`,
];
const TC_TEMPLATES_MIN: ((a: string, b: string, c: string) => string)[] = [
  (a, b, c) => `if ${a} is taller than ${b}, and ${b} is taller than ${c}, who is shortest?`,
  (a, b, c) => `${a} is older than ${b}. ${b} is older than ${c}. Who is the youngest?`,
  (a, b, c) => `${a} is faster than ${b}, and ${b} is faster than ${c}. who is the slowest?`,
  (a, b, c) => `if ${a} > ${b} and ${b} > ${c}, which is smallest?`,
  (a, b, c) => `given ${a} is heavier than ${b} and ${b} is heavier than ${c}, who's lightest?`,
];
function buildTc(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const askMax = rand() < 0.5;
    const trio = shuffle(rand, NAMES).slice(0, 3);
    const [a, b, c] = trio; // a > b > c
    const expected = askMax ? a : c;
    const tpls = askMax ? TC_TEMPLATES_MAX : TC_TEMPLATES_MIN;
    const tpl = tpls[i % tpls.length];
    out.push({ id: `tc-${i}`, bundle: 'transitiveCompare', turns: [
      { user: tpl(a, b, c), check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          const re = new RegExp(`\\b${expected}\\b`, 'i');
          if (!re.test(resp)) return `t1: missing ${expected}`;
          // Must NOT primarily mention the wrong answer as the answer
          const wrong = askMax ? c : a;
          const wRe = new RegExp(`\\b${wrong}\\s+is\\s+the\\s+(?:tallest|oldest|fastest|biggest|heaviest|shortest|youngest|slowest|smallest|lightest)`, 'i');
          if (wRe.test(resp)) return `t1: claimed ${wrong}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. SET INTERSECTION — two lists, find common
// ---------------------------------------------------------------------------
const SET_POOL = ['apple','banana','cherry','date','elderberry','fig','grape','kiwi','lemon','mango','nectarine','orange','peach','pear','plum','quince','raspberry','strawberry','tomato','watermelon'];
const SI_TEMPLATES: ((la: string, lb: string) => string)[] = [
  (la, lb) => `what's common between [${la}] and [${lb}]?`,
  (la, lb) => `which items appear in both lists: [${la}] and [${lb}]?`,
  (la, lb) => `find the intersection of [${la}] and [${lb}]`,
  (la, lb) => `what items are in both [${la}] and [${lb}]?`,
  (la, lb) => `give me the overlap between [${la}] and [${lb}]`,
  (la, lb) => `which words appear in both [${la}] and [${lb}]?`,
];
function buildSi(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const overlapCount = 1 + Math.floor(rand() * 3); // 1-3 shared
    const aOnly = 1 + Math.floor(rand() * 3);
    const bOnly = 1 + Math.floor(rand() * 3);
    const shuffled = shuffle(rand, SET_POOL);
    const shared = shuffled.slice(0, overlapCount);
    const a = [...shared, ...shuffled.slice(overlapCount, overlapCount + aOnly)];
    const b = [...shared, ...shuffled.slice(overlapCount + aOnly, overlapCount + aOnly + bOnly)];
    const aMix = shuffle(rand, a);
    const bMix = shuffle(rand, b);
    const la = aMix.join(', ');
    const lb = bMix.join(', ');
    const tpl = SI_TEMPLATES[i % SI_TEMPLATES.length];
    out.push({ id: `si-${i}`, bundle: 'setIntersection', turns: [
      { user: tpl(la, lb), check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          for (const s of shared) {
            if (!new RegExp(`\\b${s}\\b`, 'i').test(resp)) return `t1: missing ${s}`;
          }
          // The response should NOT mention items unique to one side as if they were shared.
          // We only check shared coverage to keep this robust.
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. TWO-STEP WORD — compose ops
// ---------------------------------------------------------------------------
function randWord(rand: () => number): string {
  const len = 4 + Math.floor(rand() * 5);
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let w = '';
  for (let i = 0; i < len; i++) w += letters[Math.floor(rand() * 26)];
  return w;
}
type TwoStepOp = 'reverse-upper' | 'upper-reverse' | 'reverse-lower' | 'lower-reverse';
const TW_TEMPLATES: { op: TwoStepOp; tpl: (w: string) => string }[] = [
  { op: 'reverse-upper', tpl: (w) => `reverse ${w} and then uppercase it` },
  { op: 'reverse-upper', tpl: (w) => `take ${w}, reverse it, then make it uppercase` },
  { op: 'upper-reverse', tpl: (w) => `uppercase ${w} then reverse it` },
  { op: 'upper-reverse', tpl: (w) => `make ${w} uppercase and then reverse the result` },
  { op: 'reverse-lower', tpl: (w) => `reverse ${w.toUpperCase()} and then lowercase it` },
  { op: 'lower-reverse', tpl: (w) => `lowercase ${w.toUpperCase()} then reverse it` },
];
function applyTwoStep(op: TwoStepOp, w: string): string {
  switch (op) {
    case 'reverse-upper': return w.split('').reverse().join('').toUpperCase();
    case 'upper-reverse': return w.toUpperCase().split('').reverse().join('');
    case 'reverse-lower': return w.split('').reverse().join('').toLowerCase();
    case 'lower-reverse': return w.toLowerCase().split('').reverse().join('');
  }
}
function buildTw(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const w = randWord(rand);
    const entry = TW_TEMPLATES[i % TW_TEMPLATES.length];
    // The expected works regardless of case input/output because reverse(upper(x)) == upper(reverse(x))
    const expected = applyTwoStep(entry.op, w);
    out.push({ id: `tw-${i}`, bundle: 'twoStepWord', turns: [
      { user: entry.tpl(w), check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          if (!new RegExp(`\\b${expected}\\b`).test(resp)) return `t1: missing ${expected}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. NTH FROM END — random list, "Nth from end"
// ---------------------------------------------------------------------------
const NFE_POOL = ['cat','dog','bird','fish','horse','mouse','rabbit','snake','lion','tiger','bear','wolf','fox','deer','hawk','owl','frog','goat','sheep','duck'];
const NFE_TEMPLATES: ((list: string, n: number, ord: string) => string)[] = [
  (list, n, ord) => `what's the ${ord} from the end of [${list}]?`,
  (list, n, ord) => `give me the ${ord}-to-last item of [${list}]`,
  (list, n, ord) => `what is the ${ord} item from the end: [${list}]?`,
  (list, n, ord) => `in [${list}], what's the ${ord} from the end?`,
  (list, n, ord) => `from the back of [${list}], give me item ${n}`,
  (list, n, ord) => `counting from the end of [${list}], what's number ${n}?`,
];
function ordWord(n: number): string {
  const map: Record<number, string> = { 1: 'last', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th' };
  return map[n] || `${n}th`;
}
function buildNfe(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const len = 5 + Math.floor(rand() * 4); // 5-8 items
    const list = shuffle(rand, NFE_POOL).slice(0, len);
    const fromEnd = 1 + Math.floor(rand() * Math.min(5, len)); // 1..min(5, len)
    const expected = list[list.length - fromEnd];
    const tpl = NFE_TEMPLATES[i % NFE_TEMPLATES.length];
    out.push({ id: `nfe-${i}`, bundle: 'nthFromEnd', turns: [
      { user: tpl(list.join(', '), fromEnd, ordWord(fromEnd)), check: (resp) => {
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
    ...buildSeq(rand, n),
    ...buildTc(rand, n),
    ...buildSi(rand, n),
    ...buildTw(rand, n),
    ...buildNfe(rand, n),
  ];
  const cases = bundle ? allCases.filter(c => c.bundle === bundle) : allCases;

  const stats: Record<BundleId, { pass: number; fail: number }> = {
    sequenceNext: { pass: 0, fail: 0 },
    transitiveCompare: { pass: 0, fail: 0 },
    setIntersection: { pass: 0, fail: 0 },
    twoStepWord: { pass: 0, fail: 0 },
    nthFromEnd: { pass: 0, fail: 0 },
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
  console.log('\n=== INTENT/FORMAT/MEANING BENCH v20 (HARD2) ===');
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
