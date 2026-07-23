import { buildCompetitionReport, renderCompetitionMarkdown } from './vai-competition-core.mjs';

const rounded = (value, digits = 3) => Number(value.toFixed(digits));
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(fraction * ordered.length) - 1));
  return ordered[index];
}

function groupedDiagnostics(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const label = row[key] ?? 'unclassified';
    const group = groups.get(label) ?? [];
    group.push(row);
    groups.set(label, group);
  }
  return Object.fromEntries([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([label, group]) => {
    const telemetry = group.flatMap((row) => row.turnTelemetry ?? []);
    const expectedBounded = telemetry.filter((turn) => turn.expectedRoute === 'bounded');
    return [label, {
      scenarios: group.length,
      passRate: rounded(group.filter((row) => row.passed).length / group.length),
      score: rounded(average(group.map((row) => row.score))),
      boundedCoverage: expectedBounded.length
        ? rounded(expectedBounded.filter((turn) => turn.boundedActivated).length / expectedBounded.length)
        : null,
    }];
  }));
}

function calibrationDiagnostics(turns) {
  const calibrated = turns.filter((turn) => Number.isFinite(turn.confidence));
  if (calibrated.length === 0) return {
    samples: 0, brier: null, expectedCalibrationError: null, overconfidentErrorRate: null,
  };
  const brier = average(calibrated.map((turn) => (turn.confidence - Number(turn.passed)) ** 2));
  const bins = Array.from({ length: 5 }, (_, index) => {
    const lower = index * 0.2;
    const upper = index === 4 ? 1.000001 : (index + 1) * 0.2;
    const values = calibrated.filter((turn) => turn.confidence >= lower && turn.confidence < upper);
    return {
      samples: values.length,
      confidence: values.length ? average(values.map((turn) => turn.confidence)) : 0,
      accuracy: values.length ? average(values.map((turn) => Number(turn.passed))) : 0,
    };
  });
  const expectedCalibrationError = bins.reduce(
    (sum, bin) => sum + (bin.samples / calibrated.length) * Math.abs(bin.confidence - bin.accuracy),
    0,
  );
  const highConfidence = calibrated.filter((turn) => turn.confidence >= 0.8);
  return {
    samples: calibrated.length,
    brier: rounded(brier),
    expectedCalibrationError: rounded(expectedCalibrationError),
    overconfidentErrorRate: highConfidence.length
      ? rounded(highConfidence.filter((turn) => !turn.passed).length / highConfidence.length)
      : null,
    bins: bins.map((bin, index) => ({
      range: `${(index * 0.2).toFixed(1)}-${((index + 1) * 0.2).toFixed(1)}`,
      samples: bin.samples,
      confidence: rounded(bin.confidence),
      accuracy: rounded(bin.accuracy),
    })),
  };
}

function metamorphicDiagnostics(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!row.metamorphicGroup) continue;
    const group = groups.get(row.metamorphicGroup) ?? [];
    group.push(row);
    groups.set(row.metamorphicGroup, group);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([group, members]) => {
    const scores = members.map((row) => row.score);
    return {
      group,
      scenarios: members.map((row) => row.scenarioId),
      allPassed: members.every((row) => row.passed),
      meanScore: rounded(average(scores)),
      scoreRange: rounded(Math.max(...scores) - Math.min(...scores)),
    };
  });
}

export function buildV3CompetitionReport({ suiteId, split, referenceRows, vaiRows, metadata = {} }) {
  const base = buildCompetitionReport({
    suiteId,
    split,
    codexRows: referenceRows,
    vaiRows,
    metadata,
  });
  const turns = vaiRows.flatMap((row) => (row.turnTelemetry ?? []).map((telemetry, index) => ({
    ...telemetry,
    passed: row.turns[index]?.passed ?? false,
    scenarioId: row.scenarioId,
    capability: row.capability,
  })));
  const expectedBounded = turns.filter((turn) => turn.expectedRoute === 'bounded');
  const expectedAbstain = turns.filter((turn) => turn.expectedRoute === 'abstain');
  const boundedTurns = turns.filter((turn) => turn.boundedActivated);
  const latencies = turns.map((turn) => turn.wallTimeMs).filter(Number.isFinite);
  const failedRepresentations = new Map();
  for (const row of vaiRows.filter((candidate) => !candidate.passed)) {
    for (const representation of row.requiredRepresentations ?? []) {
      failedRepresentations.set(representation, (failedRepresentations.get(representation) ?? 0) + 1);
    }
  }
  return {
    ...base,
    schemaVersion: 3,
    summary: { ...base.summary, reference: base.summary.codex },
    methodology: {
      ...base.methodology,
      reference: 'typed oracle outputs validated before exposure; this is not an independently executed Codex contestant',
      codex: 'legacy compatibility field only; v3 reports label this contestant oracle/reference',
      routeScoring: 'bounded-reasoning activation is measured independently from answer correctness',
      calibration: 'Brier score and five-bin expected calibration error use Vai-reported confidence',
      abstention: 'negative controls expect no bounded-reasoning activation; fallback text cannot hide a route false positive',
    },
    diagnosticsV3: {
      byCapability: groupedDiagnostics(vaiRows, 'capability'),
      byDifficulty: groupedDiagnostics(vaiRows, 'tier'),
      bySplit: groupedDiagnostics(vaiRows, 'split'),
      route: {
        supportedTurns: expectedBounded.length,
        boundedCoverage: expectedBounded.length
          ? rounded(expectedBounded.filter((turn) => turn.boundedActivated).length / expectedBounded.length)
          : null,
        abstentionControls: expectedAbstain.length,
        falseActivationRate: expectedAbstain.length
          ? rounded(expectedAbstain.filter((turn) => turn.boundedActivated).length / expectedAbstain.length)
          : null,
        boundedPrecision: boundedTurns.length
          ? rounded(boundedTurns.filter((turn) => turn.passed).length / boundedTurns.length)
          : null,
      },
      calibration: calibrationDiagnostics(turns),
      latencyMs: {
        samples: latencies.length,
        mean: rounded(average(latencies), 1),
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        max: latencies.length ? Math.max(...latencies) : 0,
      },
      metamorphicGroups: metamorphicDiagnostics(vaiRows),
      failedRepresentations: [...failedRepresentations.entries()]
        .map(([representation, failures]) => ({ representation, failures }))
        .sort((left, right) => right.failures - left.failures || left.representation.localeCompare(right.representation)),
    },
  };
}

export function renderV3CompetitionMarkdown(report) {
  const route = report.diagnosticsV3.route;
  const calibration = report.diagnosticsV3.calibration;
  const latency = report.diagnosticsV3.latencyMs;
  const lines = [
    renderCompetitionMarkdown(report)
      .replace(/- Codex:/g, '- Oracle/reference:')
      .replace(/Head-to-head: Codex/g, 'Head-to-head: reference')
      .replace(/\| Scenario \| Tier \| Category \| Codex \|/g, '| Scenario | Tier | Category | Reference |')
      .replace(/\| Category \| Codex \|/g, '| Category | Reference |')
      .replace(/Codex lead/g, 'Reference lead')
      .trimEnd(),
    '',
    '## V3 route and reliability diagnostics',
    '',
    `- Bounded coverage on supported turns: ${route.boundedCoverage == null ? 'n/a' : `${(route.boundedCoverage * 100).toFixed(1)}%`} (${route.supportedTurns} turns)`,
    `- False bounded activation on abstention controls: ${route.falseActivationRate == null ? 'n/a' : `${(route.falseActivationRate * 100).toFixed(1)}%`} (${route.abstentionControls} controls)`,
    `- Precision when bounded reasoning activates: ${route.boundedPrecision == null ? 'n/a' : `${(route.boundedPrecision * 100).toFixed(1)}%`}`,
    `- Confidence calibration: Brier ${calibration.brier ?? 'n/a'}, ECE ${calibration.expectedCalibrationError ?? 'n/a'}, overconfident error rate ${calibration.overconfidentErrorRate == null ? 'n/a' : `${(calibration.overconfidentErrorRate * 100).toFixed(1)}%`}`,
    `- Latency: mean ${latency.mean} ms, p50 ${latency.p50} ms, p95 ${latency.p95} ms, max ${latency.max} ms`,
    '',
    '## V3 capability scores',
    '',
    '| Capability | Scenarios | Score | Pass rate | Bounded coverage |',
    '|---|---:|---:|---:|---:|',
    ...Object.entries(report.diagnosticsV3.byCapability).map(([capability, values]) => `| ${capability} | ${values.scenarios} | ${(values.score * 100).toFixed(1)} | ${(values.passRate * 100).toFixed(1)} | ${values.boundedCoverage == null ? 'n/a' : (values.boundedCoverage * 100).toFixed(1)} |`),
    '',
    '## Failed required representations',
    '',
    ...(report.diagnosticsV3.failedRepresentations.length
      ? report.diagnosticsV3.failedRepresentations.map((item) => `- ${item.representation}: ${item.failures}`)
      : ['- None']),
    '',
    '## Metamorphic consistency',
    '',
    ...(report.diagnosticsV3.metamorphicGroups.length
      ? report.diagnosticsV3.metamorphicGroups.map((group) => `- ${group.group}: ${group.allPassed ? 'PASS' : 'FAIL'}, mean ${(group.meanScore * 100).toFixed(1)}%, range ${(group.scoreRange * 100).toFixed(1)} points`)
      : ['- No groups']),
  ];
  return `${lines.join('\n')}\n`;
}
