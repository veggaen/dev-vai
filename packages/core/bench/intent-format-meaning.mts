/**
 * Intent / Format / Meaning bench — three-bundle harness.
 *
 * Why a separate bench from `fuzz-random.mts`?
 * fuzz-random measures topic-coverage + shape-honoring across a wide grid.
 * This bench targets the three failure modes V3gga called out:
 *
 *   1. INTENT  — literal-output directives ("only the name", "just the
 *                year", "in one word", "answer with the number"). The
 *                answer must contain ONLY the requested atom and nothing
 *                else (no preamble, no explanation, no markdown chrome).
 *
 *   2. FORMAT  — structural directives ("as a numbered list of N", "as
 *                CSV", "as a markdown table", "as JSON with keys X,Y").
 *                The answer must match the requested structure exactly.
 *
 *   3. MEANING — ambiguous topics with two or three legitimate readings
 *                ("python" = snake | language; "mercury" = element |
 *                planet | god; "java" = language | island | coffee).
 *                The answer must commit to ONE reading consistent with
 *                the disambiguation hint in the prompt — never mix
 *                readings, never refuse, never silently pick the wrong one.
 *
 * Verdicts per case: PASS / FAIL with short reason. Tally per bundle.
 *
 * Usage:
 *   pnpm exec tsx bench/intent-format-meaning.mts --n=300 --seed=42
 *   pnpm exec tsx bench/intent-format-meaning.mts --bundle=intent --n=200
 *   pnpm exec tsx bench/intent-format-meaning.mts --report=../../_ifm_run1.json
 */

import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { VaiEngine } from '../src/models/vai-engine.js';

type Verdict = 'PASS' | 'FAIL';
type BundleId = 'intent' | 'format' | 'meaning';

interface Case {
  id: string;
  bundle: BundleId;
  prompt: string;
  /** Returns null when the answer passes; otherwise a short reason. */
  check: (answer: string) => string | null;
}

// ---------------------------------------------------------------------------
// PRNG
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
const HONEST_FALLBACK = /^I (?:don'?t (?:have|know)|can'?t|cannot|haven'?t|am not)\b/i;
const CLARIFY = /could you say a bit more|what (?:specifically|exactly) do you mean|which (?:one|sense|meaning)/i;
function isFallback(a: string): boolean { return HONEST_FALLBACK.test(a.trim()); }
function isClarify(a: string): boolean { return CLARIFY.test(a); }

function stripChrome(a: string): string {
  return a
    .replace(/\*\*/g, '')
    .replace(/^[#>*_\-]+\s*/gm, '')
    .replace(/`+/g, '')
    .trim();
}

function countLines(a: string): number {
  return a.split(/\r?\n/).filter(l => l.trim().length > 0).length;
}

// ---------------------------------------------------------------------------
// BUNDLE 1 — INTENT (literal-output directives)
// ---------------------------------------------------------------------------
interface IntentSeed {
  prompt: string;
  /** Acceptable answer atoms (case-insensitive). */
  expect: string[];
  /** Maximum chars the answer is allowed to be. */
  maxChars: number;
  /** Forbidden substrings (regexes). Trip → FAIL. */
  forbid?: RegExp[];
}

const INTENT_SEEDS: IntentSeed[] = [
  // Name-only
  { prompt: 'who founded apple inc? only the name, no other text.', expect: ['steve jobs', 'jobs'], maxChars: 60 },
  { prompt: 'who painted the mona lisa? only the name.',           expect: ['da vinci', 'leonardo'], maxChars: 60 },
  { prompt: 'who wrote 1984? just the name, nothing else.',        expect: ['orwell', 'george orwell'], maxChars: 60 },
  { prompt: 'who invented the telephone? only the name.',          expect: ['bell', 'alexander graham bell'], maxChars: 60 },
  { prompt: 'who is the current ceo of microsoft? name only.',     expect: ['nadella', 'satya nadella'], maxChars: 60 },
  // Year-only
  { prompt: 'in what year did world war 2 end? just the year.',    expect: ['1945'], maxChars: 30 },
  { prompt: 'when did the berlin wall fall? only the year.',       expect: ['1989'], maxChars: 30 },
  { prompt: 'what year was python first released? year only.',     expect: ['1991'], maxChars: 30 },
  { prompt: 'what year did the soviet union dissolve? just the year.', expect: ['1991'], maxChars: 30 },
  { prompt: 'what year was the eu founded? year only.',            expect: ['1993'], maxChars: 30 },
  // One-word / number / value
  { prompt: 'capital of france — one word answer.',                expect: ['paris'], maxChars: 20 },
  { prompt: 'capital of japan — one word.',                        expect: ['tokyo'], maxChars: 20 },
  { prompt: 'how many planets in the solar system? just the number.', expect: ['8', 'eight'], maxChars: 20 },
  { prompt: 'how many continents are there? number only.',         expect: ['7', 'seven'], maxChars: 20 },
  { prompt: 'chemical symbol for gold — only the symbol.',         expect: ['au'], maxChars: 10 },
  { prompt: 'chemical symbol for water — just the formula.',       expect: ['h2o', 'h₂o'], maxChars: 12 },
  // No preamble
  { prompt: 'what is the capital of norway? no preamble, no explanation.', expect: ['oslo'], maxChars: 80 },
  { prompt: 'what is the capital of sweden? no extra text.',       expect: ['stockholm'], maxChars: 80 },
  { prompt: 'what is the largest ocean? answer with only the name.', expect: ['pacific'], maxChars: 60 },
  { prompt: 'what is the smallest planet? name only.',             expect: ['mercury'], maxChars: 60 },
];

const INTENT_PARAPHRASES = [
  (s: string) => s,
  (s: string) => `please ${s.toLowerCase()}`,
  (s: string) => `${s} thanks`,
  (s: string) => s.replace('only the name', 'just the name'),
  (s: string) => s.replace('only the year', 'just the year'),
  (s: string) => s.replace(/[?.]$/, '') + ' — no other text please.',
  (s: string) => `quick: ${s.toLowerCase()}`,
  (s: string) => s.replace('one word answer', 'in one word'),
  (s: string) => s.replace('number only', 'just the number'),
  (s: string) => `${s} (terse)`,
];

function buildIntentCases(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = INTENT_SEEDS[i % INTENT_SEEDS.length];
    const para = pick(rand, INTENT_PARAPHRASES);
    const prompt = para(seed.prompt);
    out.push({
      id: `intent-${i}`,
      bundle: 'intent',
      prompt,
      check: (raw) => {
        const a = stripChrome(raw);
        if (a.length === 0) return 'empty answer';
        if (isFallback(a) || isClarify(a)) return 'engine bailed (fallback/clarify) on a literal-output prompt';
        const lower = a.toLowerCase();
        const hit = seed.expect.some(e => lower.includes(e.toLowerCase()));
        if (!hit) return `missing expected atom (one of: ${seed.expect.join(' | ')})`;
        if (a.length > seed.maxChars) return `too verbose for literal-output directive (${a.length} > ${seed.maxChars})`;
        // Generic preamble guard.
        if (/^(?:sure|of course|absolutely|certainly|here'?s|the answer is|that would be|i think|well,)/i.test(a)) {
          return 'leading preamble after "no preamble" directive';
        }
        if (seed.forbid?.some(p => p.test(a))) return 'forbidden phrase present';
        return null;
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 2 — FORMAT (structural directives)
// ---------------------------------------------------------------------------
interface FormatSeed {
  prompt: string;
  shape: 'numbered-list' | 'csv' | 'table' | 'json' | 'bullet-list';
  /** Required count for list shapes (ignored otherwise). */
  count?: number;
  /** Topic atom that must appear somewhere in the answer. */
  topic: string[];
}

const FORMAT_SEEDS: FormatSeed[] = [
  // Numbered list with explicit count
  { prompt: 'list 5 facts about france as a numbered list',         shape: 'numbered-list', count: 5, topic: ['france', 'paris', 'european'] },
  { prompt: 'give me 4 facts about japan as a numbered list',       shape: 'numbered-list', count: 4, topic: ['japan', 'tokyo', 'asia'] },
  { prompt: 'list 3 facts about germany as a numbered list',        shape: 'numbered-list', count: 3, topic: ['germany', 'berlin'] },
  { prompt: '5 numbered facts about brazil',                        shape: 'numbered-list', count: 5, topic: ['brazil', 'south america'] },
  { prompt: 'enumerate 4 things about norway in a numbered list',   shape: 'numbered-list', count: 4, topic: ['norway', 'oslo'] },
  // Bullet list with explicit count
  { prompt: '4 bullet points about aristotle',                      shape: 'bullet-list',   count: 4, topic: ['aristotle', 'philosopher', 'greek'] },
  { prompt: '3 bullet points about plato',                          shape: 'bullet-list',   count: 3, topic: ['plato', 'philosopher'] },
  { prompt: '5 bullet points about react',                          shape: 'bullet-list',   count: 5, topic: ['react', 'library', 'ui'] },
  // CSV
  { prompt: 'list the 7 continents as comma-separated values',      shape: 'csv',           topic: ['africa', 'asia', 'europe'] },
  { prompt: 'give me the days of the week as csv',                  shape: 'csv',           topic: ['monday', 'tuesday', 'sunday'] },
  // Table
  { prompt: 'compare http and https as a markdown table',           shape: 'table',         topic: ['http', 'https'] },
  { prompt: 'compare typescript and javascript in a markdown table', shape: 'table',        topic: ['typescript', 'javascript'] },
  // JSON
  { prompt: 'return the capital of france as JSON with keys country and capital', shape: 'json', topic: ['france', 'paris'] },
  { prompt: 'give me information about norway as a json object with keys name, capital, continent', shape: 'json', topic: ['norway', 'oslo'] },
];

const FORMAT_PARAPHRASES = [
  (s: string) => s,
  (s: string) => `please ${s}`,
  (s: string) => `${s} — exactly that shape please`,
  (s: string) => `${s} (no extra prose)`,
  (s: string) => `${s} only`,
];

function checkNumberedList(a: string, want: number): string | null {
  const numbered = (a.match(/^\s*\d+[.)]\s+/gm) || []).length;
  if (numbered < want) return `expected ${want} numbered items, got ${numbered}`;
  return null;
}
function checkBulletList(a: string, want: number): string | null {
  const bullets = (a.match(/^\s*[-*•]\s+/gm) || []).length;
  const numbered = (a.match(/^\s*\d+[.)]\s+/gm) || []).length;
  // A numbered list is also acceptable for "bullet points" since both signal
  // an enumerated structure — what matters is N items.
  const total = bullets + numbered;
  if (total < want) return `expected ${want} bullet/numbered items, got ${total}`;
  return null;
}
function checkCsv(a: string): string | null {
  // Must contain at least one line dominated by commas (≥3 commas) and no
  // numbered/bullet list markers on the dominant line.
  const lines = a.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const csvLine = lines.find(l => (l.match(/,/g) || []).length >= 3 && !/^\s*[\d-*•]/.test(l));
  if (!csvLine) return 'no comma-separated line with ≥3 commas';
  return null;
}
function checkTable(a: string): string | null {
  // Markdown table — header + separator row of `---`.
  if (!/\|[^\n]+\|/.test(a)) return 'no pipe-delimited rows';
  if (!/\|[\s:|-]*-{3,}[\s:|-]*\|/.test(a)) return 'no markdown table separator (`---`)';
  return null;
}
function checkJson(a: string): string | null {
  // Find a fenced JSON block first, otherwise scan for a top-level {...}.
  let body: string | null = null;
  const fenced = a.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenced) body = fenced[1];
  else {
    const brace = a.match(/\{[\s\S]+\}/);
    if (brace) body = brace[0];
  }
  if (!body) return 'no JSON body found';
  try {
    JSON.parse(body);
    return null;
  } catch (err) {
    return `invalid JSON: ${(err as Error).message.slice(0, 60)}`;
  }
}

function buildFormatCases(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = FORMAT_SEEDS[i % FORMAT_SEEDS.length];
    const para = pick(rand, FORMAT_PARAPHRASES);
    const prompt = para(seed.prompt);
    out.push({
      id: `format-${i}`,
      bundle: 'format',
      prompt,
      check: (raw) => {
        if (raw.trim().length === 0) return 'empty answer';
        if (isFallback(raw) || isClarify(raw)) return 'engine bailed (fallback/clarify) on a format prompt';
        const lower = raw.toLowerCase();
        if (!seed.topic.some(t => lower.includes(t.toLowerCase()))) {
          return `topic missing — expected one of: ${seed.topic.join(' | ')}`;
        }
        switch (seed.shape) {
          case 'numbered-list': return checkNumberedList(raw, seed.count ?? 3);
          case 'bullet-list':   return checkBulletList(raw, seed.count ?? 3);
          case 'csv':           return checkCsv(raw);
          case 'table':         return checkTable(raw);
          case 'json':          return checkJson(raw);
        }
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// BUNDLE 3 — MEANING (ambiguous topics with explicit disambiguation)
// ---------------------------------------------------------------------------
interface MeaningSeed {
  prompt: string;
  /** Atoms that signal the right reading. At least one must be present. */
  expect: string[];
  /** Atoms that signal the WRONG reading. None may be present. */
  forbid: string[];
}

const MEANING_SEEDS: MeaningSeed[] = [
  // python
  { prompt: 'tell me about python the programming language',  expect: ['programming language', 'guido', 'rossum', 'interpreter', 'syntax'], forbid: ['snake', 'reptile', 'serpent', 'constrictor'] },
  { prompt: 'tell me about python the snake',                 expect: ['snake', 'reptile', 'constrictor', 'serpent', 'non-venomous'], forbid: ['programming language', 'guido', 'rossum'] },
  // mercury
  { prompt: 'tell me about mercury the planet',               expect: ['planet', 'sun', 'solar system', 'closest'], forbid: ['element', 'liquid metal', 'roman god', 'messenger god'] },
  { prompt: 'tell me about mercury the element',              expect: ['element', 'liquid metal', 'hg', 'metal', 'periodic'], forbid: ['planet', 'closest to the sun'] },
  { prompt: 'tell me about mercury the roman god',            expect: ['god', 'messenger', 'roman', 'mythology'], forbid: ['planet', 'liquid metal', 'periodic'] },
  // java
  { prompt: 'tell me about java the programming language',    expect: ['programming language', 'jvm', 'sun microsystems', 'oracle', 'object-oriented'], forbid: ['island', 'indonesia', 'coffee bean'] },
  { prompt: 'tell me about java the island',                  expect: ['island', 'indonesia', 'jakarta'], forbid: ['programming language', 'jvm', 'oracle'] },
  // apple
  { prompt: 'tell me about apple the company',                expect: ['company', 'jobs', 'cupertino', 'iphone', 'mac'], forbid: ['fruit', 'orchard', 'tree fruit'] },
  { prompt: 'tell me about apple the fruit',                  expect: ['fruit', 'tree', 'orchard', 'malus'], forbid: ['steve jobs', 'iphone', 'cupertino'] },
  // turkey
  { prompt: 'tell me about turkey the country',               expect: ['country', 'ankara', 'istanbul', 'anatolia'], forbid: ['bird', 'thanksgiving', 'fowl'] },
  { prompt: 'tell me about turkey the bird',                  expect: ['bird', 'fowl', 'thanksgiving', 'galliformes'], forbid: ['ankara', 'istanbul', 'anatolia'] },
  // amazon
  { prompt: 'tell me about amazon the river',                 expect: ['river', 'south america', 'brazil', 'rainforest'], forbid: ['bezos', 'aws', 'e-commerce', 'company'] },
  { prompt: 'tell me about amazon the company',               expect: ['company', 'bezos', 'e-commerce', 'aws'], forbid: ['river', 'rainforest', 'tributary'] },
];

const MEANING_PARAPHRASES = [
  (s: string) => s,
  (s: string) => s.replace('tell me about', 'what is'),
  (s: string) => s.replace('tell me about', 'explain'),
  (s: string) => s.replace('tell me about', 'describe'),
  (s: string) => `${s}, briefly`,
  (s: string) => `please ${s.toLowerCase()}`,
];

function buildMeaningCases(rand: () => number, n: number): Case[] {
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    const seed = MEANING_SEEDS[i % MEANING_SEEDS.length];
    const para = pick(rand, MEANING_PARAPHRASES);
    const prompt = para(seed.prompt);
    out.push({
      id: `meaning-${i}`,
      bundle: 'meaning',
      prompt,
      check: (raw) => {
        if (raw.trim().length === 0) return 'empty answer';
        if (isFallback(raw) || isClarify(raw)) return 'engine bailed (fallback/clarify) on disambiguated prompt';
        const lower = raw.toLowerCase();
        const hitRight = seed.expect.some(e => lower.includes(e.toLowerCase()));
        const hitWrong = seed.forbid.find(f => lower.includes(f.toLowerCase()));
        if (hitWrong) return `wrong reading — found "${hitWrong}" (forbidden for this disambiguation)`;
        if (!hitRight) return `right reading missing — expected one of: ${seed.expect.slice(0, 4).join(' | ')}`;
        return null;
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
interface Args {
  n: number;          // per-bundle case count
  seed: number;
  bundle: BundleId | 'all';
  report: string | null;
}
function parseArgs(): Args {
  const args = process.argv.slice(2);
  let n = 1000, seed = 42, report: string | null = null;
  let bundle: BundleId | 'all' = 'all';
  for (const a of args) {
    if (a.startsWith('--n=')) n = Number(a.slice(4));
    else if (a.startsWith('--seed=')) seed = Number(a.slice(7));
    else if (a.startsWith('--report=')) report = a.slice(9);
    else if (a.startsWith('--bundle=')) bundle = a.slice(9) as BundleId | 'all';
  }
  return { n, seed, bundle, report };
}

async function run() {
  const { n, seed, bundle, report } = parseArgs();
  const rand = mulberry32(seed);

  const cases: Case[] = [];
  if (bundle === 'all' || bundle === 'intent')  cases.push(...buildIntentCases(rand, n));
  if (bundle === 'all' || bundle === 'format')  cases.push(...buildFormatCases(rand, n));
  if (bundle === 'all' || bundle === 'meaning') cases.push(...buildMeaningCases(rand, n));

  const engine = new VaiEngine();
  (engine as unknown as { _nowMs: () => number })._nowMs = () => new Date('2026-05-15T10:00:00Z').getTime();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError('fetch disabled in ifm bench'); }) as typeof fetch;

  const tally: Record<BundleId, { pass: number; fail: number }> = {
    intent:  { pass: 0, fail: 0 },
    format:  { pass: 0, fail: 0 },
    meaning: { pass: 0, fail: 0 },
  };
  const failures: Array<{ id: string; bundle: BundleId; prompt: string; reason: string; preview: string }> = [];
  const t0 = performance.now();

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    let answer = '';
    try {
      const r = await engine.chat({
        messages: [{ role: 'user', content: c.prompt }],
        temperature: 0,
        maxTokens: 320,
        noLearn: true,
      } as never);
      answer = r.message.content;
    } catch (err) {
      answer = `__ERROR__ ${(err as Error).message}`;
    }

    const reason = c.check(answer);
    const verdict: Verdict = reason === null ? 'PASS' : 'FAIL';
    if (verdict === 'PASS') tally[c.bundle].pass++;
    else {
      tally[c.bundle].fail++;
      if (failures.length < 5000) {
        failures.push({
          id: c.id,
          bundle: c.bundle,
          prompt: c.prompt,
          reason: reason ?? '?',
          preview: answer.slice(0, 220).replace(/\s+/g, ' '),
        });
      }
    }

    if ((i + 1) % 100 === 0) {
      const total = tally.intent.pass + tally.format.pass + tally.meaning.pass
                  + tally.intent.fail + tally.format.fail + tally.meaning.fail;
      const passes = tally.intent.pass + tally.format.pass + tally.meaning.pass;
      process.stdout.write(`  [${i + 1}/${cases.length}] PASS=${passes}/${total}\n`);
    }
  }

  const totalMs = Math.round(performance.now() - t0);
  globalThis.fetch = originalFetch;

  console.log('');
  console.log('=== Intent / Format / Meaning bench ===');
  console.log(`n_per_bundle=${n}  seed=${seed}  totalCases=${cases.length}  totalMs=${totalMs}`);
  for (const b of ['intent', 'format', 'meaning'] as const) {
    const t = tally[b];
    const sum = t.pass + t.fail;
    if (sum === 0) continue;
    const rate = ((t.pass / sum) * 100).toFixed(2);
    console.log(`  ${b.padEnd(8)} pass=${t.pass}/${sum}  (${rate}%)  fail=${t.fail}`);
  }
  const overallPass = tally.intent.pass + tally.format.pass + tally.meaning.pass;
  const overallSum  = overallPass + tally.intent.fail + tally.format.fail + tally.meaning.fail;
  console.log(`  ${'OVERALL'.padEnd(8)} pass=${overallPass}/${overallSum}  (${((overallPass/overallSum)*100).toFixed(2)}%)`);

  console.log('');
  if (failures.length > 0) {
    console.log(`First ${Math.min(15, failures.length)} failures:`);
    for (const f of failures.slice(0, 15)) {
      console.log(`  [${f.bundle}] ${f.prompt}`);
      console.log(`    reason: ${f.reason}`);
      console.log(`    answer: ${f.preview.slice(0, 140)}`);
    }
  }

  if (report) {
    writeFileSync(report, JSON.stringify({
      n, seed, totalMs, tally, failures,
    }, null, 2));
    console.log(`\nReport written to ${report}`);
  }
}

run().catch(err => { console.error(err); process.exit(1); });
