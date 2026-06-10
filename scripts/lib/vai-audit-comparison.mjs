function percentage(value) {
  return Math.round(value * 10000) / 100;
}

function flattenTurns(report) {
  const turns = new Map();

  for (const scenario of report.scenarios ?? []) {
    for (let index = 0; index < (scenario.turns ?? []).length; index += 1) {
      const turn = scenario.turns[index];
      turns.set(`${scenario.id}:${index + 1}`, {
        scenarioId: scenario.id,
        turnNumber: index + 1,
        prompt: turn.prompt,
        passed: turn.grade?.passed === true,
      });
    }
  }

  return turns;
}

function axisMap(report) {
  return new Map(
    Object.entries(report.qualityAxes ?? {}).map(([axis, score]) => [
      axis,
      {
        score: score.score,
        passed: score.passed,
        checks: score.checks,
      },
    ]),
  );
}

export function compareConversationAuditReports(baseline, candidate) {
  if (baseline.seed !== candidate.seed) {
    throw new Error(
      `Audit seeds differ: ${String(baseline.seed)} vs ${String(candidate.seed)}`,
    );
  }

  const beforeTurns = flattenTurns(baseline);
  const afterTurns = flattenTurns(candidate);
  const allKeys = new Set([...beforeTurns.keys(), ...afterTurns.keys()]);
  const transitions = [];

  for (const key of allKeys) {
    const before = beforeTurns.get(key);
    const after = afterTurns.get(key);

    if (!before || !after) {
      throw new Error(`Audit turn set differs at ${key}`);
    }

    if (before.prompt !== after.prompt) {
      throw new Error(`Audit prompt differs at ${key}`);
    }

    transitions.push({
      key,
      scenarioId: before.scenarioId,
      turnNumber: before.turnNumber,
      prompt: before.prompt,
      beforePassed: before.passed,
      afterPassed: after.passed,
      outcome:
        before.passed === after.passed
          ? 'unchanged'
          : after.passed
            ? 'improved'
            : 'regressed',
    });
  }

  const total = transitions.length;
  const beforePassed = transitions.filter((turn) => turn.beforePassed).length;
  const afterPassed = transitions.filter((turn) => turn.afterPassed).length;
  const beforeAxes = axisMap(baseline);
  const afterAxes = axisMap(candidate);
  const axes = [...new Set([...beforeAxes.keys(), ...afterAxes.keys()])].map(
    (axis) => {
      const before = beforeAxes.get(axis);
      const after = afterAxes.get(axis);

      if (!before || !after) {
        throw new Error(`Audit quality axes differ at ${axis}`);
      }

      return {
        axis,
        beforeScore: before.score,
        afterScore: after.score,
        delta: after.score - before.score,
        beforePassed: before.passed,
        afterPassed: after.passed,
        checks: after.checks,
      };
    },
  );

  return {
    seed: baseline.seed,
    total,
    beforePassed,
    afterPassed,
    beforePassRate: total === 0 ? 0 : beforePassed / total,
    afterPassRate: total === 0 ? 0 : afterPassed / total,
    passRateDelta:
      total === 0 ? 0 : (afterPassed - beforePassed) / total,
    improved: transitions.filter((turn) => turn.outcome === 'improved'),
    regressed: transitions.filter((turn) => turn.outcome === 'regressed'),
    unchanged: transitions.filter((turn) => turn.outcome === 'unchanged'),
    axes,
    transitions,
  };
}

export function renderConversationAuditComparisonMarkdown(comparison) {
  const lines = [
    '# Conversation Audit Comparison',
    '',
    `- Seed: \`${comparison.seed}\``,
    `- Baseline: ${comparison.beforePassed}/${comparison.total} (${percentage(comparison.beforePassRate)}%)`,
    `- Candidate: ${comparison.afterPassed}/${comparison.total} (${percentage(comparison.afterPassRate)}%)`,
    `- Delta: ${comparison.afterPassed - comparison.beforePassed} turns (${percentage(comparison.passRateDelta)} percentage points)`,
    `- Improved: ${comparison.improved.length}`,
    `- Regressed: ${comparison.regressed.length}`,
    '',
    '## Quality Axes',
    '',
    '| Axis | Baseline | Candidate | Delta |',
    '| --- | ---: | ---: | ---: |',
    ...comparison.axes.map(
      (axis) =>
        `| ${axis.axis} | ${percentage(axis.beforeScore)}% | ${percentage(axis.afterScore)}% | ${percentage(axis.delta)} pp |`,
    ),
    '',
    '## Turn Changes',
    '',
    '| Scenario | Turn | Outcome | Prompt |',
    '| --- | ---: | --- | --- |',
    ...comparison.transitions.map(
      (turn) =>
        `| ${turn.scenarioId} | ${turn.turnNumber} | ${turn.outcome} | ${String(turn.prompt).replaceAll('|', '\\|')} |`,
    ),
    '',
  ];

  return lines.join('\n');
}
