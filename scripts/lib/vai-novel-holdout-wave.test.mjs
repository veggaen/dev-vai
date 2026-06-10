import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNovelHoldoutWave } from './vai-novel-holdout-wave.mjs';

test('novel holdout waves are reproducible and cover every locked family', () => {
  const first = buildNovelHoldoutWave(16, 'holdout-alpha');
  const repeat = buildNovelHoldoutWave(16, 'holdout-alpha');
  const second = buildNovelHoldoutWave(16, 'holdout-beta');

  assert.deepEqual(first, repeat);
  assert.notDeepEqual(first.scenarios, second.scenarios);
  assert.equal(first.generation.families, 8);
});

test('novel holdout waves keep conversations and prompts unique at scale', () => {
  for (let index = 0; index < 250; index += 1) {
    const wave = buildNovelHoldoutWave(16, `holdout-diversity-${index}`);
    const prompts = wave.scenarios.flatMap((scenario) => scenario.turns.map((turn) => turn.prompt));
    const canaries = wave.scenarios.map((scenario) => scenario.canary);

    assert.equal(new Set(prompts).size, prompts.length);
    assert.equal(new Set(canaries).size, canaries.length);
  }
});

test('novel holdout contains ordinary conversation, ambiguity, and semantic vocabulary shifts', () => {
  const wave = buildNovelHoldoutWave(16, 'holdout-shapes');
  const dimensions = new Set(wave.scenarios.flatMap((scenario) => scenario.dimensions ?? []));
  const prompts = wave.scenarios.flatMap((scenario) => scenario.turns.map((turn) => turn.prompt)).join('\n');

  assert.ok(dimensions.has('ordinary-conversation'));
  assert.ok(dimensions.has('ambiguity'));
  assert.ok(dimensions.has('project-memory'));
  assert.match(prompts, /login secret is absent/);
  assert.match(prompts, /live environment/);
  assert.match(prompts, /anything code-ish/);
});
