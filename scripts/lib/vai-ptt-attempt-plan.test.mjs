import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildPttAttemptPlan } from '../vai-ptt-attempt-plan.mjs';
import { currentSourceFingerprint } from '../vai-ptt-target-audit.mjs';

test('predeclares ten varied and unique attempts against one binary manifest', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'vai-ptt-plan-'));
  const manifestPath = path.join(directory, 'binary-manifest.json');
  const manifest = { schemaVersion: 1, sourceFingerprint: currentSourceFingerprint() };
  const text = `${JSON.stringify(manifest)}\n`;
  writeFileSync(manifestPath, text, 'utf8');
  let id = 0;
  let nonce = 0;
  const plan = buildPttAttemptPlan({
    binaryManifestPath: manifestPath,
    randomId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    randomNonce: () => Buffer.from(String(++nonce).padStart(36, '0')),
  });
  assert.equal(plan.attempts.length, 10);
  assert.equal(new Set(plan.attempts.map((item) => item.runId)).size, 10);
  assert.equal(new Set(plan.attempts.map((item) => item.nonce)).size, 10);
  assert.equal(new Set(plan.attempts.map((item) => item.claimPath)).size, 10);
  assert.ok(plan.attempts.every((item) => path.isAbsolute(item.claimPath)));
  assert.ok(plan.attempts.filter((item) => item.workflow === 'canonical-churn').length >= 3);
  assert.ok(plan.attempts.some((item) => item.workflow === 'open-and-paste'));
  assert.deepEqual(new Set(plan.attempts.map((item) => item.mode)), new Set(['windowed', 'borderless']));
  assert.equal(plan.binaryManifestSha256, createHash('sha256').update(text).digest('hex'));
});
