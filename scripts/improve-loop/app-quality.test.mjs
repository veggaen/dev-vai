import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeWithAppGate, appQualityAvailable, appVerdictToScore } from './app-quality.mjs';

test('appVerdictToScore maps verdicts to the loop 0..10 scale', () => {
  assert.ok(appVerdictToScore('pass', 1) >= 8);
  assert.equal(appVerdictToScore('warn', 0.7), 6);
  assert.ok(appVerdictToScore('fail', 0.2) <= 4);
});

test('grades a good answer (matching prompt) as pass when the gate is built', async (t) => {
  if (!(await appQualityAvailable())) return t.skip('app dist not built — loop falls back to rubric');
  const r = await gradeWithAppGate(
    'how do I fix slow React re-renders?',
    'Open the React DevTools Profiler and record the interaction. Fixes: 1. useMemo, 2. split context, 3. virtualize long lists.',
  );
  assert.equal(r.verdict, 'pass', JSON.stringify(r));
});

test('grades an off-topic answer as fail with an actionable missing-list', async (t) => {
  if (!(await appQualityAvailable())) return t.skip('app dist not built');
  const r = await gradeWithAppGate(
    'how do I fix slow React re-renders?',
    'A good company culture is defined by amazing people and a supportive environment where everyone thrives.',
  );
  assert.equal(r.verdict, 'fail');
  assert.ok(r.missing.length > 0, 'a failing answer names what it missed');
});

test('returns null gracefully (caller falls back) — never throws', async () => {
  // empty inputs must not throw regardless of gate availability
  assert.doesNotReject(() => gradeWithAppGate('', ''));
  assert.doesNotReject(() => gradeWithAppGate(null, null));
});
