// Run: node --test scripts/improve-loop/motion.test.mjs
// Built-in node test runner — improve-loop tooling lives outside the vitest
// workspace on purpose, so it self-tests via node:test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  seriesSlope,
  classifyTrend,
  detectStagnation,
  analyzeMotion,
  formatMotion,
} from './motion.mjs';

test('seriesSlope: rising +1/step, falling -1/step, flat 0, <2 pts 0', () => {
  assert.equal(seriesSlope([0, 1, 2, 3]), 1);
  assert.equal(seriesSlope([3, 2, 1, 0]), -1);
  assert.equal(seriesSlope([5, 5, 5]), 0);
  assert.equal(seriesSlope([7]), 0);
  assert.equal(seriesSlope([]), 0);
});

test('classifyTrend respects the flat-band epsilon', () => {
  assert.equal(classifyTrend(0.05, 0.01), 'improving');
  assert.equal(classifyTrend(-0.05, 0.01), 'regressing');
  assert.equal(classifyTrend(0.005, 0.01), 'flat');
});

test('detectStagnation flags a flat trailing window', () => {
  const s = detectStagnation([0.9, 0.9, 0.9], { window: 3, eps: 0.01 });
  assert.equal(s.stalled, true);
  assert.ok(s.runsFlat >= 2);
});

test('detectStagnation: still-moving tail is not stalled', () => {
  assert.equal(detectStagnation([0.7, 0.8, 0.9], { window: 3, eps: 0.01 }).stalled, false);
});

test('detectStagnation needs at least `window` samples', () => {
  assert.equal(detectStagnation([0.9, 0.9], { window: 3 }).stalled, false);
});

test('analyzeMotion: cold-start when there is not enough data', () => {
  const m = analyzeMotion({ passRate: [0.9], excellence: [] });
  assert.equal(m.state, 'cold-start');
  assert.match(m.recommendation, /enough runs/i);
});

test('analyzeMotion: rising excellence reads as improving even if pass-rate is maxed', () => {
  const m = analyzeMotion({ passRate: [1, 1, 1], excellence: [6, 7, 8] });
  assert.equal(m.state, 'improving');
  assert.equal(m.excellence.verdict, 'improving');
  assert.equal(m.stagnation.stalled, false);
  assert.equal(m.recommendation, null);
});

test('analyzeMotion: both gradients flat = stalling, with innovate recommendation', () => {
  const m = analyzeMotion({ passRate: [0.9, 0.9, 0.9], excellence: [7, 7, 7] });
  assert.equal(m.state, 'stalling');
  assert.equal(m.stagnation.stalled, true);
  assert.match(m.recommendation, /innovate|spinning/i);
});

test('analyzeMotion: a dropping gradient reads as regressing and says bisect', () => {
  const m = analyzeMotion({ passRate: [0.9, 0.8, 0.7], excellence: [7, 7, 7] });
  assert.equal(m.state, 'regressing');
  assert.equal(m.passRate.verdict, 'regressing');
  assert.match(m.recommendation, /bisect|regress/i);
});

test('analyzeMotion: current/first/slope are reported per gradient', () => {
  const m = analyzeMotion({ passRate: [0.5, 0.75, 1.0], excellence: [4, 6, 8] });
  assert.equal(m.passRate.first, 0.5);
  assert.equal(m.passRate.current, 1.0);
  assert.ok(m.passRate.slope > 0);
  assert.equal(m.excellence.current, 8);
});

test('formatMotion renders a single readable line with both gradients', () => {
  const m = analyzeMotion({ passRate: [0.5, 0.75, 1.0], excellence: [4, 6, 8] });
  assert.match(m.headline, /Perpetual motion: improving/);
  assert.match(m.headline, /pass 100%/);
  assert.match(m.headline, /excellence 8\/10/);
});

test('headline carries a STALLED marker when spinning', () => {
  const m = analyzeMotion({ passRate: [0.9, 0.9, 0.9], excellence: [7, 7, 7] });
  assert.match(formatMotion(m), /STALLED/);
});
