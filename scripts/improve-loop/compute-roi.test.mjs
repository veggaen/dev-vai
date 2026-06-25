// Run: node --test scripts/improve-loop/compute-roi.test.mjs
// Pure module (no node:sqlite) — the --experimental-sqlite flag is NOT required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  roundCompute, roundRoi, analyzeRoiTrend, formatRoi,
  WASTE_COMPUTE_FLOOR,
} from './compute-roi.mjs';

test('roundCompute: model calls are primary; wall-time is a fallback', () => {
  assert.equal(roundCompute({ modelCalls: 8, wallMs: 600000 }).computeUnits, 8);
  assert.equal(roundCompute({ modelCalls: 0, wallMs: 180000 }).computeUnits, 3); // 3 minutes
  assert.equal(roundCompute({}).computeUnits, 1); // never zero (no divide-by-zero downstream)
});

test('roundRoi: realized drives roi, qualified drives potentialRoi', () => {
  const r = roundRoi({ modelCalls: 10, proposals: 7, qualified: 5, adopted: 2 });
  assert.equal(r.roi, 0.2);          // 2 shipped / 10 compute
  assert.equal(r.potentialRoi, 0.5); // 5 qualified / 10 compute
});

test('analyzeRoiTrend: cold-start is insufficient-data, never a false verdict', () => {
  const r = analyzeRoiTrend([{ modelCalls: 8, qualified: 3 }, { modelCalls: 8, qualified: 3 }]);
  assert.equal(r.state, 'insufficient-data');
  assert.equal(r.diminishingReturns, false);
});

test('analyzeRoiTrend: compute burned, qualified piling up, ZERO shipped = wasteful (adoption bottleneck)', () => {
  const round = { modelCalls: 8, proposals: 7, qualified: 4, adopted: 0 };
  const r = analyzeRoiTrend([round, round, round]); // 24 compute > floor, 0 shipped
  assert.ok(r.totalCompute >= WASTE_COMPUTE_FLOOR);
  assert.equal(r.state, 'wasteful');
  assert.equal(r.diminishingReturns, true);
  assert.match(r.recommendation, /ADOPTION|APPLYING the backlog/);
});

test('analyzeRoiTrend: a little compute, nothing shipped yet = unproven (not yet waste)', () => {
  const r = analyzeRoiTrend([
    { modelCalls: 2, qualified: 1, adopted: 0 },
    { modelCalls: 2, qualified: 1, adopted: 0 },
    { modelCalls: 2, qualified: 1, adopted: 0 },
  ]);
  assert.equal(r.state, 'unproven'); // 6 compute < floor
  assert.equal(r.diminishingReturns, false);
});

test('analyzeRoiTrend: rising benefit-per-compute is productive', () => {
  const r = analyzeRoiTrend([
    { modelCalls: 10, adopted: 0, qualified: 1 },
    { modelCalls: 10, adopted: 1, qualified: 2 },
    { modelCalls: 10, adopted: 3, qualified: 3 },
  ]);
  assert.equal(r.state, 'productive');
  assert.equal(r.diminishingReturns, false);
  assert.ok(r.roiSlope > 0);
});

test('analyzeRoiTrend: flat HIGH roi = productive-plateau, flat LOW roi = diminishing', () => {
  const high = analyzeRoiTrend([
    { modelCalls: 4, adopted: 2 }, { modelCalls: 4, adopted: 2 }, { modelCalls: 4, adopted: 2 },
  ]);
  assert.equal(high.state, 'productive-plateau'); // roi 0.5, flat, above floor
  assert.equal(high.diminishingReturns, false);

  const low = analyzeRoiTrend([
    { modelCalls: 100, adopted: 1 }, { modelCalls: 100, adopted: 1 }, { modelCalls: 100, adopted: 1 },
  ]);
  assert.equal(low.state, 'diminishing'); // roi 0.01, flat, below floor
  assert.equal(low.diminishingReturns, true);
});

test('formatRoi: renders headline + recommendation, flags diminishing with a warning', () => {
  const out = formatRoi(analyzeRoiTrend([
    { modelCalls: 8, qualified: 4, adopted: 0 },
    { modelCalls: 8, qualified: 4, adopted: 0 },
    { modelCalls: 8, qualified: 4, adopted: 0 },
  ]));
  assert.match(out, /Compute ROI:/);
  assert.match(out, /⚠/);
  assert.equal(formatRoi(null), 'Compute ROI: n/a');
});
