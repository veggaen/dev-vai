import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdversarialAuditWave } from './vai-adversarial-audit-wave.mjs';

test('adversarial waves are reproducible for one seed and vary across seeds', () => {
  const first = buildAdversarialAuditWave(16, 'adversarial-alpha');
  const repeat = buildAdversarialAuditWave(16, 'adversarial-alpha');
  const second = buildAdversarialAuditWave(16, 'adversarial-beta');

  assert.deepEqual(first, repeat);
  assert.notDeepEqual(first.scenarios, second.scenarios);
});

test('adversarial waves cover every out-of-distribution family with unique prompts and canaries', () => {
  const wave = buildAdversarialAuditWave(16, 'adversarial-coverage');
  const prompts = wave.scenarios.flatMap((scenario) => scenario.turns.map((turn) => turn.prompt));
  const canaries = wave.scenarios.map((scenario) => scenario.canary);
  const dimensions = new Set(wave.scenarios.flatMap((scenario) => scenario.dimensions ?? []));

  assert.equal(wave.generation.families, 8);
  assert.equal(new Set(prompts).size, prompts.length);
  assert.equal(new Set(canaries).size, canaries.length);
  assert.ok(dimensions.has('typo-tolerance'));
  assert.ok(dimensions.has('paraphrase'));
  assert.ok(dimensions.has('multi-intent'));
});

test('adversarial waves contain casual casing, typo, reordered inventory, and combined-intent controls', () => {
  const wave = buildAdversarialAuditWave(16, 'adversarial-shapes');
  const prompts = wave.scenarios.flatMap((scenario) => scenario.turns.map((turn) => turn.prompt)).join('\n');

  assert.match(prompts, /\bi\b/);
  assert.match(prompts, /\bpls\b|\bwhats\b|\bwasnt\b|\bisnt\b/);
  assert.match(prompts, /routes=\d+; root has \d+ scratch files/);
  assert.match(prompts, /i need 2 things/);
});
