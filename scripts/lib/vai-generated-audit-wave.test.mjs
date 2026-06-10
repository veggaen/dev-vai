import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeneratedAuditWave, randomAuditSeed } from './vai-generated-audit-wave.mjs';
import { aggregateQualityAxes, gradeAuditTurn } from './vai-generated-audit-grader.mjs';
import {
  compareConversationAuditReports,
  renderConversationAuditComparisonMarkdown,
} from './vai-audit-comparison.mjs';

function assistant(content, strategy = 'code-gen', processTrace = [
  { stage: 'stream:start', durationMs: 0 },
  { stage: `tracked:${strategy}`, durationMs: 12 },
]) {
  return {
    content,
    thinking: {
      intent: 'other',
      strategy,
      strategyChain: [strategy],
      processTrace,
      durationMs: 14,
      confidence: 0.8,
    },
  };
}

test('generated waves are reproducible for one seed and vary across seeds', () => {
  const first = buildGeneratedAuditWave(12, 'held-out-alpha');
  const repeat = buildGeneratedAuditWave(12, 'held-out-alpha');
  const second = buildGeneratedAuditWave(12, 'held-out-beta');

  assert.deepEqual(first, repeat);
  assert.notDeepEqual(first.scenarios.map((scenario) => scenario.turns[0].prompt),
    second.scenarios.map((scenario) => scenario.turns[0].prompt));
});

test('generated waves cover all engineering families and disclose hidden rubrics after generation', () => {
  const wave = buildGeneratedAuditWave(16, 'coverage-seed');
  const prompts = wave.scenarios.flatMap((scenario) => scenario.turns.map((turn) => turn.prompt));
  const rubrics = wave.scenarios.flatMap((scenario) => scenario.turns.map((turn) => turn.rubric));

  assert.equal(wave.scenarios.length, 16);
  assert.equal(wave.generation.families, 8);
  assert.equal(new Set(prompts).size, prompts.length);
  assert.ok(rubrics.every((rubric) => rubric?.id && rubric.checks.length > 0));
});

test('generated context switches remain unique for a previously colliding held-out seed', () => {
  const wave = buildGeneratedAuditWave(16, 'generated-63fb0eab221440f9');
  const prompts = wave.scenarios.flatMap((scenario) => scenario.turns.map((turn) => turn.prompt));

  assert.equal(new Set(prompts).size, prompts.length);
});

test('random audit seeds are non-static identifiers', () => {
  const first = randomAuditSeed();
  const second = randomAuditSeed();
  assert.match(first, /^generated-[a-f0-9]{16}$/);
  assert.notEqual(first, second);
});

test('independent grader accepts a correct generated JSON contract', () => {
  const wave = buildGeneratedAuditWave(16, 'json-contract-seed');
  const scenario = wave.scenarios.find((candidate) => candidate.id.startsWith('generated-runtime-exposure'));
  assert.ok(scenario);
  const turn = scenario.turns.find((candidate) => candidate.rubric.id === 'runtime-json-contract');
  assert.ok(turn);
  const [allowKey, reasonKey, changeKey] = scenario.generated.jsonKeys;
  const reply = JSON.stringify({
    [allowKey]: false,
    [reasonKey]: 'Unsafe network exposure without credentials',
    [changeKey]: 'Bind loopback or configure authentication',
  });
  const result = gradeAuditTurn({ assistant: assistant(reply, 'json-contract'), turn });
  assert.equal(result.passed, true);
});

test('independent grader recognizes an allowed fenced language', () => {
  const turn = {
    rubric: {
      id: 'language-fence-control',
      checks: [{ type: 'code-fence-language', values: ['ts', 'typescript'] }],
    },
  };
  const result = gradeAuditTurn({
    assistant: assistant('```typescript\nconst answer: number = 42;\n```'),
    turn,
  });
  assert.equal(result.passed, true);
});

test('independent grader catches routing hijacks and generic fallback replies', () => {
  const wave = buildGeneratedAuditWave(16, 'routing-hijack-seed');
  const scenario = wave.scenarios.find((candidate) => candidate.id.startsWith('generated-constraint-memory'));
  assert.ok(scenario);
  const turn = scenario.turns[2];
  const hijacked = gradeAuditTurn({
    assistant: assistant("That isn't in my knowledge yet. One link or sentence of context and I can try again.", 'factual-curated'),
    turn,
  });
  assert.ok(hijacked.failures.includes('quality:generic-fallback'));
  assert.ok(hijacked.failures.includes('routing:forbidden-strategy:factual-curated'));
});

test('independent grader audits trace ordering and cross-conversation canary leaks', () => {
  const turn = {
    rubric: {
      id: 'trace-control',
      checks: [{ type: 'min-chars', value: 2 }],
    },
  };
  const result = gradeAuditTurn({
    assistant: assistant('Prior canary LEAK-404', 'test', [
      { stage: 'stream:start', durationMs: 5 },
      { stage: 'tracked:test', durationMs: 3 },
    ]),
    turn,
    previousCanaries: [null, '', 'LEAK-404'],
  });
  assert.ok(result.failures.includes('trace:non-monotonic-duration'));
  assert.ok(result.failures.includes('isolation:cross-conversation-leak:LEAK-404'));
});

test('independent grader can require at least one clarification question', () => {
  const turn = {
    rubric: {
      id: 'minimum-question-control',
      checks: [{ type: 'min-question-count', value: 1 }],
    },
  };
  const accepted = gradeAuditTurn({ assistant: assistant('Which version changed, and what symptom worsened?'), turn });
  const rejected = gradeAuditTurn({ assistant: assistant('Rollback immediately.'), turn });

  assert.equal(accepted.passed, true);
  assert.ok(rejected.failures.includes('contract:min-question-count:0<1'));
});

test('independent grader requires diagnosis before replacement artifacts', () => {
  const turn = {
    rubric: {
      id: 'diagnostic-first-control',
      checks: [{ type: 'diagnostic-first', axes: ['human', 'robot'] }],
    },
  };
  const accepted = gradeAuditTurn({
    assistant: assistant('Start with the browser console. Capture the first red error, then verify whether the React root mounts before changing files.'),
    turn,
  });
  const rejected = gradeAuditTurn({
    assistant: assistant('Replace it with:\n```json title="package.json"\n{}\n```\n```js title="webpack.config.js"\nmodule.exports = {};\n```'),
    turn,
  });

  assert.equal(accepted.passed, true);
  assert.ok(rejected.failures.includes('quality:diagnosis-replaced-existing-project'));
  assert.equal(rejected.metrics.qualityAxes.human.score, 0);
  assert.equal(rejected.metrics.qualityAxes.robot.score, 0.5);
});

test('quality axis aggregation exposes weighted scores and recurring failures', () => {
  const turn = {
    rubric: {
      id: 'diagnostic-first-control',
      checks: [{ type: 'diagnostic-first', axes: ['human', 'robot'] }],
    },
  };
  const accepted = gradeAuditTurn({
    assistant: assistant('Start with the browser console. Capture the first red error, then verify whether the React root mounts.'),
    turn,
  });
  const rejected = gradeAuditTurn({
    assistant: assistant('Replace the project with:\n```js\nconsole.log("new app");\n```'),
    turn,
  });
  const axes = aggregateQualityAxes([accepted, rejected]);

  assert.deepEqual(
    {
      checks: axes.human.checks,
      passed: axes.human.passed,
      failed: axes.human.failed,
      turnsScored: axes.human.turnsScored,
      perfectTurns: axes.human.perfectTurns,
    },
    { checks: 2, passed: 1, failed: 1, turnsScored: 2, perfectTurns: 1 },
  );
  assert.equal(axes.human.score, 0.5);
  assert.deepEqual(axes.human.failures, [
    { failure: 'quality:diagnosis-replaced-existing-project', count: 1 },
  ]);
  assert.equal(axes.ai.score, null);
  assert.equal(axes.robot.score, 0.75);
});

test('audit comparison measures same-seed improvements', () => {
  const baseline = {
    seed: 'fixed-seed',
    scenarios: [{
      id: 'scenario',
      turns: [{ prompt: 'Help me', grade: { passed: false } }],
    }],
    qualityAxes: {
      human: { score: 0.5, passed: 1, checks: 2 },
    },
  };
  const candidate = {
    seed: 'fixed-seed',
    scenarios: [{
      id: 'scenario',
      turns: [{ prompt: 'Help me', grade: { passed: true } }],
    }],
    qualityAxes: {
      human: { score: 1, passed: 2, checks: 2 },
    },
  };

  const comparison = compareConversationAuditReports(baseline, candidate);

  assert.equal(comparison.beforePassed, 0);
  assert.equal(comparison.afterPassed, 1);
  assert.equal(comparison.improved.length, 1);
  assert.equal(comparison.regressed.length, 0);
  assert.equal(comparison.axes[0].delta, 0.5);
  assert.match(
    renderConversationAuditComparisonMarkdown(comparison),
    /Candidate: 1\/1 \(100%\)/,
  );
});

test('audit comparison rejects mismatched seeds', () => {
  assert.throws(
    () =>
      compareConversationAuditReports(
        { seed: 'before', scenarios: [], qualityAxes: {} },
        { seed: 'after', scenarios: [], qualityAxes: {} },
      ),
    /Audit seeds differ/,
  );
});
