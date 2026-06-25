// Run: node --test --experimental-sqlite scripts/improve-loop/experiment-runner.test.mjs
// node:test (improve-loop tooling lives outside vitest). Importing pulls in db.mjs
// (node:sqlite) so --experimental-sqlite is required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import {
  nextOpenExperiment,
  measureCorpusMetric,
  runExperiment,
  runNextExperiment,
} from './experiment-runner.mjs';
import { startExperiment, finishExperiment, targetMetric, experimentHistory } from './innovation-engine.mjs';
import { openDb, startRun, recordResult, upsertPrompt } from './db.mjs';

function tmpDb() {
  const f = join(tmpdir(), `vai-exprun-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  return { f, db: openDb(f) };
}
function seedRun(db, passed, total, ex = null) {
  const runId = startRun(db, 'r');
  for (let k = 0; k < total; k++) {
    const pid = upsertPrompt(db, { prompt: `p${runId}-${k}`, klass: 'demo', expectedIntent: 'x', origin: 'seed' });
    recordResult(db, { runId, promptId: pid, klass: 'demo', readAs: 'demo', passed: k < passed, answerExcellence: ex });
  }
  return runId;
}

test('targetMetric maps grading→excellence, everything else→passRate', () => {
  assert.equal(targetMetric('grading'), 'excellence');
  assert.equal(targetMetric('model'), 'passRate');
  assert.equal(targetMetric('prompt'), 'passRate');
});

test('nextOpenExperiment: oldest open, ignores finished, null when none', () => {
  const { f, db } = tmpDb();
  try {
    assert.equal(nextOpenExperiment(db), null);
    const a = startExperiment(db, { type: 'model', hypothesis: 'a', config: {}, baselineScore: 0.5 });
    const b = startExperiment(db, { type: 'prompt', hypothesis: 'b', config: {}, baselineScore: 0.5 });
    finishExperiment(db, a, { experimentScore: 0.5, delta: 0, adopted: false, evidence: 'x' });
    assert.equal(nextOpenExperiment(db).id, b); // a is finished → b is the oldest open
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('measureCorpusMetric: value is latest, samplesSince counts runs after the timestamp', async () => {
  const { f, db } = tmpDb();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    // Runs must carry >= MIN_MOTION_SAMPLE (8) graded prompts to count (same filter the
    // baseline uses, so the A/B is like-for-like and tiny probes can't fake a measurement).
    seedRun(db, 6, 10); // 0.6
    await sleep(5);
    const cut = new Date().toISOString();
    await sleep(5);
    seedRun(db, 8, 10); // 0.8, strictly after cut
    const m = measureCorpusMetric(db, 'passRate', cut);
    assert.equal(Math.round(m.value * 100), 80);
    assert.equal(m.samplesSince, 1);
    assert.equal(measureCorpusMetric(db, 'passRate', '').samplesSince, 2);
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('runExperiment: refuses without a post-queue run (honest — no verdict yet)', () => {
  const { f, db } = tmpDb();
  try {
    const id = startExperiment(db, { type: 'model', hypothesis: 'h', config: {}, baselineScore: 0.5 });
    const exp = nextOpenExperiment(db);
    const r = runExperiment(db, exp, { measure: () => ({ value: 0.9, samplesSince: 0 }) });
    assert.equal(r.ran, false);
    assert.match(r.reason, /post-queue/);
    assert.equal(experimentHistory(db)[0].delta, null); // still open
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('runExperiment: beats threshold ⇒ ADOPTED with measured delta', () => {
  const { f, db } = tmpDb();
  try {
    startExperiment(db, { type: 'model', hypothesis: 'h', config: {}, baselineScore: 0.6 });
    const r = runExperiment(db, nextOpenExperiment(db), { measure: () => ({ value: 0.75, samplesSince: 2 }) });
    assert.equal(r.ran, true);
    assert.equal(r.adopted, true);
    assert.ok(Math.abs(r.delta - 0.15) < 1e-9);
    assert.equal(nextOpenExperiment(db), null); // closed
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('runExperiment: below threshold ⇒ discarded (and recorded so it blocks re-tries)', () => {
  const { f, db } = tmpDb();
  try {
    startExperiment(db, { type: 'model', hypothesis: 'h', config: {}, baselineScore: 0.6 });
    const r = runExperiment(db, nextOpenExperiment(db), { measure: () => ({ value: 0.605, samplesSince: 1 }) });
    assert.equal(r.adopted, false);
    const row = experimentHistory(db)[0];
    assert.equal(row.adopted, 0);
    assert.notEqual(row.delta, null);
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('runExperiment: grading uses the excellence threshold (0.2/10), not the pass-rate one', () => {
  const { f, db } = tmpDb();
  try {
    // +0.1 craft would ADOPT under pass-rate's 0.02 bar but must DISCARD under 0.2.
    startExperiment(db, { type: 'grading', hypothesis: 'h', config: {}, baselineScore: 7.0 });
    const r = runExperiment(db, nextOpenExperiment(db), { measure: () => ({ value: 7.1, samplesSince: 1 }) });
    assert.equal(r.metric, 'excellence');
    assert.equal(r.adopted, false);
    startExperiment(db, { type: 'grading', hypothesis: 'h2', config: {}, baselineScore: 7.0 });
    const r2 = runExperiment(db, nextOpenExperiment(db), { measure: () => ({ value: 7.3, samplesSince: 1 }) });
    assert.equal(r2.adopted, true);
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('runExperiment: ABANDONS an unmeasurable (null-baseline) experiment so it cannot deadlock the arc', () => {
  const { f, db } = tmpDb();
  try {
    startExperiment(db, { type: 'model', hypothesis: 'h', config: {}, baselineScore: null });
    const r = runExperiment(db, nextOpenExperiment(db), { measure: () => ({ value: 0.9, samplesSince: 5 }) });
    // Old behaviour refused + left it OPEN forever (a single such row blocks the one-open
    // guard permanently). New behaviour closes it as abandoned/discarded → arc stays alive.
    assert.equal(r.ran, true);
    assert.equal(r.abandoned, true);
    assert.equal(r.adopted, false);
    assert.equal(nextOpenExperiment(db), null); // closed — no deadlock
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('runExperiment: stale (many runs, never measurable) ⇒ abandoned; fresh wait ⇒ stays open', () => {
  const { f, db } = tmpDb();
  try {
    startExperiment(db, { type: 'model', hypothesis: 'h', config: {}, baselineScore: 0.6 });
    const exp = nextOpenExperiment(db);
    // Fresh: only a couple runs elapsed, no sample yet → keep waiting (don't abandon early).
    const wait = runExperiment(db, exp, { measure: () => ({ value: null, samplesSince: 0 }), runsSince: 2 });
    assert.equal(wait.ran, false);
    assert.match(wait.reason, /post-queue/);
    assert.notEqual(nextOpenExperiment(db), null); // still open, legitimately waiting
    // Stale: many runs elapsed, still no sample → abandon to unblock the arc.
    const stale = runExperiment(db, exp, { measure: () => ({ value: null, samplesSince: 0 }), runsSince: 9 });
    assert.equal(stale.ran, true);
    assert.equal(stale.abandoned, true);
    assert.equal(nextOpenExperiment(db), null);
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('runNextExperiment: full lifecycle on a real corpus (queue→accumulate→close)', async () => {
  const { f, db } = tmpDb();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    seedRun(db, 6, 10); // baseline corpus 0.6 (>= MIN_MOTION_SAMPLE so it counts)
    startExperiment(db, { type: 'model', hypothesis: 'h', config: {}, baselineScore: 0.6 });
    await sleep(5); // ensure the post-queue run's timestamp is strictly later
    seedRun(db, 10, 10); // a post-queue run lifts to 1.0
    const r = runNextExperiment(db);
    assert.equal(r.ran, true);
    assert.equal(r.adopted, true);
    assert.ok(r.treatment > r.baseline);
    assert.equal(runNextExperiment(db).reason, 'no open experiment');
  } finally { db.close(); rmSync(f, { force: true }); }
});
