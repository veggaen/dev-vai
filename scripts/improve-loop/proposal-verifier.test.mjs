// Run: node --test --experimental-sqlite scripts/improve-loop/proposal-verifier.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { verifyProposal, isNonExecutableFind, summarizeVerdicts } from './proposal-verifier.mjs';
import { openDb, recordKnowledge, topKnowledge, knowledgeConfidence } from './db.mjs';

const SRC = [
  'const BUILD_VERB_ANYWHERE = /\\b(build|create)\\b/i;',
  '// a comment line that looks fixable',
  'if (BUILD_VERB_ANYWHERE.test(text)) return false;',
  'const msg = "this is a string literal";',
  'return true;',
].join('\n');
const reader = () => SRC;

test('isNonExecutableFind: flags comments, strings, prose, empties', () => {
  assert.equal(isNonExecutableFind('// a comment'), true);
  assert.equal(isNonExecutableFind('"a string literal",'), true);
  assert.equal(isNonExecutableFind('  '), true);
  assert.equal(isNonExecutableFind('if (x) return false;'), false);
  assert.equal(isNonExecutableFind('const RE = /x/;'), false);
});

test('verifyProposal: ok when find exists, executable, unique, changes the line', () => {
  const v = verifyProposal({ file: 'f.ts', find: 'if (BUILD_VERB_ANYWHERE.test(text)) return false;', replace: 'if (BUILD_VERB_ANYWHERE.test(text) && !isQuestion) return false;' }, { reader: null, readFile: reader });
  assert.equal(v.ok, true);
  assert.equal(v.code, 'ok');
});

test('verifyProposal: HALLUCINATED find (line not in file) is caught — the core learned guard', () => {
  const v = verifyProposal({ file: 'f.ts', find: 'if (TOTALLY_MADE_UP.test(text)) return 42;', replace: 'x' }, { readFile: reader });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'hallucinated-find');
});

test('verifyProposal: a whitespace near-miss find is RECOVERED to exact source text (not rejected)', () => {
  // The model collapsed the indentation / spacing but the line really exists. Recover it.
  const v = verifyProposal(
    { file: 'f.ts', find: 'if (BUILD_VERB_ANYWHERE.test(text))   return false;', replace: 'if (BUILD_VERB_ANYWHERE.test(text) && ok) return false;' },
    { readFile: reader },
  );
  assert.equal(v.ok, true, 'a recoverable near-miss should pass');
  assert.equal(v.correctedFind, 'if (BUILD_VERB_ANYWHERE.test(text)) return false;', 'find corrected to the exact source line');
});

test('verifyProposal: a genuinely hallucinated find is STILL rejected (recovery does not weaken the guard)', () => {
  const v = verifyProposal({ file: 'f.ts', find: 'if (NOPE.test(text)) return 99;', replace: 'x' }, { readFile: reader });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'hallucinated-find');
});

test('recoverFind: only a UNIQUE single-line whitespace match is recovered', async () => {
  const { recoverFind } = await import('./proposal-verifier.mjs');
  const src = 'const a = 1;\nif (x)  return y;\nconst b = 2;';
  // The model's find has single spacing; the SOURCE has double — recover returns the EXACT source text.
  assert.equal(recoverFind(src, 'if (x) return y;'), 'if (x)  return y;', 'unique normalized match recovered to exact source text');
  // ambiguous: two source lines normalize to the SAME target (differ only by spacing) → not
  // recovered (no guessing which one the model meant).
  // Two lines that differ only in space COUNT: they normalize identically but trim to different
  // exact text → two distinct candidates → ambiguous, must not be recovered (no guessing).
  const dup = 'return  foo(a);\nreturn foo(a);';
  assert.equal(recoverFind(dup, 'return foo(a);'), null, 'ambiguous match must NOT be recovered');
  // no match at all
  assert.equal(recoverFind(src, 'totally absent line here'), null);
  // too-short / multiline guards
  assert.equal(recoverFind(src, 'a;'), null);
  assert.equal(recoverFind(src, 'line1\nline2'), null);
});

test('verifyProposal: editing a comment or string is rejected as non-executable', () => {
  const vc = verifyProposal({ file: 'f.ts', find: '// a comment line that looks fixable', replace: '// fixed' }, { readFile: reader });
  assert.equal(vc.code, 'non-executable-find');
  const vs = verifyProposal({ file: 'f.ts', find: 'const msg = "this is a string literal";', replace: 'const msg = "x";' }, { readFile: reader });
  assert.equal(vs.ok, true); // a const assignment IS executable (only a BARE string find is rejected)
});

test('verifyProposal: UNBALANCED edit (truncated find) is caught before it corrupts the file', () => {
  // The real fresh-data-trigger break: find ended mid-regex ("…temperature|fore"), replace was the
  // WHOLE regex — applying it left the old tail "cast|…)/i;" dangling → tsc failure every cycle.
  const SRC2 = 'const FRESH = /\\b(?:price|weather|temperature|forecast|latest)\\b/i;\nreturn FRESH.test(x);';
  const v = verifyProposal({
    file: 'f.ts',
    find: '/\\b(?:price|weather|temperature|fore',                       // truncated: opens ( and /, closes neither
    replace: '/\\b(?:price|weather|temperature|forecast|latest|urgent)\\b/i;', // full, balanced regex
  }, { readFile: () => SRC2 });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'unbalanced-edit');
});

test('verifyProposal: a balanced edit that adds an alternative is still allowed', () => {
  const v = verifyProposal({ file: 'f.ts', find: 'if (BUILD_VERB_ANYWHERE.test(text)) return false;', replace: 'if (BUILD_VERB_ANYWHERE.test(text) && ok(y)) return false;' }, { readFile: reader });
  assert.equal(v.ok, true, 'balanced () additions must pass');
});

test('verifyProposal: noop replace and missing fields', () => {
  assert.equal(verifyProposal({ file: 'f.ts', find: 'return true;', replace: 'return true;' }, { readFile: reader }).code, 'noop-replace');
  assert.equal(verifyProposal({ file: 'f.ts' }, { readFile: reader }).code, 'no-find');
  assert.equal(verifyProposal({ find: 'x' }, { readFile: reader }).code, 'no-file');
  assert.equal(verifyProposal({ file: 'f.ts', find: 'x' }, { readFile: () => { throw new Error('enoent'); } }).code, 'no-file');
});

test('summarizeVerdicts: builds an evidence-bound prompt hint from counts (not vibes)', () => {
  assert.equal(summarizeVerdicts([]), null);
  const s = summarizeVerdicts([
    { code: 'hallucinated-find' }, { code: 'hallucinated-find' }, { code: 'ok' }, { code: 'non-executable-find' },
  ]);
  assert.equal(s.total, 4);
  assert.equal(s.byCode['hallucinated-find'], 2);
  assert.ok(Math.abs(s.hallucinationRate - 0.5) < 1e-9);
  assert.match(s.promptHint, /2\/4/);                 // counts, not vibes
  assert.match(s.promptHint, /EXACT, verbatim substring/);
});

// ── Knowledge spine ──────────────────────────────────────────────────────────
function tmpDb() {
  const f = join(tmpdir(), `vai-know-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  return { f, db: openDb(f) };
}

test('knowledgeConfidence: rises on confirmation, falls on contradiction (Laplace)', () => {
  assert.ok(Math.abs(knowledgeConfidence({ confirmations: 0, contradictions: 0 }) - 0.5) < 1e-9);
  assert.ok(knowledgeConfidence({ confirmations: 9, contradictions: 0 }) > 0.9);
  assert.ok(knowledgeConfidence({ confirmations: 1, contradictions: 4 }) < 0.3); // decaying
});

test('recordKnowledge + topKnowledge: capture, reinforce, decay, confidence-filter', () => {
  const { f, db } = tmpDb();
  try {
    // A guard claim confirmed 5×.
    for (let i = 0; i < 5; i++) recordKnowledge(db, { scope: 'propose-fix:m', claim: 'copy find verbatim', kind: 'guard', confirm: true, evidence: 'x' });
    // A claim that keeps getting contradicted → low confidence → filtered out.
    recordKnowledge(db, { scope: 'propose-fix:m', claim: 'model never hallucinates', confirm: false });
    recordKnowledge(db, { scope: 'propose-fix:m', claim: 'model never hallucinates', confirm: false });
    recordKnowledge(db, { scope: 'propose-fix:m', claim: 'model never hallucinates', confirm: false });

    const top = topKnowledge(db, 'propose-fix:m', { minConfidence: 0.5 });
    assert.equal(top.length, 1);                       // the contradicted one is below floor
    assert.equal(top[0].claim, 'copy find verbatim');
    assert.equal(top[0].confirmations, 5);
    assert.ok(top[0].confidence > 0.8);
    // scope isolation
    assert.equal(topKnowledge(db, 'other-scope').length, 0);
  } finally { db.close(); rmSync(f, { force: true }); }
});
