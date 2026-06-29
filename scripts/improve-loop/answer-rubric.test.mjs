// Run: node --test scripts/improve-loop/answer-rubric.test.mjs
// Built-in node test runner — the improve-loop scripts live outside the vitest
// workspace on purpose (operational tooling), so they self-test via node:test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeAnswerExcellence } from './answer-rubric.mjs';
import { detectAnswerSignals, scoreVagueOverconfident } from './vague-answer.mjs';

const GROUNDED =
  'Vai routes turns through packages/core. The council runs ~5 local models via ' +
  'Ollama (qwen3:8b, DeepSeek-R1). Latency is typically 2-30s depending on depth; ' +
  'it might still be wrong on fresh facts, so it searches the web first.';

const SLOP =
  'Vai is a powerful, cutting-edge local-first AI system that seamlessly leverages ' +
  'the best practices in intelligence. It is definitely the only way to get robust ' +
  'answers, and obviously everyone knows local is always better. At the end of the ' +
  'day it just works and everyone wins.';

test('empty answer is the worst outcome (P0, capped at 3)', () => {
  const r = judgeAnswerExcellence('');
  assert.equal(r.overall, 0);
  assert.equal(r.flawCounts.P0, 1);
  assert.ok(r.overall <= 3);
  assert.match(r.lesson, /empty/i);
});

test('grounded + calibrated answer scores well and carries no P0/P1 flaw', () => {
  const r = judgeAnswerExcellence(GROUNDED);
  assert.ok(r.overall >= 7, `overall ${r.overall} should be strong`);
  assert.equal(r.flawCounts.P0, 0);
  assert.equal(r.flawCounts.P1, 0);
  assert.ok(r.scores.grounding >= 7);
});

test('overconfident ungrounded slop is capped and flagged', () => {
  const r = judgeAnswerExcellence(SLOP);
  assert.ok(r.overall <= 6, `overall ${r.overall} should be capped by a P1 flaw`);
  assert.ok(r.flawCounts.P1 >= 1);
  assert.ok(r.flaws.some((f) => /overconfident|grounding/i.test(f.symptom)));
});

test('short, plain answer is acceptable (no invented flaws)', () => {
  const r = judgeAnswerExcellence('Yes, that works.');
  assert.equal(r.flawCounts.P0, 0);
  assert.equal(r.flawCounts.P1, 0);
  assert.ok(r.overall >= 5);
});

test('empty preamble is penalized on directness', () => {
  const withPreamble = judgeAnswerExcellence(
    'Great question! ' + GROUNDED,
  );
  const without = judgeAnswerExcellence(GROUNDED);
  assert.ok(withPreamble.scores.directness < without.scores.directness);
  assert.ok(withPreamble.flaws.some((f) => /preamble/i.test(f.symptom)));
});

test('wall of text is penalized on structure', () => {
  const sentence = 'The system processes the request and returns a value step by step. ';
  const wall = sentence.repeat(20); // >120 words, no breaks
  const r = judgeAnswerExcellence(wall);
  assert.ok(r.scores.structure <= 4, `structure ${r.scores.structure}`);
  assert.ok(r.flaws.some((f) => /wall of text/i.test(f.symptom)));
});

test('all dimension scores stay within 0..10 bounds', () => {
  for (const input of ['', 'Yes.', GROUNDED, SLOP, 'Great question! maybe.']) {
    const r = judgeAnswerExcellence(input);
    assert.ok(r.overall >= 0 && r.overall <= 10);
    for (const v of Object.values(r.scores)) {
      assert.ok(v >= 0 && v <= 10, `score ${v} out of bounds for: ${input.slice(0, 20)}`);
    }
  }
});

test('lesson is deterministic for the same input', () => {
  assert.equal(judgeAnswerExcellence(SLOP).lesson, judgeAnswerExcellence(SLOP).lesson);
  assert.equal(judgeAnswerExcellence(GROUNDED).lesson, judgeAnswerExcellence(GROUNDED).lesson);
});

test('headline summarizes overall + every dimension', () => {
  const r = judgeAnswerExcellence(GROUNDED);
  assert.match(r.headline, /answer excellence/);
  for (const dim of ['ground', 'direct', 'struct', 'calib', 'spec']) {
    assert.match(r.headline, new RegExp(dim));
  }
});

// Shared-primitive contract: the rubric and the vague grader read the same signals.
test('detectAnswerSignals stays consistent and vague grader is unchanged', () => {
  const sig = detectAnswerSignals(SLOP);
  assert.equal(sig.confident, true);
  assert.equal(sig.grounded, false);
  assert.equal(scoreVagueOverconfident(SLOP).vague, true);
  assert.equal(scoreVagueOverconfident(GROUNDED).vague, false);
  assert.equal(scoreVagueOverconfident('').vague, false);
});
