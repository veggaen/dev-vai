import test from 'node:test';
import assert from 'node:assert/strict';
import { buildV3CompetitionReport, renderV3CompetitionMarkdown } from './vai-competition-v3-core.mjs';

const turn = (passed, score = passed ? 1 : 0) => ({ passed, score, failedChecks: passed ? [] : ['answer'] });
const row = ({ id, passed, score, capability, expectedRoute, strategy, confidence, split = 'dev', group = 'g' }) => ({
  scenarioId: id,
  split,
  tier: 'hard',
  category: capability,
  capability,
  subjective: false,
  passed,
  score,
  metamorphicGroup: group,
  requiredRepresentations: [capability],
  turns: [turn(passed, score)],
  turnTelemetry: [{
    expectedRoute,
    strategy,
    boundedActivated: strategy.startsWith('bounded-reasoning:'),
    confidence,
    wallTimeMs: id === 'a' ? 10 : 40,
  }],
});

test('v3 report separates answer score, route coverage, abstention precision, and calibration', () => {
  const referenceRows = [
    row({ id: 'a', passed: true, score: 1, capability: 'logic', expectedRoute: 'bounded', strategy: 'reference', confidence: 1 }),
    row({ id: 'b', passed: true, score: 1, capability: 'control', expectedRoute: 'abstain', strategy: 'reference', confidence: 1 }),
  ];
  const vaiRows = [
    row({ id: 'a', passed: true, score: 1, capability: 'logic', expectedRoute: 'bounded', strategy: 'bounded-reasoning:logic', confidence: 0.9 }),
    row({ id: 'b', passed: false, score: 0, capability: 'control', expectedRoute: 'abstain', strategy: 'bounded-reasoning:false-positive', confidence: 0.8 }),
  ];
  const report = buildV3CompetitionReport({ suiteId: 'v3-test', split: 'all', referenceRows, vaiRows });
  assert.equal(report.schemaVersion, 3);
  assert.equal(report.diagnosticsV3.route.boundedCoverage, 1);
  assert.equal(report.diagnosticsV3.route.falseActivationRate, 1);
  assert.equal(report.diagnosticsV3.route.boundedPrecision, 0.5);
  assert.equal(report.diagnosticsV3.calibration.brier, 0.325);
  assert.equal(report.diagnosticsV3.latencyMs.p50, 10);
  assert.equal(report.diagnosticsV3.metamorphicGroups[0].allPassed, false);
  assert.match(renderV3CompetitionMarkdown(report), /False bounded activation.*100\.0%/i);
});
