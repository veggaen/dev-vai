// Run: node --test --experimental-sqlite scripts/improve-loop/speculator.test.mjs
// node:test (improve-loop tooling lives outside vitest). Importing pulls in db.mjs
// (node:sqlite) so --experimental-sqlite is required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { experimentStats, expectedValue, speculate, EXPLORE_BONUS } from './speculator.mjs';
import { startExperiment, finishExperiment } from './innovation-engine.mjs';
import { openDb } from './db.mjs';

function tmpDb() {
  const f = join(tmpdir(), `vai-spec-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  return { f, db: openDb(f) };
}
/** Queue then immediately close an experiment with a measured outcome. */
function closed(db, { type, variant, delta, adopted }) {
  const id = startExperiment(db, { type, hypothesis: 'h', config: { variant }, baselineScore: 0.5 });
  finishExperiment(db, id, { experimentScore: 0.5 + delta, delta, adopted, evidence: 'x' });
  return id;
}
const cand = (type, variant) => ({ type, hypothesis: 'h', config: { target: 't', variant } });

test('experimentStats: aggregates CLOSED rows per type and type+variant, ignores OPEN', () => {
  const { f, db } = tmpDb();
  try {
    closed(db, { type: 'model', variant: 'a', delta: 0.04, adopted: true });
    closed(db, { type: 'model', variant: 'a', delta: 0.0, adopted: false });
    startExperiment(db, { type: 'model', hypothesis: 'h', config: { variant: 'a' }, baselineScore: 0.5 }); // OPEN
    const s = experimentStats(db);
    assert.equal(s.byType.get('model').tried, 2); // open one excluded
    assert.equal(s.byType.get('model').adopted, 1);
    assert.equal(s.byKey.get('model\u0000a').tried, 2);
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('expectedValue: no history ⇒ pure exploration (ev == EXPLORE_BONUS, basis prior)', () => {
  const { f, db } = tmpDb();
  try {
    const v = expectedValue(cand('model', 'fresh'), experimentStats(db));
    assert.equal(v.basis, 'prior');
    assert.ok(Math.abs(v.ev - EXPLORE_BONUS) < 1e-9);
    assert.equal(v.exploit, 0);
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('expectedValue: a proven-good TYPE transfers to an untried sibling, lifting it above a cold type', () => {
  const { f, db } = tmpDb();
  try {
    // model has a strong adopted record; prompt has none.
    closed(db, { type: 'model', variant: 'winner', delta: 0.06, adopted: true });
    const stats = experimentStats(db);
    const win = expectedValue(cand('model', 'winner'), stats);
    const sibling = expectedValue(cand('model', 'untried'), stats); // type-level fallback
    const cold = expectedValue(cand('prompt', 'new'), stats); // no history at all
    assert.equal(win.basis, 'variant');
    assert.ok(win.exploit > 0); // adopt-rate * normalized +6pp delta
    assert.equal(sibling.basis, 'type'); // inherits the model type's signal
    assert.ok(sibling.exploit > 0);
    assert.ok(sibling.ev > cold.ev); // a strong type lifts even its untried variants
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('expectedValue: a tried-and-discarded variant scores BELOW a fresh sibling', () => {
  const { f, db } = tmpDb();
  try {
    closed(db, { type: 'prompt', variant: 'dud', delta: 0.0, adopted: false });
    const stats = experimentStats(db);
    const dud = expectedValue(cand('prompt', 'dud'), stats);
    const fresh = expectedValue(cand('prompt', 'new'), stats);
    // dud: exploit≈0 (0 delta) + explore EXPLORE_BONUS/2 ; fresh: explore EXPLORE_BONUS/1
    assert.ok(fresh.ev > dud.ev);
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('expectedValue: delta is normalized by type threshold so cross-type EV is comparable', () => {
  const { f, db } = tmpDb();
  try {
    // +4pp pass-rate (thr 0.02 ⇒ norm 2.0) vs +0.4/10 craft (thr 0.2 ⇒ norm 2.0).
    closed(db, { type: 'model', variant: 'm', delta: 0.04, adopted: true });
    closed(db, { type: 'grading', variant: 'g', delta: 0.4, adopted: true });
    const stats = experimentStats(db);
    const m = expectedValue(cand('model', 'm'), stats);
    const g = expectedValue(cand('grading', 'g'), stats);
    assert.ok(Math.abs(m.exploit - g.exploit) < 1e-9); // same adopt-rate, same normalized delta
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('speculate: stable under no history (preserves engine base order)', () => {
  const { f, db } = tmpDb();
  try {
    const base = [cand('model', 'a'), cand('grading', 'b'), cand('prompt', 'c')];
    const out = speculate(db, base);
    assert.deepEqual(out.map((c) => c.type), ['model', 'grading', 'prompt']);
    assert.ok(out.every((c) => typeof c.ev === 'number' && c.evRationale));
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('speculate: promotes the historically-strong lever above the base-order head', () => {
  const { f, db } = tmpDb();
  try {
    closed(db, { type: 'grading', variant: 'b', delta: 0.6, adopted: true });
    closed(db, { type: 'grading', variant: 'b', delta: 0.5, adopted: true });
    // base order puts model first; grading has a strong adopted record ⇒ should lead.
    const base = [cand('model', 'a'), cand('grading', 'b'), cand('prompt', 'c')];
    const out = speculate(db, base);
    assert.equal(out[0].type, 'grading');
    assert.ok(out[0].ev > out[1].ev);
  } finally { db.close(); rmSync(f, { force: true }); }
});
