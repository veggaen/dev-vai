// Run: node --test --experimental-sqlite scripts/improve-loop/loop-processes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { buildLoopContext, defineLoopProcesses, advanceCycleCounters } from './loop-processes.mjs';
import { createRegistry, plan, runCycle } from './process-engine.mjs';
import { openDb, startRun, recordResult, upsertPrompt, getLoopState, setLoopState, recentLoopEvents, logLoopEvent } from './db.mjs';

function tmpDb() {
  const f = join(tmpdir(), `vai-lp-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  return { f, db: openDb(f) };
}
function seedClass(db, klass, passed, total) {
  const runId = startRun(db, 'r');
  for (let k = 0; k < total; k++) {
    const pid = upsertPrompt(db, { prompt: `${klass}-${runId}-${k}`, klass, expectedIntent: 'x', origin: 'seed' });
    recordResult(db, { runId, promptId: pid, klass, readAs: 'd', passed: k < passed });
  }
}
const reg = (deps) => createRegistry(defineLoopProcesses(deps));

test('buildLoopContext: cold-start has no data, identifies worst failing class when present', () => {
  const { f, db } = tmpDb();
  try {
    let ctx = buildLoopContext(db, { motion: { state: 'cold-start' }, cycle: 1 });
    assert.equal(ctx.hasData, false);
    assert.equal(ctx.failingClassCount, 0);

    seedClass(db, 'strong', 9, 10);
    seedClass(db, 'weak', 2, 10);
    ctx = buildLoopContext(db, { motion: { state: 'warming', passRate: { current: 0.6 } }, cycle: 2 });
    assert.equal(ctx.hasData, true);
    assert.equal(ctx.worstClass, 'weak');
    assert.ok(ctx.worstPassRate < 0.3);
    assert.equal(ctx.failingClassCount, 1); // 'strong' at 90% is not failing
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('COLD-START: only observe is eligible (no data to propose/innovate against)', () => {
  const { f, db } = tmpDb();
  try {
    // Suppress periodics BEFORE snapshotting (buildLoopContext reads state once, up front).
    setLoopState(db, 'cyclesSinceVisual', 0); setLoopState(db, 'cyclesSinceCapability', 0);
    const ctx = buildLoopContext(db, { motion: { state: 'cold-start' }, cycle: 1 });
    const planned = plan(reg({ anyOpen: () => false }), ctx, { budget: 100 });
    assert.deepEqual(planned.chosen, ['observe']); // nothing else has signal yet
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('FAILING CLASS present: propose becomes eligible and high-value', () => {
  const { f, db } = tmpDb();
  try {
    seedClass(db, 'weak', 1, 10); // 10% — a real failing class
    setLoopState(db, 'cyclesSinceVisual', 0); setLoopState(db, 'cyclesSinceCapability', 0);
    const ctx = buildLoopContext(db, { motion: { state: 'warming', passRate: { current: 0.1 } }, cycle: 2 });
    const planned = plan(reg({ anyOpen: () => false }), ctx, { budget: 100 });
    assert.ok(planned.chosen.includes('propose'));
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('NO failing class: propose is NOT run (no wasted model call)', () => {
  const { f, db } = tmpDb();
  try {
    seedClass(db, 'allgood', 10, 10);
    setLoopState(db, 'cyclesSinceVisual', 0); setLoopState(db, 'cyclesSinceCapability', 0);
    const ctx = buildLoopContext(db, { motion: { state: 'improving', passRate: { current: 1 } }, cycle: 2 });
    const planned = plan(reg({ anyOpen: () => false }), ctx, { budget: 100 });
    assert.ok(!planned.chosen.includes('propose'));
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('BUDGET: a tight compute budget runs only the densest moves (anti-waste, BSOD-serial)', () => {
  const { f, db } = tmpDb();
  try {
    seedClass(db, 'weak', 1, 10);
    setLoopState(db, 'cyclesSinceVisual', 99); setLoopState(db, 'cyclesSinceCapability', 99); // both periodics due
    const ctx = buildLoopContext(db, { motion: { state: 'stalling', passRate: { current: 0.1 } }, cycle: 5 });
    const planned = plan(reg({ anyOpen: () => false }), ctx, { budget: 2 });
    // capability(12) + observe(8) + visual(3) all exceed budget 2 → only cheap dense ones fit.
    assert.ok(!planned.chosen.includes('capability'));
    assert.ok(!planned.chosen.includes('observe'));
    assert.ok(planned.spent <= 2);
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('PERIODIC cadence is value-driven: visual eligible only after enough cycles', () => {
  const { f, db } = tmpDb();
  try {
    seedClass(db, 'x', 5, 10);
    setLoopState(db, 'cyclesSinceVisual', 1);
    let ctx = buildLoopContext(db, { motion: { state: 'warming' }, cycle: 3 });
    assert.ok(!plan(reg({ anyOpen: () => false }), ctx, {}).chosen.includes('visual'));
    setLoopState(db, 'cyclesSinceVisual', 5);
    ctx = buildLoopContext(db, { motion: { state: 'warming' }, cycle: 9 });
    assert.ok(plan(reg({ anyOpen: () => false }), ctx, {}).chosen.includes('visual'));
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('runCycle: delegates to injected runners, records produced; advanceCycleCounters grows idle counters', async () => {
  const { f, db } = tmpDb();
  try {
    seedClass(db, 'weak', 1, 10);
    const spawned = [];
    const deps = {
      anyOpen: () => false,
      runChild: async (script) => { spawned.push(script); return 0; },
      planExperiment: () => ({ recorded: true, trigger: 'stall', experimentId: 7 }),
      runPrototypeFor: async () => ({ adopted: false, valued: { value: 0 }, attribution: {} }),
      runArgs: () => ['--per-class', '4'],
    };
    setLoopState(db, 'cyclesSinceVisual', 0); setLoopState(db, 'cyclesSinceCapability', 0);
    setLoopState(db, 'cyclesSinceObserve', 2); // make observe high-value this cycle
    const ctx = buildLoopContext(db, { motion: { state: 'stalling', passRate: { current: 0.1 } }, cycle: 1 });
    const out = await runCycle(reg(deps), ctx, { budget: 100 });
    assert.ok(out.ran.includes('observe'));
    assert.ok(spawned.includes('scripts/improve-loop/run.mjs'));
    // With a failing class present, prototype runs and innovate YIELDS to it (no co-fire).
    assert.ok(out.ran.includes('prototype'));
    assert.ok(!out.ran.includes('innovate'));

    // visual didn't run (suppressed) → its counter advances toward eligibility.
    advanceCycleCounters(db, out.ran);
    assert.equal(getLoopState(db, 'cyclesSinceVisual'), 1);
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('prototype process: eligible with a failing class + no open experiment; runs the injected prototype', async () => {
  const { f, db } = tmpDb();
  try {
    seedClass(db, 'weak', 1, 10); // a real failing class
    setLoopState(db, 'cyclesSinceVisual', 0); setLoopState(db, 'cyclesSinceCapability', 0);
    let called = null;
    const deps = {
      anyOpen: () => false,
      runPrototypeFor: async (ctx) => { called = ctx.worstClass; return { adopted: true, valued: { value: 0.05, verdict: 'adopt' }, attribution: { process: 'prototype', cycle: ctx.cycle } }; },
    };
    const ctx = buildLoopContext(db, { motion: { state: 'warming', passRate: { current: 0.1 } }, cycle: 4 });
    const planned = plan(reg(deps), ctx, { budget: 100 });
    assert.ok(planned.chosen.includes('prototype'));
    const out = await runCycle(reg(deps), ctx, { budget: 100 });
    const proto = out.outcomes.find((o) => o.id === 'prototype');
    assert.equal(proto.result.adopted, true);
    assert.equal(called, 'weak'); // the prototype was pointed at the weakest class
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('prototype process: NOT eligible while an experiment is open (one change at a time)', () => {
  const { f, db } = tmpDb();
  try {
    seedClass(db, 'weak', 1, 10);
    setLoopState(db, 'cyclesSinceVisual', 0); setLoopState(db, 'cyclesSinceCapability', 0);
    const ctx = buildLoopContext(db, { motion: { state: 'warming', passRate: { current: 0.1 } }, cycle: 4 });
    const planned = plan(reg({ anyOpen: () => true, runPrototypeFor: async () => ({ adopted: false }) }), ctx, { budget: 100 });
    assert.ok(!planned.chosen.includes('prototype')); // guarded off while an experiment is open
  } finally { db.close(); rmSync(f, { force: true }); }
});

test('logLoopEvent + recentLoopEvents: the trace is queryable (proof-of-motion data)', () => {
  const { f, db } = tmpDb();
  try {
    logLoopEvent(db, { cycle: 1, kind: 'plan', detail: { chosen: ['observe'] } });
    logLoopEvent(db, { cycle: 1, kind: 'run:done', process: 'observe', ok: true, compute: 8, ms: 1200 });
    const ev = recentLoopEvents(db, 10);
    assert.equal(ev.length, 2);
    assert.equal(ev[0].process, 'observe'); // newest first
    assert.equal(ev[0].ok, 1);
  } finally { db.close(); rmSync(f, { force: true }); }
});
