// intent-format-meaning-v23.mts — HARD5: matrices, encoding, graphs, regex, anagrams

import fs from 'node:fs/promises';
import path from 'node:path';
import { VaiEngine } from '../src/models/vai-engine.js';
import type { Message } from '../src/types/index.js';

(globalThis as any).fetch = async () => { throw new TypeError('fetch disabled'); };

type BundleId = 'matrixOps' | 'caesarCipher' | 'graphReach' | 'regexExtract' | 'anagramCheck';
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
// 1. MATRIX OPS — transpose / row sums / largest
// ---------------------------------------------------------------------------
function buildMo(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const kind = i % 3;
    const rows = 2 + Math.floor(rand() * 2); // 2 or 3
    const cols = 2 + Math.floor(rand() * 2);
    const mat: number[][] = [];
    for (let r = 0; r < rows; r++) {
      const row: number[] = [];
      for (let c = 0; c < cols; c++) row.push(1 + Math.floor(rand() * 50));
      mat.push(row);
    }
    const matStr = `[${mat.map(r => `[${r.join(',')}]`).join(',')}]`;
    let prompt: string, expected: string[];
    if (kind === 0) {
      // transpose
      const t: number[][] = [];
      for (let c = 0; c < cols; c++) {
        const row: number[] = [];
        for (let r = 0; r < rows; r++) row.push(mat[r][c]);
        t.push(row);
      }
      // expected: every transposed row should appear as comma-listed numbers in order
      expected = t.map(r => r.join(','));
      prompt = `transpose ${matStr}`;
    } else if (kind === 1) {
      // row sums
      const sums = mat.map(r => r.reduce((a, b) => a + b, 0));
      expected = sums.map(String);
      prompt = `what are the row sums of ${matStr}?`;
    } else {
      // largest
      let max = mat[0][0];
      for (const r of mat) for (const v of r) if (v > max) max = v;
      expected = [String(max)];
      prompt = `what's the largest value in ${matStr}?`;
    }
    out.push({ id: `mo-${i}`, bundle: 'matrixOps', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          for (const e of expected) {
            if (!new RegExp(`\\b${e.replace(/,/g, '\\s*,\\s*')}\\b`).test(resp)) return `t1: missing ${e}`;
          }
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. CAESAR CIPHER — encode/decode/rot13
// ---------------------------------------------------------------------------
function caesar(s: string, shift: number): string {
  return s.split('').map(ch => {
    const c = ch.charCodeAt(0);
    if (c >= 97 && c <= 122) return String.fromCharCode(((c - 97 + shift + 26) % 26) + 97);
    if (c >= 65 && c <= 90) return String.fromCharCode(((c - 65 + shift + 26) % 26) + 65);
    return ch;
  }).join('');
}
const CC_WORDS = ['hello','world','vegga','crypto','simple','cipher','random','letter','encode','secret','puzzle','answer'];
function buildCc(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const kind = i % 3;
    const word = pick(rand, CC_WORDS);
    const shift = 1 + Math.floor(rand() * 24);
    let prompt: string, expected: string;
    if (kind === 0) {
      expected = caesar(word, shift);
      prompt = `apply a caesar cipher with shift ${shift} to "${word}"`;
    } else if (kind === 1) {
      const encoded = caesar(word, shift);
      expected = word;
      prompt = `decode the caesar cipher "${encoded}" with shift ${shift}`;
    } else {
      expected = caesar(word, 13);
      prompt = `apply rot13 to "${word}"`;
    }
    out.push({ id: `cc-${i}`, bundle: 'caesarCipher', turns: [
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
// 3. GRAPH REACHABILITY — "edges: A->B, B->C. can A reach C?"
// ---------------------------------------------------------------------------
function buildGr(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  const nodes = ['A','B','C','D','E','F'];
  for (let i = 0; i < n; i++) {
    // Build a small random DAG
    const numNodes = 4 + Math.floor(rand() * 3); // 4-6
    const used = nodes.slice(0, numNodes);
    const edges: Array<[string, string]> = [];
    for (let k = 0; k < numNodes - 1; k++) {
      // every k has at least one outgoing to k+1..end
      const target = k + 1 + Math.floor(rand() * (numNodes - k - 1));
      edges.push([used[k], used[target]]);
    }
    // Maybe add 1-2 extra random forward edges
    const extra = Math.floor(rand() * 3);
    for (let e = 0; e < extra; e++) {
      const a = Math.floor(rand() * (numNodes - 1));
      const b = a + 1 + Math.floor(rand() * (numNodes - a - 1));
      if (a !== b) edges.push([used[a], used[b]]);
    }
    // Choose query (start, end)
    const startIdx = Math.floor(rand() * (numNodes - 1));
    const endIdx = startIdx + 1 + Math.floor(rand() * (numNodes - startIdx - 1));
    const start = used[startIdx], end = used[endIdx];
    // Compute reachability via BFS
    const adj = new Map<string, string[]>();
    for (const n of used) adj.set(n, []);
    for (const [a, b] of edges) adj.get(a)!.push(b);
    const visited = new Set<string>([start]);
    const queue = [start];
    let reachable = false;
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur === end) { reachable = true; break; }
      for (const nx of adj.get(cur)!) if (!visited.has(nx)) { visited.add(nx); queue.push(nx); }
    }
    const edgeStr = edges.map(([a, b]) => `${a}->${b}`).join(', ');
    const prompt = `edges: ${edgeStr}. can ${start} reach ${end}?`;
    const expected = reachable ? 'yes' : 'no';
    out.push({ id: `gr-${i}`, bundle: 'graphReach', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          // Just check leading yes/no
          const lr = lower(resp).trim();
          if (!new RegExp(`^\\**${expected}\\b|\\b${expected}\\*?\\.?\\s|^\\**${expected}\\*?[\\.\\s]`).test(lr)) {
            // Also check the response prominently includes the expected and not the opposite as the primary answer
            const opp = expected === 'yes' ? 'no' : 'yes';
            if (lr.startsWith(opp) || lr.startsWith(`**${opp}`)) return `t1: said ${opp} expected ${expected}`;
            if (!new RegExp(`\\b${expected}\\b`).test(lr)) return `t1: missing ${expected}`;
          }
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. REGEX EXTRACT — "extract all digits/vowels/uppercase from 'X'"
// ---------------------------------------------------------------------------
function buildRx(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const kind = i % 3;
    // Build a mixed string
    const parts: string[] = [];
    const len = 8 + Math.floor(rand() * 8);
    for (let k = 0; k < len; k++) {
      const r = rand();
      if (r < 0.3) parts.push(String.fromCharCode(48 + Math.floor(rand() * 10)));
      else if (r < 0.5) parts.push(String.fromCharCode(65 + Math.floor(rand() * 26)));
      else parts.push(String.fromCharCode(97 + Math.floor(rand() * 26)));
    }
    const s = parts.join('');
    let prompt: string, expected: string;
    if (kind === 0) {
      expected = (s.match(/\d/g) || []).join('');
      if (expected.length === 0) expected = '(none)';
      prompt = `extract all digits from "${s}"`;
    } else if (kind === 1) {
      expected = String((s.match(/[aeiouAEIOU]/g) || []).length);
      prompt = `count vowels in "${s}"`;
    } else {
      expected = (s.match(/[A-Z]/g) || []).join('');
      if (expected.length === 0) expected = '(none)';
      prompt = `extract all uppercase letters from "${s}"`;
    }
    out.push({ id: `rx-${i}`, bundle: 'regexExtract', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          if (expected === '(none)') {
            if (!/\b(none|no\s+(?:digits|uppercase|matches)|empty|0)\b/i.test(resp)) return `t1: missing (none)`;
            return null;
          }
          if (kind === 1) {
            if (!new RegExp(`\\b${expected}\\b`).test(resp)) return `t1: missing ${expected}`;
            return null;
          }
          if (!new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(resp)) return `t1: missing ${expected}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. ANAGRAM CHECK — "is X an anagram of Y?"
// ---------------------------------------------------------------------------
const AN_PAIRS: Array<[string, string]> = [
  ['listen','silent'], ['evil','vile'], ['dusty','study'], ['night','thing'],
  ['stressed','desserts'], ['save','vase'], ['heart','earth'], ['angel','glean'],
];
function buildAn(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const kind = i % 2;
    let a: string, b: string, expected: 'yes' | 'no';
    if (kind === 0) {
      [a, b] = pick(rand, AN_PAIRS);
      expected = 'yes';
    } else {
      a = pick(rand, AN_PAIRS)[0];
      // Pick a definitely-non-anagram
      const otherWords = ['planet','random','jumble','strong','bright','quartz','flicker','sphere'];
      b = pick(rand, otherWords);
      // Confirm non-anagram
      const sa = a.split('').sort().join('');
      const sb = b.split('').sort().join('');
      expected = sa === sb ? 'yes' : 'no';
    }
    const prompt = `is "${a}" an anagram of "${b}"?`;
    out.push({ id: `an-${i}`, bundle: 'anagramCheck', turns: [
      { user: prompt, check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          const lr = lower(resp).trim();
          const opp = expected === 'yes' ? 'no' : 'yes';
          if (lr.startsWith(opp) || lr.startsWith(`**${opp}`)) return `t1: said ${opp} expected ${expected}`;
          if (!new RegExp(`\\b${expected}\\b`).test(lr)) return `t1: missing ${expected}`;
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
    ...buildMo(rand, n),
    ...buildCc(rand, n),
    ...buildGr(rand, n),
    ...buildRx(rand, n),
    ...buildAn(rand, n),
  ];
  const cases = bundle ? allCases.filter(c => c.bundle === bundle) : allCases;
  const stats: Record<BundleId, { pass: number; fail: number }> = {
    matrixOps: { pass: 0, fail: 0 },
    caesarCipher: { pass: 0, fail: 0 },
    graphReach: { pass: 0, fail: 0 },
    regexExtract: { pass: 0, fail: 0 },
    anagramCheck: { pass: 0, fail: 0 },
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
  console.log('\n=== INTENT/FORMAT/MEANING BENCH v23 (HARD5) ===');
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
