// Run: node --test scripts/improve-loop/visual-rubric.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contrastRatio,
  parseCssColor,
  gradeMotionTiming,
  detectGenericAesthetic,
  buildFlaws,
  judgeVisualExcellence,
} from './visual-rubric.mjs';

test('contrastRatio matches WCAG extremes', () => {
  const black = { r: 0, g: 0, b: 0 };
  const white = { r: 255, g: 255, b: 255 };
  assert.equal(Math.round(contrastRatio(black, white)), 21);
  assert.equal(Math.round(contrastRatio(white, white)), 1);
});

test('parseCssColor reads rgb and rgba', () => {
  assert.deepEqual(parseCssColor('rgb(18, 22, 34)'), { r: 18, g: 22, b: 34, a: 1 });
  assert.deepEqual(parseCssColor('rgba(255, 0, 0, 0.5)'), { r: 255, g: 0, b: 0, a: 0.5 });
  assert.equal(parseCssColor('transparent'), null);
});

test('gradeMotionTiming rewards eased mid-duration, punishes linear/abrupt/draggy', () => {
  const good = gradeMotionTiming({ durationMs: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
  assert.ok(good.score >= 8, good.reason);
  const abrupt = gradeMotionTiming({ durationMs: 40, easing: 'linear' });
  assert.ok(abrupt.score <= 4, abrupt.reason);
  const draggy = gradeMotionTiming({ durationMs: 1200, easing: 'ease' });
  assert.ok(draggy.score <= 6, draggy.reason);
  assert.equal(gradeMotionTiming({ durationMs: null }).score, 5);
});

test('detectGenericAesthetic flags the named failure signs', () => {
  const flags = detectGenericAesthetic({
    purpleGradientCount: 1,
    glassmorphismCount: 4,
    maxCardNestingDepth: 3,
    oversizedEmptyHero: true,
    distinctFontSizes: 2,
  });
  assert.ok(flags.includes('purple-gradient slop'));
  assert.ok(flags.includes('overused glassmorphism'));
  assert.ok(flags.includes('nested cards'));
  assert.ok(flags.includes('oversized empty hero'));
  assert.ok(flags.includes('weak typographic hierarchy'));
  assert.equal(detectGenericAesthetic({ distinctFontSizes: 5 }).length, 0);
});

test('buildFlaws gives a clipped popover P0 with cause and fix direction', () => {
  const flaws = buildFlaws({
    viewport: { width: 1440, height: 900 },
    clippedPopovers: [{ selector: 'div.menu', clipperSelector: 'div.panel', clipperOverflow: 'hidden' }],
  });
  assert.equal(flaws.length, 1);
  assert.equal(flaws[0].severity, 'P0');
  assert.match(flaws[0].symptom, /clipped/);
  assert.match(flaws[0].fixDirection, /portal|top-layer/);
});

test('buildFlaws catches offscreen and covered controls as P0', () => {
  const flaws = buildFlaws({
    viewport: { width: 390, height: 700 },
    offscreenInteractive: [{ selector: 'button.menu', box: { x: 360, y: 40, w: 90, h: 36 } }],
    coveredInteractive: [{ selector: 'button.submit', topLabel: 'div.overlay', point: { x: 120, y: 500 } }],
  });
  assert.equal(flaws.length, 2);
  assert.deepEqual(flaws.map((f) => f.severity), ['P0', 'P0']);
  assert.match(flaws[0].symptom, /offscreen/);
  assert.match(flaws[1].symptom, /covered/);
  assert.match(flaws[1].fixDirection, /stacking|top layer/);
});

test('buildFlaws treats small hit areas as polish flaws, not blockers', () => {
  const flaws = buildFlaws({
    viewport: { width: 1440, height: 900 },
    tinyClickTargets: [{ selector: 'button.icon', box: { x: 24, y: 24, w: 24, h: 24 } }],
  });
  assert.equal(flaws.length, 1);
  assert.equal(flaws[0].severity, 'P2');
  assert.match(flaws[0].symptom, /too small/);
});

test('buildFlaws escalates very-low-contrast text to P0, mild to P1', () => {
  const flaws = buildFlaws({
    invisibleText: [
      { selector: 'span.ghost', contrast: 1.2, fg: 'rgb(200,200,200)', bg: 'rgb(210,210,210)' },
      { selector: 'p.dim', contrast: 3.1, fg: 'rgb(120,120,120)', bg: 'rgb(255,255,255)' },
    ],
  });
  const sev = flaws.map((f) => f.severity);
  assert.deepEqual(sev, ['P0', 'P1']);
});

test('buildFlaws catches layout shift, missing focus ring, scrollbar', () => {
  const flaws = buildFlaws({
    layoutShiftPx: 24,
    focusRingVisible: false,
    unexpectedScrollbar: 'x',
    hoverStateDelta: false,
  });
  const symptoms = flaws.map((f) => f.symptom).join(' | ');
  assert.match(symptoms, /jumps during interaction/);
  assert.match(symptoms, /focus state/);
  assert.match(symptoms, /scrollbar/);
  assert.match(symptoms, /hover affordance/);
});

test('judgeVisualExcellence: a disciplined, alive UI scores well with no blockers', () => {
  const verdict = judgeVisualExcellence({
    viewport: { width: 1440, height: 900 },
    distinctFontSizes: 5,
    distinctColors: 9,
    usesCustomFont: true,
    contentDensity: 0.4,
    glassmorphismCount: 1,
    purpleGradientCount: 0,
    maxCardNestingDepth: 1,
    oversizedEmptyHero: false,
    invisibleText: [],
    unexpectedScrollbar: null,
    primaryTransitionMs: 220,
    primaryEasing: 'cubic-bezier(.2,.8,.2,1)',
    layoutShiftPx: 0,
    inputLatencyMs: 30,
    focusRingVisible: true,
    hoverStateDelta: true,
  });
  assert.equal(verdict.flawCounts.P0, 0);
  assert.ok(verdict.overall >= 7, `overall ${verdict.overall}`);
  assert.ok(verdict.humanAppeal.wow >= 5, `wow ${verdict.humanAppeal.wow}`);
  assert.ok(verdict.humanAppeal.firstImpression >= 7);
  assert.match(verdict.headline, /visual \d/);
});

test('judgeVisualExcellence: generic-slop + blocker UI scores low and wow is gated to floor', () => {
  const verdict = judgeVisualExcellence({
    viewport: { width: 1440, height: 900 },
    distinctFontSizes: 2,
    distinctColors: 30,
    usesCustomFont: false,
    contentDensity: 0.85,
    glassmorphismCount: 5,
    purpleGradientCount: 2,
    maxCardNestingDepth: 4,
    oversizedEmptyHero: true,
    invisibleText: [{ selector: 'span', contrast: 1.1, fg: 'rgb(200,200,200)', bg: 'rgb(205,205,205)' }],
    unexpectedScrollbar: 'x',
    primaryTransitionMs: 0,
    primaryEasing: 'linear',
    layoutShiftPx: 30,
    inputLatencyMs: 250,
    focusRingVisible: false,
    hoverStateDelta: false,
  });
  assert.ok(verdict.flawCounts.P0 >= 1);
  assert.ok(verdict.overall <= 5, `overall ${verdict.overall}`);
  assert.equal(verdict.humanAppeal.wow, 1, 'a blocker forces wow to its floor');
  assert.ok(verdict.genericFlags.length >= 3);
  assert.match(verdict.tasteLesson, /hides or blocks|broken before/);
});

test('judgeVisualExcellence stays conservative when signals are missing', () => {
  const verdict = judgeVisualExcellence({});
  assert.ok(verdict.overall >= 3 && verdict.overall <= 7, `neutral overall ${verdict.overall}`);
  assert.equal(verdict.flaws.length, 0);
  assert.ok(typeof verdict.tasteLesson === 'string' && verdict.tasteLesson.length > 0);
});
