import test from 'node:test';
import assert from 'node:assert/strict';
import { runV3ScorerAttackBank, scoreV3Answer } from './vai-competition-v3-scorer.mjs';

test('strict JSON scorer rejects polarity, extra keys, duplicate keys, echo, and malformed output', () => {
  const controls = runV3ScorerAttackBank();
  assert.equal(controls.passed, true);
  assert.equal(controls.trueOrderSwapInvariant, true);
  assert.deepEqual(controls.attacks.correct, { passed: true, disposition: 'correct' });
  assert.equal(controls.attacks.duplicateKey.disposition, 'invalid-output');
  assert.equal(controls.attacks.extraKey.disposition, 'wrong');
});

test('typed scorer supports exact alternatives and numeric tolerances without regex matching', () => {
  assert.equal(scoreV3Answer('{"path":["A","B"]}', { kind: 'json', oneOf: [{ path: ['A', 'B'] }, { path: ['A', 'C', 'B'] }] }).passed, true);
  assert.equal(scoreV3Answer('0.3334', { kind: 'number', value: 1 / 3, tolerance: 0.001 }).passed, true);
  assert.equal(scoreV3Answer('INSUFFICIENT', { kind: 'exact', value: 'INSUFFICIENT' }).passed, true);
});
