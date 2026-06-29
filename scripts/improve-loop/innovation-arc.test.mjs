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

test('planInnovation classifies the grounding gap autonomous (build injected to isolate routing)', async () => {
  // Inject a passing build so this test isolates the DISCOVER→CLASSIFY routing from the data-dependent
  // prove step (which has its own tests above). A guardable grounding gap must route autonomous.
  const plan = await planInnovation(null, {
    lessons: [L('no concrete grounding: cite a number, name, file ref', 52, 5.3)],
    build: () => ({ built: true, guard: () => ({ verdict: 'ship' }), scorecard: { detail: 'injected pass' }, reason: 'injected pass' }),
  });
  assert.equal(plan.found, true);
  assert.equal(plan.mode, 'autonomous');
  assert.equal(plan.built, true);
  assert.match(plan.headline, /innovation \[autonomous · BUILT\+PROVEN\]/);
});

test('planInnovation with a guardable gap but NO examples demotes to escalate (cannot prove)', async () => {
  const plan = await planInnovation(null, {
    lessons: [L('no concrete grounding: cite a number, name, file ref', 52, 5.3)],
    examples: [], // no labelled data → cannot prove a guard → must not keep it
  });
  assert.equal(plan.built, false);
  assert.equal(plan.mode, 'escalate');
});

test('planInnovation reports nothing-to-do when the loop is healthy', async () => {
  const plan = await planInnovation(null, { lessons: [L('keep this craft', 94, 7.9)] });
  assert.equal(plan.found, false);
  assert.match(formatInnovation(plan), /no unacted gap/);
});

test('planInnovation BUILDS+PROVES an autonomous guard when the data separates', async () => {
  const SLOP = 'A good company culture is defined by its focus on amazing people, with leaders who invest in hiring, onboarding, and retaining top talent. It fosters a supportive and productive environment where everyone simply thrives and the best teams always win because the right mindset is the only way.';
  const GROUNDED = 'For React, open the React DevTools Profiler, record the slow interaction. Fixes: 1. useMemo, 2. split context, 3. virtualize lists.';
  const plan = await planInnovation(null, {
    lessons: [L('no concrete grounding: cite a number, name, file ref', 52, 5.3)],
    examples: [
      { answer: SLOP, bad: true }, { answer: SLOP.replace('culture', 'team'), bad: true },
      { answer: GROUNDED, bad: false }, { answer: GROUNDED.replace('React', 'Vue'), bad: false },
    ],
    buildOpts: { minCatch: 0.6, maxFalsePos: 0.1 },
  });
  assert.equal(plan.mode, 'autonomous');
  assert.equal(plan.built, true, JSON.stringify(plan.scorecard));
  assert.equal(typeof plan.guard, 'function');
  assert.match(formatInnovation(plan), /AUTONOMOUSLY BUILT/);
});

test('planInnovation DEMOTES to escalate when the guard cannot prove out', async () => {
  const GROUNDED = 'Use Vitest 3.2, e.g. `vitest run`, and check the 12 failing specs in service.ts.';
  const plan = await planInnovation(null, {
    lessons: [L('no concrete grounding: cite a number', 52, 5.3)],
    // all "bad" examples are actually grounded → the guard catches nothing → must not be kept
    examples: [{ answer: GROUNDED, bad: true }, { answer: GROUNDED, bad: false }],
  });
  assert.equal(plan.built, false);
  assert.equal(plan.mode, 'escalate');
  assert.match(formatInnovation(plan), /flagged for V3gga/);
});

test('formatInnovation flags an escalate plan for V3gga', async () => {
  const plan = await planInnovation(null, {
    // a stuck low gap that is NOT guardable → escalate
    lessons: [L('the council disagrees on multi-step reasoning chains too often', 50, 4.5)],
  });
  assert.equal(plan.mode, 'escalate');
  assert.match(formatInnovation(plan), /flagged for V3gga/);
});
