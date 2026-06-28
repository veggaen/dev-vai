import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreLanes, chooseMeaningfulWork, formatMeaning } from './meaning-selector.mjs';

test('picks QUALITY over routing when quality is poor and actionable', () => {
  const plan = chooseMeaningfulWork({
    routingPassRate: 0.8, routingWeakestClass: { class: 'x', passRate: 0.75 }, // routing nearly fine
    answerQuality: 5.0, answerSampleCount: 100, canActQuality: true,           // quality bad + fixable
    capabilityGaps: 0,
  });
  assert.equal(plan.lane, 'quality', formatMeaning(plan));
});

test('picks ROUTING when a class is genuinely broken and quality is fine', () => {
  const plan = chooseMeaningfulWork({
    routingPassRate: 0.35, routingWeakestClass: { class: 'comparison', passRate: 0.35 },
    answerQuality: 8.5, answerSampleCount: 100,
    capabilityGaps: 2,
  });
  assert.equal(plan.lane, 'routing', formatMeaning(plan));
});

test('CAPABILITY lane surfaces when features wait and other lanes are healthy', () => {
  const plan = chooseMeaningfulWork({
    routingPassRate: 0.9, routingWeakestClass: null,
    answerQuality: 8.6, answerSampleCount: 100,
    capabilityGaps: 15,
  });
  assert.equal(plan.lane, 'capability', formatMeaning(plan));
});

test('quality with too few samples is not chosen (no fiction from thin data)', () => {
  const plan = chooseMeaningfulWork({ answerQuality: 3.0, answerSampleCount: 4, routingPassRate: 0.9 });
  const qualityLane = plan.ranking.find((l) => l.lane === 'quality');
  assert.equal(qualityLane, undefined, 'quality lane must not appear with <10 samples');
});

test('a quality gap with NO buildable guard is down-weighted (0.4x), not ignored', () => {
  const withAction = scoreLanes({ answerQuality: 5, answerSampleCount: 50, canActQuality: true }).find((l) => l.lane === 'quality');
  const without = scoreLanes({ answerQuality: 5, answerSampleCount: 50, canActQuality: false }).find((l) => l.lane === 'quality');
  assert.ok(withAction.leverage > without.leverage, 'actionable quality must outrank non-actionable');
  assert.ok(without.leverage > 0, 'a non-actionable quality gap is still surfaced (escalate path)');
});

test('nothing below bar → no lane chosen (loop is in good shape)', () => {
  const plan = chooseMeaningfulWork({
    routingPassRate: 0.95, routingWeakestClass: null,
    answerQuality: 9.0, answerSampleCount: 100,
    capabilityGaps: 0, stuckQualityGaps: 0,
  });
  assert.equal(plan.lane, null);
  assert.match(plan.headline, /no lane below its bar/);
});

test('routing no longer monopolises: it ranks BELOW quality and capability', () => {
  // The exact live situation: routing 57%, quality 5/10, 15 features waiting. Routing must NOT win.
  const plan = chooseMeaningfulWork({
    routingPassRate: 0.57, routingWeakestClass: { class: 'context-carry', passRate: 0.35 },
    answerQuality: 5.0, answerSampleCount: 195, canActQuality: true,
    capabilityGaps: 15,
  });
  assert.notEqual(plan.lane, 'routing', 'routing must no longer monopolise the loop');
  const routingRank = plan.ranking.findIndex((l) => l.lane === 'routing');
  const qualityRank = plan.ranking.findIndex((l) => l.lane === 'quality');
  assert.ok(qualityRank < routingRank, 'quality outranks routing');
});

test('when capability backlog is small, a real quality gap wins', () => {
  const plan = chooseMeaningfulWork({
    routingPassRate: 0.8, routingWeakestClass: { class: 'x', passRate: 0.78 },
    answerQuality: 5.0, answerSampleCount: 100, canActQuality: true,
    capabilityGaps: 1, // small backlog → quality should win
  });
  assert.equal(plan.lane, 'quality', formatMeaning(plan));
});

test('formatMeaning marks the chosen lane', () => {
  const plan = chooseMeaningfulWork({ routingPassRate: 0.3, routingWeakestClass: { class: 'a', passRate: 0.3 }, answerQuality: 9, answerSampleCount: 50 });
  assert.match(formatMeaning(plan), /→ routing/);
});

test('CODEBASE lane: whole-app craft debt competes when health is below bar', () => {
  const lanes = scoreLanes({
    routingPassRate: 0.95,                       // routing fine
    codebaseHealth: 0.55, codebaseGaps: 1, codebaseTopGap: 'a 36k-line file to decompose',
  });
  const cb = lanes.find((l) => l.lane === 'codebase');
  assert.ok(cb, 'codebase lane present when health below bar');
  assert.ok(cb.gap > 0 && cb.actionable, 'has a gap and a buildable target');
  assert.match(cb.reason, /decompose/, 'names the concrete top gap');
  // with routing healthy, the whole-app craft lane should win
  assert.equal(lanes[0].lane, 'codebase');
});

test('CODEBASE lane: silent when health is at/above bar (no busywork)', () => {
  const lanes = scoreLanes({ routingPassRate: 0.7, codebaseHealth: 0.92, codebaseGaps: 0 });
  assert.equal(lanes.find((l) => l.lane === 'codebase'), undefined, 'no codebase lane when healthy');
});
