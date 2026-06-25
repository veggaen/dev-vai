import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectGuardShape, makeGuard, proveGuard, buildGuardFromDiscovery } from './guard-builder.mjs';

const SLOP = 'A good company culture is defined by its focus on amazing people, with leaders who invest in hiring, onboarding, and retaining top talent. It fosters a supportive and productive environment where everyone simply thrives. The best teams always win because they obviously prioritise collaboration and the right mindset is the only way to build something lasting.';
const GROUNDED = 'For React performance, open the React DevTools Profiler, record the slow interaction, and look for re-rendering components. Common fixes: 1. memoize with useMemo, 2. split context, 3. virtualize long lists.';

test('selectGuardShape maps a grounding lesson to the grounding shape', () => {
  const s = selectGuardShape({ lesson: 'no concrete grounding: cite a number, name, file ref' });
  assert.equal(s.name, 'grounding');
});

test('selectGuardShape maps an overconfidence lesson', () => {
  assert.equal(selectGuardShape({ lesson: 'overconfident and ungrounded — calibrate' }).name, 'overconfidence');
});

test('selectGuardShape returns null for a non-signal-shaped discovery', () => {
  assert.equal(selectGuardShape({ lesson: 'the council disagrees on multi-step reasoning chains' }), null);
});

test('makeGuard: a grounding guard holds slop and ships grounded answers', () => {
  const guard = makeGuard(selectGuardShape({ lesson: 'grounding' }));
  assert.equal(guard(SLOP).verdict, 'hold');
  assert.equal(guard(GROUNDED).verdict, 'ship');
});

test('makeGuard: short answers are always exempt', () => {
  const guard = makeGuard(selectGuardShape({ lesson: 'grounding' }));
  assert.equal(guard('Yes, use Postgres.').verdict, 'ship');
});

test('proveGuard PASSES a guard that separates good from bad', () => {
  const guard = makeGuard(selectGuardShape({ lesson: 'grounding' }));
  const examples = [
    { answer: SLOP, bad: true },
    { answer: SLOP.replace('culture', 'process'), bad: true },
    { answer: GROUNDED, bad: false },
    { answer: GROUNDED.replace('React', 'Vue'), bad: false },
  ];
  const sc = proveGuard(guard, examples, { minCatch: 0.6, maxFalsePos: 0.1 });
  assert.equal(sc.pass, true, sc.detail);
  assert.ok(sc.catchRate >= 0.6);
  assert.equal(sc.falsePosRate, 0);
});

test('proveGuard FAILS (cannot prove) with no good or no bad examples', () => {
  const guard = makeGuard(selectGuardShape({ lesson: 'grounding' }));
  assert.equal(proveGuard(guard, [{ answer: SLOP, bad: true }]).pass, false); // no good examples
  assert.equal(proveGuard(guard, []).pass, false);
});

test('buildGuardFromDiscovery: builds + proves a grounding guard on real-shaped data', () => {
  const r = buildGuardFromDiscovery(
    { kind: 'discovery', lesson: 'no concrete grounding: cite a number', guardable: true },
    [{ answer: SLOP, bad: true }, { answer: GROUNDED, bad: false }],
  );
  assert.equal(r.built, true, r.reason);
  assert.equal(typeof r.guard, 'function');
  assert.equal(r.shape.name, 'grounding');
});

test('buildGuardFromDiscovery: ESCALATES a non-signal-shaped discovery (no guard family fits)', () => {
  const r = buildGuardFromDiscovery({ kind: 'discovery', lesson: 'council disagrees on reasoning chains' }, []);
  assert.equal(r.built, false);
  assert.match(r.reason, /not signal-shaped|escalate/);
});

test('buildGuardFromDiscovery: DISCARDS an unproven guard rather than shipping it', () => {
  // A grounding lesson, but the labelled data does NOT separate (all "bad" examples are actually grounded)
  // → the guard catches nothing → must NOT be kept.
  const r = buildGuardFromDiscovery(
    { kind: 'discovery', lesson: 'grounding' },
    [{ answer: GROUNDED, bad: true }, { answer: GROUNDED, bad: false }],
  );
  assert.equal(r.built, false);
  assert.match(r.reason, /no .* configuration proved out|escalate/);
});
