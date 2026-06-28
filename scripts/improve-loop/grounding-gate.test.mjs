import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeGrounding, groundingAnchors, describeGrounding } from './grounding-gate.mjs';

// Representative of the loop's OWN labelled examples (the 52× gap), so the test pins real behaviour.
// ~70 words, confident, zero concrete anchors — the real 52× slop shape (long essay-soup).
const SLOP = 'A good company culture is defined by its focus on amazing people, with leaders who invest in hiring, onboarding, and retaining top talent. It fosters a supportive and productive environment where everyone simply thrives. The best teams always win because they obviously prioritise collaboration, and undoubtedly the right mindset is the only way to build something that lasts and truly empowers everyone involved at the end of the day.';
// Genuinely grounded: a named tool (React DevTools), a code identifier (`useMemo`), AND a concrete
// number (16ms) — not just a numbered checklist, which no longer self-qualifies (CodeRabbit #25).
const GROUNDED = 'For React performance, open the React DevTools Profiler and record the slow interaction. If a component re-renders more than the 16ms frame budget, memoize it with `useMemo` or split the context provider.';

test('groundingAnchors counts DISTINCT anchor kinds, not raw hits', () => {
  const a = groundingAnchors(GROUNDED);
  assert.ok(a.anchors >= 2, `grounded answer should have ≥2 anchors, got ${a.anchors} (${a.kinds})`);
  const s = groundingAnchors(SLOP);
  assert.ok(s.anchors <= 1, `slop should have ≤1 anchor, got ${s.anchors} (${s.kinds})`);
});

test('a short answer ships without grounding', () => {
  const g = gradeGrounding('Yes — Postgres is the better default here.');
  assert.equal(g.verdict, 'ship');
  assert.match(g.reason, /short answer/);
});

test('a long grounded answer ships', () => {
  const g = gradeGrounding(GROUNDED);
  assert.equal(g.verdict, 'ship');
  assert.ok(g.anchors >= 2);
});

test('a long confident anchorless answer is HELD (the 52× slop shape)', () => {
  // SLOP has "simply/always/best" confident markers, no hedge, no real anchor → hold.
  const g = gradeGrounding(SLOP);
  assert.equal(g.verdict, 'hold', `expected hold, got ${g.verdict}: ${g.reason}`);
  assert.ok(g.repair, 'a held answer must carry a repair instruction');
});

test('a substantive but thin answer is REPAIR, not hold', () => {
  const thin = 'Choosing a database depends on your needs and your team and the kind of product you are building and how it might grow over time in production.';
  const g = gradeGrounding(thin);
  assert.equal(g.verdict, 'repair');
  assert.ok(g.repair);
});

test('does NOT false-positive: a grounded answer is never held', () => {
  for (const ans of [GROUNDED, 'The fix is in `service.ts:88` — change the guard to 0.5.', 'Use Vitest 3.2, e.g. `vitest run`, and check the 12 failing specs.']) {
    assert.notEqual(gradeGrounding(ans).verdict, 'hold', `false positive on: ${ans.slice(0, 40)}`);
  }
});

test('describeGrounding renders a compact one-liner', () => {
  assert.match(describeGrounding(gradeGrounding(GROUNDED)), /grounding ✓ ship/);
  assert.equal(describeGrounding(null), '');
});

test('empty / nullish answer does not throw', () => {
  assert.doesNotThrow(() => gradeGrounding(''));
  assert.doesNotThrow(() => gradeGrounding(null));
});
