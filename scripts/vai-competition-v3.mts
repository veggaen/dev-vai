#!/usr/bin/env node
/** Scaled, manifest-enforced v3 Vai reasoning competition. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { VaiEngine } from '../packages/core/src/models/vai-engine.js';
import { V3_SOUNDNESS_SCENARIOS } from './lib/vai-competition-v3-soundness.mjs';
import { V3_FRONTIER_SCENARIOS } from './lib/vai-competition-v3-frontier.mjs';
import { V3_FRESH_SCENARIOS } from './lib/vai-competition-v3-fresh.mjs';
import { V3_MANIFEST } from './lib/vai-competition-v3-manifest.mjs';
import { buildV3CompetitionReport, renderV3CompetitionMarkdown } from './lib/vai-competition-v3-core.mjs';
import { runV3ScorerAttackBank, scoreV3Scenario } from './lib/vai-competition-v3-scorer.mjs';

type Scenario = typeof V3_SOUNDNESS_SCENARIOS[number] | typeof V3_FRONTIER_SCENARIOS[number] | typeof V3_FRESH_SCENARIOS[number];
type TurnTelemetry = {
  expectedRoute: 'bounded' | 'abstain';
  strategy: string;
  boundedActivated: boolean;
  confidence: number | null;
  wallTimeMs: number;
  timedOut: boolean;
};

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const stableFingerprint = (value: unknown) => sha256(JSON.stringify(value));

function fileFingerprint(file: string): string {
  return sha256(readFileSync(path.resolve(file)));
}

function candidateFingerprint(): string {
  const files = [
    'packages/core/src/reasoning/bounded-reasoning.ts',
    'packages/core/src/reasoning/advanced-reasoning.ts',
    'packages/core/src/reasoning/mini-js-reasoning.ts',
    'packages/core/src/reasoning/planning-reasoning.ts',
    'packages/core/src/models/vai-engine.ts',
    'packages/core/src/chat/service.ts',
  ];
  return sha256(files.map((file) => `${file}\0${fileFingerprint(file)}`).join('\0'));
}

function parseArgs(argv: string[]) {
  let orders = 3;
  let pack: 'soundness' | 'frontier' | 'fresh' | 'all' = 'soundness';
  let out: string | null = null;
  let timeoutMs = 5_000;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--orders') {
      orders = Number(argv[++index]);
      if (![1, 3].includes(orders)) throw new Error('--orders must be 1 or 3');
    } else if (arg === '--pack') {
      const value = argv[++index];
      if (value !== 'soundness' && value !== 'frontier' && value !== 'fresh' && value !== 'all') throw new Error('--pack must be soundness, frontier, fresh, or all');
      pack = value;
    } else if (arg === '--timeout-ms') {
      timeoutMs = Number(argv[++index]);
      if (!Number.isFinite(timeoutMs) || timeoutMs < 100) throw new Error('--timeout-ms must be at least 100');
    } else if (arg === '--out') {
      out = argv[++index] ?? null;
      if (!out) throw new Error('--out requires a path');
    } else if (arg === '--help') {
      console.log('Usage: node --import tsx scripts/vai-competition-v3.mts [--pack soundness|frontier|fresh|all] [--orders 1|3] [--timeout-ms 5000] [--out append-only-report.json]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { orders, out, timeoutMs, pack };
}

function verifyManifest(scenarios: readonly Scenario[], pack: 'soundness' | 'frontier' | 'fresh' | 'all') {
  const expected = V3_MANIFEST.packs[pack];
  const actual = {
    scenarioCount: scenarios.length,
    turnCount: scenarios.reduce((sum, scenario) => sum + scenario.turns.length, 0),
    familyCount: new Set(scenarios.map((scenario) => scenario.familyId)).size,
    suiteFingerprint: stableFingerprint(scenarios),
    scorerFingerprint: fileFingerprint('scripts/lib/vai-competition-v3-scorer.mjs'),
    reportCoreFingerprint: fileFingerprint('scripts/lib/vai-competition-v3-core.mjs'),
  };
  const failures = Object.entries(actual)
    .filter(([key, value]) => value !== (key === 'scorerFingerprint' || key === 'reportCoreFingerprint'
      ? V3_MANIFEST[key as 'scorerFingerprint' | 'reportCoreFingerprint']
      : expected[key as keyof typeof expected]))
    .map(([key, value]) => `${key}: expected=${key === 'scorerFingerprint' || key === 'reportCoreFingerprint'
      ? V3_MANIFEST[key as 'scorerFingerprint' | 'reportCoreFingerprint']
      : expected[key as keyof typeof expected]} actual=${value}`);
  if (failures.length) throw new Error(`V3 manifest mismatch; frozen evidence is invalid:\n${failures.join('\n')}`);
  return actual;
}

function orderScenarios(scenarios: readonly Scenario[], orderIndex: number): Scenario[] {
  if (orderIndex === 0) return [...scenarios];
  if (orderIndex === 1) return [...scenarios].reverse();
  return [...scenarios].sort((left, right) => sha256(left.id).localeCompare(sha256(right.id)));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  const result = await Promise.race([promise.then((value) => ({ timedOut: false as const, value })), timeout]);
  if (timer) clearTimeout(timer);
  return result;
}

async function runScenario(scenario: Scenario, timeoutMs: number): Promise<{ answers: string[]; telemetry: TurnTelemetry[] }> {
  const engine = new VaiEngine({ testMode: true });
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const answers: string[] = [];
  const telemetry: TurnTelemetry[] = [];
  for (const turn of scenario.turns) {
    const startedAt = performance.now();
    const response = await withTimeout(engine.chat({ messages: [...history, { role: 'user', content: turn.prompt }], noLearn: true }), timeoutMs);
    const meta = (engine as unknown as { lastResponseMeta?: { strategy?: string; confidence?: number } }).lastResponseMeta;
    const answer = response.timedOut ? '' : (response.value.message.content ?? '');
    const strategy = response.timedOut ? 'timeout' : (meta?.strategy ?? 'unknown');
    answers.push(answer);
    telemetry.push({
      expectedRoute: turn.expectedRoute as 'bounded' | 'abstain',
      strategy,
      boundedActivated: strategy.startsWith('bounded-reasoning:'),
      confidence: typeof meta?.confidence === 'number' ? meta.confidence : null,
      wallTimeMs: Math.round(performance.now() - startedAt),
      timedOut: response.timedOut,
    });
    history.push({ role: 'user', content: turn.prompt }, { role: 'assistant', content: answer });
  }
  return { answers, telemetry };
}

function attachScenarioMetadata(row: ReturnType<typeof scoreV3Scenario>, scenario: Scenario) {
  return {
    ...row,
    capability: scenario.capability,
    familyId: scenario.familyId,
    metamorphicGroup: scenario.metamorphicGroup,
    requiredRepresentations: scenario.requiredRepresentations,
    expectedRoute: scenario.expectedRoute,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scenarios = (args.pack === 'soundness'
    ? [...V3_SOUNDNESS_SCENARIOS]
    : args.pack === 'frontier'
      ? [...V3_FRONTIER_SCENARIOS]
      : args.pack === 'fresh'
        ? [...V3_FRESH_SCENARIOS]
        : [...V3_SOUNDNESS_SCENARIOS, ...V3_FRONTIER_SCENARIOS, ...V3_FRESH_SCENARIOS]) as Scenario[];
  const manifestActual = verifyManifest(scenarios, args.pack);
  const scorerControls = runV3ScorerAttackBank();
  if (!scorerControls.passed) throw new Error('V3 scorer attack bank failed');

  const referenceRows = scenarios.map((scenario) => attachScenarioMetadata(
    scoreV3Scenario(scenario, scenario.turns.map((turn) => turn.referenceAnswer)), scenario,
  ));
  const invalidReferences = referenceRows.filter((row) => !row.passed);
  if (invalidReferences.length) throw new Error(`Reference validity audit failed: ${invalidReferences.map((row) => row.scenarioId).join(', ')}`);

  const answerRuns = new Map<string, string[][]>();
  const primaryTelemetry = new Map<string, TurnTelemetry[]>();
  for (let orderIndex = 0; orderIndex < args.orders; orderIndex += 1) {
    const ordered = orderScenarios(scenarios, orderIndex);
    for (let scenarioIndex = 0; scenarioIndex < ordered.length; scenarioIndex += 1) {
      const scenario = ordered[scenarioIndex];
      const run = await runScenario(scenario, args.timeoutMs);
      const answers = answerRuns.get(scenario.id) ?? [];
      answers.push(run.answers);
      answerRuns.set(scenario.id, answers);
      if (orderIndex === 0) primaryTelemetry.set(scenario.id, run.telemetry);
      if ((scenarioIndex + 1) % 20 === 0 || scenarioIndex + 1 === ordered.length) {
        console.log(`VAI_COMPETITION_V3_PROGRESS order=${orderIndex + 1}/${args.orders} scenarios=${scenarioIndex + 1}/${ordered.length}`);
      }
    }
  }

  const vaiRows = scenarios.map((scenario) => ({
    ...attachScenarioMetadata(scoreV3Scenario(scenario, answerRuns.get(scenario.id)?.[0] ?? []), scenario),
    turnTelemetry: primaryTelemetry.get(scenario.id) ?? [],
  }));
  const determinismRows = scenarios.map((scenario) => {
    const runs = answerRuns.get(scenario.id) ?? [];
    const canonical = runs[0] ?? [];
    const stable = runs.every((answers) => answers.length === canonical.length
      && answers.every((answer, index) => answer.replace(/\s+/g, ' ').trim() === canonical[index]?.replace(/\s+/g, ' ').trim()));
    return { scenarioId: scenario.id, stable, runs: runs.length };
  });
  const candidateHash = candidateFingerprint();
  const report = buildV3CompetitionReport({
    suiteId: V3_MANIFEST.suiteId,
    split: args.pack,
    referenceRows,
    vaiRows,
    metadata: {
      manifest: V3_MANIFEST,
      manifestActual,
      scorerControls,
      candidateHash,
      execution: { orders: args.orders, timeoutMs: args.timeoutMs, freshEnginePerScenario: true },
    },
  });
  report.diagnosticsV3.determinism = {
    scenarios: determinismRows.length,
    stable: determinismRows.filter((row) => row.stable).length,
    rate: determinismRows.length ? determinismRows.filter((row) => row.stable).length / determinismRows.length : 0,
    unstableScenarios: determinismRows.filter((row) => !row.stable).map((row) => row.scenarioId),
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.resolve(args.out ?? path.join('artifacts', 'vai-competition-v3', candidateHash.slice(0, 12), `${args.pack}-${timestamp}.json`));
  if (existsSync(outPath)) throw new Error(`Append-only evidence path already exists: ${outPath}`);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(outPath.replace(/\.json$/i, '.md'), renderV3CompetitionMarkdown(report), 'utf8');

  console.log('VAI_COMPETITION_V3 MANIFEST-PASS SCORER-ATTACK-BANK-PASS REFERENCES-PASS');
  console.log(`suite=${V3_MANIFEST.suiteId} pack=${args.pack} fingerprint=${V3_MANIFEST.packs[args.pack].suiteFingerprint}`);
  console.log(`reference=100.0% (${report.summary.reference.passed}/${report.summary.reference.scenarios})`);
  console.log(`vai=${(report.summary.vai.score * 100).toFixed(1)}% (${report.summary.vai.passed}/${report.summary.vai.scenarios})`);
  console.log(`boundedCoverage=${((report.diagnosticsV3.route.boundedCoverage ?? 0) * 100).toFixed(1)}% falseActivation=${((report.diagnosticsV3.route.falseActivationRate ?? 0) * 100).toFixed(1)}% boundedPrecision=${((report.diagnosticsV3.route.boundedPrecision ?? 0) * 100).toFixed(1)}%`);
  console.log(`brier=${report.diagnosticsV3.calibration.brier} ece=${report.diagnosticsV3.calibration.expectedCalibrationError} deterministic=${(report.diagnosticsV3.determinism.rate * 100).toFixed(1)}%`);
  console.log(`report=${outPath}`);
}

main().catch((error) => {
  console.error(`VAI_COMPETITION_V3_ERROR ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
