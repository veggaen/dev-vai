import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mineDiscovery, classifyInnovation, planInnovation, formatInnovation } from './innovation-arc.mjs';

const L = (lesson, times_seen, last_overall) => ({ lesson, times_seen, last_overall });

test('mineDiscovery finds the most-repeated unacted low-score gap (the 52× shape)', () => {
  const d = mineDiscovery([
    L('Grounded, calibrated, direct answer — keep this craft', 94, 7.9), // healthy → not a gap
    L('no concrete grounding: cite a number, name, file ref', 52, 5.3),   // the real gap
    L('1 empty-filler phrase(s): cut filler', 8, 7.5),                    // below minTimes
  ]);
  assert.ok(d, 'should find a discovery');
  assert.match(d.lesson, /no concrete grounding/);
  assert.equal(d.timesSeen, 52);
  assert.equal(d.guardable, true);
});

test('mineDiscovery skips a HEALTHY high-score lesson even if repeated a lot', () => {
  const d = mineDiscovery([L('Grounded, calibrated, direct answer — keep this craft', 94, 7.9)]);
  assert.equal(d, null);
});

test('mineDiscovery skips an already-RESOLVED lesson', () => {
  const d = mineDiscovery([L('no concrete grounding: cite a number [RESOLVED by grounding-gate]', 52, 5.3)]);
  assert.equal(d, null);
});

test('mineDiscovery returns null below the discovery threshold', () => {
  const d = mineDiscovery([L('some rare lesson', 3, 4.0)]);
  assert.equal(d, null);
});

test('classifyInnovation: a guardable discovery is AUTONOMOUS', () => {
  const c = classifyInnovation({ kind: 'discovery', guardable: true });
  assert.equal(c.mode, 'autonomous');
});

test('classifyInnovation: a feature is ESCALATE (fundamental)', () => {
  const c = classifyInnovation({ kind: 'feature', area: 'vision' });
  assert.equal(c.mode, 'escalate');
});

test('classifyInnovation: a NON-guardable discovery escalates (errs safe)', () => {
  const c = classifyInnovation({ kind: 'discovery', guardable: false });
  assert.equal(c.mode, 'escalate');
});

test('classifyInnovation: unknown/empty candidate escalates by default', () => {
  assert.equal(classifyInnovation({}).mode, 'escalate');
  assert.equal(classifyInnovation().mode, 'escalate');
});

test('planInnovation routes the grounding gap to autonomous', async () => {
  const plan = await planInnovation(null, {
    lessons: [L('no concrete grounding: cite a number, name, file ref', 52, 5.3)],
  });
  assert.equal(plan.found, true);
  assert.equal(plan.mode, 'autonomous');
  assert.match(plan.headline, /innovation \[autonomous\]/);
});

test('planInnovation reports nothing-to-do when the loop is healthy', async () => {
  const plan = await planInnovation(null, { lessons: [L('keep this craft', 94, 7.9)] });
  assert.equal(plan.found, false);
  assert.match(formatInnovation(plan), /no unacted gap/);
});

test('formatInnovation flags an escalate plan for V3gga', async () => {
  const plan = await planInnovation(null, {
    // a stuck low gap that is NOT guardable → escalate
    lessons: [L('the council disagrees on multi-step reasoning chains too often', 50, 4.5)],
  });
  assert.equal(plan.mode, 'escalate');
  assert.match(formatInnovation(plan), /flagged for V3gga/);
});
