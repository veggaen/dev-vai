import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTargetLocation,
  enclosingFunction,
  selectExcerpt,
  buildFeaturePrompt,
  shapeArtifact,
  buildFeatureArtifact,
} from './feature-build.mjs';

// A tiny real-ish source file the tests ground against.
const SOURCE = [
  'export function alpha(x) {',              // 1
  '  if (x > 0) return "pos";',              // 2
  '  return "neg";',                          // 3
  '}',                                        // 4
  '',                                         // 5
  'export function beta(name) {',            // 6
  '  const greeting = "hello " + name;',     // 7
  '  return greeting.toUpperCase();',        // 8
  '}',                                        // 9
].join('\n');

// ── location parsing ──────────────────────────────────────────────────────────
test('parseTargetLocation: splits file and :line', () => {
  assert.deepEqual(parseTargetLocation('packages/core/src/chat/service.ts:526'), { file: 'packages/core/src/chat/service.ts', line: 526 });
  assert.deepEqual(parseTargetLocation('a/b.ts'), { file: 'a/b.ts', line: null });
});

test('parseTargetLocation: a Windows drive letter is NOT mistaken for a line', () => {
  assert.deepEqual(parseTargetLocation('C:/Users/v3gga/x.ts:12'), { file: 'C:/Users/v3gga/x.ts', line: 12 });
  assert.deepEqual(parseTargetLocation('C:/Users/v3gga/x.ts'), { file: 'C:/Users/v3gga/x.ts', line: null });
  assert.deepEqual(parseTargetLocation('C:\\Users\\v3gga\\x.ts:7'), { file: 'C:\\Users\\v3gga\\x.ts', line: 7 });
});

// ── enclosing function ──────────────────────────────────────────────────────────
test('enclosingFunction: bounds the function containing a line', () => {
  const lines = SOURCE.split('\n');
  // line index 7 (0-based) is inside beta (decl at idx 5, close at idx 8).
  const r = enclosingFunction(lines, 7);
  assert.deepEqual(r, { start: 5, end: 9 });
});

test('enclosingFunction: returns null when no decl is found above', () => {
  assert.equal(enclosingFunction(['const x = 1;', 'const y = 2;'], 1), null);
});

// ── excerpt selection ───────────────────────────────────────────────────────────
test('selectExcerpt: a precise line prefers the enclosing function', () => {
  const ex = selectExcerpt(SOURCE, { line: 8, window: 150 });
  assert.equal(ex.scope, 'function');
  assert.equal(ex.startLine, 6);
  assert.equal(ex.endLine, 9);
  assert.match(ex.text, /6: export function beta/);
  assert.match(ex.text, /8: {3}return greeting/); // "8: " + "  return" = 3 spaces before "return"
});

test('selectExcerpt: no line falls back to keyword match', () => {
  const ex = selectExcerpt(SOURCE, { instruction: 'change the greeting text' });
  // "greeting" appears on line 7 → center there; small file → head/window path returns numbered lines.
  assert.match(ex.text, /greeting/);
});

test('selectExcerpt: numbered lines carry REAL 1-based line numbers', () => {
  const ex = selectExcerpt(SOURCE, {});
  assert.match(ex.text, /^1: export function alpha/m);
});

// ── prompt build ────────────────────────────────────────────────────────────────
test('buildFeaturePrompt: carries the instruction, file, excerpt, and the findLine contract', () => {
  const ex = selectExcerpt(SOURCE, { line: 8 });
  const p = buildFeaturePrompt({ instruction: 'shout the greeting louder', file: 'x.ts', excerpt: ex });
  assert.match(p, /shout the greeting louder/);
  assert.match(p, /x\.ts/);
  assert.match(p, /findLine/);
  assert.match(p, /ONLY a JSON object/);
});

test('buildFeaturePrompt: includes learned facts when provided', () => {
  const ex = selectExcerpt(SOURCE, {});
  const p = buildFeaturePrompt({ instruction: 'x', file: 'f.ts', excerpt: ex, learned: ['do not edit comments'] });
  assert.match(p, /LEARNED/);
  assert.match(p, /do not edit comments/);
});

// ── artifact shaping (line-number grounding + verify) ────────────────────────────
const readFileFake = () => SOURCE;

test('shapeArtifact: findLine copies the REAL source line (ignores a corrupted retype)', () => {
  const ex = selectExcerpt(SOURCE, { line: 8 });
  // The model MISTYPED the find (dropped a char) but pointed findLine at 8 → we copy line 8 verbatim.
  const raw = JSON.stringify({ file: 'x.ts', findLine: 8, find: 'return greeting.toUpperCas()', replace: '  return greeting.toUpperCase() + "!";', why: 'shout' });
  const out = shapeArtifact(raw, { source: SOURCE, excerpt: ex, readFile: readFileFake });
  assert.ok(out.ok, out.reason);
  assert.equal(out.artifact.find, 'return greeting.toUpperCase();', 'find replaced with the verbatim source line');
  assert.match(out.artifact.diff, /- return greeting\.toUpperCase\(\);/);
  // diff renders "+ " + the replace string (which itself begins with 2 indent spaces) = 3 spaces.
  assert.match(out.artifact.diff, /\+ {3}return greeting\.toUpperCase\(\) \+ "!";/);
});

test('shapeArtifact: rejects when the find does not exist in source', () => {
  const ex = selectExcerpt(SOURCE, {});
  const raw = JSON.stringify({ file: 'x.ts', find: 'this line is not in the file at all', replace: 'nope', why: 'x' });
  const out = shapeArtifact(raw, { source: SOURCE, excerpt: ex, readFile: readFileFake });
  assert.equal(out.ok, false);
});

test('shapeArtifact: rejects unparseable JSON', () => {
  const ex = selectExcerpt(SOURCE, {});
  const out = shapeArtifact('the change looks good, trust me', { source: SOURCE, excerpt: ex, readFile: readFileFake });
  assert.equal(out.ok, false);
  assert.equal(out.verdict.code, 'no-json');
});

test('shapeArtifact: a findLine OUTSIDE the excerpt is not copied (kept as the model string)', () => {
  const ex = selectExcerpt(SOURCE, { line: 2 }); // excerpt = alpha (lines 1-4)
  // findLine 8 is outside alpha's excerpt → we must NOT copy line 8; parsed.find stays and fails verify.
  const raw = JSON.stringify({ file: 'x.ts', findLine: 8, find: 'a line that is not real', replace: 'y', why: 'z' });
  const out = shapeArtifact(raw, { source: SOURCE, excerpt: ex, readFile: readFileFake });
  assert.equal(out.ok, false, 'out-of-excerpt findLine is not trusted');
});

// ── end-to-end build with injected model + fs ────────────────────────────────────
test('buildFeatureArtifact: produces a verified artifact from a good model reply', async () => {
  const generate = async () => JSON.stringify({
    file: 'x.ts', findLine: 7, find: 'const greeting = "hello " + name;',
    replace: '  const greeting = "hi " + name;', why: 'friendlier greeting',
  });
  const out = await buildFeatureArtifact(
    { instruction: 'make the greeting say hi instead of hello', location: 'x.ts:7' },
    { generate, readFile: readFileFake },
  );
  assert.ok(out.ok, out.reason);
  assert.equal(out.artifact.file, 'x.ts');
  assert.match(out.artifact.replace, /hi /);
  assert.equal(out.artifact.why, 'friendlier greeting');
});

test('buildFeatureArtifact: requires instruction and location', async () => {
  const out = await buildFeatureArtifact({ instruction: '', location: '' }, { generate: async () => '', readFile: readFileFake });
  assert.equal(out.ok, false);
});

test('buildFeatureArtifact: reports an unreadable file instead of throwing', async () => {
  const out = await buildFeatureArtifact(
    { instruction: 'x', location: 'missing.ts' },
    { generate: async () => '{}', readFile: () => { throw new Error('ENOENT'); } },
  );
  assert.equal(out.ok, false);
  assert.match(out.reason, /could not read/);
});

test('buildFeatureArtifact: a model error is caught and reported', async () => {
  const out = await buildFeatureArtifact(
    { instruction: 'x', location: 'x.ts:7' },
    { generate: async () => { throw new Error('ollama 500'); }, readFile: readFileFake },
  );
  assert.equal(out.ok, false);
  assert.match(out.reason, /model unavailable/);
});
