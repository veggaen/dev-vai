import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyChangeShape,
  shapeCeiling,
  parseWorth,
  modelSubScore,
  worthVerdict,
  judgeChangeWorth,
  WORTH_PASS_SCORE,
} from './change-worth.mjs';

// ── shape classification (the ungameable anti-cosmetic layer) ────────────────────────
test('classifyChangeShape: a string/message tweak is string-only (NOT substantive)', () => {
  // This is the EXACT change the council committed today — a copy tweak.
  const find = 'return `I won\'t guess. Give me more detail or a source, or I can escalate it.`;';
  const replace = 'return `I won\'t guess. Please rephrase the question or break it into smaller steps.`;';
  const shape = classifyChangeShape(find, replace);
  assert.equal(shape.kind, 'string-only');
  assert.equal(shape.substantive, false);
});

test('classifyChangeShape: a real logic change (condition) is logic + substantive', () => {
  const shape = classifyChangeShape('if (score > 0.5) return true;', 'if (score >= 0.62 && !flagged) return true;');
  assert.equal(shape.kind, 'logic');
  assert.equal(shape.substantive, true);
});

test('classifyChangeShape: comment-only change is not substantive', () => {
  const shape = classifyChangeShape('const x = 1; // old note', 'const x = 1; // clearer note');
  assert.equal(shape.kind, 'comment-only');
  assert.equal(shape.substantive, false);
});

test('classifyChangeShape: whitespace-only is not substantive', () => {
  assert.equal(classifyChangeShape('  const x = 1;', 'const x = 1;').kind, 'whitespace-only');
});

test('shapeCeiling: cosmetic shapes are capped below the pass bar; logic can reach the top', () => {
  assert.ok(shapeCeiling({ kind: 'string-only' }) < WORTH_PASS_SCORE, 'a string tweak cannot pass on shape alone');
  assert.ok(shapeCeiling({ kind: 'comment-only' }) < WORTH_PASS_SCORE);
  assert.ok(shapeCeiling({ kind: 'whitespace-only' }) < WORTH_PASS_SCORE);
  assert.equal(shapeCeiling({ kind: 'logic' }), 1.0);
});

// ── model rubric parse + sub-score ────────────────────────────────────────────────────
test('parseWorth: reads the four dimensions + verdict', () => {
  const p = parseWorth('MEANINGFULNESS: 0.9\nENGINEERING: 0.85\nCONFIGURABILITY: 0.7\nFUTUREPROOF: 0.8\nVERDICT: worthy\nCRITIQUE: solid');
  assert.equal(p.meaningfulness, 0.9);
  assert.equal(p.futureProofness, 0.8);
  assert.equal(p.verdict, 'worthy');
  assert.ok(p.parsed);
});

test('parseWorth: out-of-range or missing dimension → not parsed', () => {
  assert.equal(parseWorth('MEANINGFULNESS: 5\nENGINEERING: 0.8\nCONFIGURABILITY: 0.7\nFUTUREPROOF: 0.8').parsed, false);
  assert.equal(parseWorth('nothing useful').parsed, false);
});

test('modelSubScore: weighted combination of dimensions', () => {
  // all 1.0 → weighted sum = 1.0
  const p = parseWorth('MEANINGFULNESS: 1\nENGINEERING: 1\nCONFIGURABILITY: 1\nFUTUREPROOF: 1\nVERDICT: worthy\nCRITIQUE: x');
  assert.equal(modelSubScore(p), 1);
  // meaningfulness weighted heaviest (0.35): high meaning, low rest
  const p2 = parseWorth('MEANINGFULNESS: 1\nENGINEERING: 0\nCONFIGURABILITY: 0\nFUTUREPROOF: 0\nVERDICT: marginal\nCRITIQUE: x');
  assert.equal(modelSubScore(p2), 0.35);
});

// ── the combined verdict: the CAP is the point ────────────────────────────────────────
test('worthVerdict: a string tweak the model LOVES is still capped below the bar', () => {
  const shape = classifyChangeShape("return 'old';", "return 'much better copy';");
  const parsed = parseWorth('MEANINGFULNESS: 0.95\nENGINEERING: 0.95\nCONFIGURABILITY: 0.9\nFUTUREPROOF: 0.9\nVERDICT: worthy\nCRITIQUE: great');
  const v = worthVerdict({ shape, parsed });
  assert.equal(v.shape, 'string-only');
  assert.ok(v.worth <= 0.45, `capped at the string ceiling, got ${v.worth}`);
  assert.equal(v.worthy, false, 'a cosmetic change is NOT worthy no matter the model score');
  assert.match(v.reason, /capped/);
});

test('worthVerdict: an excellent logic change passes', () => {
  const shape = classifyChangeShape('if (a) return x;', 'if (a && withinBudget(cfg)) return x;');
  const parsed = parseWorth('MEANINGFULNESS: 0.85\nENGINEERING: 0.85\nCONFIGURABILITY: 0.8\nFUTUREPROOF: 0.85\nVERDICT: worthy\nCRITIQUE: generalises well');
  const v = worthVerdict({ shape, parsed });
  assert.equal(v.worthy, true);
  assert.ok(v.worth >= WORTH_PASS_SCORE);
});

test('worthVerdict: a poorly-engineered logic change is sunk by a low model score', () => {
  const shape = classifyChangeShape('return compute();', 'return compute() || hackyGlobalFallback;');
  const parsed = parseWorth('MEANINGFULNESS: 0.5\nENGINEERING: 0.2\nCONFIGURABILITY: 0.2\nFUTUREPROOF: 0.15\nVERDICT: not-worthy\nCRITIQUE: introduces a hidden global');
  const v = worthVerdict({ shape, parsed });
  assert.equal(v.worthy, false, 'substantive shape but bad engineering → rejected');
});

test('worthVerdict: unreadable model on a logic change → indeterminate, benefit of the doubt to ceiling', () => {
  const shape = classifyChangeShape('if (a) x();', 'if (a && b) x();');
  const v = worthVerdict({ shape, parsed: { parsed: false } });
  assert.equal(v.indeterminate, true);
  assert.equal(v.worthy, true, 'logic ceiling 1.0 >= pass; a real change is not blocked by a model hiccup');
});

test('worthVerdict: unreadable model on a string change → still capped, still not worthy', () => {
  const shape = classifyChangeShape("return 'a';", "return 'b';");
  const v = worthVerdict({ shape, parsed: { parsed: false } });
  assert.equal(v.worthy, false, 'cosmetic stays rejected even when the model is silent');
});

// ── end-to-end with an injected model ──────────────────────────────────────────────────
test('judgeChangeWorth: whitespace change short-circuits without calling the model', async () => {
  let called = false;
  const v = await judgeChangeWorth(
    { find: '  const x=1;', replace: 'const x=1;' },
    { generate: async () => { called = true; return ''; } },
  );
  assert.equal(called, false, 'no model call wasted on whitespace');
  assert.equal(v.worthy, false);
});

test('judgeChangeWorth: a real, excellent logic change is judged worthy', async () => {
  const generate = async () => 'MEANINGFULNESS: 0.9\nENGINEERING: 0.88\nCONFIGURABILITY: 0.85\nFUTUREPROOF: 0.9\nVERDICT: worthy\nCRITIQUE: clean + configurable';
  const v = await judgeChangeWorth(
    { instruction: 'gate X by a configurable budget', file: 'f.ts', find: 'if (a) run();', replace: 'if (a && underBudget(cfg.max)) run();', why: 'configurable gate' },
    { generate },
  );
  assert.equal(v.worthy, true);
  assert.equal(v.verdict, 'worthy');
});

test('judgeChangeWorth: the exact council copy-tweak we committed is judged NOT worthy', async () => {
  // Even if a model rsubjectively likes it, the shape cap makes it not-worthy — the whole point.
  const generate = async () => 'MEANINGFULNESS: 0.7\nENGINEERING: 0.8\nCONFIGURABILITY: 0.6\nFUTUREPROOF: 0.6\nVERDICT: marginal\nCRITIQUE: helpful but cosmetic';
  const v = await judgeChangeWorth(
    {
      instruction: 'make the gap message more actionable',
      file: 'packages/core/src/chat/capability-gap.ts',
      find: 'return `I won\'t guess. Give me more detail or a source, or I can escalate it.`;',
      replace: 'return `I won\'t guess. Please rephrase the question or break it into smaller steps.`;',
    },
    { generate },
  );
  assert.equal(v.shape, 'string-only');
  assert.equal(v.worthy, false, 'the loop should NOT commit a bare copy tweak under V3gga\'s bar');
});
