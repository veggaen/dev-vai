/**
 * Deterministic scoring and reporting for the Codex-vs-Vai competition.
 *
 * The scorer never receives contestant identity as an input. Rubrics are
 * explicit and inspectable; contestant ids are attached only after scoring.
 */

function normalize(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').trim();
}

function normalizedExact(text) {
  return normalize(text).replace(/\s+/g, ' ').toLowerCase();
}

function wordCount(text) {
  return normalize(text).split(/\s+/).filter(Boolean).length;
}

function patternLabel(pattern) {
  if (pattern instanceof RegExp) return `/${pattern.source}/${pattern.flags}`;
  return JSON.stringify(pattern);
}

function matches(text, pattern) {
  if (pattern instanceof RegExp) {
    pattern.lastIndex = 0;
    return pattern.test(text);
  }
  return text.toLowerCase().includes(String(pattern).toLowerCase());
}

function structuralEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => structuralEqual(value, right[index]));
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index] && structuralEqual(left[key], right[key]));
  }
  return false;
}

function scoreCriterion(answer, criterion) {
  const text = normalize(answer);
  switch (criterion.kind) {
    case 'match': {
      const patterns = criterion.any ?? [criterion.pattern];
      const passed = patterns.some((pattern) => matches(text, pattern));
      return {
        passed,
        detail: passed
          ? `matched ${patterns.map(patternLabel).join(' OR ')}`
          : `missing ${patterns.map(patternLabel).join(' OR ')}`,
      };
    }
    case 'avoid': {
      const patterns = criterion.any ?? [criterion.pattern];
      const found = patterns.find((pattern) => matches(text, pattern));
      return {
        passed: !found,
        detail: found ? `forbidden ${patternLabel(found)}` : 'no forbidden pattern',
      };
    }
    case 'exact': {
      const passed = normalizedExact(text) === normalizedExact(criterion.value);
      return { passed, detail: passed ? 'exact match' : `expected exactly ${JSON.stringify(criterion.value)}` };
    }
    case 'minWords': {
      const actual = wordCount(text);
      return { passed: actual >= criterion.value, detail: `${actual} words; minimum ${criterion.value}` };
    }
    case 'maxWords': {
      const actual = wordCount(text);
      return { passed: actual <= criterion.value, detail: `${actual} words; maximum ${criterion.value}` };
    }
    case 'json': {
      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { passed: false, detail: 'JSON contract requires a top-level object' };
        }
        const missing = (criterion.requiredKeys ?? []).filter((key) => !(key in parsed));
        const wrong = Object.entries(criterion.exactValues ?? {})
          .filter(([key, value]) => !structuralEqual(parsed[key], value))
          .map(([key]) => key);
        const extra = criterion.exactKeys
          ? Object.keys(parsed).filter((key) => !(criterion.requiredKeys ?? []).includes(key))
          : [];
        const passed = missing.length === 0 && wrong.length === 0 && extra.length === 0;
        return {
          passed,
          detail: passed
            ? 'valid JSON contract'
            : `JSON contract failed: missing=${missing.join(',') || 'none'} wrong=${wrong.join(',') || 'none'} extra=${extra.join(',') || 'none'}`,
        };
      } catch {
        return { passed: false, detail: 'not parseable JSON-only output' };
      }
    }
    default:
      return { passed: false, detail: `unknown criterion kind ${criterion.kind}` };
  }
}

export function scoreAnswer(answer, rubric) {
  const checks = (rubric.criteria ?? []).map((criterion) => {
    const result = scoreCriterion(answer, criterion);
    return {
      id: criterion.id,
      weight: criterion.weight ?? 1,
      critical: criterion.critical ?? false,
      ...result,
    };
  });
  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const earned = checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0);
  const score = totalWeight > 0 ? Number((earned / totalWeight).toFixed(3)) : 0;
  const criticalFailures = checks.filter((check) => check.critical && !check.passed);
  const passed = score >= (rubric.threshold ?? 0.75) && criticalFailures.length === 0;
  return {
    score,
    passed,
    checks,
    failedChecks: checks.filter((check) => !check.passed).map((check) => check.id),
    criticalFailures: criticalFailures.map((check) => check.id),
  };
}

export function scoreScenario(scenario, answers) {
  const turns = scenario.turns.map((turn, index) => ({
    turn: index + 1,
    prompt: turn.prompt,
    answer: answers[index] ?? '',
    ...scoreAnswer(answers[index] ?? '', turn.rubric),
  }));
  const score = turns.length
    ? Number((turns.reduce((sum, turn) => sum + turn.score, 0) / turns.length).toFixed(3))
    : 0;
  return {
    scenarioId: scenario.id,
    split: scenario.split,
    tier: scenario.tier,
    category: scenario.category,
    subjective: Boolean(scenario.subjective),
    passed: turns.every((turn) => turn.passed),
    score,
    turns,
  };
}

function summarizeContestant(rows) {
  const score = rows.length
    ? Number((rows.reduce((sum, row) => sum + row.score, 0) / rows.length).toFixed(3))
    : 0;
  return {
    scenarios: rows.length,
    passed: rows.filter((row) => row.passed).length,
    failed: rows.filter((row) => !row.passed).length,
    score,
  };
}

function groupAverage(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const label = row[key];
    const list = groups.get(label) ?? [];
    list.push(row.score);
    groups.set(label, list);
  }
  return Object.fromEntries([...groups.entries()].map(([label, scores]) => [
    label,
    Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(3)),
  ]));
}

export function runScorerControls() {
  const rubric = {
    threshold: 1,
    criteria: [{ id: 'capital', kind: 'exact', value: 'Oslo', critical: true }],
  };
  const correctA = scoreAnswer('Oslo', rubric);
  const correctB = scoreAnswer('Oslo', rubric);
  const wrongA = scoreAnswer('Bergen', rubric);
  const wrongB = scoreAnswer('Bergen', rubric);
  return {
    passed:
      correctA.score === correctB.score
      && wrongA.score === wrongB.score
      && correctA.score > wrongA.score,
    labelSwapInvariant: correctA.score === correctB.score && wrongA.score === wrongB.score,
    correctScore: correctA.score,
    wrongScore: wrongA.score,
  };
}

export function buildCompetitionReport({ suiteId, split, codexRows, vaiRows, metadata = {} }) {
  const byVai = new Map(vaiRows.map((row) => [row.scenarioId, row]));
  const comparisons = codexRows.map((codex) => {
    const vai = byVai.get(codex.scenarioId);
    const delta = Number((codex.score - (vai?.score ?? 0)).toFixed(3));
    return {
      scenarioId: codex.scenarioId,
      category: codex.category,
      tier: codex.tier,
      subjective: codex.subjective,
      codexScore: codex.score,
      vaiScore: vai?.score ?? 0,
      delta,
      winner: Math.abs(delta) <= 0.03 ? 'tie' : delta > 0 ? 'codex' : 'vai',
    };
  });
  const categoryGaps = new Map();
  for (const row of comparisons) {
    const values = categoryGaps.get(row.category) ?? [];
    values.push(row.delta);
    categoryGaps.set(row.category, values);
  }
  const gapRanking = [...categoryGaps.entries()]
    .map(([category, values]) => ({
      category,
      avgCodexLead: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)),
      scenarios: values.length,
    }))
    .sort((a, b) => b.avgCodexLead - a.avgCodexLead || a.category.localeCompare(b.category));
  const failureCounts = new Map();
  for (const row of vaiRows) {
    for (const turn of row.turns) {
      for (const failed of turn.failedChecks) {
        failureCounts.set(failed, (failureCounts.get(failed) ?? 0) + 1);
      }
    }
  }
  const controls = runScorerControls();
  return {
    schemaVersion: 1,
    suiteId,
    split,
    generatedAt: new Date().toISOString(),
    methodology: {
      vai: 'current-source vai:v0 in deterministic test mode; no Council or response model',
      codex: 'principal-engineer authored reference answers, frozen before Vai execution',
      scoring: 'identity-blind explicit rubrics; no contestant id is passed to scoreAnswer()',
      controls,
    },
    metadata,
    summary: {
      codex: summarizeContestant(codexRows),
      vai: summarizeContestant(vaiRows),
      byCategory: {
        codex: groupAverage(codexRows, 'category'),
        vai: groupAverage(vaiRows, 'category'),
      },
      headToHead: {
        codexWins: comparisons.filter((row) => row.winner === 'codex').length,
        vaiWins: comparisons.filter((row) => row.winner === 'vai').length,
        ties: comparisons.filter((row) => row.winner === 'tie').length,
      },
    },
    diagnosis: {
      largestGap: gapRanking[0] ?? null,
      categoryGaps: gapRanking,
      failureCounts: [...failureCounts.entries()]
        .map(([criterion, count]) => ({ criterion, count }))
        .sort((a, b) => b.count - a.count || a.criterion.localeCompare(b.criterion)),
      weakestVaiScenarios: [...vaiRows]
        .sort((a, b) => a.score - b.score || a.scenarioId.localeCompare(b.scenarioId))
        .slice(0, 5)
        .map((row) => ({ scenarioId: row.scenarioId, score: row.score, failedTurns: row.turns.filter((turn) => !turn.passed).length })),
    },
    comparisons,
    contestants: { codex: codexRows, vai: vaiRows },
  };
}

export function renderCompetitionMarkdown(report) {
  const lines = [
    `# Vai competition: ${report.suiteId} (${report.split})`,
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `- Codex: ${(report.summary.codex.score * 100).toFixed(1)}% (${report.summary.codex.passed}/${report.summary.codex.scenarios} passed)`,
    `- Vai: ${(report.summary.vai.score * 100).toFixed(1)}% (${report.summary.vai.passed}/${report.summary.vai.scenarios} passed)`,
    `- Head-to-head: Codex ${report.summary.headToHead.codexWins}, Vai ${report.summary.headToHead.vaiWins}, ties ${report.summary.headToHead.ties}`,
    `- Scorer controls: ${report.methodology.controls.passed ? 'PASS' : 'FAIL'}`,
    '',
    '## Largest measured gap',
    '',
    report.diagnosis.largestGap
      ? `${report.diagnosis.largestGap.category}: Codex lead ${(report.diagnosis.largestGap.avgCodexLead * 100).toFixed(1)} points across ${report.diagnosis.largestGap.scenarios} scenario(s).`
      : 'No scenarios.',
    '',
    '## Scenario results',
    '',
    '| Scenario | Tier | Category | Codex | Vai | Winner |',
    '|---|---|---|---:|---:|---|',
    ...report.comparisons.map((row) => `| ${row.scenarioId} | ${row.tier} | ${row.category} | ${(row.codexScore * 100).toFixed(0)} | ${(row.vaiScore * 100).toFixed(0)} | ${row.winner} |`),
    '',
    '## Category scores',
    '',
    '| Category | Codex | Vai | Delta |',
    '|---|---:|---:|---:|',
    ...Object.keys(report.summary.byCategory.codex).sort().map((category) => {
      const codex = report.summary.byCategory.codex[category] ?? 0;
      const vai = report.summary.byCategory.vai[category] ?? 0;
      return `| ${category} | ${(codex * 100).toFixed(1)} | ${(vai * 100).toFixed(1)} | ${((vai - codex) * 100).toFixed(1)} |`;
    }),
    '',
    '## Weakest Vai scenarios',
    '',
    ...report.diagnosis.weakestVaiScenarios.map((row) => `- ${row.scenarioId}: ${(row.score * 100).toFixed(1)}%, ${row.failedTurns} failed turn(s)`),
    '',
    'Council review, when used, receives anonymized answers only and is advisory; it cannot override deterministic rubric failures.',
  ];
  return `${lines.join('\n')}\n`;
}
