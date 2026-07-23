import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompetitionReport,
  runScorerControls,
  scoreAnswer,
  scoreScenario,
} from './vai-competition-core.mjs';

test('scoreAnswer enforces exact and critical constraints without contestant identity', () => {
  const rubric = {
    threshold: 0.5,
    criteria: [
      { id: 'answer', kind: 'exact', value: 'Oslo', critical: true },
      { id: 'brief', kind: 'maxWords', value: 1 },
    ],
  };
  assert.deepEqual(scoreAnswer('Oslo', rubric).failedChecks, []);
  const wrong = scoreAnswer('Oslo is the answer', rubric);
  assert.equal(wrong.passed, false);
  assert.deepEqual(wrong.criticalFailures, ['answer']);
});

test('scoreAnswer validates JSON-only contracts', () => {
  const rubric = {
    criteria: [{
      id: 'json', kind: 'json', requiredKeys: ['risk', 'action'],
      exactValues: { risk: 'high', action: 'rollback' }, critical: true,
    }],
  };
  assert.equal(scoreAnswer('{"risk":"high","action":"rollback"}', rubric).passed, true);
  assert.equal(scoreAnswer('```json\n{"risk":"high","action":"rollback"}\n```', rubric).passed, false);
});

test('scoreAnswer compares structured JSON values and can reject extra keys', () => {
  const rubric = {
    threshold: 1,
    criteria: [{
      id: 'structured-json',
      kind: 'json',
      requiredKeys: ['order', 'cost'],
      exactKeys: true,
      exactValues: { order: ['C', 'B', 'D', 'A'], cost: { minutes: 12 } },
      critical: true,
    }],
  };
  assert.equal(scoreAnswer('{"cost":{"minutes":12},"order":["C","B","D","A"]}', rubric).passed, true);
  assert.equal(scoreAnswer('{"order":["C","B","D","A"],"cost":{"minutes":12},"note":"extra"}', rubric).passed, false);
  assert.equal(scoreAnswer('{"order":["C","D","B","A"],"cost":{"minutes":12}}', rubric).passed, false);
});

test('scoreScenario averages turns while requiring every turn to pass', () => {
  const scenario = {
    id: 'multi', split: 'visible', tier: 'advanced', category: 'dialogue',
    turns: [
      { prompt: 'one', rubric: { criteria: [{ id: 'a', kind: 'match', pattern: /alpha/i }] } },
      { prompt: 'two', rubric: { criteria: [{ id: 'b', kind: 'match', pattern: /beta/i }] } },
    ],
  };
  const result = scoreScenario(scenario, ['alpha', 'wrong']);
  assert.equal(result.score, 0.5);
  assert.equal(result.passed, false);
});

test('scorer controls prove label/order invariance', () => {
  assert.deepEqual(runScorerControls(), {
    passed: true,
    labelSwapInvariant: true,
    correctScore: 1,
    wrongScore: 0,
  });
});

test('report identifies the largest measured category gap', () => {
  const row = (scenarioId, category, score) => ({
    scenarioId, split: 'visible', tier: 'simple', category, subjective: false,
    passed: score === 1, score, turns: [],
  });
  const report = buildCompetitionReport({
    suiteId: 'test', split: 'visible',
    codexRows: [row('a', 'fact', 1), row('b', 'dialogue', 1)],
    vaiRows: [row('a', 'fact', 0.8), row('b', 'dialogue', 0.2)],
  });
  assert.equal(report.diagnosis.largestGap.category, 'dialogue');
  assert.equal(report.methodology.controls.passed, true);
  assert.equal(report.summary.byCategory.codex.fact, 1);
  assert.equal(report.summary.byCategory.vai.dialogue, 0.2);
});
