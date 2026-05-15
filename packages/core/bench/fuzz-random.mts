/**
 * Random-prompt fuzz harness.
 *
 * Generates N pseudo-random prompts by sampling (template × topic × style)
 * and runs each through VaiEngine with a *dual* gate:
 *
 *   - content gate: answer must reference the topic keyword (or one of its
 *     accepted aliases) AND must not trip any FALLBACK / LOWQ / SHORT
 *     pattern.
 *   - format gate: depending on the template — single-sentence prompts must
 *     produce ≤ 3 sentences; "list N" prompts must produce ≥ N list-item
 *     markers (`1.`/`-`/`*` line-starts) OR an enumeration; "table" prompts
 *     must produce a markdown table; "name only" prompts must stay short
 *     (≤ 120 chars) and not contain explanatory clauses.
 *
 * Usage:
 *   pnpm exec tsx bench/fuzz-random.mts --n=2000 --seed=42
 *   pnpm exec tsx bench/fuzz-random.mts --n=500 --report=_fuzz_run1.json
 */

import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { VaiEngine } from '../src/models/vai-engine.js';

type Verdict = 'PASS' | 'CONTENT_FAIL' | 'FORMAT_FAIL' | 'FALLBACK' | 'LOWQ' | 'SHORT';

interface Topic {
  key: string;             // canonical keyword to look for in the answer
  aliases?: string[];      // additional acceptable substrings
  category: string;
}

interface Template {
  id: string;
  shape: 'prose' | 'one-sentence' | 'list' | 'name-only' | 'table' | 'short-fact';
  build: (topic: Topic, n: number) => string;
  n?: number;              // for list / table
  minChars?: number;
  maxChars?: number;
}

// ---------------------------------------------------------------------------
// Topic pool — wide and intentionally messy so we touch many engine paths.
// ---------------------------------------------------------------------------
const TOPICS: Topic[] = [
  // people
  { key: 'einstein', aliases: ['relativity', 'physicist'], category: 'people' },
  { key: 'newton', aliases: ['gravity', 'principia'], category: 'people' },
  { key: 'marie curie', aliases: ['radium', 'polonium', 'radioactivity'], category: 'people' },
  { key: 'darwin', aliases: ['evolution', 'natural selection'], category: 'people' },
  { key: 'mozart', aliases: ['composer', 'salzburg', 'requiem'], category: 'people' },
  { key: 'beethoven', aliases: ['composer', 'symphony'], category: 'people' },
  { key: 'shakespeare', aliases: ['playwright', 'hamlet'], category: 'people' },
  { key: 'tesla', aliases: ['nikola', 'inventor', 'alternating current'], category: 'people' },
  { key: 'edison', aliases: ['inventor', 'menlo park'], category: 'people' },
  { key: 'da vinci', aliases: ['leonardo', 'mona lisa', 'renaissance'], category: 'people' },
  { key: 'picasso', aliases: ['painter', 'cubism'], category: 'people' },
  { key: 'van gogh', aliases: ['painter', 'starry night', 'sunflowers'], category: 'people' },
  { key: 'churchill', aliases: ['winston', 'prime minister'], category: 'people' },
  { key: 'lincoln', aliases: ['abraham', 'gettysburg'], category: 'people' },
  { key: 'gandhi', aliases: ['mahatma', 'india', 'nonviolence'], category: 'people' },
  { key: 'freud', aliases: ['psychoanalysis', 'sigmund'], category: 'people' },
  { key: 'marx', aliases: ['karl', 'capital', 'communist'], category: 'people' },
  { key: 'aristotle', aliases: ['philosopher', 'greek'], category: 'people' },
  { key: 'plato', aliases: ['philosopher', 'republic'], category: 'people' },
  { key: 'socrates', aliases: ['philosopher', 'athens'], category: 'people' },
  // countries
  { key: 'france', aliases: ['paris'], category: 'country' },
  { key: 'germany', aliases: ['berlin'], category: 'country' },
  { key: 'japan', aliases: ['tokyo'], category: 'country' },
  { key: 'china', aliases: ['beijing'], category: 'country' },
  { key: 'india', aliases: ['delhi'], category: 'country' },
  { key: 'brazil', aliases: ['brasília', 'brasilia', 'são paulo'], category: 'country' },
  { key: 'norway', aliases: ['oslo'], category: 'country' },
  { key: 'sweden', aliases: ['stockholm'], category: 'country' },
  { key: 'italy', aliases: ['rome'], category: 'country' },
  { key: 'spain', aliases: ['madrid'], category: 'country' },
  { key: 'canada', aliases: ['ottawa'], category: 'country' },
  { key: 'mexico', aliases: ['mexico city'], category: 'country' },
  { key: 'russia', aliases: ['moscow'], category: 'country' },
  { key: 'united kingdom', aliases: ['uk', 'london'], category: 'country' },
  { key: 'australia', aliases: ['canberra', 'sydney'], category: 'country' },
  { key: 'south korea', aliases: ['seoul'], category: 'country' },
  { key: 'turkey', aliases: ['ankara', 'istanbul'], category: 'country' },
  { key: 'egypt', aliases: ['cairo', 'nile'], category: 'country' },
  { key: 'greece', aliases: ['athens'], category: 'country' },
  { key: 'argentina', aliases: ['buenos aires'], category: 'country' },
  // science
  { key: 'photosynthesis', aliases: ['chlorophyll', 'glucose', 'oxygen'], category: 'science' },
  { key: 'mitochondrion', aliases: ['mitochondria', 'atp', 'powerhouse'], category: 'science' },
  { key: 'dna', aliases: ['nucleotide', 'helix', 'genetic'], category: 'science' },
  { key: 'crispr', aliases: ['cas9', 'gene'], category: 'science' },
  { key: 'entropy', aliases: ['thermodynamics', 'disorder'], category: 'science' },
  { key: 'general relativity', aliases: ['einstein', 'spacetime', 'gravity'], category: 'science' },
  { key: 'quantum entanglement', aliases: ['spooky', 'particles'], category: 'science' },
  { key: 'evolution', aliases: ['darwin', 'natural selection', 'species'], category: 'science' },
  { key: 'big bang', aliases: ['universe', 'expansion', 'cosmology'], category: 'science' },
  { key: 'black hole', aliases: ['singularity', 'horizon', 'gravity'], category: 'science' },
  // tech
  { key: 'http', aliases: ['hypertext', 'protocol', 'request'], category: 'tech' },
  { key: 'tcp', aliases: ['transmission', 'connection', 'reliable'], category: 'tech' },
  { key: 'udp', aliases: ['datagram', 'connectionless'], category: 'tech' },
  { key: 'react', aliases: ['component', 'jsx', 'facebook'], category: 'tech' },
  { key: 'typescript', aliases: ['microsoft', 'javascript', 'types'], category: 'tech' },
  { key: 'python', aliases: ['guido', 'language', 'interpreted'], category: 'tech' },
  { key: 'rust', aliases: ['mozilla', 'memory', 'ownership'], category: 'tech' },
  { key: 'docker', aliases: ['container', 'image'], category: 'tech' },
  { key: 'kubernetes', aliases: ['k8s', 'container', 'orchestration'], category: 'tech' },
  { key: 'git', aliases: ['version control', 'commit', 'linus'], category: 'tech' },
  // history
  { key: 'cold war', aliases: ['soviet', 'usa', 'iron curtain'], category: 'history' },
  { key: 'world war 2', aliases: ['wwii', 'world war ii', 'hitler', 'allies'], category: 'history' },
  { key: 'world war 1', aliases: ['wwi', 'world war i', 'trenches', '1914'], category: 'history' },
  { key: 'french revolution', aliases: ['1789', 'bastille', 'guillotine'], category: 'history' },
  { key: 'cuban missile crisis', aliases: ['kennedy', 'khrushchev', '1962'], category: 'history' },
  { key: 'roman empire', aliases: ['rome', 'caesar', 'emperor'], category: 'history' },
  { key: 'renaissance', aliases: ['italy', '14th', '15th', 'florence'], category: 'history' },
  { key: 'industrial revolution', aliases: ['steam', 'factory', 'britain'], category: 'history' },
  // geography (planets/oceans/landmarks)
  { key: 'mount everest', aliases: ['himalaya', '8,848', '8848'], category: 'geo' },
  { key: 'amazon river', aliases: ['south america', 'longest'], category: 'geo' },
  { key: 'sahara', aliases: ['desert', 'africa'], category: 'geo' },
  { key: 'pacific ocean', aliases: ['largest', 'ocean'], category: 'geo' },
  { key: 'mariana trench', aliases: ['deepest', 'pacific'], category: 'geo' },
  // arts
  { key: 'mona lisa', aliases: ['leonardo', 'louvre'], category: 'arts' },
  { key: 'starry night', aliases: ['van gogh', 'painting'], category: 'arts' },
  { key: 'the iliad', aliases: ['homer', 'troy'], category: 'arts' },
  { key: 'don quixote', aliases: ['cervantes', 'spanish'], category: 'arts' },
  // misc
  { key: 'apple inc', aliases: ['steve jobs', 'wozniak', 'cupertino', 'iphone'], category: 'company' },
  { key: 'microsoft', aliases: ['bill gates', 'windows', 'redmond'], category: 'company' },
  { key: 'google', aliases: ['larry page', 'sergey brin', 'search'], category: 'company' },
  { key: 'tesla motors', aliases: ['elon musk', 'electric vehicle', 'eberhard'], category: 'company' },
];

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
const TEMPLATES: Template[] = [
  { id: 'what-is',         shape: 'prose',         build: t => `what is ${t.key}?`,                                   minChars: 200 },
  { id: 'tell-me-about',   shape: 'prose',         build: t => `tell me about ${t.key}`,                              minChars: 200 },
  { id: 'explain',         shape: 'prose',         build: t => `explain ${t.key}`,                                    minChars: 200 },
  { id: 'who-is',          shape: 'prose',         build: t => `who is ${t.key}?`,                                    minChars: 150 },
  { id: 'describe',        shape: 'prose',         build: t => `describe ${t.key} in detail`,                         minChars: 200 },
  { id: 'one-sentence',    shape: 'one-sentence',  build: t => `in one sentence, what is ${t.key}?`,                  maxChars: 320 },
  { id: 'short',           shape: 'short-fact',    build: t => `give me a short fact about ${t.key}`,                 maxChars: 600 },
  { id: 'list-3',          shape: 'list',          n: 3, build: (t, n) => `list ${n} key things about ${t.key}` },
  { id: 'list-5',          shape: 'list',          n: 5, build: (t, n) => `give me ${n} interesting facts about ${t.key} as a numbered list` },
  { id: 'list-bullets-4',  shape: 'list',          n: 4, build: (t, n) => `${n} bullet points about ${t.key}` },
];

// ---------------------------------------------------------------------------
// Detection patterns
// ---------------------------------------------------------------------------
const FALLBACK_PATTERNS = [
  /isn['']t in my knowledge yet/i,
  /isn['']t somewhere i can speak with confidence/i,
  /real gap in what i hold/i,
  /don['']t have \*\*[^*]+\*\* locally yet/i,
  /empty pocket on/i,
  /i don['']t yet hold/i,
  /honest take:.*real gap/i,
  /one anchor.*name.*date.*paper/i,
];

const LOWQ_PATTERNS = [
  /\[citation needed\]/i,
  /from wikipedia, the free encyclopedia/i,
  /\bnot to be confused with\b/i,
  /\bfor other uses,?\s+see\b/i,
  /this article needs/i,
];

// ---------------------------------------------------------------------------
// PRNG (mulberry32) for reproducible runs
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Format checkers
// ---------------------------------------------------------------------------
function countListMarkers(text: string): { ordered: number; bulleted: number } {
  const lines = text.split(/\r?\n/);
  let ordered = 0, bulleted = 0;
  for (const ln of lines) {
    if (/^\s*\d+[.)]\s+\S/.test(ln)) ordered++;
    if (/^\s*[-*•]\s+\S/.test(ln)) bulleted++;
  }
  return { ordered, bulleted };
}

function looksLikeTable(text: string): boolean {
  return /(^|\n)\s*\|.+\|.+\|/.test(text) && /(^|\n)\s*\|?[\s-]*\|[\s-]*\|/.test(text);
}

function sentenceCount(text: string): number {
  // strip code/list lines, then count sentence terminators
  const cleaned = text.replace(/```[\s\S]*?```/g, '').replace(/^[-*•\d.][^\n]*\n/gm, '');
  const matches = cleaned.match(/[.!?](?:\s|$)/g);
  return matches ? matches.length : 0;
}

function checkFormat(tpl: Template, text: string): string | null {
  switch (tpl.shape) {
    case 'one-sentence': {
      if (tpl.maxChars && text.length > tpl.maxChars) return `too long for one-sentence (${text.length})`;
      if (sentenceCount(text) > 3) return `expected 1 sentence, got ~${sentenceCount(text)}`;
      return null;
    }
    case 'list': {
      const n = tpl.n ?? 3;
      const { ordered, bulleted } = countListMarkers(text);
      if (Math.max(ordered, bulleted) < n) return `expected ${n}+ list items, got ord=${ordered} bul=${bulleted}`;
      return null;
    }
    case 'table':
      return looksLikeTable(text) ? null : 'no markdown table found';
    case 'name-only':
      if (tpl.maxChars && text.length > tpl.maxChars) return `too long for name-only (${text.length})`;
      return null;
    case 'short-fact':
      if (tpl.maxChars && text.length > tpl.maxChars) return `too long for short-fact (${text.length})`;
      return null;
    case 'prose':
      if (tpl.minChars && text.length < tpl.minChars) return `too short (${text.length} < ${tpl.minChars})`;
      return null;
  }
}

function checkContent(topic: Topic, text: string): string | null {
  const lower = text.toLowerCase();
  const accepted = [topic.key, ...(topic.aliases ?? [])].map(s => s.toLowerCase());
  for (const a of accepted) if (lower.includes(a)) return null;
  return `none of [${accepted.join(', ')}] found in answer`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
interface Args { n: number; seed: number; report: string | null; }
function parseArgs(): Args {
  const args = process.argv.slice(2);
  let n = 2000, seed = 42, report: string | null = null;
  for (const a of args) {
    if (a.startsWith('--n=')) n = Number(a.slice(4));
    else if (a.startsWith('--seed=')) seed = Number(a.slice(7));
    else if (a.startsWith('--report=')) report = a.slice(9);
  }
  return { n, seed, report };
}

async function run() {
  const { n, seed, report } = parseArgs();
  const rand = mulberry32(seed);
  const engine = new VaiEngine();
  (engine as unknown as { _nowMs: () => number })._nowMs = () => new Date('2026-05-15T10:00:00Z').getTime();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError('fetch disabled in fuzz'); }) as typeof fetch;

  const tally: Record<Verdict, number> = { PASS: 0, CONTENT_FAIL: 0, FORMAT_FAIL: 0, FALLBACK: 0, LOWQ: 0, SHORT: 0 };
  const byCategory: Record<string, Record<Verdict, number>> = {};
  const failures: Array<{ id: number; topic: string; tpl: string; verdict: Verdict; reason: string; q: string; preview: string; }> = [];
  const t0 = performance.now();

  for (let i = 0; i < n; i++) {
    const topic = TOPICS[Math.floor(rand() * TOPICS.length)];
    const tpl = TEMPLATES[Math.floor(rand() * TEMPLATES.length)];
    const q = tpl.build(topic, tpl.n ?? 3);
    let text = '';
    try {
      const r = await engine.chat({
        messages: [{ role: 'user', content: q }],
        temperature: 0,
        maxTokens: 320,
        noLearn: true,
      } as never);
      text = r.message.content;
    } catch (err) {
      text = `__ERROR__ ${(err as Error).message}`;
    }

    let verdict: Verdict = 'PASS';
    let reason = '';
    if (FALLBACK_PATTERNS.some(p => p.test(text))) { verdict = 'FALLBACK'; reason = 'fallback pattern matched'; }
    else if (LOWQ_PATTERNS.some(p => p.test(text))) { verdict = 'LOWQ'; reason = 'low-quality pattern matched'; }
    else {
      // Shape-aware short-floor: one-sentence / short-fact answers can be ~30+
      // chars and still be a valid response (e.g. "Sweden is a country in
      // Northern Europe (Scandinavia)."). Other shapes still expect ~60+.
      const shortFloor = (tpl.shape === 'one-sentence' || tpl.shape === 'short-fact' || tpl.shape === 'name-only') ? 30 : 60;
      if (text.length < shortFloor) { verdict = 'SHORT'; reason = `len=${text.length}`; }
      else {
        const cReason = checkContent(topic, text);
        if (cReason) { verdict = 'CONTENT_FAIL'; reason = cReason; }
        else {
          const fReason = checkFormat(tpl, text);
          if (fReason) { verdict = 'FORMAT_FAIL'; reason = fReason; }
        }
      }
    }

    tally[verdict]++;
    byCategory[topic.category] ??= { PASS: 0, CONTENT_FAIL: 0, FORMAT_FAIL: 0, FALLBACK: 0, LOWQ: 0, SHORT: 0 };
    byCategory[topic.category][verdict]++;

    if (verdict !== 'PASS' && failures.length < 80) {
      failures.push({ id: i, topic: topic.key, tpl: tpl.id, verdict, reason, q, preview: text.slice(0, 220).replace(/\s+/g, ' ') });
    }

    if ((i + 1) % 100 === 0) {
      process.stdout.write(`  [${i + 1}/${n}] PASS=${tally.PASS} FAIL=${tally.CONTENT_FAIL + tally.FORMAT_FAIL + tally.FALLBACK + tally.LOWQ + tally.SHORT}\n`);
    }
  }

  const totalMs = Math.round(performance.now() - t0);
  globalThis.fetch = originalFetch;

  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  const passRate = ((tally.PASS / total) * 100).toFixed(2);

  console.log('');
  console.log('=== Fuzz random verdicts ===');
  console.log(`n=${total}  seed=${seed}  totalMs=${totalMs}`);
  console.log(`PASS=${tally.PASS}  (${passRate}%)`);
  console.log(`CONTENT_FAIL=${tally.CONTENT_FAIL}  FORMAT_FAIL=${tally.FORMAT_FAIL}  FALLBACK=${tally.FALLBACK}  LOWQ=${tally.LOWQ}  SHORT=${tally.SHORT}`);
  console.log('');
  console.log('By category:');
  for (const [cat, t] of Object.entries(byCategory).sort()) {
    const sum = Object.values(t).reduce((a, b) => a + b, 0);
    console.log(`  ${cat.padEnd(10)} pass=${t.PASS}/${sum}  cFail=${t.CONTENT_FAIL}  fFail=${t.FORMAT_FAIL}  fb=${t.FALLBACK}  lowq=${t.LOWQ}  short=${t.SHORT}`);
  }
  console.log('');
  if (failures.length) {
    console.log(`First ${failures.length} failures:`);
    for (const f of failures.slice(0, 30)) {
      console.log(`  [${f.verdict}] ${f.tpl} :: ${f.q}`);
      console.log(`     reason: ${f.reason}`);
      console.log(`     preview: ${f.preview.slice(0, 160)}`);
    }
  }

  if (report) {
    writeFileSync(report, JSON.stringify({ seed, n: total, totalMs, tally, byCategory, failures }, null, 2));
    console.log(`Report: ${report}`);
  }
}

run().catch(err => { console.error(err); process.exit(1); });
