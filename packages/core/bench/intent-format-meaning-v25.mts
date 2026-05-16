// intent-format-meaning-v25.mts — HARD7: infix-to-postfix / shortest-path / interval-overlap / poly-eval / base-arith

import fs from 'node:fs/promises';
import path from 'node:path';
import { VaiEngine } from '../src/models/vai-engine.js';
import type { Message } from '../src/types/index.js';

(globalThis as any).fetch = async () => { throw new TypeError('fetch disabled'); };

type BundleId = 'infixToPostfix' | 'shortestPath' | 'intervalOverlap' | 'polyEval' | 'baseArith';
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

// ---------------------------------------------------------------------------
// 1. INFIX -> POSTFIX (shunting yard) — single-letter operands, + - * /, parens
// ---------------------------------------------------------------------------
function toPostfix(expr: string): string {
  const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
  const out: string[] = [];
  const stack: string[] = [];
  for (const ch of expr.replace(/\s+/g, '')) {
    if (/[a-z0-9]/i.test(ch)) out.push(ch);
    else if (ch === '(') stack.push(ch);
    else if (ch === ')') {
      while (stack.length && stack[stack.length - 1] !== '(') out.push(stack.pop()!);
      stack.pop();
    } else if (ch in prec) {
      while (stack.length && stack[stack.length - 1] !== '(' && prec[stack[stack.length - 1]] >= prec[ch]) out.push(stack.pop()!);
      stack.push(ch);
    }
  }
  while (stack.length) out.push(stack.pop()!);
  return out.join(' ');
}
function buildI2P(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  const letters = 'abcdefgh';
  const ops = ['+', '-', '*', '/'];
  for (let i = 0; i < n; i++) {
    const ops3 = [pick(rand, ops), pick(rand, ops), pick(rand, ops)];
    const v = [pick(rand, letters.split('')), pick(rand, letters.split('')), pick(rand, letters.split('')), pick(rand, letters.split(''))];
    const shape = i % 3;
    let expr: string;
    if (shape === 0) expr = `${v[0]} ${ops3[0]} ${v[1]} ${ops3[1]} ${v[2]} ${ops3[2]} ${v[3]}`;
    else if (shape === 1) expr = `(${v[0]} ${ops3[0]} ${v[1]}) ${ops3[1]} ${v[2]} ${ops3[2]} ${v[3]}`;
    else expr = `${v[0]} ${ops3[0]} (${v[1]} ${ops3[1]} ${v[2]}) ${ops3[2]} ${v[3]}`;
    const expect = toPostfix(expr);
    const prompt = `convert to postfix: ${expr}`;
    out.push({ id: `i2p-${i}`, bundle: 'infixToPostfix', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          // accept with or without spaces; collapse
          const norm = (s: string) => s.replace(/[^a-z0-9+\-*/]/gi, '').toLowerCase();
          if (!norm(resp).includes(norm(expect))) return `t1: expected ${expect}`;
          return null;
        }},
    ]});
  }
  return out;
}
function pick<T>(r: () => number, a: T[]): T { return a[Math.floor(r() * a.length)]; }

// ---------------------------------------------------------------------------
// 2. SHORTEST PATH (weighted) — small undirected graph, Dijkstra
// ---------------------------------------------------------------------------
function dijkstra(nodes: string[], edges: Array<[string, string, number]>, s: string, t: string): number {
  const adj = new Map<string, Array<[string, number]>>();
  for (const n of nodes) adj.set(n, []);
  for (const [a, b, w] of edges) { adj.get(a)!.push([b, w]); adj.get(b)!.push([a, w]); }
  const dist = new Map<string, number>();
  for (const n of nodes) dist.set(n, Infinity);
  dist.set(s, 0);
  const visited = new Set<string>();
  while (visited.size < nodes.length) {
    let u: string | null = null, best = Infinity;
    for (const n of nodes) if (!visited.has(n) && dist.get(n)! < best) { best = dist.get(n)!; u = n; }
    if (u === null) break;
    visited.add(u);
    for (const [v, w] of adj.get(u)!) {
      const nd = dist.get(u)! + w;
      if (nd < dist.get(v)!) dist.set(v, nd);
    }
  }
  return dist.get(t)!;
}
function buildSP(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const nodes = ['A', 'B', 'C', 'D'];
    // Always include a path A-B, B-C, C-D + maybe shortcut
    const edges: Array<[string, string, number]> = [];
    edges.push(['A', 'B', 1 + Math.floor(rand() * 9)]);
    edges.push(['B', 'C', 1 + Math.floor(rand() * 9)]);
    edges.push(['C', 'D', 1 + Math.floor(rand() * 9)]);
    if (i % 2 === 0) edges.push(['A', 'D', 1 + Math.floor(rand() * 15)]);
    if (i % 3 === 0) edges.push(['A', 'C', 1 + Math.floor(rand() * 12)]);
    const s = 'A', t = 'D';
    const best = dijkstra(nodes, edges, s, t);
    const eStr = edges.map(([a, b, w]) => `${a}-${b}:${w}`).join(', ');
    const prompt = `edges: ${eStr}. shortest path cost from ${s} to ${t}?`;
    out.push({ id: `sp-${i}`, bundle: 'shortestPath', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          if (!new RegExp(`\\b${best}\\b`).test(resp)) return `t1: expected ${best}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. INTERVAL OVERLAP — "do [a,b] and [c,d] overlap?"
// ---------------------------------------------------------------------------
function overlap(a: number, b: number, c: number, d: number): boolean {
  return Math.max(a, c) <= Math.min(b, d);
}
function buildIO(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor(rand() * 20);
    const b = a + 1 + Math.floor(rand() * 10);
    let c: number, d: number;
    if (i % 2 === 0) {
      // overlap
      c = a + Math.floor(rand() * (b - a + 1));
      d = c + 1 + Math.floor(rand() * 10);
    } else {
      // no overlap
      c = b + 1 + Math.floor(rand() * 10);
      d = c + 1 + Math.floor(rand() * 5);
    }
    const exp = overlap(a, b, c, d);
    const prompt = `do intervals [${a},${b}] and [${c},${d}] overlap?`;
    out.push({ id: `io-${i}`, bundle: 'intervalOverlap', turns: [
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

// ---------------------------------------------------------------------------
// 4. POLY EVAL — "evaluate polynomial: 2x^2 + 3x + 1 at x=4"
// ---------------------------------------------------------------------------
function buildPE(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const a = 1 + Math.floor(rand() * 9);
    const b = 1 + Math.floor(rand() * 9);
    const c = 0 + Math.floor(rand() * 10);
    const x = 1 + Math.floor(rand() * 9);
    const val = a * x * x + b * x + c;
    const prompt = `evaluate polynomial: ${a}x^2 + ${b}x + ${c} at x=${x}`;
    out.push({ id: `pe-${i}`, bundle: 'polyEval', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          if (!new RegExp(`\\b${val}\\b`).test(resp)) return `t1: expected ${val}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. BASE ARITH — "in base 5, what is 23 + 14?"
// ---------------------------------------------------------------------------
function toBase(n: number, b: number): string { return n.toString(b).toUpperCase(); }
function fromBase(s: string, b: number): number { return parseInt(s, b); }
function buildBA(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  const bases = [2, 3, 5, 8, 16];
  for (let i = 0; i < n; i++) {
    const base = bases[i % bases.length];
    const x = 5 + Math.floor(rand() * 50);
    const y = 1 + Math.floor(rand() * 30);
    const op = (i % 2 === 0) ? '+' : '-';
    const result = op === '+' ? x + y : x - y;
    const xs = toBase(x, base);
    const ys = toBase(y, base);
    const rs = toBase(result, base);
    const prompt = `in base ${base}, what is ${xs} ${op} ${ys}?`;
    out.push({ id: `ba-${i}`, bundle: 'baseArith', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          // Use substring match anchored to known boundaries (handles negative results like -2)
          const cleaned = resp.toUpperCase();
          const wantLeft = result < 0 ? `-${(-result).toString(base).toUpperCase()}` : rs;
          if (!cleaned.includes(wantLeft.toUpperCase())) return `t1: expected ${rs}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const argN = parseInt((args.find(a => a.startsWith('--n=')) || '').slice(4)) || 200;
  const argSeed = parseInt((args.find(a => a.startsWith('--seed=')) || '').slice(7)) || 42;
  const reportArg = (args.find(a => a.startsWith('--report=')) || '').slice(9);
  const bundleArg = (args.find(a => a.startsWith('--bundle=')) || '').slice(9);

  const rand = mulberry32(argSeed);
  const allBundles: Record<BundleId, (r: () => number, n: number) => Case[]> = {
    infixToPostfix: buildI2P,
    shortestPath:   buildSP,
    intervalOverlap: buildIO,
    polyEval:       buildPE,
    baseArith:      buildBA,
  };
  const bundleIds: BundleId[] = bundleArg ? [bundleArg as BundleId] : (Object.keys(allBundles) as BundleId[]);

  const cases: Case[] = [];
  for (const b of bundleIds) cases.push(...allBundles[b](rand, argN));

  console.log(`=== INTENT/FORMAT/MEANING BENCH v25 (HARD7) ===`);
  console.log(`  n=${argN}  seed=${argSeed}  bundles=${bundleIds.join(',')}  total=${cases.length}`);

  const perBundle = new Map<BundleId, { pass: number; total: number }>();
  for (const b of bundleIds) perBundle.set(b, { pass: 0, total: 0 });
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
    const stats = perBundle.get(c.bundle)!;
    stats.total++; if (ok) stats.pass++;
    done++;
    if (done % 100 === 0) console.log(`  …${done}/${cases.length}`);
  }

  let passTot = 0, total = 0;
  for (const b of bundleIds) {
    const s = perBundle.get(b)!;
    passTot += s.pass; total += s.total;
    console.log(`  ${b.padEnd(20)} ${s.pass}/${s.total} (${((s.pass / s.total) * 100).toFixed(2)}%)`);
  }
  console.log(`  OVERALL              pass=${passTot}/${total} (${((passTot / total) * 100).toFixed(2)}%)`);

  if (reportArg) {
    const abs = path.isAbsolute(reportArg) ? reportArg : path.resolve(process.cwd(), reportArg);
    await fs.writeFile(abs, JSON.stringify({ n: argN, seed: argSeed, perBundle: Object.fromEntries(perBundle), failures }, null, 2));
    console.log(`  report: ${reportArg}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
