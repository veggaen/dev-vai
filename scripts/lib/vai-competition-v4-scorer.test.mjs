import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { V4_SEALED_SCENARIOS } from './vai-competition-v4-sealed.mjs';
import { V4_MANIFEST } from './vai-competition-v4-manifest.mjs';
import { runV4ScorerAttackBank, scoreV4Answer, scoreV4Scenario } from './vai-competition-v4-scorer.mjs';

describe('v4 sealed competition integrity', () => {
  test('freezes the materialized suite before exposure', () => {
    expect(V4_SEALED_SCENARIOS).toHaveLength(60);
    expect(V4_SEALED_SCENARIOS.reduce((sum, scenario) => sum + scenario.turns.length, 0)).toBe(72);
    expect(new Set(V4_SEALED_SCENARIOS.map((scenario) => scenario.familyId)).size).toBe(20);
    expect(createHash('sha256').update(JSON.stringify(V4_SEALED_SCENARIOS)).digest('hex')).toBe(V4_MANIFEST.suiteFingerprint);
  });

  test('validates every reference before candidate execution', () => {
    const invalid = V4_SEALED_SCENARIOS.filter((scenario) => !scoreV4Scenario(scenario, scenario.turns.map((turn) => turn.referenceAnswer)).passed);
    expect(invalid).toEqual([]);
  });

  test('rejects schedule certificate attacks and accepts alternative valid witnesses', () => {
    expect(runV4ScorerAttackBank().passed).toBe(true);
    const contract = {
      kind: 'validated-schedule', capacity: 2, optimalMakespan: 4,
      tasks: [{ id: 'A', duration: 2, predecessors: [] }, { id: 'B', duration: 2, predecessors: [] }, { id: 'C', duration: 2, predecessors: ['A'] }],
    };
    expect(scoreV4Answer('{"makespan":4,"schedule":{"B":[0,2],"A":[0,2],"C":[2,4]}}', contract).passed).toBe(true);
    expect(scoreV4Answer('{"makespan":4,"schedule":{"A":[0,2],"B":[0,2],"C":[1,3]}}', contract).passed).toBe(false);
  });
});
