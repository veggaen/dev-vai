// Run: node --test scripts/improve-loop/apply-runners.test.mjs
// Verifies the production deps' SAFETY contract — the branch guard especially, since it's the
// code that enforces "auto-apply only ever commits to council/auto-improve".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realApplyDeps, currentBranch, AUTO_IMPROVE_BRANCH, resolveInsideRoot } from './apply-runners.mjs';

test('currentBranch returns a non-empty branch name in this repo', () => {
  const b = currentBranch();
  assert.equal(typeof b, 'string');
  assert.ok(b.length > 0, 'should detect the current git branch');
});

test('commit() REFUSES when HEAD is not the dedicated branch (the autonomy guard)', async () => {
  const head = currentBranch();
  const deps = realApplyDeps({ branch: AUTO_IMPROVE_BRANCH });
  if (head === AUTO_IMPROVE_BRANCH) {
    // Rare: tests happen to run on the auto-improve branch. Then assert the INVERSE guard —
    // a committer locked to a different branch must refuse here.
    const other = realApplyDeps({ branch: 'definitely-not-this-branch' });
    await assert.rejects(() => other.commit('msg', 'x.ts'), /refusing to commit/i);
  } else {
    // Normal: we're on a feature branch, committer is locked to council/auto-improve → refuse.
    await assert.rejects(() => deps.commit('msg', 'x.ts'), /refusing to commit/i);
  }
});

test('verify() reports tsc-only green shape when no testPath is given (no throw)', () => {
  // We don't run the real (slow) tsc here — just assert the deps object is well-formed and the
  // verify function exists and is callable. Real verify is exercised live via apply-consensus.
  const deps = realApplyDeps({});
  assert.equal(typeof deps.verify, 'function');
  assert.equal(typeof deps.readFile, 'function');
  assert.equal(typeof deps.writeFile, 'function');
  assert.equal(deps.branch, AUTO_IMPROVE_BRANCH);
});

test('resolveInsideRoot: accepts repo-relative, rejects absolute + traversal (CodeRabbit #25 security)', () => {
  // repo-relative paths resolve fine
  assert.ok(resolveInsideRoot('packages/core/src/x.ts').endsWith('x.ts'));
  // absolute paths are rejected (the proposal contract is repo-relative only)
  assert.throws(() => resolveInsideRoot('C:/Windows/System32/evil.txt'), /absolute|escape/i);
  assert.throws(() => resolveInsideRoot('/etc/passwd'), /absolute|escape/i);
  // ../ traversal out of the repo is rejected
  assert.throws(() => resolveInsideRoot('../../../../etc/passwd'), /escape/i);
  assert.throws(() => resolveInsideRoot('packages/../../outside'), /escape/i);
  // empty / non-string rejected
  assert.throws(() => resolveInsideRoot(''), /non-empty/i);
});
