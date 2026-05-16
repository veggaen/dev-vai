// intent-format-meaning-v26.mts — EXTREME: 8 bundles × 200 cases
// trie-prefix / scheduling / sat3 / json-patch / list-flatten / sliding-window-max
// modular-exp / parens-balance

import fs from 'node:fs/promises';
import path from 'node:path';
import { VaiEngine } from '../src/models/vai-engine.js';
import type { Message } from '../src/types/index.js';

(globalThis as any).fetch = async () => { throw new TypeError('fetch disabled'); };

type BundleId =
  | 'triePrefix'
  | 'scheduling'
  | 'sat3'
  | 'jsonPatch'
  | 'listFlatten'
  | 'slidingMax'
  | 'modularExp'
  | 'parensBalance';

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
const pick = <T>(r: () => number, a: T[]): T => a[Math.floor(r() * a.length)];
function lower(s: string): string { return (s || '').toLowerCase(); }
function isFallback(a: string): boolean {
  const l = lower(a);
  return /(\bisn['’]?t in my\b|don['’]?t yet hold|don'?t have it (locally|yet)|stay on|pivot fully|in my (?:local )?(?:knowledge|memory)|don['’]?t have a solid answer|i (?:don'?t|do not) know about\b)/i.test(l);
}
function isClarify(a: string): boolean {
  return /(could you clarify|what do you mean|which one did you mean|are you asking about)/i.test(a);
}

// ----------------------------------------------------------------------------
// 1. TRIE PREFIX — "from words [a,b,c,d], how many start with 'pre'?"
// ----------------------------------------------------------------------------
const TRIE_WORDS = ['apple','app','apt','ape','book','boot','born','bore','cat','car','cart','care','dog','dot','dough','door'];
function buildTrie(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const k = 5 + Math.floor(rand() * 6);
    const pool = [...TRIE_WORDS];
    const words: string[] = [];
    for (let j = 0; j < k; j++) words.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    const prefixes = ['ap', 'bo', 'ca', 'do', 'a', 'b', 'c', 'd'];
    const pref = pick(rand, prefixes);
    const count = words.filter(w => w.startsWith(pref)).length;
    const prompt = `from words [${words.join(', ')}], how many start with "${pref}"?`;
    out.push({ id: `tp-${i}`, bundle: 'triePrefix', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          if (!new RegExp(`\\b${count}\\b`).test(resp)) return `t1: expected ${count}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ----------------------------------------------------------------------------
// 2. SCHEDULING — "tasks [(start,end), …] — max non-overlapping count?"
// (Greedy by end-time)
// ----------------------------------------------------------------------------
function maxNonOverlap(items: Array<[number, number]>): number {
  const s = [...items].sort((a, b) => a[1] - b[1]);
  let last = -Infinity, count = 0;
  for (const [a, b] of s) if (a >= last) { count++; last = b; }
  return count;
}
function buildSched(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const k = 4 + Math.floor(rand() * 3);
    const items: Array<[number, number]> = [];
    for (let j = 0; j < k; j++) {
      const s = Math.floor(rand() * 15);
      const e = s + 1 + Math.floor(rand() * 8);
      items.push([s, e]);
    }
    const c = maxNonOverlap(items);
    const str = items.map(([a, b]) => `(${a},${b})`).join(', ');
    const prompt = `tasks as (start,end): ${str}. max number of non-overlapping tasks?`;
    out.push({ id: `sc-${i}`, bundle: 'scheduling', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          if (!new RegExp(`\\b${c}\\b`).test(resp)) return `t1: expected ${c}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ----------------------------------------------------------------------------
// 3. SAT 3-CNF — "is (a OR b) AND (NOT a OR c) AND (b OR NOT c) satisfiable?"
// brute force over up to 4 vars
// ----------------------------------------------------------------------------
function satSolve(clauses: Array<Array<[string, boolean]>>, vars: string[]): boolean {
  const n = vars.length;
  for (let mask = 0; mask < (1 << n); mask++) {
    const env: Record<string, boolean> = {};
    for (let i = 0; i < n; i++) env[vars[i]] = !!(mask & (1 << i));
    let all = true;
    for (const cl of clauses) {
      let any = false;
      for (const [v, sign] of cl) if (env[v] === sign) { any = true; break; }
      if (!any) { all = false; break; }
    }
    if (all) return true;
  }
  return false;
}
function buildSat(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const vars = ['a', 'b', 'c'];
    const k = 3;
    const clauses: Array<Array<[string, boolean]>> = [];
    const parts: string[] = [];
    for (let j = 0; j < k; j++) {
      const v1 = pick(rand, vars), v2 = pick(rand, vars);
      const s1 = rand() < 0.5, s2 = rand() < 0.5;
      clauses.push([[v1, s1], [v2, s2]]);
      parts.push(`(${s1 ? '' : 'NOT '}${v1} OR ${s2 ? '' : 'NOT '}${v2})`);
    }
    const sat = satSolve(clauses, vars);
    const prompt = `is ${parts.join(' AND ')} satisfiable?`;
    out.push({ id: `sat-${i}`, bundle: 'sat3', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          const want = sat ? /^\s*(?:\*\*)?yes\b/i : /^\s*(?:\*\*)?no\b/i;
          if (!want.test(resp)) return `t1: expected ${sat ? 'yes' : 'no'}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ----------------------------------------------------------------------------
// 4. JSON PATCH — "apply patch {op:replace, path:/x, value:9} to {x:1,y:2}; what is x?"
// Simplified: single-op replace on flat object
// ----------------------------------------------------------------------------
function buildJp(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const keys = ['x', 'y', 'z'];
    const obj: Record<string, number> = {};
    for (const k of keys) obj[k] = Math.floor(rand() * 10);
    const target = pick(rand, keys);
    const newVal = 10 + Math.floor(rand() * 90);
    const objStr = '{' + keys.map(k => `"${k}":${obj[k]}`).join(',') + '}';
    const prompt = `apply patch {"op":"replace","path":"/${target}","value":${newVal}} to ${objStr}; what is the new value of ${target}?`;
    out.push({ id: `jp-${i}`, bundle: 'jsonPatch', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          if (!new RegExp(`\\b${newVal}\\b`).test(resp)) return `t1: expected ${newVal}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ----------------------------------------------------------------------------
// 5. LIST FLATTEN — "flatten [1,[2,[3,4]],5] — how many elements?"
// ----------------------------------------------------------------------------
function genNested(rand: () => number, depth: number, maxDepth: number): any[] {
  const out: any[] = [];
  const k = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < k; i++) {
    if (depth < maxDepth && rand() < 0.5) out.push(genNested(rand, depth + 1, maxDepth));
    else out.push(Math.floor(rand() * 10));
  }
  return out;
}
function flatten(a: any[]): number[] {
  const out: number[] = [];
  for (const x of a) if (Array.isArray(x)) out.push(...flatten(x)); else out.push(x);
  return out;
}
function buildFl(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const arr = genNested(rand, 0, 3);
    const flat = flatten(arr);
    const count = flat.length;
    const prompt = `flatten ${JSON.stringify(arr)} — how many elements total?`;
    out.push({ id: `fl-${i}`, bundle: 'listFlatten', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          if (!new RegExp(`\\b${count}\\b`).test(resp)) return `t1: expected ${count}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ----------------------------------------------------------------------------
// 6. SLIDING WINDOW MAX — "in [a,b,c,d,e], max of any window of size K?"
// (the overall max of all windows = overall max)
// Use sum-of-window-of-size-K maximum — more interesting
// ----------------------------------------------------------------------------
function maxWindowSum(arr: number[], k: number): number {
  let cur = 0;
  for (let i = 0; i < k; i++) cur += arr[i];
  let best = cur;
  for (let i = k; i < arr.length; i++) { cur += arr[i] - arr[i - k]; if (cur > best) best = cur; }
  return best;
}
function buildSw(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const len = 6 + Math.floor(rand() * 5);
    const arr: number[] = [];
    for (let j = 0; j < len; j++) arr.push(1 + Math.floor(rand() * 9));
    const k = 2 + Math.floor(rand() * 3);
    const best = maxWindowSum(arr, k);
    const prompt = `for array [${arr.join(',')}], max sum of any contiguous window of size ${k}?`;
    out.push({ id: `sw-${i}`, bundle: 'slidingMax', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          if (!new RegExp(`\\b${best}\\b`).test(resp)) return `t1: expected ${best}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ----------------------------------------------------------------------------
// 7. MODULAR EXP — "what is a^b mod m?"
// ----------------------------------------------------------------------------
function modPow(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n; b = b % m;
  while (e > 0n) { if (e & 1n) r = (r * b) % m; e >>= 1n; b = (b * b) % m; }
  return r;
}
function buildMe(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const a = 2 + Math.floor(rand() * 20);
    const b = 2 + Math.floor(rand() * 10);
    const m = 3 + Math.floor(rand() * 50);
    const val = Number(modPow(BigInt(a), BigInt(b), BigInt(m)));
    const prompt = `what is ${a}^${b} mod ${m}?`;
    out.push({ id: `me-${i}`, bundle: 'modularExp', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          if (!new RegExp(`\\b${val}\\b`).test(resp)) return `t1: expected ${val}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ----------------------------------------------------------------------------
// 8. PARENS BALANCE — "is '((()))' balanced?"  including mixed brackets
// ----------------------------------------------------------------------------
function isBalanced(s: string): boolean {
  const stack: string[] = [];
  const pair: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
    else if (ch in pair) { if (stack.pop() !== pair[ch]) return false; }
  }
  return stack.length === 0;
}
function buildPb(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  const opens = ['(', '[', '{'];
  const closes: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  for (let i = 0; i < n; i++) {
    const balanced = i % 2 === 0;
    let s = '';
    if (balanced) {
      const stack: string[] = [];
      const k = 3 + Math.floor(rand() * 4);
      for (let j = 0; j < k; j++) {
        if (stack.length > 0 && rand() < 0.5) { s += closes[stack.pop()!]; }
        else { const o = pick(rand, opens); s += o; stack.push(o); }
      }
      while (stack.length) s += closes[stack.pop()!];
    } else {
      // unbalanced: random mix
      const k = 4 + Math.floor(rand() * 4);
      for (let j = 0; j < k; j++) {
        if (rand() < 0.5) s += pick(rand, opens);
        else s += pick(rand, [')', ']', '}']);
      }
      if (isBalanced(s)) s += ')'; // force unbalanced
    }
    const exp = isBalanced(s);
    const prompt = `is "${s}" balanced?`;
    out.push({ id: `pb-${i}`, bundle: 'parensBalance', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          const want = exp ? /^\s*(?:\*\*)?yes\b/i : /^\s*(?:\*\*)?no\b/i;
          if (!want.test(resp)) return `t1: expected ${exp ? 'yes' : 'no'}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ----------------------------------------------------------------------------
// MAIN
// ----------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
  const n = parseInt(arg('n', '200'), 10);
  const seed = parseInt(arg('seed', '42'), 10);
  const report = arg('report', '');
  const bundle = arg('bundle', '');
  const rand = mulberry32(seed);

  const allBundles: Record<BundleId, (r: () => number, n: number) => Case[]> = {
    triePrefix:    buildTrie,
    scheduling:    buildSched,
    sat3:          buildSat,
    jsonPatch:     buildJp,
    listFlatten:   buildFl,
    slidingMax:    buildSw,
    modularExp:    buildMe,
    parensBalance: buildPb,
  };
  const bundleIds: BundleId[] = bundle ? [bundle as BundleId] : (Object.keys(allBundles) as BundleId[]);
  const cases: Case[] = [];
  for (const b of bundleIds) cases.push(...allBundles[b](rand, n));

  console.log(`=== INTENT/FORMAT/MEANING BENCH v26 (EXTREME) ===`);
  console.log(`  n=${n}  seed=${seed}  bundles=${bundleIds.join(',')}  total=${cases.length}`);

  const stats = new Map<BundleId, { pass: number; total: number }>();
  for (const b of bundleIds) stats.set(b, { pass: 0, total: 0 });
  const failures: Array<{ id: string; bundle: BundleId; prompt: string; reason: string; preview: string }> = [];

  let done = 0;
  for (const c of cases) {
    const engine = new VaiEngine();
    const hist: Message[] = [];
    let ok = true;
    for (const t of c.turns) {
      hist.push({ role: 'user', content: t.user } as any);
      let resp: any;
      try { resp = await (engine as any).chat({ messages: hist, noLearn: true }); }
      catch (e) { ok = false; failures.push({ id: c.id, bundle: c.bundle, prompt: t.user, reason: 'threw ' + (e as Error).message, preview: '' }); break; }
      const a: string = (resp?.content ?? resp?.message?.content ?? '').toString();
      hist.push({ role: 'assistant', content: a } as any);
      const r = t.check(a, hist);
      if (r) { ok = false; failures.push({ id: c.id, bundle: c.bundle, prompt: t.user, reason: r, preview: a.slice(0, 220) }); break; }
    }
    const s = stats.get(c.bundle)!;
    s.total++; if (ok) s.pass++;
    done++;
    if (done % 100 === 0) console.log(`  …${done}/${cases.length}`);
  }

  let pT = 0, tT = 0;
  for (const b of bundleIds) {
    const s = stats.get(b)!;
    pT += s.pass; tT += s.total;
    console.log(`  ${b.padEnd(20)} ${s.pass}/${s.total} (${((s.pass / s.total) * 100).toFixed(2)}%)`);
  }
  console.log(`  OVERALL              pass=${pT}/${tT} (${((pT / tT) * 100).toFixed(2)}%)`);

  if (report) {
    const abs = path.isAbsolute(report) ? report : path.resolve(process.cwd(), report);
    await fs.writeFile(abs, JSON.stringify({ n, seed, perBundle: Object.fromEntries(stats), failures }, null, 2));
    console.log(`  report: ${report}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
