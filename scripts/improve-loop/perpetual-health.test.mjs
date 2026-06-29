// Run: node --test scripts/improve-loop/perpetual-health.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIGNALS, makeSample, analyzeQuality, verifyPerpetualWork, formatHealth, collectSignals,
} from './perpetual-health.mjs';

const raw = (over = {}) => ({ testsPassing: 220, testsTotal: 220, tscErrors: 0, lintWarnings: 5, maxFileLines: 1800, todoCount: 30, ...over });

test('makeSample: composite is a weighted, normalized [0,1] score', () => {
  const good = makeSample(raw());
  const bad = makeSample(raw({ testsPassing: 100, tscErrors: 12, maxFileLines: 56000 }));
  assert.ok(good.composite > bad.composite);
  assert.ok(good.composite > 0 && good.composite <= 1);
});

test('makeSample: lower-is-better signals raise composite when they fall', () => {
  const before = makeSample(raw({ tscErrors: 10 }));
  const after = makeSample(raw({ tscErrors: 0 }));
  assert.ok(after.composite > before.composite); // fewer tsc errors = higher quality
});

test('makeSample: UNMEASURED signals are excluded, not scored as 0 (un-freezes the metric)', () => {
  // The frozen-composite bug: on no-tsc cycles only cheap signals are collected. Defaulting the
  // missing ones to 0 pinned the composite to a constant forever. Now only measured signals count,
  // so the composite MOVES with the signals that did run.
  const cheap1 = makeSample({ maxFileLines: 35152, todoCount: 38 });
  const cheap2 = makeSample({ maxFileLines: 30000, todoCount: 38 }); // god-class shrank
  assert.ok(cheap2.composite > cheap1.composite, 'composite must rise when maxFileLines falls');
  assert.deepEqual(Object.keys(cheap1.signals).sort(), ['maxFileLines', 'todoCount'], 'only measured signals scored');
  assert.ok(!('testsPassing' in cheap1.signals), 'an unmeasured signal is absent, not 0');
  assert.ok(!('tscErrors' in cheap1.signals), 'a skipped typecheck is absent, not 0 errors');
});

test('collectSignals: omits tscErrors when the heavy typecheck probe is skipped', async () => {
  const calls = [];
  const sample = await collectSignals({
    withTsc: false,
    exec: async (file, args) => {
      calls.push(`${file} ${args.join(' ')}`);
      return { ok: true, out: '' };
    },
  });

  assert.equal('tscErrors' in sample, false);
  assert.ok(!calls.some((call) => call.includes('tsc')), 'must not run tsc when withTsc=false');
});

test('collectSignals: records tscErrors only when the typecheck probe runs', async () => {
  const sample = await collectSignals({
    withTsc: true,
    exec: async (file, args) => {
      if (file === 'npx' && args[0] === 'tsc') {
        return { ok: false, out: 'src/a.ts(1,1): error TS2322: nope\nsrc/b.ts(2,1): error TS7006: nope' };
      }
      return { ok: true, out: '' };
    },
  });

  assert.equal(sample.tscErrors, 2);
});

test('analyzeQuality: cold-start under 2 samples', () => {
  assert.equal(analyzeQuality([makeSample(raw())]).state, 'cold-start');
});

test('analyzeQuality: rising composite ⇒ improving; falling ⇒ regressing', () => {
  const up = [raw({ tscErrors: 6 }), raw({ tscErrors: 3 }), raw({ tscErrors: 0 })].map((r) => makeSample(r));
  assert.equal(analyzeQuality(up).state, 'improving');
  const down = [raw({ tscErrors: 0, maxFileLines: 1800 }), raw({ tscErrors: 4, maxFileLines: 3000 }), raw({ tscErrors: 9, maxFileLines: 9000 })].map((r) => makeSample(r));
  assert.equal(analyzeQuality(down).state, 'regressing');
});

test('analyzeQuality: per-signal verdict is DIRECTION-AWARE', () => {
  const down = [raw({ tscErrors: 8 }), raw({ tscErrors: 4 }), raw({ tscErrors: 0 })].map((r) => makeSample(r));
  const q = analyzeQuality(down);
  // tscErrors fell 8→0: raw slope negative, but for a lower-is-better signal that's IMPROVING.
  assert.equal(q.perSignal.tscErrors.verdict, 'improving');
});

test('verifyPerpetualWork: WORKING when quality rises AND the loop landed changes', () => {
  const up = [raw({ tscErrors: 6 }), raw({ tscErrors: 3 }), raw({ tscErrors: 0 })].map((r) => makeSample(r));
  const v = verifyPerpetualWork(analyzeQuality(up), { commitsByLoop: 2, proposalsAdopted: 1 });
  assert.equal(v.working, true);
  assert.match(v.reason, /attributable/);
});

test('verifyPerpetualWork: NAMES the crediting actions (process@cycle#experiment) for honest attribution', () => {
  const up = [raw({ tscErrors: 6 }), raw({ tscErrors: 0 })].map((r) => makeSample(r));
  const v = verifyPerpetualWork(analyzeQuality(up), { actions: [{ process: 'propose', cycle: 7, experimentId: 3 }] });
  assert.equal(v.working, true);
  assert.equal(v.landed, 1);            // actions count as landed when no explicit counts given
  assert.match(v.reason, /propose@c7#3/); // the specific action is named, not just counted
});

test('verifyPerpetualWork: NOT WORKING = running but quality flat and nothing landed (meta-slop)', () => {
  const flat = [raw(), raw(), raw()].map((r) => makeSample(r)); // identical → flat
  const v = verifyPerpetualWork(analyzeQuality(flat), { commitsByLoop: 0, proposalsAdopted: 0 });
  assert.equal(v.working, false);
  assert.match(v.reason, /meta-slop|not doing its job/);
});

test('verifyPerpetualWork: NOT WORKING when quality is regressing', () => {
  const down = [raw({ tscErrors: 0 }), raw({ tscErrors: 5 }), raw({ tscErrors: 11 })].map((r) => makeSample(r));
  const v = verifyPerpetualWork(analyzeQuality(down), { commitsByLoop: 3 });
  assert.equal(v.working, false);
  assert.match(v.reason, /REGRESSING/);
});

test('verifyPerpetualWork: INCONCLUSIVE when quality rises but loop landed nothing (not attributable)', () => {
  const up = [raw({ tscErrors: 6 }), raw({ tscErrors: 3 }), raw({ tscErrors: 0 })].map((r) => makeSample(r));
  const v = verifyPerpetualWork(analyzeQuality(up), { commitsByLoop: 0, proposalsAdopted: 0 });
  assert.equal(v.working, null);
  assert.match(v.reason, /not attributable/);
});

test('formatHealth: one-line, shows verdict + arrow', () => {
  const up = [raw({ tscErrors: 6 }), raw({ tscErrors: 0 })].map((r) => makeSample(r));
  const q = analyzeQuality(up);
  const line = formatHealth(q, verifyPerpetualWork(q, { commitsByLoop: 1 }));
  assert.match(line, /Perpetual health/);
});

test('SIGNALS is extensible: every signal declares dir + normalize', () => {
  for (const [k, def] of Object.entries(SIGNALS)) {
    assert.ok(['up', 'down'].includes(def.dir), `${k} needs a direction`);
    assert.equal(typeof def.normalize, 'function');
  }
});
