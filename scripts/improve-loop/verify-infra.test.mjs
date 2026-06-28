import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyVerifiedFix } from './apply-fix.mjs';

// Regression: a tsc that TIMED OUT (infra) must NOT be treated as a broken patch. Before this fix,
// verify returned ok:false with empty output → "reverted-red" → the fix was STRUCK as dead, even
// though it was fine. Under GPU load (the loop running models) tsc is slow → every patch falsely
// reverted → the loop could never land a fix. Now an infra verify returns { applied:false, infra:true }.

const baseProposal = { file: 'x.ts', find: 'const a = 1;', replace: 'const a = 2;', why: 'w' };
const deps = (verifyResult) => ({
  branch: 'council/auto-improve',
  readFile: () => 'const a = 1;\n',
  writeFile: () => {},
  verify: async () => verifyResult,
  commit: async () => {},
});

test('an INFRA verify failure is signalled, NOT treated as a reverted bad patch', async () => {
  const r = await applyVerifiedFix(baseProposal, deps({ ok: false, infra: true, detail: 'tsc could not complete (infra: ETIMEDOUT)' }));
  assert.equal(r.committed, false);
  assert.equal(r.infra, true, 'must carry infra:true so the caller skips, not strikes');
  assert.match(r.verifyDetail, /skipped \(infra\)/);
});

test('a REAL type error still reverts (not infra)', async () => {
  const r = await applyVerifiedFix(baseProposal, deps({ ok: false, detail: 'tsc failed: error TS2322: Type ...' }));
  assert.equal(r.committed, false);
  assert.notEqual(r.infra, true);
  assert.match(r.verifyDetail, /reverted — verify failed/);
});

test('a green verify still commits', async () => {
  const r = await applyVerifiedFix(baseProposal, deps({ ok: true, detail: 'tsc green' }));
  assert.equal(r.committed, true);
});
