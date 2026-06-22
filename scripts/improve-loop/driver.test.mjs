// Run: node --test scripts/improve-loop/driver.test.mjs
// Uses the built-in node test runner — the improve-loop scripts live outside the
// vitest workspace on purpose (operational tooling), so they self-test via node:test
// (mirrors vague-answer.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInfraError } from './driver.mjs';

// Verification-First: isInfraError is the gate that decides whether a failed turn is an
// INFRASTRUCTURE failure (skip — never grade, the constitution's "don't score infra as Vai
// logic") or a genuine answer-level failure (record). Wrong classification either way
// corrupts the corpus, so its behaviour must be pinned by tests.

test('classifies connection/infra failures as infra (skip-not-grade)', () => {
  // The exact failure that cost two loop runs this session: a cold model → every WS
  // connect attempt fails → Node surfaces an AggregateError.
  assert.equal(isInfraError(new AggregateError([], 'all connect attempts failed')), true);
  assert.equal(isInfraError(new Error('connect ECONNREFUSED 127.0.0.1:3006')), true);
  assert.equal(isInfraError(new Error('read ECONNRESET')), true);
  assert.equal(isInfraError(new Error('fetch failed')), true);
  assert.equal(isInfraError(new Error('socket hang up')), true);
  assert.equal(isInfraError(new Error('WebSocket was closed before the connection was established')), true);
  assert.equal(isInfraError(new Error('timeout')), true);
});

test('accepts a bare string or a raw AggregateError name', () => {
  assert.equal(isInfraError('AggregateError'), true);
  assert.equal(isInfraError('ECONNREFUSED'), true);
});

test('does NOT classify a genuine Vai answer-level error as infra (it must be graded)', () => {
  // A real content/grounding failure the council surfaced must be RECORDED, not skipped.
  assert.equal(isInfraError(new Error('draft did not meet quality bar')), false);
  assert.equal(isInfraError(new Error('council escalated: no grounded evidence')), false);
  assert.equal(isInfraError(new Error('builder produced no files')), false);
  assert.equal(isInfraError('I cannot access external repositories'), false);
});

test('null / undefined / empty are safely non-infra', () => {
  assert.equal(isInfraError(null), false);
  assert.equal(isInfraError(undefined), false);
  assert.equal(isInfraError(''), false);
});
