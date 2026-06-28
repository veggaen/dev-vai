// Run: node --test scripts/improve-loop/pass-rate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passRateDelta, formatPassRateDelta } from './pass-rate.mjs';

test('detects an improvement and computes per-class + overall delta', () => {
  const before = [{ class: 'a', total: 4, passed: 1 }, { class: 'b', total: 4, passed: 2 }];
  const after  = [{ class: 'a', total: 4, passed: 3 }, { class: 'b', total: 4, passed: 2 }];
  const d = passRateDelta(before, after);
  assert.equal(d.verdict, 'improved');
  assert.ok(d.overall.delta > 0);
  assert.equal(d.classes[0].class, 'a'); // biggest |delta| first
  assert.equal(d.regressions.length, 0);
});

test('flags a regression (a class got worse) — the gate signal', () => {
  const before = [{ class: 'a', total: 4, passed: 4 }];
  const after  = [{ class: 'a', total: 4, passed: 1 }];
  const d = passRateDelta(before, after);
  assert.equal(d.verdict, 'regressed');
  assert.deepEqual(d.regressions, ['a']);
});

test('flat when within the noise epsilon', () => {
  const before = [{ class: 'a', total: 100, passed: 50 }];
  const after  = [{ class: 'a', total: 100, passed: 50 }];
  assert.equal(passRateDelta(before, after).verdict, 'flat');
});

test('handles new/absent classes and zero-sample rows without NaN', () => {
  const d = passRateDelta([], [{ class: 'new', total: 0, passed: 0 }]);
  assert.equal(d.overall.afterRate, 0);
  assert.equal(d.verdict, 'flat');
  assert.ok(Number.isFinite(d.classes[0].delta));
});

test('formats a readable one-liner', () => {
  const d = passRateDelta([{ class: 'a', total: 4, passed: 1 }], [{ class: 'a', total: 4, passed: 3 }]);
  const s = formatPassRateDelta(d);
  assert.match(s, /improved/);
  assert.match(s, /25% → 75%/);
});
