// Run: node --test scripts/improve-loop/vague-answer.test.mjs
// Uses the built-in node test runner — the improve-loop scripts live outside the
// vitest workspace on purpose (operational tooling), so they self-test via node:test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreVagueOverconfident } from './vague-answer.mjs';

test('flags the kind of reply the user complained about', () => {
  const slop =
    'Vai is a powerful, cutting-edge local-first AI system that seamlessly leverages ' +
    'the best practices in intelligence. It is definitely the only way to get robust ' +
    'answers, and obviously everyone knows local is always better. At the end of the ' +
    'day it just works.';
  const r = scoreVagueOverconfident(slop);
  assert.equal(r.vague, true);
  assert.ok(r.score >= 3, `score ${r.score} should reach threshold`);
});

test('clears a grounded answer with numbers, file refs, and hedging', () => {
  const good =
    'Vai routes turns through packages/core. The council runs ~5 local models via ' +
    'Ollama (qwen3:8b, DeepSeek-R1). Latency is typically 2-30s depending on depth; ' +
    'cold loads may take longer. It might still be wrong on fresh facts, so it ' +
    'searches the web first.';
  assert.equal(scoreVagueOverconfident(good).vague, false);
});

test('does not flag a short, plain answer', () => {
  assert.equal(scoreVagueOverconfident('Yes, that works.').vague, false);
});

test('treats empty / undefined input as not-vague', () => {
  assert.equal(scoreVagueOverconfident('').vague, false);
  assert.equal(scoreVagueOverconfident(undefined).vague, false);
});

test('honors a custom threshold', () => {
  const mild = 'This is simply the best approach and it always works well for everyone.';
  assert.equal(scoreVagueOverconfident(mild, { threshold: 99 }).vague, false);
});
