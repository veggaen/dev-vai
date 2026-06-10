import test from 'node:test';
import assert from 'node:assert/strict';
import { auditPromptRealism, auditWaveRealism } from './vai-benchmark-realism.mjs';
import { buildGeneratedAuditWave } from './vai-generated-audit-wave.mjs';
import { buildRealisticMutationWave } from './vai-realistic-mutation-wave.mjs';

test('realistic dogfood waves are reproducible and cover every family', () => {
  const first = buildRealisticMutationWave(20, 'dogfood-alpha');
  const repeat = buildRealisticMutationWave(20, 'dogfood-alpha');
  const second = buildRealisticMutationWave(20, 'dogfood-beta');

  assert.deepEqual(first, repeat);
  assert.notDeepEqual(first.scenarios, second.scenarios);
  assert.equal(first.generation.families, 10);
});

test('realistic dogfood prompts stay unique and do not expose internal markers', () => {
  for (let index = 0; index < 100; index += 1) {
    const wave = buildRealisticMutationWave(20, `dogfood-diversity-${index}`);
    const prompts = wave.scenarios.flatMap((scenario) => scenario.turns.map((turn) => turn.prompt));

    assert.equal(new Set(prompts).size, prompts.length);
    assert.ok(wave.scenarios.every((scenario) => scenario.turns.every((turn) => !turn.prompt.includes(scenario.canary))));
  }
});

test('realism audit separates protocol controls from dogfood prompts', () => {
  const control = auditWaveRealism(buildGeneratedAuditWave(16, 'control-realism'), 'generated-control');
  const dogfood = auditWaveRealism(buildRealisticMutationWave(20, 'dogfood-realism'));

  assert.ok(control.syntheticPrompts > 0);
  assert.ok(control.promptVisibleCanaries > 0);
  assert.equal(dogfood.syntheticPrompts, 0);
  assert.equal(dogfood.promptVisibleCanaries, 0);
  assert.ok(dogfood.humanTraitPrompts > 0);
});

test('realism audit identifies explicit benchmark language', () => {
  const result = auditPromptRealism('Context: I am testing whether you stay on-task. Request: explain CORS.');
  assert.ok(result.syntheticFlags.includes('explicit-test-language'));
});

