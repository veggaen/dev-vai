/**
 * Multi-suite variant test generator.
 *
 * Generates "(variant)" twins of behavioral test suites: same assertions, lightly
 * reworded user prompts. The point is paraphrase-resilience pressure — if a variant
 * fails while the original passes, routing is phrase-brittle and that is real signal.
 *
 * Improvements over v1 (which only handled vai-engine.test.ts):
 *   1. Multi-suite: every behavioral suite with meaningful user-prompt traffic gets a twin.
 *   2. Assertion-aware mutation: before rewording a prompt, the generator collects every
 *      regex/string literal used in expect() calls within the same it() block and refuses
 *      any mutation that would alter a word those assertions depend on.
 *   3. Deterministic seeded transform choice (same output for same input — stable diffs).
 *   4. Per-suite opt-outs for files whose prompts are themselves the thing under test
 *      (e.g. paraphrase-resilience.test.ts already IS a variant suite).
 *
 * Usage:  node scripts/generate-variant-tests.mjs [--check]
 *   --check  exit 1 if any generated file is out of date (CI guard), write nothing.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CHECK_MODE = process.argv.includes('--check');

/**
 * Suites that get a variant twin. Output is `<name>-variants.test.ts` in the same
 * directory, so relative imports keep working unchanged. vai-engine keeps its
 * historical output name (vai-engine-variants.test.ts).
 *
 * Deliberately excluded:
 *   - paraphrase-resilience.test.ts — it is already a phrasing-variation suite.
 *   - golden-conversations.test.ts  — golden transcripts are pinned by design.
 *   - conversation-facts.test.ts    — prompts ARE the fixture (constraint wording is load-bearing).
 *   - ola/vetle-conversation, tool-executor — prompt formats produce zero safe mutations,
 *     so a twin would be a pure duplicate (runtime cost, no signal).
 */
const SUITES = [
  'packages/core/__tests__/vai-engine.test.ts',
  'packages/core/__tests__/opinion-framing.test.ts',
  'packages/core/__tests__/dynamic-chat.test.ts',
  'packages/core/__tests__/edge-cases.test.ts',
  'packages/core/__tests__/chat-hygiene.test.ts',
  'packages/core/__tests__/vai-learning-flywheel.test.ts',
  'packages/core/src/chat/format-only-followup.test.ts',
  'packages/core/src/chat/web-conclude-turn.test.ts',
];

/** Content markers that must never be reworded (load-bearing for routing/assertions). */
const GLOBAL_SKIP_RE = /\{\{template|quantum breakpoints|web search|made-up|Use the headings|statsminister|fylke|king of norway|prime minister|reply with exactly|nothing else/i;

/** Literal assertion phrases (toContain/toBe string args) per block — for echo-fixture veto. */
function assertionLiteralsForBlock(block) {
  const literals = [];
  for (const m of block.matchAll(/(?:toContain|toBe|toEqual)\(\s*['"`]((?:\\.|[^'"`])+)['"`]/g)) {
    literals.push(m[1].replace(/\\'/g, "'").toLowerCase());
  }
  return literals;
}

/**
 * Conservative, meaning-preserving transforms. Each returns the modified string or the
 * original if it does not apply. Selection is seeded per line for determinism.
 *
 * Two tiers:
 *   - cosmetic: case/punctuation only — safe for ANY prompt length; these genuinely
 *     exercise input normalization (casing, trailing punctuation) without word drift.
 *   - wordy:    word substitutions — only applied to prompts >= WORDY_MIN_LEN, where a
 *     single synonym cannot dominate routing.
 */
const WORDY_MIN_LEN = 80;
const TRANSFORMS = [
  { cosmetic: true, fn: (s) => (/^[a-z]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s) },
  { cosmetic: true, fn: (s) => (!/[.?!]$/.test(s) && s.length > 20 ? `${s}.` : s) },
  { cosmetic: true, fn: (s) => (/^(what|how|should|can|is|are|do|which|where|when|why)\b/i.test(s) && !/[.?!]$/.test(s) ? `${s}?` : s) },
  { cosmetic: true, fn: (s) => (/^[A-Z][a-z]/.test(s) && s.split(' ').length > 3 ? s[0].toLowerCase() + s.slice(1) : s) },
  { cosmetic: false, fn: (s) => s.replace(/^What is /, "What\\'s ") },
  { cosmetic: false, fn: (s) => (/^Hello\b/.test(s) ? 'hi' : s) },
  { cosmetic: false, fn: (s) => s.replace(/\bHow should\b/, 'How would') },
  { cosmetic: false, fn: (s) => s.replace(/\bgive me\b/i, 'show me') },
  { cosmetic: false, fn: (s) => s.replace(/\bExplain\b/, 'Describe').replace(/\bexplain\b/, 'describe') },
  { cosmetic: false, fn: (s) => (s.endsWith('.') ? `${s.slice(0, -1)} clearly.` : s) },
  { cosmetic: false, fn: (s) => s.replace(/^Should I\b/, 'Do you think I should') },
  { cosmetic: false, fn: (s) => s.replace(/^Compare\b/, 'Contrast') },
  { cosmetic: false, fn: (s) => s.replace(/\bI want\b/, "I\\'d like") },
  { cosmetic: false, fn: (s) => s.replace(/^Can you\b/, 'Could you') },
  { cosmetic: false, fn: (s) => s.replace(/\bplease\b/i, 'kindly') },
  { cosmetic: false, fn: (s) => s.replace(/^Help me\b/, 'I need help to') },
];

/**
 * Collect the words that expect()-assertions inside a test block depend on, so mutations
 * can be vetoed when they would touch one. Heuristic but deliberately over-inclusive:
 * pulls every word from toMatch(/…/) regex sources and toContain('…') literals.
 */
function assertionWordsForBlock(block) {
  const words = new Set();
  const patterns = [
    /toMatch\(\/((?:\\.|[^/])+)\//g,
    /(?:toContain|toBe|toEqual)\(\s*['"`]((?:\\.|[^'"`])+)['"`]/g,
  ];
  for (const re of patterns) {
    for (const m of block.matchAll(re)) {
      for (const w of m[1].toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []) {
        words.add(w.replace(/\\'/g, "'"));
      }
    }
  }
  return words;
}

/** Split source into it() blocks with their spans so each prompt line can find its block. */
function blockSpans(src) {
  const starts = [];
  const re = /^\s*it(?:\.each\s*\([^)]*\)\s*\()?\s*\(/gm;
  let m;
  while ((m = re.exec(src)) !== null) starts.push(m.index);
  return starts.map((s, i) => [s, i + 1 < starts.length ? starts[i + 1] : src.length]);
}

function mutationIsSafe(original, mutated, assertionWords) {
  if (original === mutated) return false;
  const origWords = new Set(original.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []);
  const newWords = mutated.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
  // Any word added or removed by the mutation must not be an assertion word.
  for (const w of newWords) {
    if (!origWords.has(w) && assertionWords.has(w)) return false;
  }
  for (const w of origWords) {
    if (!newWords.includes(w) && assertionWords.has(w)) return false;
  }
  return true;
}

function generateVariant(srcPath) {
  const src = readFileSync(srcPath, 'utf-8');

  let testCount = 0;
  let result = src.replace(
    /(\bit\s*\(\s*)(['"])((?:\\.|(?!\2).)*?)\2/g,
    (match, prefix, quote, name) => {
      testCount++;
      return `${prefix}${quote}${name} (variant)${quote}`;
    },
  );
  result = result.replace(
    /(it\.each\s*\([^)]*\)\s*\(\s*)(['"])((?:\\.|(?!\2).)*?)\2/g,
    (match, prefix, quote, name) => {
      if (name.includes('(variant)')) return match;
      testCount++;
      return `${prefix}${quote}${name} (variant)${quote}`;
    },
  );

  // Spans/assertions MUST be computed on the renamed text: the " (variant)" insertions
  // shift every downstream offset, so computing them on `src` mis-assigns blocks.
  const spans = blockSpans(result);
  const blockAssertions = spans.map(([a, b]) => assertionWordsForBlock(result.slice(a, b)));
  const blockLiterals = spans.map(([a, b]) => assertionLiteralsForBlock(result.slice(a, b)));

  // Reword user prompts, vetoed by assertion words of the enclosing block.
  let modCount = 0;
  let offset = 0;
  const lines = result.split('\n');
  const out = lines.map((line, idx) => {
    const lineStart = offset;
    offset += line.length + 1;

    const m = line.match(/^(\s*(?:messages:\s*\[)?\s*\{?\s*role:\s*'user',\s*content:\s*')([^']{15,})('\s*\}?,?\s*\]?,?\s*)$/);
    if (!m) return line;
    const [, prefix, content, suffix] = m;
    if (GLOBAL_SKIP_RE.test(content)) return line;

    const span = spans.findIndex(([a, b]) => lineStart >= a && lineStart < b);
    const assertionWords = span >= 0 ? blockAssertions[span] : new Set();
    const literals = span >= 0 ? blockLiterals[span] : [];
    const contentLower = content.toLowerCase();

    // Veto 1: echoed fixtures — if an assertion literal appears verbatim inside this
    // prompt, the prompt IS the expected output (Nth-message echo, exact-token reply).
    if (literals.some((lit) => lit.length >= 4 && contentLower.includes(lit))) return line;
    // Veto 2: non-natural-language payloads (binary/hex/morse) — punctuation is data.
    if (!/[a-z]{3,}\s+[a-z]{2,}/i.test(content)) return line;

    const allowWordy = content.length >= WORDY_MIN_LEN;

    for (let k = 0; k < TRANSFORMS.length; k++) {
      const t = TRANSFORMS[(idx + k) % TRANSFORMS.length];
      if (!t.cosmetic && !allowWordy) continue;
      const mutated = t.fn(content);
      if (mutationIsSafe(content, mutated, assertionWords)) {
        modCount++;
        return `${prefix}${mutated}${suffix}`;
      }
    }
    return line;
  });

  const header =
    `// AUTO-GENERATED variant tests — do not edit manually\n` +
    `// Generated from ${basename(srcPath)} by scripts/generate-variant-tests.mjs\n` +
    `// Same assertions, reworded prompts: failures here mean phrase-brittle routing.\n\n`;
  return { content: header + out.join('\n'), testCount, modCount };
}

let stale = 0;
for (const rel of SUITES) {
  const srcPath = resolve(ROOT, rel);
  if (!existsSync(srcPath)) {
    console.warn(`[skip] missing suite: ${rel}`);
    continue;
  }
  const outPath = srcPath.replace(/\.test\.ts$/, '-variants.test.ts');
  const { content, testCount, modCount } = generateVariant(srcPath);

  if (CHECK_MODE) {
    const current = existsSync(outPath) ? readFileSync(outPath, 'utf-8') : '';
    if (current !== content) {
      console.error(`[stale] ${outPath}`);
      stale++;
    }
    continue;
  }
  writeFileSync(outPath, content, 'utf-8');
  console.log(`[gen] ${basename(outPath)} — ${testCount} tests, ${modCount} prompts reworded`);
}

if (CHECK_MODE) {
  if (stale > 0) {
    console.error(`${stale} variant file(s) out of date. Run: node scripts/generate-variant-tests.mjs`);
    process.exit(1);
  }
  console.log('All variant files up to date.');
}
