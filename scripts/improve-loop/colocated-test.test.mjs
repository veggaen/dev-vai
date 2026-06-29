// Run: node --test scripts/improve-loop/colocated-test.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { colocatedTestPath } from './colocated-test.mjs';

// Absolute, platform-correct root so resolve() inside the helper matches the test's expectations.
const root = resolve('/repo');
// Fake fs keyed by repo-relative path: an abs path "exists" iff its tail (after root) is present.
const fsWith = (present) => (abs) => {
  const rel = resolve(abs).slice(root.length).replace(/^[\\/]+/, '').replace(/\\/g, '/');
  return present.has(rel);
};

test('returns the sibling .test.ts when it exists', () => {
  const exists = fsWith(new Set(['packages/core/src/chat/x.test.ts']));
  assert.equal(
    colocatedTestPath('packages/core/src/chat/x.ts', { root, exists }),
    'packages/core/src/chat/x.test.ts',
  );
});

test('returns null when no sibling test exists (caller falls back to tsc-only)', () => {
  const exists = fsWith(new Set());
  assert.equal(colocatedTestPath('packages/core/src/chat/x.ts', { root, exists }), null);
});

test('handles .mjs ↔ .test.mjs', () => {
  const exists = fsWith(new Set(['scripts/improve-loop/foo.test.mjs']));
  assert.equal(
    colocatedTestPath('scripts/improve-loop/foo.mjs', { root, exists }),
    'scripts/improve-loop/foo.test.mjs',
  );
});

test('a .ts source can map to a .test.ts even if same-ext check is first', () => {
  const exists = fsWith(new Set(['a/b/comp.test.ts']));
  assert.equal(colocatedTestPath('a/b/comp.ts', { root, exists }), 'a/b/comp.test.ts');
});

test('if given a test file directly, returns it when present', () => {
  const exists = fsWith(new Set(['a/b/comp.test.ts']));
  assert.equal(colocatedTestPath('a/b/comp.test.ts', { root, exists }), 'a/b/comp.test.ts');
});

test('non-source paths and junk return null', () => {
  const exists = fsWith(new Set());
  assert.equal(colocatedTestPath('README.md', { root, exists }), null);
  assert.equal(colocatedTestPath('', { root, exists }), null);
  assert.equal(colocatedTestPath(null, { root, exists }), null);
});
