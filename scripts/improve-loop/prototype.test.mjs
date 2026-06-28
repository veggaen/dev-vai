// Run: node --test scripts/improve-loop/prototype.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valuePrototype, shouldAdopt, runPrototype, GATE_ORDER } from './prototype.mjs';

test('valuePrototype: failed gate ⇒ value 0, never negative-credit a broken build', () => {
  const v = valuePrototype({ gatesPassed: false, qualityBefore: 0.5, qualityAfter: 0.9, compute: 1 });
  assert.equal(v.value, 0);
  assert.match(v.verdict, /failed a gate/);
});

test('valuePrototype: quality-delta per compute is the shared scale', () => {
  const cheap = valuePrototype({ gatesPassed: true, qualityBefore: 0.50, qualityAfter: 0.60, compute: 1 });
  const pricey = valuePrototype({ gatesPassed: true, qualityBefore: 0.50, qualityAfter: 0.60, compute: 10 });
  assert.ok(Math.abs(cheap.value - 0.10) < 1e-9);
  assert.ok(Math.abs(pricey.value - 0.01) < 1e-9); // same gain, 10x compute ⇒ 1/10 the value
  assert.ok(cheap.value > pricey.value);
});

test('valuePrototype: zero/negative delta ⇒ discard (no value for passing-but-useless)', () => {
  assert.match(valuePrototype({ gatesPassed: true, qualityBefore: 0.5, qualityAfter: 0.5, compute: 1 }).verdict, /moved no metric/);
  const reg = valuePrototype({ gatesPassed: true, qualityBefore: 0.6, qualityAfter: 0.4, compute: 1 });
  assert.equal(reg.value, 0); // max(0, negative) = 0
  assert.match(reg.verdict, /regressed/);
});

test('valuePrototype: config A/B fallback uses metricDelta when no quality signal', () => {
  const v = valuePrototype({ gatesPassed: true, compute: 2, metricDelta: 0.08 }); // pass-rate +8pp, no quality
  assert.ok(Math.abs(v.value - 0.04) < 1e-9);
  assert.match(v.verdict, /adopt/);
});

test('shouldAdopt: strict — needs gates green AND positive quality delta', () => {
  assert.equal(shouldAdopt(valuePrototype({ gatesPassed: true, qualityBefore: 0.5, qualityAfter: 0.6, compute: 1 })), true);
  assert.equal(shouldAdopt(valuePrototype({ gatesPassed: true, qualityBefore: 0.5, qualityAfter: 0.5, compute: 1 })), false);
  assert.equal(shouldAdopt(valuePrototype({ gatesPassed: false, qualityBefore: 0.5, qualityAfter: 0.9, compute: 1 })), false);
});

test('runPrototype: full happy path — builds, passes ladder, values, adopts, attributes', async () => {
  const seen = [];
  const out = await runPrototype(
    { type: 'prompt', hypothesis: 'tighten the propose prompt', config: {} },
    {
      cycle: 7, experimentId: 3,
      build: async () => ({ patch: 'real' }),
      gates: {
        shape: async () => ({ pass: true }),
        verify: async () => ({ pass: true }),
        typecheck: async () => ({ pass: true }),
        test: async () => ({ pass: true }),
      },
      sampleQuality: async () => (seen.push('q'), seen.length === 1 ? 0.50 : 0.58),
      computeOf: () => 2,
    },
  );
  assert.equal(out.adopted, true);
  assert.ok(out.valued.value > 0);
  assert.equal(out.attribution.cycle, 7);
  assert.equal(out.attribution.experimentId, 3);
  assert.equal(out.gateResults.length, 4); // all four ran
});

test('runPrototype: cheap→expensive SHORT-CIRCUITS on first gate failure (no wasted tsc)', async () => {
  const ran = [];
  const out = await runPrototype(
    { type: 'model', hypothesis: 'x', config: {} },
    {
      build: async () => ({ patch: 'hallucinated' }),
      gates: {
        shape: async () => (ran.push('shape'), { pass: true }),
        verify: async () => (ran.push('verify'), { pass: false, detail: 'find not in file' }),
        typecheck: async () => (ran.push('typecheck'), { pass: true }), // must NOT run
        test: async () => (ran.push('test'), { pass: true }),           // must NOT run
      },
      sampleQuality: async () => 0.5,
      computeOf: () => 1,
    },
  );
  assert.deepEqual(ran, ['shape', 'verify']); // stopped at the failure; never paid tsc/test
  assert.equal(out.adopted, false);
  assert.equal(out.valued.value, 0);
});

test('runPrototype: review gate runs AFTER verify and short-circuits typecheck/test on review fail', async () => {
  const ran = [];
  const out = await runPrototype({ type: 'code', hypothesis: 'x', config: {} }, {
    build: async () => ({ patch: 'mechanically-valid-but-bad' }),
    gates: {
      shape: async () => (ran.push('shape'), { pass: true }),
      verify: async () => (ran.push('verify'), { pass: true }),       // mechanical: fine
      review: async () => (ran.push('review'), { pass: false, detail: 'reviewer: loosens a guard' }),
      typecheck: async () => (ran.push('typecheck'), { pass: true }), // must NOT run
      test: async () => (ran.push('test'), { pass: true }),           // must NOT run
    },
    sampleQuality: async () => 0.5,
    computeOf: () => 2,
  });
  assert.deepEqual(ran, ['shape', 'verify', 'review']); // stopped at the model review; never compiled
  assert.equal(out.adopted, false);
  assert.match(out.gateResults.at(-1).detail, /loosens a guard/);
});

test('runPrototype: no artifact built ⇒ a build gate failure, not a crash', async () => {
  const out = await runPrototype({ type: 'model', hypothesis: 'x', config: {} }, {
    build: async () => { throw new Error('model down'); },
    gates: { shape: async () => ({ pass: true }) },
    sampleQuality: async () => 0.5,
    computeOf: () => 1,
  });
  assert.equal(out.adopted, false);
  assert.equal(out.gateResults[0].name, 'build');
  assert.equal(out.gateResults[0].pass, false);
});

test('GATE_ORDER is cost-ascending (shape < verify < review < typecheck < test)', () => {
  // review (1 model call) sits between the cheap mechanical verify and the expensive tsc/test —
  // don't pay a model on a hallucinated find; don't compile a fix the reviewer rejects.
  assert.deepEqual(GATE_ORDER, ['shape', 'verify', 'review', 'typecheck', 'test']);
});
