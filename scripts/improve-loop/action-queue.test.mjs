// Run: node --test scripts/improve-loop/action-queue.test.mjs
// Pure module (no node:sqlite) — the --experimental-sqlite flag is NOT required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActionQueue,
  personaForClass,
  formatTopAction,
  STUCK_PRIORITY_BASE,
} from './action-queue.mjs';

test('buildActionQueue: a stuck visual lesson always outranks every weak class', () => {
  const queue = buildActionQueue({
    targets: [
      { class: 'routing/comparison', total: 5, passed: 2, passRate: 0.4, target: true }, // p60
    ],
    stuckLessons: [
      { lesson: 'oversized empty hero', lane: 'visual', timesSeen: 774 }, // p1774
    ],
  });
  assert.equal(queue[0].type, 'visual-fix');
  assert.equal(queue[0].priority, STUCK_PRIORITY_BASE + 774);
  assert.equal(queue[0].suggestedPersona, 'visual-stylist');
  assert.equal(queue[1].type, 'propose-fix');
  assert.ok(queue[0].priority > queue[1].priority, 'stuck lesson must outrank weak class');
});

test('buildActionQueue: each action carries the required fields', () => {
  const [action] = buildActionQueue({
    stuckLessons: [{ lesson: 'low-contrast text', lane: 'visual', timesSeen: 503 }],
  });
  for (const k of ['type', 'priority', 'target', 'reason', 'suggestedPersona']) {
    assert.ok(k in action, `missing field: ${k}`);
  }
  assert.equal(action.target, 'low-contrast text');
  assert.match(action.reason, /×503/);
});

test('buildActionQueue: answer-lane stuck lesson becomes an answer-fix', () => {
  const [action] = buildActionQueue({
    stuckLessons: [{ lesson: 'curated trap', lane: 'answer', timesSeen: 120 }],
  });
  assert.equal(action.type, 'answer-fix');
  assert.equal(action.suggestedPersona, 'answer-craft');
});

test('buildActionQueue: orders multiple stuck lessons most-repeated first', () => {
  const queue = buildActionQueue({
    stuckLessons: [
      { lesson: 'minor', lane: 'visual', timesSeen: 60 },
      { lesson: 'major', lane: 'visual', timesSeen: 774 },
    ],
  });
  assert.deepEqual(queue.map((a) => a.target), ['major', 'minor']);
});

test('buildActionQueue: weak classes only — stable weakest-first by priority', () => {
  const queue = buildActionQueue({
    targets: [
      { class: 'routing/comparison', passRate: 0.4, passed: 2, total: 5, target: true }, // p60
      { class: 'answer/curated-trap', passRate: 0.46, passed: 6, total: 13, target: true }, // p54
    ],
    stuckLessons: [],
  });
  assert.deepEqual(queue.map((a) => a.target), ['routing/comparison', 'answer/curated-trap']);
  assert.equal(queue.every((a) => a.type === 'propose-fix'), true);
});

test('buildActionQueue: skips non-target classes and is empty-safe', () => {
  const queue = buildActionQueue({
    targets: [{ class: 'healthy', passRate: 0.9, passed: 9, total: 10, target: false }],
    stuckLessons: [],
  });
  assert.deepEqual(queue, []);
  assert.deepEqual(buildActionQueue(), []);
});

test('personaForClass maps prefixes and falls back to generalist', () => {
  assert.equal(personaForClass('routing/comparison'), 'router-specialist');
  assert.equal(personaForClass('answer/framing'), 'answer-craft');
  assert.equal(personaForClass('followup/context-carry'), 'context-keeper');
  assert.equal(personaForClass('ui/contrast'), 'visual-stylist');
  assert.equal(personaForClass('something/unknown'), 'generalist');
  assert.equal(personaForClass(null), 'generalist');
});

test('formatTopAction summarizes the head or reports an empty queue', () => {
  assert.match(formatTopAction([]), /none/);
  const line = formatTopAction(buildActionQueue({
    stuckLessons: [{ lesson: 'oversized empty hero', lane: 'visual', timesSeen: 774 }],
  }));
  assert.match(line, /visual-fix/);
  assert.match(line, /p1774/);
  assert.match(line, /visual-stylist/);
});
