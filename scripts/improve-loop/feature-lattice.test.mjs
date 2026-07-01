import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLattice,
  topoOrder,
  leverage,
  readiness,
  bundleFor,
  nextBestFeature,
  analyzeLattice,
} from './feature-lattice.mjs';

// A realistic shape mirroring the capability engine's output: synthesis X builds on A + B; C standalone.
function sample() {
  return [
    { id: 'A', title: 'Voice Identity Clarification', impact: 8.7, status: 'proposed', buildsOn: '' },
    { id: 'B', title: 'Honest Gap Diagnosis', impact: 8.0, status: 'proposed', buildsOn: '' },
    { id: 'X', title: 'Synthesis: Voice-First Task Execution', impact: 9.6, status: 'proposed', buildsOn: 'Voice Identity Clarification; Honest Gap Diagnosis' },
    { id: 'C', title: 'Task Verification Flag', impact: 6.9, status: 'proposed', buildsOn: '' },
  ];
}

// ── graph construction ────────────────────────────────────────────────────────────
test('buildLattice: resolves buildsOn TITLES into dependency edges', () => {
  const lat = buildLattice(sample());
  assert.deepEqual([...lat.nodes.get('X').dependsOn].sort(), ['A', 'B']);
  assert.ok(lat.nodes.get('A').enables.includes('X'));
  assert.equal(lat.nodes.get('C').dependsOn.length, 0, 'standalone has no deps');
  assert.equal(lat.cycles.length, 0);
});

test('buildLattice: a phantom prereq (no matching proposal) creates NO fake edge', () => {
  const lat = buildLattice([
    { id: 'X', title: 'X', impact: 9, status: 'proposed', buildsOn: 'Some Feature That Was Never Proposed' },
  ]);
  assert.equal(lat.nodes.get('X').dependsOn.length, 0, 'unresolved prereq is dropped, not faked');
});

// ── build order ────────────────────────────────────────────────────────────────────
test('topoOrder: prerequisites come before the feature that builds on them', () => {
  const lat = buildLattice(sample());
  const { order } = topoOrder(lat);
  assert.ok(order.indexOf('A') < order.indexOf('X'), 'A before X');
  assert.ok(order.indexOf('B') < order.indexOf('X'), 'B before X');
});

test('topoOrder: independent features are ordered by impact (highest first)', () => {
  const lat = buildLattice([
    { id: 'low', title: 'low', impact: 3, status: 'proposed' },
    { id: 'high', title: 'high', impact: 9, status: 'proposed' },
  ]);
  assert.deepEqual(topoOrder(lat).order, ['high', 'low']);
});

// ── leverage ────────────────────────────────────────────────────────────────────────
test('leverage: an enabling feature scores by downstream reach; standalone = 0', () => {
  const lat = buildLattice(sample());
  assert.equal(leverage(lat, 'A'), 1, 'A unlocks X → leverage 1');
  assert.equal(leverage(lat, 'C'), 0, 'standalone unlocks nothing → 0 (still valid on impact)');
});

test('leverage: transitive chain A→B→C gives A leverage 2', () => {
  const lat = buildLattice([
    { id: 'A', title: 'A', impact: 5, status: 'proposed' },
    { id: 'B', title: 'B', impact: 5, status: 'proposed', buildsOn: 'A' },
    { id: 'C', title: 'C', impact: 5, status: 'proposed', buildsOn: 'B' },
  ]);
  assert.equal(leverage(lat, 'A'), 2, 'A → B → C');
  assert.equal(leverage(lat, 'B'), 1);
});

// ── readiness ──────────────────────────────────────────────────────────────────────
test('readiness: blocked when a prereq is unbuilt, buildable once built, terminal when none', () => {
  const lat = buildLattice(sample());
  assert.equal(readiness(lat, 'X'), 'blocked', 'X needs A + B which are unbuilt');
  assert.equal(readiness(lat, 'A'), 'terminal');
  assert.equal(readiness(lat, 'C'), 'terminal');
});

test('readiness: X becomes buildable once its prereqs are built', () => {
  const props = sample().map((p) => (p.id === 'A' || p.id === 'B' ? { ...p, status: 'built' } : p));
  const lat = buildLattice(props);
  assert.equal(readiness(lat, 'X'), 'buildable');
});

// ── BUNDLES (V3gga's "bulk package") ─────────────────────────────────────────────────
test('bundleFor: a feature + its unbuilt prereqs = one package, in build order', () => {
  const lat = buildLattice(sample());
  const bundle = bundleFor(lat, 'X');
  assert.equal(bundle.size, 3, 'X + A + B');
  assert.ok(bundle.order.indexOf('A') < bundle.order.indexOf('X'));
  assert.ok(bundle.order.indexOf('B') < bundle.order.indexOf('X'));
  assert.equal(bundle.order[bundle.order.length - 1], 'X', 'the root is last (built after prereqs)');
  assert.equal(bundle.cycle, false);
});

test('bundleFor: a terminal feature bundles to just itself', () => {
  const lat = buildLattice(sample());
  const bundle = bundleFor(lat, 'C');
  assert.deepEqual(bundle.order, ['C']);
  assert.equal(bundle.size, 1);
});

test('bundleFor: an already-built prereq is NOT pulled into the bundle', () => {
  const props = sample().map((p) => (p.id === 'A' ? { ...p, status: 'built' } : p));
  const lat = buildLattice(props);
  const bundle = bundleFor(lat, 'X');
  assert.ok(!bundle.order.includes('A'), 'A is built → not in the bundle');
  assert.ok(bundle.order.includes('B'), 'B still unbuilt → in the bundle');
  assert.equal(bundle.size, 2);
});

// ── cycles (unbuildable roadmap must be caught) ──────────────────────────────────────
test('buildLattice + readiness: a dependency cycle is detected and flagged', () => {
  const lat = buildLattice([
    { id: 'X', title: 'X', impact: 5, status: 'proposed', buildsOn: 'Y' },
    { id: 'Y', title: 'Y', impact: 5, status: 'proposed', buildsOn: 'X' },
  ]);
  assert.equal(lat.cycles.length, 1);
  assert.equal(readiness(lat, 'X'), 'cycle');
  assert.equal(bundleFor(lat, 'X').cycle, true);
});

// ── nextBestFeature ──────────────────────────────────────────────────────────────────
test('nextBestFeature: picks the highest-leverage BUILDABLE move (not the blocked synthesis)', () => {
  const lat = buildLattice(sample());
  const next = nextBestFeature(lat);
  // X (9.6) is blocked; among buildable A/B/C, A has leverage 1 (enables X) and beats B/C.
  assert.equal(next.id, 'A', 'the enabling prerequisite is the best next move');
});

test('nextBestFeature: a standalone high-impact feature can win when it has the most leverage-then-impact', () => {
  const lat = buildLattice([
    { id: 'solo', title: 'Standalone Big Win', impact: 9.5, status: 'proposed' },
    { id: 'small', title: 'Small Enabler', impact: 4, status: 'proposed', buildsOn: '' },
  ]);
  // Both leverage 0 → impact tie-break → the standalone big win.
  assert.equal(nextBestFeature(lat).id, 'solo');
});

test('nextBestFeature: null when everything is built', () => {
  const lat = buildLattice(sample().map((p) => ({ ...p, status: 'built' })));
  assert.equal(nextBestFeature(lat), null);
});

// ── whole-lattice review analysis ────────────────────────────────────────────────────
test('analyzeLattice: returns unbuilt items with readiness + leverage + bundle, best-first', () => {
  const lat = buildLattice(sample());
  const { items, cycles } = analyzeLattice(lat);
  assert.equal(items.length, 4);
  assert.equal(cycles.length, 0);
  // Highest leverage first: A and B (leverage 1) rank above C and X-as-item (X has leverage 0 but
  // high impact; A/B win on leverage).
  assert.ok(['A', 'B'].includes(items[0].id));
  const xItem = items.find((i) => i.id === 'X');
  assert.equal(xItem.readiness, 'blocked');
  assert.equal(xItem.bundle.size, 3);
});
