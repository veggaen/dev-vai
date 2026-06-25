import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LENSES, selectLenses, lensPreamble } from './capability-lenses.mjs';

// The crews the mission names. If a crew lens is missing, the council literally cannot reason
// in that role — so presence is a contract, not a nicety.
const REQUIRED_CREWS = [
  'research-crew', 'brainstorm-crew', 'design-styling-crew',
  'branding-crew', 'growth-marketing-crew', 'external-pull-strategist',
];

test('every named crew exists as a lens with a grounded framing', () => {
  const byId = new Map(LENSES.map((l) => [l.id, l]));
  for (const id of REQUIRED_CREWS) {
    const lens = byId.get(id);
    assert.ok(lens, `missing crew lens: ${id}`);
    assert.ok(lens.area && lens.title && lens.lens, `${id} must have area/title/lens`);
    assert.ok(lens.lens.length > 80, `${id} framing too thin to steer a model`);
  }
});

test('no-focus round returns the FULL roundtable (all crews seated)', () => {
  const picked = selectLenses();
  assert.equal(picked.length, LENSES.length);
  for (const id of REQUIRED_CREWS) {
    assert.ok(picked.some((l) => l.id === id), `${id} absent from full roundtable`);
  }
});

test('external-pull-strategist is ALWAYS seated, even on a code-only focused round', () => {
  // A focused engineering round must not drift away from the real definition of useful.
  const picked = selectLenses('tooling shell api');
  assert.ok(picked.some((l) => l.id === 'external-pull-strategist'),
    'the goal-keeper lens must be always-on');
  assert.ok(picked.some((l) => l.id === 'capability-gap-hunter'));
});

test('focus routing reaches each crew by theme', () => {
  const cases = [
    ['research a better technique', 'research-crew'],
    ['brainstorm a wild idea', 'brainstorm-crew'],
    ['improve the ui design and motion', 'design-styling-crew'],
    ['the brand story and readme', 'branding-crew'],
    ['growth and shareable reach', 'growth-marketing-crew'],
    ['what attracts external stars and forks', 'external-pull-strategist'],
  ];
  for (const [focus, expectId] of cases) {
    const picked = selectLenses(focus);
    assert.ok(picked.some((l) => l.id === expectId),
      `focus "${focus}" did not route to ${expectId}`);
  }
});

test('lensPreamble carries the north-star and the grounding rule', () => {
  const lens = LENSES.find((l) => l.id === 'external-pull-strategist');
  const pre = lensPreamble(lens, { goal: 'make Vai useful enough to pull external PRs', focus: 'traction' });
  assert.match(pre, /north-star/i);
  assert.match(pre, /useful enough to pull external PRs/);
  assert.match(pre, /only cite a file\/line you actually read/i, 'must keep the anti-hallucination rule');
  assert.match(pre, new RegExp(`area "${lens.area}"`));
});

test('selecting an unknown focus still yields a usable roundtable (never empty)', () => {
  const picked = selectLenses('zzz-nonsense-focus');
  assert.ok(picked.length >= 1, 'must never return an empty council');
});
