import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tierForImpact,
  summarizeBudget,
  shouldNotify,
  parseBudgetSpec,
  DEFAULT_BUDGET_CONFIG,
} from './review-budget.mjs';

const items = (impacts) => impacts.map((impact) => ({ impact }));

// ── tier mapping ────────────────────────────────────────────────────────────────
test('tierForImpact: maps by default cutoffs (medium=7, high=8.5)', () => {
  assert.equal(tierForImpact(9.6), 'high');
  assert.equal(tierForImpact(8.5), 'high');
  assert.equal(tierForImpact(8.0), 'medium');
  assert.equal(tierForImpact(7.0), 'medium');
  assert.equal(tierForImpact(6.9), 'minor');
  assert.equal(tierForImpact(2), 'minor');
});

test('tierForImpact: non-numeric → minor', () => {
  assert.equal(tierForImpact(undefined), 'minor');
  assert.equal(tierForImpact('x'), 'minor');
});

// ── summarize ────────────────────────────────────────────────────────────────────
test('summarizeBudget: counts per tier + weighted total', () => {
  // 2 high (10 each), 1 medium (3), 3 minor (1 each) = 20 + 3 + 3 = 26
  const s = summarizeBudget(items([9, 8.6, 7.5, 6, 5, 1]));
  assert.deepEqual(s.counts, { high: 2, medium: 1, minor: 3 });
  assert.equal(s.totalValue, 26);
  assert.equal(s.total, 6);
});

test('summarizeBudget: custom weights change the total', () => {
  const s = summarizeBudget(items([9, 6]), { weights: { minor: 5, medium: 3, high: 20 } });
  assert.equal(s.totalValue, 25); // 1 high×20 + 1 minor×5
});

// ── leverage boost (enabling features worth more) ──────────────────────────────────
test('summarizeBudget: an item with no leverage field is unaffected (backward-compatible)', () => {
  const s = summarizeBudget(items([9, 3])); // no leverage → value = tier weights = 10 + 1 = 11
  assert.equal(s.totalValue, 11);
});

test('summarizeBudget: leverage boosts an item value above its tier weight', () => {
  // high tier weight 10; leverage 3 at default boost 0.25 → 10 × (1 + 0.75) = 17.5
  const s = summarizeBudget([{ impact: 9, leverage: 3 }]);
  assert.equal(s.totalValue, 17.5);
});

test('summarizeBudget: leverageBoost=0 disables the boost', () => {
  const s = summarizeBudget([{ impact: 9, leverage: 5 }], { leverageBoost: 0 });
  assert.equal(s.totalValue, 10, 'value falls back to the tier weight');
});

test('shouldNotify: a high-leverage feature trips the threshold sooner than an isolated one', () => {
  // Two high-impact features. Isolated: value 20 (< 100). With leverage 4 each: 10×(1+1)=20 each = 40.
  // Give them big leverage so the boosted batch trips a threshold the isolated one wouldn't.
  const isolated = shouldNotify(items([9, 9]), { thresholds: { totalValue: 30, counts: {} } });
  assert.equal(isolated.notify, false, '2 high isolated = value 20 < 30');
  const leveraged = shouldNotify(
    [{ impact: 9, leverage: 4 }, { impact: 9, leverage: 4 }],
    { thresholds: { totalValue: 30, counts: {} } },
  );
  assert.equal(leveraged.notify, true, 'the same 2 high, but enabling, cross the threshold');
});

// ── shouldNotify: total-value gate ────────────────────────────────────────────────
test('shouldNotify: total-value gate trips at the threshold', () => {
  // default totalValue threshold = 100. 10 high × 10 = 100 → trips.
  const r = shouldNotify(items(Array(10).fill(9)));
  assert.equal(r.notify, true);
  assert.match(r.reason, /weighted value 100 ≥ 100/);
});

test('shouldNotify: just under the total-value threshold does NOT trip', () => {
  // 9 high × 10 = 90 < 100
  assert.equal(shouldNotify(items(Array(9).fill(9))).notify, false);
});

test('shouldNotify: a hundred minor fixes trips the same value threshold as ten high', () => {
  // 100 minor × 1 = 100 → trips 100-value. This is the "devalue per stage" equivalence.
  const r = shouldNotify(items(Array(100).fill(3)));
  assert.equal(r.notify, true);
  assert.match(r.reason, /100m/);
});

// ── shouldNotify: per-tier count gate ──────────────────────────────────────────────
test('shouldNotify: per-tier count gate ("10 high") trips independent of value', () => {
  const cfg = { thresholds: { totalValue: null, counts: { high: 10, medium: null, minor: null } } };
  assert.equal(shouldNotify(items(Array(9).fill(9)), cfg).notify, false, '9 high < 10');
  const r = shouldNotify(items(Array(10).fill(9)), cfg);
  assert.equal(r.notify, true);
  assert.match(r.reason, /10 high ≥ 10/);
});

test('shouldNotify: "100 minor" count gate', () => {
  const cfg = { thresholds: { totalValue: null, counts: { minor: 100, medium: null, high: null } } };
  assert.equal(shouldNotify(items(Array(99).fill(2)), cfg).notify, false);
  assert.equal(shouldNotify(items(Array(100).fill(2)), cfg).notify, true);
});

test('shouldNotify: multiple gates OR together — whichever trips first', () => {
  const cfg = { thresholds: { totalValue: 1000, counts: { high: 5, medium: null, minor: null } } };
  // value is only 50 (5 high×10) — under 1000 — but the high-count gate (5) trips.
  const r = shouldNotify(items(Array(5).fill(9)), cfg);
  assert.equal(r.notify, true);
  assert.equal(r.tripped.length, 1);
  assert.equal(r.tripped[0].kind, 'count');
});

test('shouldNotify: empty batch never notifies', () => {
  assert.equal(shouldNotify([]).notify, false);
});

// ── parseBudgetSpec ────────────────────────────────────────────────────────────────
test('parseBudgetSpec: "high=10;value=200" sets both gates', () => {
  const cfg = parseBudgetSpec('high=10;value=200');
  assert.equal(cfg.thresholds.counts.high, 10);
  assert.equal(cfg.thresholds.totalValue, 200);
  assert.equal(cfg.thresholds.counts.minor, null);
});

test('parseBudgetSpec: "minor=100" sets ONLY that gate (value cleared)', () => {
  const cfg = parseBudgetSpec('minor=100');
  assert.equal(cfg.thresholds.counts.minor, 100);
  assert.equal(cfg.thresholds.totalValue, null, 'a bare tier spec disables the default value gate');
});

test('parseBudgetSpec: custom weights + cutoffs', () => {
  const cfg = parseBudgetSpec('value=500;weights=2,5,25;cutoffs=6,9');
  assert.deepEqual(cfg.weights, { minor: 2, medium: 5, high: 25 });
  assert.deepEqual(cfg.cutoffs, { medium: 6, high: 9 });
  assert.equal(cfg.thresholds.totalValue, 500);
});

test('parseBudgetSpec: empty spec → default thresholds preserved', () => {
  const cfg = parseBudgetSpec('');
  assert.equal(cfg.thresholds.totalValue, DEFAULT_BUDGET_CONFIG.thresholds.totalValue);
});

test('parseBudgetSpec: unknown keys ignored, valid ones still applied', () => {
  const cfg = parseBudgetSpec('banana=3;high=7');
  assert.equal(cfg.thresholds.counts.high, 7);
});
