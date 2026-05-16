// intent-format-meaning-v24.mts — HARD6: knapsack/regex-match/state-machine/truth-table/edit-distance

import fs from 'node:fs/promises';
import path from 'node:path';
import { VaiEngine } from '../src/models/vai-engine.js';
import type { Message } from '../src/types/index.js';

(globalThis as any).fetch = async () => { throw new TypeError('fetch disabled'); };

type BundleId = 'knapsackSmall' | 'regexMatch' | 'stateMachine' | 'truthTable' | 'editDistance';
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
// 1. KNAPSACK SMALL — DP over 0/1 knapsack with 3-4 items
// ---------------------------------------------------------------------------
function knapsack(items: Array<[number, number]>, W: number): number {
  const n = items.length;
  const dp = new Array(W + 1).fill(0);
  for (let i = 0; i < n; i++) {
    const [w, v] = items[i];
    for (let j = W; j >= w; j--) dp[j] = Math.max(dp[j], dp[j - w] + v);
  }
  return dp[W];
}
function buildKs(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const k = 3 + (i % 2); // 3 or 4 items
    const items: Array<[number, number]> = [];
    for (let j = 0; j < k; j++) items.push([1 + Math.floor(rand() * 8), 1 + Math.floor(rand() * 20)]);
    const W = 5 + Math.floor(rand() * 10);
    const best = knapsack(items, W);
    const itemStr = items.map(([w, v]) => `(${w},${v})`).join(', ');
    const prompt = `given items as (weight,value): ${itemStr}, with max weight ${W}, what's the maximum value?`;
    out.push({ id: `ks-${i}`, bundle: 'knapsackSmall', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          if (!new RegExp(`\\b${best}\\b`).test(resp)) return `t1: missing ${best}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. REGEX MATCH — "does 'X' match pattern Y?"
// ---------------------------------------------------------------------------
function buildRm(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  const patterns: Array<{ src: string; sample: () => string; nonMatch: () => string }> = [
    { src: '^\\d+$', sample: () => String(100 + Math.floor(rand() * 900)), nonMatch: () => 'abc' + Math.floor(rand() * 9) },
    { src: '^[a-z]+$', sample: () => 'abc' + String.fromCharCode(97 + Math.floor(rand() * 26)), nonMatch: () => '123' },
    { src: '^[A-Z][a-z]+$', sample: () => 'Hello', nonMatch: () => 'hello' },
    { src: '\\d{3}', sample: () => 'x' + (100 + Math.floor(rand() * 900)) + 'y', nonMatch: () => 'xy' },
  ];
  for (let i = 0; i < n; i++) {
    const p = patterns[i % patterns.length];
    const matches = i % 2 === 0;
    const s = matches ? p.sample() : p.nonMatch();
    // Compute actual
    const actual = new RegExp(p.src).test(s);
    const expected = actual ? 'yes' : 'no';
    const prompt = `does "${s}" match the regex /${p.src}/?`;
    out.push({ id: `rm-${i}`, bundle: 'regexMatch', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          const lr = lower(resp).trim();
          const opp = expected === 'yes' ? 'no' : 'yes';
          if (lr.startsWith(opp) || lr.startsWith(`**${opp}`)) return `t1: said ${opp}`;
          if (!new RegExp(`\\b${expected}\\b`).test(lr)) return `t1: missing ${expected}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. STATE MACHINE — "machine starts in A. on tick: A→B, B→C, C→A. after N ticks, state?"
// ---------------------------------------------------------------------------
function buildSm(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const states = ['A','B','C','D'].slice(0, 3 + (i % 2));
    // Build random permutation as transition (each state maps to another state)
    const perm = states.slice().sort(() => rand() - 0.5);
    const transitions = states.map((s, k) => `${s}->${perm[k]}`).join(', ');
    const startIdx = Math.floor(rand() * states.length);
    const start = states[startIdx];
    const ticks = 2 + Math.floor(rand() * 8);
    let cur = start;
    for (let t = 0; t < ticks; t++) {
      const idx = states.indexOf(cur);
      cur = perm[idx];
    }
    const expected = cur;
    const prompt = `state machine starts in ${start}. transitions on each tick: ${transitions}. after ${ticks} ticks, what state?`;
    out.push({ id: `sm-${i}`, bundle: 'stateMachine', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          if (!new RegExp(`\\b${expected}\\b`).test(resp)) return `t1: missing ${expected}`;
          // Reject if other states all appear too (ambiguous)
          const others = states.filter(s => s !== expected);
          const allPresent = others.every(s => new RegExp(`\\b${s}\\b`).test(resp));
          if (allPresent && !new RegExp(`^\\**${expected}|\\*\\*${expected}\\*\\*`).test(resp.trim())) {
            return `t1: ambiguous`;
          }
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. TRUTH TABLE — "evaluate (T AND F) OR (NOT T)"
// ---------------------------------------------------------------------------
function buildTt(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  const ops = [
    (a: boolean, b: boolean) => ({ op: 'AND', v: a && b }),
    (a: boolean, b: boolean) => ({ op: 'OR', v: a || b }),
  ];
  for (let i = 0; i < n; i++) {
    const a1 = rand() < 0.5, b1 = rand() < 0.5, a2 = rand() < 0.5, b2 = rand() < 0.5;
    const o1 = ops[Math.floor(rand() * 2)];
    const o2 = ops[Math.floor(rand() * 2)];
    const outer = ops[Math.floor(rand() * 2)];
    const left = o1(a1, b1);
    const right = o2(a2, b2);
    const final = outer(left.v, right.v);
    const T = (b: boolean) => b ? 'T' : 'F';
    const prompt = `evaluate (${T(a1)} ${left.op} ${T(b1)}) ${final.op} (${T(a2)} ${right.op} ${T(b2)})`;
    const expected = final.v ? 'true' : 'false';
    const expectedShort = final.v ? 'T' : 'F';
    out.push({ id: `tt-${i}`, bundle: 'truthTable', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          const lr = lower(resp).trim();
          const opp = final.v ? 'false' : 'true';
          const oppShort = final.v ? 'f' : 't';
          // Strip the prompt echo if present
          if (new RegExp(`\\b${expected}\\b`).test(lr)) return null;
          if (new RegExp(`^\\*?\\*?${expectedShort}\\b`).test(lr) || new RegExp(`^\\*?\\*?${expectedShort}\\*?\\*?\\.?$`).test(lr)) return null;
          if (lr.startsWith(opp) || lr.startsWith(oppShort + ' ') || lr.startsWith(`**${opp}`)) return `t1: said ${opp}`;
          return `t1: missing ${expected}`;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. EDIT DISTANCE — Levenshtein on small words
// ---------------------------------------------------------------------------
function editDist(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
const ED_WORDS = ['cat','car','cut','dog','log','frog','sun','run','fun','book','look','cook','tree','three'];
function buildEd(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const a = pick(rand, ED_WORDS);
    const b = pick(rand, ED_WORDS);
    const d = editDist(a, b);
    const prompt = `what's the edit distance between "${a}" and "${b}"?`;
    out.push({ id: `ed-${i}`, bundle: 'editDistance', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          if (!new RegExp(`\\b${d}\\b`).test(resp)) return `t1: missing ${d}`;
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
    ...buildKs(rand, n),
    ...buildRm(rand, n),
    ...buildSm(rand, n),
    ...buildTt(rand, n),
    ...buildEd(rand, n),
  ];
  const cases = bundle ? allCases.filter(c => c.bundle === bundle) : allCases;
  const stats: Record<BundleId, { pass: number; fail: number }> = {
    knapsackSmall: { pass: 0, fail: 0 },
    regexMatch: { pass: 0, fail: 0 },
    stateMachine: { pass: 0, fail: 0 },
    truthTable: { pass: 0, fail: 0 },
    editDistance: { pass: 0, fail: 0 },
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
  console.log('\n=== INTENT/FORMAT/MEANING BENCH v24 (HARD6) ===');
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
