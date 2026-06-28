// Run: node --test scripts/improve-loop/grader.test.mjs
// Pure module (no node:sqlite) — the --experimental-sqlite flag is NOT required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rankWeakestClasses,
  detectStuckLessons,
  gradeLedger,
  formatGrade,
  WEAK_CLASS_THRESHOLD,
  STUCK_LESSON_MIN_TIMES,
} from './grader.mjs';

test('rankWeakestClasses: weakest-first, target flag, unscored never a target', () => {
  const ranked = rankWeakestClasses([
    { class: 'strong', total: 10, passed: 10 },   // 100%
    { class: 'weak', total: 4, passed: 1 },        // 25%
    { class: 'mid', total: 10, passed: 8 },        // 80%
    { class: 'unscored', total: 0, passed: 0 },    // 0% but never measured
  ]);
  assert.deepEqual(ranked.map((c) => c.class), ['unscored', 'weak', 'mid', 'strong']);
  assert.equal(ranked.find((c) => c.class === 'weak').target, true);   // 25% < 70%
  assert.equal(ranked.find((c) => c.class === 'mid').target, false);   // 80% >= 70%
  assert.equal(ranked.find((c) => c.class === 'unscored').target, false); // total 0 ⇒ never a target
  assert.equal(ranked.find((c) => c.class === 'strong').target, false);
});

test('rankWeakestClasses: stable for equal rates, honors custom threshold', () => {
  const ranked = rankWeakestClasses(
    [{ class: 'a', total: 10, passed: 9 }, { class: 'b', total: 10, passed: 9 }],
    { threshold: 0.95 },
  );
  assert.deepEqual(ranked.map((c) => c.class), ['a', 'b']); // equal 90% keeps input order
  assert.equal(ranked[0].target, true); // 90% < 95% custom threshold
});

test('rankWeakestClasses: empty/garbage input does not throw', () => {
  assert.deepEqual(rankWeakestClasses(), []);
  assert.deepEqual(rankWeakestClasses(null), []);
});

test('detectStuckLessons: only flags re-learned-but-flat, most-repeated first', () => {
  const stuck = detectStuckLessons([
    { lesson: 'low-contrast text', times_seen: 503, last_overall: 7.3 },
    { lesson: 'rare', times_seen: 3, last_overall: 6 },
    { lesson: 'oversized hero', times_seen: 80, last_overall: null },
  ]);
  assert.deepEqual(stuck.map((s) => s.lesson), ['low-contrast text', 'oversized hero']);
  assert.equal(stuck[0].timesSeen, 503);
  assert.equal(stuck[1].lastOverall, null); // null preserved, not coerced to 0
  assert.match(stuck[0].why, /never|acted on|×503/);
});

test('detectStuckLessons: threshold boundary + defaults', () => {
  assert.equal(detectStuckLessons([{ lesson: 'x', times_seen: STUCK_LESSON_MIN_TIMES }]).length, 1);
  assert.equal(detectStuckLessons([{ lesson: 'x', times_seen: STUCK_LESSON_MIN_TIMES - 1 }]).length, 0);
  assert.deepEqual(detectStuckLessons(), []);
});

test('gradeLedger: rejects weakest class, stuck lesson, low hit-rate; keeps healthy council', () => {
  const report = gradeLedger({
    classStats: [
      { class: 'routing/fresh-data', total: 3, passed: 0 }, // 0% → weakest target
      { class: 'answer/framing', total: 3, passed: 1 },     // 33% target
      { class: 'routing/comparison', total: 4, passed: 4 }, // 100%
    ],
    tasteLessons: [{ lesson: 'low-contrast text', times_seen: 503, last_overall: 7.3 }],
    answerLessons: [],
    proposalQuality: { hitRate: 0.33, total: 6 }, // > 0.3 ⇒ NOT a reject
    councilHealth: { responseRate: 0.83 },
  });
  assert.deepEqual(report.targets.map((c) => c.class), ['routing/fresh-data', 'answer/framing']);
  const byAgent = Object.fromEntries(report.verdicts.map((v) => [v.agent, v]));
  assert.equal(byAgent['propose-fix personas'].verdict, 'reject');
  assert.match(byAgent['propose-fix personas'].why, /routing\/fresh-data/);
  assert.equal(byAgent['visual-rubric + stylist'].verdict, 'reject');
  assert.equal(byAgent['council members'].verdict, 'keep');
  assert.equal(byAgent['propose-fix + consensus-fix'], undefined); // 33% is above the floor
  assert.match(report.headline, /weak class/);
});

test('gradeLedger: low hit-rate AND unhealthy council both flip to reject', () => {
  const report = gradeLedger({
    classStats: [],
    proposalQuality: { hitRate: 0.1, total: 8 }, // below floor with enough sample
    councilHealth: { responseRate: 0.4 },        // below gate
  });
  const byAgent = Object.fromEntries(report.verdicts.map((v) => [v.agent, v]));
  assert.equal(byAgent['propose-fix + consensus-fix'].verdict, 'reject');
  assert.equal(byAgent['council members'].verdict, 'reject');
  assert.equal(report.targets.length, 0);
});

test('gradeLedger: empty corpus is safe and council defaults to keep', () => {
  const report = gradeLedger({});
  assert.deepEqual(report.targets, []);
  assert.deepEqual(report.stuckLessons, []);
  assert.equal(report.verdicts.find((v) => v.agent === 'council members').verdict, 'keep');
  assert.equal(typeof formatGrade(report), 'string');
});

test('WEAK_CLASS_THRESHOLD is a sane default', () => {
  assert.ok(WEAK_CLASS_THRESHOLD > 0 && WEAK_CLASS_THRESHOLD < 1);
});
