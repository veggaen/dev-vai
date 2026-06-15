// intent-format-meaning-v19.mts — HARDER VARIATION BENCH
// Each bundle uses 6+ paraphrase templates and randomized numeric/text inputs
// so handlers must GENERALIZE rather than match a curated template.
//   1. compareNumbers     — random pairs, 8 paraphrases
//   2. isPalindrome       — random words (real + synthetic), 7 paraphrases
//   3. alphabetPosition   — random pos 1-26, both directions, 7 paraphrases
//   4. mathExpression     — random expressions w/ parens + precedence, 6 templates
//   5. countWordsInText   — random sentence length 2-12, 7 paraphrases

import fs from 'node:fs/promises';
import path from 'node:path';
import { VaiEngine } from '../src/models/vai-engine.js';
import type { Message } from '../src/types/index.js';

(globalThis as any).fetch = async () => { throw new TypeError('fetch disabled'); };

type BundleId = 'compareNumbers' | 'isPalindrome' | 'alphabetPosition' | 'mathExpression' | 'countWordsInText';

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
// 1. COMPARE NUMBERS — random pairs, 8 paraphrase shapes
// ---------------------------------------------------------------------------
const CMP_TEMPLATES: ((a: number, b: number) => string)[] = [
  (a, b) => `which is bigger, ${a} or ${b}?`,
  (a, b) => `which is larger: ${a} or ${b}?`,
  (a, b) => `what's greater, ${a} or ${b}?`,
  (a, b) => `between ${a} and ${b}, which is more?`,
  (a, b) => `is ${a} greater than ${b}?`,
  (a, b) => `compare ${a} and ${b} — which one is higher?`,
  (a, b) => `tell me the bigger number: ${a} or ${b}`,
  (a, b) => `pick the larger of ${a} and ${b}`,
];
function randNum(rand: () => number): number {
  const kind = Math.floor(rand() * 4);
  if (kind === 0) return Math.floor(rand() * 1000);
  if (kind === 1) return -Math.floor(rand() * 100);
  if (kind === 2) return Math.round(rand() * 100 * 100) / 100;
  return Math.round(rand() * 10 * 1000) / 1000;
}
function buildCmp(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    let a = randNum(rand), b = randNum(rand);
    if (a === b) b = a + 1;
    const bigger = a > b ? a : b;
    const tpl = CMP_TEMPLATES[i % CMP_TEMPLATES.length];
    const isYesNo = tpl(a, b).startsWith('is ');
    const expectedYesNo = isYesNo ? (a > b) : null;
    out.push({ id: `cmp-${i}`, bundle: 'compareNumbers', turns: [
      { user: tpl(a, b), check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          if (expectedYesNo !== null) {
            if (expectedYesNo) {
              if (!/\byes\b/i.test(resp)) return 't1: missing yes';
            } else {
              if (!/\bno\b|\bnot\b/i.test(resp)) return 't1: missing no';
            }
            return null;
          }
          const bs = String(bigger).replace('.', '\\.');
          if (!new RegExp(`(?<![\\d.])${bs}(?![\\d])`).test(resp)) return `t1: missing ${bigger}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. IS PALINDROME — random synthetic words (forces algorithmic answer)
// ---------------------------------------------------------------------------
function genWord(rand: () => number, palindrome: boolean): string {
  const len = 3 + Math.floor(rand() * 6);
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const half = Math.floor(len / 2);
  const buf: string[] = [];
  for (let i = 0; i < half; i++) buf.push(letters[Math.floor(rand() * 26)]);
  const mid = len % 2 === 1 ? letters[Math.floor(rand() * 26)] : '';
  if (palindrome) {
    return [...buf, mid, ...buf.slice().reverse()].join('');
  } else {
    let w: string;
    do {
      w = '';
      for (let i = 0; i < len; i++) w += letters[Math.floor(rand() * 26)];
    } while (w === w.split('').reverse().join(''));
    return w;
  }
}
const PAL_TEMPLATES: ((w: string) => string)[] = [
  (w) => `is ${w} a palindrome?`,
  (w) => `does ${w} read the same backwards?`,
  (w) => `is the word ${w} a palindrome?`,
  (w) => `is "${w}" a palindrome?`,
  (w) => `check if ${w} is a palindrome`,
  (w) => `tell me whether ${w} is a palindrome`,
  (w) => `is ${w} the same forwards and backwards?`,
];
function buildPal(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const isPalin = rand() < 0.5;
    const w = genWord(rand, isPalin);
    const tpl = PAL_TEMPLATES[i % PAL_TEMPLATES.length];
    out.push({ id: `pal-${i}`, bundle: 'isPalindrome', turns: [
      { user: tpl(w), check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          const la = lower(resp);
          if (isPalin) {
            if (/\bnot\s+a\s+palindrome\b|\bisn['’]?t\s+a\s+palindrome\b|^\s*no\b/i.test(la)) return 't1: said no (wrong)';
            if (!/\byes\b|\bis\s+a\s+palindrome\b/i.test(la)) return 't1: missing yes';
          } else {
            if (/^\s*yes\b|\bit\s+is\s+a\s+palindrome\b/i.test(la) && !/\bnot\b|\bisn['’]?t\b|\bno\b/.test(la)) return 't1: said yes (wrong)';
            if (!/\bno\b|\bnot\s+a\s+palindrome\b|\bisn['’]?t\s+a\s+palindrome\b/i.test(la)) return 't1: missing no';
          }
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. ALPHABET POSITION — both directions
// ---------------------------------------------------------------------------
const ALPHA = 'abcdefghijklmnopqrstuvwxyz';
function ord(n: number): string {
  const s = ['th','st','nd','rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
const ALPHA_TEMPLATES_POS_TO_LETTER: ((p: number) => string)[] = [
  (p) => `what is the ${ord(p)} letter of the alphabet?`,
  (p) => `which letter is in position ${p} of the alphabet?`,
  (p) => `give me the letter at index ${p} in the alphabet`,
  (p) => `what letter comes ${p === 1 ? 'first' : ord(p)} in the alphabet?`,
];
const ALPHA_TEMPLATES_LETTER_TO_POS: ((l: string) => string)[] = [
  (l) => `what position is ${l} in the alphabet?`,
  (l) => `what's the index of ${l} in the alphabet?`,
  (l) => `which number in the alphabet is ${l}?`,
];
function buildAlpha(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const reverse = rand() < 0.4;
    if (reverse) {
      const pos = 1 + Math.floor(rand() * 26);
      const letter = ALPHA[pos - 1];
      const tpl = pick(rand, ALPHA_TEMPLATES_LETTER_TO_POS);
      out.push({ id: `alp-${i}`, bundle: 'alphabetPosition', turns: [
        { user: tpl(letter), check: (resp) => {
            if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
            const nums = (resp.match(/\b\d+\b/g) || []).map(Number);
            if (!nums.includes(pos)) return `t1: missing ${pos}`;
            return null;
          }},
      ]});
    } else {
      const pos = 1 + Math.floor(rand() * 26);
      const exp = ALPHA[pos - 1];
      const tpl = pick(rand, ALPHA_TEMPLATES_POS_TO_LETTER);
      out.push({ id: `alp-${i}`, bundle: 'alphabetPosition', turns: [
        { user: tpl(pos), check: (resp) => {
            if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
            if (!new RegExp(`\\b${exp}\\b`, 'i').test(resp) && !new RegExp(`\\*\\*${exp}\\*\\*`, 'i').test(resp)) return `t1: missing ${exp}`;
            return null;
          }},
      ]});
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. MATH EXPRESSION — random shapes
// ---------------------------------------------------------------------------
function genExpr(rand: () => number): { expr: string; val: number } {
  const ops = ['+','-','*'];
  const intN = () => 1 + Math.floor(rand() * 12);
  const shape = Math.floor(rand() * 5);
  const a = intN(), b = intN(), c = intN();
  const op1 = pick(rand, ops), op2 = pick(rand, ops);
  const safeEval = (s: string): number => {
    if (!/^[\d+\-*/() .]+$/.test(s)) return NaN;
     
    return Function(`"use strict"; return (${s});`)() as number;
  };
  let expr: string;
  if (shape === 0) expr = `${a}${op1}${b}`;
  else if (shape === 1) expr = `(${a}${op1}${b})${op2}${c}`;
  else if (shape === 2) expr = `${a}${op1}(${b}${op2}${c})`;
  else if (shape === 3) expr = `${a}${op1}${b}${op2}${c}`;
  else expr = `(${a}+${b})*${c}`;
  const val = safeEval(expr);
  return { expr, val };
}
const ME_TEMPLATES: ((e: string) => string)[] = [
  (e) => `what is ${e}?`,
  (e) => `compute ${e}`,
  (e) => `evaluate ${e}`,
  (e) => `calculate ${e}`,
  (e) => `what does ${e} equal?`,
  (e) => `${e} equals what?`,
];
function buildMe(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    let g = genExpr(rand);
    let safety = 0;
    while ((!Number.isFinite(g.val) || Number.isNaN(g.val)) && safety++ < 20) g = genExpr(rand);
    if (!Number.isFinite(g.val)) g = { expr: '2+2', val: 4 };
    const tpl = ME_TEMPLATES[i % ME_TEMPLATES.length];
    out.push({ id: `me-${i}`, bundle: 'mathExpression', turns: [
      { user: tpl(g.expr), check: (resp) => {
          if (isFallback(resp) || isClarify(resp)) return 't1: bailed';
          const nums = (resp.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
          if (!nums.some(v => Math.abs(v - g.val) <= 0.01)) return `t1: missing ${g.val} for ${g.expr}`;
          return null;
        }},
    ]});
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. COUNT WORDS IN TEXT — random sentence
// ---------------------------------------------------------------------------
const WORD_POOL = ['the','quick','brown','fox','jumps','over','lazy','dog','cat','runs','fast','today','tomorrow','apple','river','code','data','model','agent','tool','build','test','plan','done','red','blue','green','yellow','far','near'];
const CW_TEMPLATES: ((t: string) => string)[] = [
  (t) => `how many words are in "${t}"?`,
  (t) => `count the words in "${t}"`,
  (t) => `what's the word count of "${t}"?`,
  (t) => `how many words does "${t}" have?`,
  (t) => `tell me the number of words in "${t}"`,
  (t) => `word count: "${t}"`,
  (t) => `how many words: "${t}"?`,
];
function buildCw(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const len = 2 + Math.floor(rand() * 11);
    const words: string[] = [];
    for (let j = 0; j < len; j++) words.push(pick(rand, WORD_POOL));
    const text = words.join(' ');
    const expected = len;
    const tpl = CW_TEMPLATES[i % CW_TEMPLATES.length];
    out.push({ id: `cw-${i}`, bundle: 'countWordsInText', turns: [
      { user: tpl(text), check: (resp) => {
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
    ...buildCmp(rand, n),
    ...buildPal(rand, n),
    ...buildAlpha(rand, n),
    ...buildMe(rand, n),
    ...buildCw(rand, n),
  ];
  const cases = bundle ? allCases.filter(c => c.bundle === bundle) : allCases;

  const stats: Record<BundleId, { pass: number; fail: number }> = {
    compareNumbers: { pass: 0, fail: 0 },
    isPalindrome: { pass: 0, fail: 0 },
    alphabetPosition: { pass: 0, fail: 0 },
    mathExpression: { pass: 0, fail: 0 },
    countWordsInText: { pass: 0, fail: 0 },
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
  console.log('\n=== INTENT/FORMAT/MEANING BENCH v19 (HARD) ===');
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
