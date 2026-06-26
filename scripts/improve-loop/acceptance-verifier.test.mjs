// Run: node --test --experimental-sqlite scripts/improve-loop/acceptance-verifier.test.mjs
// Imports db.mjs (node:sqlite) for the failingRowsForClass temp-DB test → flag required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import {
  summarizeAcceptance, verifyAcceptance, verifyClassAcceptance, formatAcceptance, ACCEPT_RATE,
} from './acceptance-verifier.mjs';
import { openDb, startRun, recordResult, upsertPrompt, failingRowsForClass } from './db.mjs';

test('summarizeAcceptance: all recovered = accepted, recoveryRate exact', () => {
  const r = summarizeAcceptance([{ passed: true }, { passed: true }], { klass: 'x' });
  assert.equal(r.verdict, 'accepted');
  assert.equal(r.accepted, true);
  assert.equal(r.recovered, 2);
  assert.equal(r.recoveryRate, 1);
});

test('summarizeAcceptance: accepted ≥0.8, improved ≥improveRate, partial below, rejected at 0', () => {
  const atBar = summarizeAcceptance([{ passed: true }, { passed: true }, { passed: true }, { passed: true }, { passed: false }], { acceptRate: 0.8 });
  assert.equal(atBar.recoveryRate, 0.8);
  assert.equal(atBar.verdict, 'accepted');
  // 1/3 (33%) ≥ improveRate 0.25 + breaks nothing → IMPROVED (kept, net progress) — the key change.
  const improved = summarizeAcceptance([{ passed: true }, { passed: false }, { passed: false }], { acceptRate: 0.8, improveRate: 0.25 });
  assert.equal(improved.verdict, 'improved');
  assert.equal(improved.accepted, true, 'an improvement is KEPT');
  // 1/10 (10%) < improveRate → too marginal → partial (not kept).
  const partial = summarizeAcceptance(Array.from({ length: 10 }, (_, i) => ({ passed: i === 0 })), { acceptRate: 0.8, improveRate: 0.25 });
  assert.equal(partial.verdict, 'partial');
  const rejected = summarizeAcceptance([{ passed: false }, { passed: false }], { acceptRate: 0.8 });
  assert.equal(rejected.verdict, 'rejected');
});

test('summarizeAcceptance: ANY regression rejects, however much it recovers (safety)', () => {
  // recovers 2/2 failures (100%) BUT breaks a previously-passing prompt → REJECTED.
  const r = summarizeAcceptance([
    { passed: true }, { passed: true },                 // both failures recovered
    { passed: false, regression: true },                // a known-pass now FAILS → regression
  ], { acceptRate: 0.8 });
  assert.equal(r.regressed, 1);
  assert.equal(r.verdict, 'rejected');
  assert.equal(r.accepted, false);
  assert.match(r.headline, /REGRESSED/);
});

test('summarizeAcceptance: passing regression rows do not count as targets', () => {
  // 1 failure recovered + 2 passing rows that stay passing → 1/1 targets = accepted, no regression.
  const r = summarizeAcceptance([
    { passed: true },                                   // the one failure, recovered
    { passed: true, regression: true }, { passed: true, regression: true },
  ], { acceptRate: 0.8 });
  assert.equal(r.total, 1, 'regression rows excluded from targets');
  assert.equal(r.regressed, 0);
  assert.equal(r.verdict, 'accepted');
});

test('summarizeAcceptance: NO targeted failures is no-targets, never a silent pass', () => {
  const r = summarizeAcceptance([], { klass: 'x' });
  assert.equal(r.verdict, 'no-targets');
  assert.equal(r.accepted, false);
  assert.match(r.headline, /no targeted failures/);
});

test('verifyAcceptance: re-runs each row serially via injected runner+grader; errors count as still-failing', async () => {
  const order = [];
  const rows = [
    { prompt: 'a', expected_intent: 'EA' },
    { prompt: 'b', expected_intent: 'EB' },
    { prompt: 'c', expected_intent: 'EC' }, // this one throws in runOne
  ];
  const runOne = async (p) => { order.push(p); if (p === 'c') throw new Error('infra blip'); return { tag: p }; };
  const grade = async (klass, expected, prompt, vai) => ({ passed: prompt === 'a' }); // only 'a' recovers
  const seen = [];
  const rep = await verifyAcceptance({ rows, klass: 'routing/x', runOne, grade, onResult: (r) => seen.push(r.prompt) });
  assert.deepEqual(order, ['a', 'b', 'c']);          // serial, in order (BSOD rule)
  assert.deepEqual(seen, ['a', 'b', 'c']);           // onResult fired per row
  assert.equal(rep.total, 3);
  assert.equal(rep.recovered, 1);                    // only 'a'
  assert.equal(rep.verdict, 'improved');             // 1/3 (33%) ≥ improveRate, breaks nothing → kept
  const cRow = rep.perPrompt.find((p) => p.prompt === 'c');
  assert.equal(cRow.passed, false);
  assert.match(cRow.error, /infra blip/);
});

test('verifyAcceptance: throws without a runner/grader (no silent no-op)', async () => {
  await assert.rejects(() => verifyAcceptance({ rows: [{ prompt: 'a' }] }), /requires runOne/);
});

test('verifyClassAcceptance: pulls rows via injected selectRows, then verifies', async () => {
  const selectRows = () => [{ prompt: 'p1', expected_intent: 'E1' }, { prompt: 'p2', expected_intent: 'E2' }];
  const runOne = async (p) => ({ p });
  const grade = async () => ({ passed: true });
  const rep = await verifyClassAcceptance(null, 'answer/vague', { runOne, grade, selectRows });
  assert.equal(rep.verdict, 'accepted');
  assert.equal(rep.total, 2);
});

test('formatAcceptance: renders headline + still-failing prompts; null-safe', () => {
  const rep = summarizeAcceptance([{ passed: false, prompt: 'why is x broken' }, { passed: true }], { klass: 'c' });
  const out = formatAcceptance(rep);
  assert.match(out, /Acceptance:/);
  assert.match(out, /still failing:/);
  assert.equal(formatAcceptance(null), 'Acceptance: n/a');
});

test('failingRowsForClass: returns only prompts whose LATEST result is a failure', () => {
  const dbPath = join(tmpdir(), `vai-accept-${Date.now()}.sqlite`);
  const db = openDb(dbPath);
  try {
    const klass = 'routing/build-verb-poison';
    const pFixed = upsertPrompt(db, { prompt: 'fixed prompt', klass, expectedIntent: 'E', origin: 'seed' });
    const pStill = upsertPrompt(db, { prompt: 'still broken', klass, expectedIntent: 'E', origin: 'seed' });
    const pOther = upsertPrompt(db, { prompt: 'other class fail', klass: 'answer/x', expectedIntent: 'E', origin: 'seed' });
    const run1 = startRun(db, 'r1');
    recordResult(db, { runId: run1, promptId: pFixed, klass, passed: false, gradeReason: 'old fail' });
    recordResult(db, { runId: run1, promptId: pStill, klass, passed: false, gradeReason: 'still' });
    recordResult(db, { runId: run1, promptId: pOther, klass: 'answer/x', passed: false, gradeReason: 'other' });
    const run2 = startRun(db, 'r2');
    recordResult(db, { runId: run2, promptId: pFixed, klass, passed: true, gradeReason: 'recovered' }); // latest = pass
    recordResult(db, { runId: run2, promptId: pStill, klass, passed: false, gradeReason: 'still' });     // latest = fail

    const rows = failingRowsForClass(db, klass);
    assert.equal(rows.length, 1, `only the still-broken prompt should be a target, got ${rows.length}`);
    assert.equal(rows[0].prompt, 'still broken');
    assert.equal(rows[0].prompt_id, pStill);
    assert.equal(failingRowsForClass(db, 'answer/x').length, 1); // class isolation
  } finally {
    db.close();
    rmSync(dbPath, { force: true });
  }
});
