import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyProposal } from './proposal-verifier.mjs';

// Regression for the apply-time revert bug found by grading the live loop: consensus-fix stored the
// CLUSTER KEY (find.slice(0,80)) as the patch, not the winner's FULL find. An 80-char cut lands
// mid-regex → unbalanced parens/slashes → tsc fails → reverted-red every cycle, even though the
// model's real proposal was clean. The fix: store top.find and RE-VERIFY before saving.

const SOURCE = '  if (!/\\bvs\\.?\\b|\\bversus\\b|\\bcompare\\b|\\bcompared to\\b|\\bshould i use\\b|\\bdifference[s]? between\\b/i.test(lower)) return null;\n';
const FULL_FIND = SOURCE.trim();
const REPLACE = FULL_FIND.replace('\\bdifference[s]? between\\b', '\\bdifference[s]? between\\b|\\bbootstrap\\b');
const reader = () => SOURCE;

test('the 80-char-truncated cluster key is REJECTED (unbalanced)', () => {
  const truncated = FULL_FIND.slice(0, 80); // ends mid-regex, like the live bug
  const v = verifyProposal({ file: 'r.ts', find: truncated, replace: REPLACE }, { readFile: reader });
  assert.equal(v.ok, false);
  assert.match(v.code, /unbalanced-edit|hallucinated-find/);
});

test('the FULL winner find PASSES verification (what we now store)', () => {
  const v = verifyProposal({ file: 'r.ts', find: FULL_FIND, replace: REPLACE }, { readFile: reader });
  assert.equal(v.ok, true, v.detail);
});

test('re-verify gate: a truncated find can never be saved as verified', () => {
  // simulate the consensus save guard: only save when verifyProposal(top.find, replace).ok
  const candidate = { file: 'r.ts', find: FULL_FIND.slice(0, 80), replace: REPLACE };
  const verdict = verifyProposal(candidate, { readFile: reader });
  const wouldSave = verdict.ok;
  assert.equal(wouldSave, false, 'a truncated find must not be saved');
});
