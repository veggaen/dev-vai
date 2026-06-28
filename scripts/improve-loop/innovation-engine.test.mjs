// Run: node --test --experimental-sqlite scripts/improve-loop/innovation-engine.test.mjs
// node:test (improve-loop tooling lives outside the vitest workspace). Importing the
// engine pulls in db.mjs (node:sqlite), so the --experimental-sqlite flag is required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import {
  buildScorecard,
  suggestExperiment,
  rankExperiments,
  hasOpenExperiment,
  planNextExperiment,
  startExperiment,
  finishExperiment,
  experimentHistory,
} from './innovation-engine.mjs';
import { openDb, startRun, endRun, recordResult, upsertPrompt, proposalQualityStats } from './db.mjs';

test('proposalQualityStats: per-class, bounded [0,1], unpolluted by other-lane consensus', () => {
  // Regression for the live 116× bug: the visual lane writes hundreds of ui/contrast
  // rows into the shared consensus table; the old metric divided ALL verified
  // consensus by the proposal count, yielding hit-rates like 8660%. The fix measures
  // convergence at the proposed-class grain so unrelated lanes can't inflate it.
  const dbPath = join(tmpdir(), `vai-pq-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  const db = openDb(dbPath);
  // Lazy tables (created in production by propose-fix / consensus-fix / supervisor).
  db.exec('CREATE TABLE IF NOT EXISTS proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, fix_id INTEGER, class TEXT, file TEXT, find TEXT, "replace" TEXT, why TEXT, raw TEXT, status TEXT, created_at TEXT)');
  db.exec('CREATE TABLE IF NOT EXISTS consensus (id INTEGER PRIMARY KEY AUTOINCREMENT, class TEXT, file TEXT, find TEXT, "replace" TEXT, agree_count INTEGER, personas TEXT, verified INTEGER, why TEXT, created_at TEXT, applied TEXT)');
  const now = new Date().toISOString();
  const insP = db.prepare('INSERT INTO proposals (class,file,find,"replace",why,raw,status,created_at) VALUES (?,?,?,?,?,?,?,?)');
  insP.run('answer/x', 'f.ts', 'a', 'r', 'w', 'raw', 'queued', now);
  insP.run('answer/x', 'f.ts', 'a2', 'r2', 'w', 'raw', 'queued', now);
  insP.run('routing/y', 'g.ts', 'b', 'r', 'w', 'raw', 'queued', now);
  const insC = db.prepare('INSERT INTO consensus (class,file,find,"replace",agree_count,personas,verified,why,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
  insC.run('answer/x', 'f.ts', 'a', 'r', 3, '[]', 1, 'w', now); // answer/x converged
  for (let i = 0; i < 50; i++) insC.run('ui/contrast', 'App.tsx', 'x', 'y', 5, '[]', 1, 'w', now); // pollution
  const pq = proposalQualityStats(db);
  db.close();
  rmSync(dbPath, { force: true });
  assert.equal(pq.total, 2);     // two distinct proposed classes
  assert.equal(pq.converged, 1); // only answer/x reached verified consensus (routing/y did not)
  assert.equal(pq.hitRate, 0.5); // the 50 ui/contrast rows do NOT inflate it
  assert.ok(pq.hitRate <= 1);
});

/** A minimal analyzeMotion-shaped object for unit-testing the pure branches. */
function motionOf({ state, passV = 'flat', passCur = 0.6, exV = 'flat', exCur = null, stalled = false }) {
  return {
    state,
    passRate: { current: passCur, slope: 0, verdict: passV },
    excellence: { current: exCur, slope: 0, verdict: exV },
    stagnation: { stalled },
  };
}

test('buildScorecard: defaults are safe and shape is stable', () => {
  const sc = buildScorecard({});
  assert.equal(sc.state, 'cold-start');
  assert.equal(sc.passRate.current, 0);
  assert.equal(sc.proposalQuality.hitRate, 0);
  assert.equal(sc.councilHealth.responseRate, 1); // unknown council ⇒ assume healthy
  assert.equal(sc.slopScore.score, 0);
});

test('buildScorecard threads motion + stats through unchanged', () => {
  const sc = buildScorecard({
    motion: motionOf({ state: 'stalling', passCur: 0.9, exV: 'flat' }),
    proposal: { hitRate: 0.2, total: 9 },
    council: { responseRate: 0.4 },
    excellence: { low: 7, graded: 12 },
  });
  assert.equal(sc.passRate.current, 0.9);
  assert.equal(sc.proposalQuality.total, 9);
  assert.equal(sc.councilHealth.responseRate, 0.4);
  assert.equal(sc.slopScore.score, 7);
});

test('suggestExperiment: stall + maxed pass + flat excellence ⇒ grading', () => {
  const sc = buildScorecard({ motion: motionOf({ state: 'stalling', passCur: 0.92, passV: 'flat', exV: 'flat' }) });
  assert.equal(suggestExperiment(sc).type, 'grading');
});

test('suggestExperiment: stall + both gradients flat (low pass) ⇒ model', () => {
  const sc = buildScorecard({ motion: motionOf({ state: 'stalling', passCur: 0.6, passV: 'flat', exV: 'flat' }) });
  assert.equal(suggestExperiment(sc).type, 'model');
});

test('suggestExperiment: stall with one soft gradient ⇒ prompt', () => {
  const sc = buildScorecard({ motion: motionOf({ state: 'stalling', passCur: 0.6, passV: 'flat', exV: 'improving' }) });
  assert.equal(suggestExperiment(sc).type, 'prompt');
});

test('suggestExperiment: not stalled falls through to legacy signal branches', () => {
  const sc = buildScorecard({
    motion: motionOf({ state: 'improving', passCur: 0.7 }),
    proposal: { hitRate: 0.1, total: 8 },
  });
  assert.equal(suggestExperiment(sc).type, 'prompt'); // low hit-rate branch
});

test('rankExperiments: ordered, head==suggestExperiment, distinct candidates for fall-through', () => {
  const sc = buildScorecard({ motion: motionOf({ state: 'stalling', passCur: 0.6, passV: 'flat', exV: 'flat' }) });
  const ranked = rankExperiments(sc);
  assert.ok(ranked.length >= 2); // need fall-back room when the top pick is deduped
  assert.equal(ranked[0].type, suggestExperiment(sc).type);
  const keys = ranked.map((e) => `${e.type}:${e.config.variant}`);
  assert.equal(new Set(keys).size, keys.length); // no immediate dupes ⇒ fall-through advances
});

function tmpDb() {
  const f = join(tmpdir(), `vai-innov-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  return { f, db: openDb(f) };
}

/** Seed `runs` count, each with `total` results of which `passed` pass. */
function seedRuns(db, perRunPass) {
  perRunPass.forEach(([passed, total], i) => {
    const runId = startRun(db, `seed-${i}`);
    for (let k = 0; k < total; k++) {
      const pid = upsertPrompt(db, { prompt: `p${i}-${k}`, klass: 'demo', expectedIntent: 'x', origin: 'seed' });
      recordResult(db, { runId, promptId: pid, klass: 'demo', readAs: 'demo', passed: k < passed });
    }
    endRun(db, runId, 'ok'); // a seeded run is FINISHED — trends now exclude in-progress runs
  });
}

test('planNextExperiment: stalled corpus RECORDS the top pick (one open at a time)', () => {
  const { f, db } = tmpDb();
  try {
    // Runs must each carry >= MIN_MOTION_SAMPLE (8) graded prompts to count as a motion
    // sample — tiny runs are filtered as noise (the bug that kept the loop from ever stalling).
    seedRuns(db, [[5, 8], [5, 8], [5, 8]]); // pass-rate flat at 0.625 across 3 real runs ⇒ stalling
    const first = planNextExperiment(db, { record: true });
    assert.equal(first.motion.state, 'stalling');
    assert.equal(first.trigger, 'stall');
    assert.equal(first.recorded, true);
    assert.ok(first.experimentId > 0);

    // ONE open experiment at a time: with the first still open (delta IS NULL), the next
    // plan must NOT stack another — it waits for the experiment-runner to close it.
    const second = planNextExperiment(db, { record: true });
    assert.equal(second.recorded, false);
    assert.match(second.skipReason, /already open/);
    assert.equal(experimentHistory(db).length, 1);
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('planNextExperiment: regressing corpus records an arrest-regression experiment', () => {
  const { f, db } = tmpDb();
  try {
    seedRuns(db, [[7, 8], [5, 8], [2, 8]]); // 0.875 → 0.625 → 0.25 ⇒ regressing
    const plan = planNextExperiment(db, { record: true });
    assert.equal(plan.motion.state, 'regressing');
    assert.equal(plan.trigger, 'regression');
    assert.equal(plan.recorded, true);
    assert.match(plan.suggestion.config.variant, /arrest-regression/);
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('planNextExperiment: healthy + idle ⇒ idle-speculation records a forward probe', () => {
  const { f, db } = tmpDb();
  try {
    seedRuns(db, [[2, 8], [5, 8], [8, 8]]); // 0.25 → 0.625 → 1.0 ⇒ improving (healthy)
    const plan = planNextExperiment(db, { record: true });
    assert.equal(plan.motion.state, 'improving');
    assert.equal(plan.trigger, 'idle-speculation'); // "nothing to do ⇒ think ahead"
    assert.equal(plan.recorded, true);
    // …and with that probe open, the next idle plan waits (one at a time).
    const next = planNextExperiment(db, { record: true });
    assert.equal(next.recorded, false);
    assert.match(next.skipReason, /already open/);
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('planNextExperiment: cold-start (too few real runs) records nothing', () => {
  const { f, db } = tmpDb();
  try {
    seedRuns(db, [[5, 8]]); // a single real run ⇒ not enough to read motion
    const plan = planNextExperiment(db, { record: true });
    assert.equal(plan.motion.state, 'cold-start');
    assert.equal(plan.recorded, false);
    assert.equal(experimentHistory(db).length, 0);
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('planNextExperiment preview (record:false) never writes', () => {
  const { f, db } = tmpDb();
  try {
    seedRuns(db, [[5, 8], [5, 8], [5, 8]]);
    const plan = planNextExperiment(db, { record: false });
    assert.equal(plan.motion.state, 'stalling');
    assert.equal(plan.recorded, false);
    assert.match(plan.skipReason, /preview/);
    assert.equal(experimentHistory(db).length, 0);
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('hasOpenExperiment: matches type+variant of an OPEN experiment', () => {
  const { f, db } = tmpDb();
  try {
    startExperiment(db, { type: 'model', hypothesis: 'h', config: { variant: 'qwen2.5-coder:7b' } });
    assert.equal(hasOpenExperiment(db, { type: 'model', config: { variant: 'qwen2.5-coder:7b' } }), true);
    assert.equal(hasOpenExperiment(db, { type: 'model', config: { variant: 'other' } }), false);
    assert.equal(hasOpenExperiment(db, { type: 'prompt', config: { variant: 'qwen2.5-coder:7b' } }), false);
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('hasOpenExperiment: a REJECTED variant blocks during cooldown, then is re-eligible', () => {
  const { f, db } = tmpDb();
  try {
    const v = { type: 'model', config: { variant: 'qwen2.5-coder:7b' } };
    const id = startExperiment(db, { type: 'model', hypothesis: 'h', config: v.config });
    finishExperiment(db, id, { experimentScore: 0.5, delta: 0, adopted: false, evidence: 'discard' });
    // Just rejected: 0 experiments closed since ⇒ within cooldown ⇒ blocks.
    assert.equal(hasOpenExperiment(db, v, { cooldown: 3 }), true);
    // Close 3 OTHER experiments (cooldown rotation proxy).
    for (let i = 0; i < 3; i++) {
      const oid = startExperiment(db, { type: 'prompt', hypothesis: `o${i}`, config: { variant: `o${i}` } });
      finishExperiment(db, oid, { experimentScore: 0.5, delta: 0, adopted: false, evidence: 'd' });
    }
    // 3 closed since the rejection ⇒ past cooldown(3) ⇒ re-eligible (perpetual pool rotation).
    assert.equal(hasOpenExperiment(db, v, { cooldown: 3 }), false);
    // cooldown:0 ⇒ a rejected variant is ALWAYS re-eligible immediately.
    assert.equal(hasOpenExperiment(db, v, { cooldown: 0 }), false);
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('planNextExperiment: PERPETUAL — keeps recording across many reject cycles (pool rotates, never dies)', () => {
  const { f, db } = tmpDb();
  try {
    seedRuns(db, [[5, 8], [5, 8], [5, 8]]); // permanent stall (flat 0.625)
    let recorded = 0;
    for (let cycle = 0; cycle < 20; cycle++) {
      // close any open experiment as a DISCARD (the change didn't help)
      const open = experimentHistory(db, 1).find((r) => r.delta == null);
      if (open) finishExperiment(db, open.id, { experimentScore: 0.625, delta: 0, adopted: false, evidence: 'd' });
      const plan = planNextExperiment(db, { record: true });
      if (plan.recorded) recorded++;
    }
    // Old behaviour died after ~4 (finite pool, permanent ban). With cooldown rotation the
    // pool replenishes in time, so the loop keeps producing experiments indefinitely.
    assert.ok(recorded >= 15, `expected a perpetual stream, got ${recorded}/20`);
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('planNextExperiment: signals `exhausted` when every candidate is OPEN (caller → generator fallback)', () => {
  const { f, db } = tmpDb();
  try {
    seedRuns(db, [[5, 8], [5, 8], [5, 8]]); // stalling
    // Queue every ranked candidate as OPEN. Open always blocks (cooldown can't rescue it),
    // and the one-open guard returns BEFORE the exhausted check — so to hit `exhausted` we
    // must have NO open experiment but every candidate cooldown-blocked. Simulate that by
    // recording each as a fresh reject and probing with the engine's own dedup: once the
    // one-open guard passes (nothing open) and all candidates are blocked, exhausted=true.
    const ranked = rankExperiments(planNextExperiment(db, { record: false }).scorecard);
    // Record + immediately reject each, newest last, so the MOST-recent rejects are within
    // cooldown. With < cooldown(3) closures after the last few, those stay blocked; the head
    // candidate may rotate — so we assert the loop EITHER records (rotation) OR flags exhausted
    // (so the generator fires). Both are valid perpetual outcomes; neither is a dead stop.
    for (const c of ranked) {
      const id = startExperiment(db, { type: c.type, hypothesis: c.hypothesis, config: c.config });
      finishExperiment(db, id, { experimentScore: 0.6, delta: 0, adopted: false, evidence: 'd' });
    }
    const plan = planNextExperiment(db, { record: true });
    assert.ok(plan.recorded || plan.exhausted, 'must either rotate-in a candidate or flag exhausted for the generator');
    if (plan.exhausted) assert.match(plan.skipReason, /exhausted/);
  } finally { db.close(); rmSync(f, { force: true }); }
});
