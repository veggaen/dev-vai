#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { VaiEngine } from '../packages/core/src/models/vai-engine.js';
import { V4_SEALED_SCENARIOS } from './lib/vai-competition-v4-sealed.mjs';
import { V4_MANIFEST } from './lib/vai-competition-v4-manifest.mjs';
import { V4_WAVE2_SCENARIOS } from './lib/vai-competition-v4-wave2.mjs';
import { V4_WAVE2_MANIFEST } from './lib/vai-competition-v4-wave2-manifest.mjs';
import { scoreV4Scenario, runV4ScorerAttackBank } from './lib/vai-competition-v4-scorer.mjs';
import { buildV3CompetitionReport, renderV3CompetitionMarkdown } from './lib/vai-competition-v3-core.mjs';

type Scenario = typeof V4_SEALED_SCENARIOS[number] | typeof V4_WAVE2_SCENARIOS[number];
type Telemetry = { expectedRoute: 'bounded' | 'abstain'; strategy: string; boundedActivated: boolean; confidence: number | null; wallTimeMs: number; timedOut: boolean };

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const fileHash = (file: string) => sha256(readFileSync(path.resolve(file)));
const suiteHash = (scenarios: readonly Scenario[]) => sha256(JSON.stringify(scenarios));
const candidateHash = () => {
  const files = [
    'packages/core/src/reasoning/bounded-reasoning.ts',
    'packages/core/src/reasoning/advanced-reasoning.ts',
    'packages/core/src/reasoning/mini-js-reasoning.ts',
    'packages/core/src/reasoning/planning-reasoning.ts',
    'packages/core/src/models/vai-engine.ts',
    'packages/core/src/chat/service.ts',
  ];
  return sha256(files.map((file) => `${file}\0${fileHash(file)}`).join('\0'));
};

function parseArgs() {
  let orders = 3; let timeoutMs = 5_000; let out: string | null = null; let allowCandidateDrift = false; let wave: 'sealed' | 'wave2' = 'sealed';
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--orders') orders = Number(args[++index]);
    else if (args[index] === '--timeout-ms') timeoutMs = Number(args[++index]);
    else if (args[index] === '--out') out = args[++index] ?? null;
    else if (args[index] === '--wave') {
      const value = args[++index];
      if (value !== 'sealed' && value !== 'wave2') throw new Error('--wave must be sealed or wave2');
      wave = value;
    }
    else if (args[index] === '--allow-candidate-drift') allowCandidateDrift = true;
    else if (args[index] === '--help') { console.log('Usage: node --import tsx scripts/vai-competition-v4.mts [--wave sealed|wave2] [--orders 1|3] [--timeout-ms 5000] [--out path] [--allow-candidate-drift]'); process.exit(0); }
    else throw new Error(`Unknown argument ${args[index]}`);
  }
  if (![1, 3].includes(orders)) throw new Error('--orders must be 1 or 3');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100) throw new Error('--timeout-ms must be >=100');
  return { orders, timeoutMs, out, allowCandidateDrift, wave };
}

function verifyManifest(scenarios: readonly Scenario[], manifest: typeof V4_MANIFEST | typeof V4_WAVE2_MANIFEST, suiteSource: string, actualCandidate: string, allowCandidateDrift: boolean) {
  const actual = {
    scenarioCount: scenarios.length,
    turnCount: scenarios.reduce((sum, scenario) => sum + scenario.turns.length, 0),
    familyCount: new Set(scenarios.map((scenario) => scenario.familyId)).size,
    suiteFingerprint: suiteHash(scenarios),
    suiteSourceFingerprint: fileHash(suiteSource),
    scorerFingerprint: fileHash('scripts/lib/vai-competition-v4-scorer.mjs'),
    reportCoreFingerprint: fileHash('scripts/lib/vai-competition-v3-core.mjs'),
  };
  const failures = Object.entries(actual).filter(([key, value]) => value !== manifest[key as keyof typeof manifest]).map(([key, value]) => `${key}: expected=${manifest[key as keyof typeof manifest]} actual=${value}`);
  if (!allowCandidateDrift && actualCandidate !== manifest.preExposureCandidateFingerprint) failures.push(`candidate: expected=${manifest.preExposureCandidateFingerprint} actual=${actualCandidate}`);
  if (failures.length) throw new Error(`V4 frozen-manifest mismatch:\n${failures.join('\n')}`);
  return actual;
}

function orderedScenarios(scenarios: readonly Scenario[], order: number): Scenario[] {
  if (order === 0) return [...scenarios];
  if (order === 1) return [...scenarios].reverse();
  return [...scenarios].sort((left, right) => sha256(left.id).localeCompare(sha256(right.id)));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs); });
  const outcome = await Promise.race([promise.then((value) => ({ timedOut: false as const, value })), timeout]);
  if (timer) clearTimeout(timer);
  return outcome;
}

async function runScenario(scenario: Scenario, timeoutMs: number) {
  const engine = new VaiEngine({ testMode: true });
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const answers: string[] = []; const telemetry: Telemetry[] = [];
  for (const task of scenario.turns) {
    const started = performance.now();
    const response = await withTimeout(engine.chat({ messages: [...history, { role: 'user', content: task.prompt }], noLearn: true }), timeoutMs);
    const meta = engine.lastResponseMeta;
    const answer = response.timedOut ? '' : response.value.message.content;
    const strategy = response.timedOut ? 'timeout' : meta?.strategy ?? 'unknown';
    answers.push(answer);
    telemetry.push({
      expectedRoute: task.expectedRoute as 'bounded' | 'abstain', strategy,
      boundedActivated: strategy.startsWith('bounded-reasoning:'), confidence: meta?.confidence ?? null,
      wallTimeMs: Math.round(performance.now() - started), timedOut: response.timedOut,
    });
    history.push({ role: 'user', content: task.prompt }, { role: 'assistant', content: answer });
  }
  return { answers, telemetry };
}

function withMetadata(row: ReturnType<typeof scoreV4Scenario>, scenario: Scenario) {
  return { ...row, capability: scenario.capability, familyId: scenario.familyId, metamorphicGroup: scenario.metamorphicGroup, requiredRepresentations: scenario.requiredRepresentations, expectedRoute: scenario.expectedRoute };
}

async function main() {
  const args = parseArgs();
  const selectedScenarios = (args.wave === 'wave2' ? V4_WAVE2_SCENARIOS : V4_SEALED_SCENARIOS) as readonly Scenario[];
  const manifest = args.wave === 'wave2' ? V4_WAVE2_MANIFEST : V4_MANIFEST;
  const suiteSource = args.wave === 'wave2' ? 'scripts/lib/vai-competition-v4-wave2.mjs' : 'scripts/lib/vai-competition-v4-sealed.mjs';
  const currentCandidate = candidateHash();
  const manifestActual = verifyManifest(selectedScenarios, manifest, suiteSource, currentCandidate, args.allowCandidateDrift);
  const scorerControls = runV4ScorerAttackBank();
  if (!scorerControls.passed) throw new Error('V4 scorer attack bank failed');
  const referenceRows = selectedScenarios.map((scenario) => withMetadata(scoreV4Scenario(scenario, scenario.turns.map((task) => task.referenceAnswer)), scenario));
  const invalidReferences = referenceRows.filter((row) => !row.passed);
  if (invalidReferences.length) throw new Error(`V4 reference audit failed: ${invalidReferences.map((row) => row.scenarioId).join(', ')}`);

  const runs = new Map<string, string[][]>(); const telemetry = new Map<string, Telemetry[]>();
  for (let order = 0; order < args.orders; order += 1) {
    const scenarios = orderedScenarios(selectedScenarios, order);
    for (let index = 0; index < scenarios.length; index += 1) {
      const scenario = scenarios[index];
      const outcome = await runScenario(scenario, args.timeoutMs);
      runs.set(scenario.id, [...(runs.get(scenario.id) ?? []), outcome.answers]);
      if (order === 0) telemetry.set(scenario.id, outcome.telemetry);
      if ((index + 1) % 20 === 0 || index + 1 === scenarios.length) console.log(`VAI_COMPETITION_V4_PROGRESS order=${order + 1}/${args.orders} scenarios=${index + 1}/${scenarios.length}`);
    }
  }
  const vaiRows = selectedScenarios.map((scenario) => ({ ...withMetadata(scoreV4Scenario(scenario, runs.get(scenario.id)?.[0] ?? []), scenario), turnTelemetry: telemetry.get(scenario.id) ?? [] }));
  const stability = selectedScenarios.map((scenario) => {
    const answers = runs.get(scenario.id) ?? []; const first = answers[0] ?? [];
    return { scenarioId: scenario.id, stable: answers.every((candidate) => candidate.length === first.length && candidate.every((answer, index) => normalize(answer) === normalize(first[index]))), runs: answers.length };
  });
  const report = buildV3CompetitionReport({
    suiteId: manifest.suiteId, split: args.wave === 'wave2' ? 'sealed-wave2' : 'sealed-post-improvement', referenceRows, vaiRows,
    metadata: { manifest, manifestActual, scorerControls, candidateHash: currentCandidate, preExposureCandidateMatch: currentCandidate === manifest.preExposureCandidateFingerprint, execution: { orders: args.orders, timeoutMs: args.timeoutMs, freshEnginePerScenario: true } },
  });
  report.schemaVersion = 4;
  report.methodology.v4 = 'Post-improvement sealed wave with semantic schedule-certificate validation and matched unsupported controls.';
  report.diagnosticsV3.determinism = { scenarios: stability.length, stable: stability.filter((row) => row.stable).length, rate: stability.filter((row) => row.stable).length / stability.length, unstableScenarios: stability.filter((row) => !row.stable).map((row) => row.scenarioId) };
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.resolve(args.out ?? path.join('artifacts', 'vai-competition-v4', currentCandidate.slice(0, 12), `${args.wave}-${timestamp}.json`));
  if (existsSync(outPath)) throw new Error(`Append-only evidence path exists: ${outPath}`);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(outPath.replace(/\.json$/i, '.md'), renderV3CompetitionMarkdown(report).replace(/V3/g, 'V4'), 'utf8');
  console.log('VAI_COMPETITION_V4 MANIFEST-PASS SCORER-ATTACK-BANK-PASS REFERENCES-PASS');
  console.log(`suite=${manifest.suiteId} fingerprint=${manifest.suiteFingerprint}`);
  console.log(`reference=100.0% (${report.summary.reference.passed}/${report.summary.reference.scenarios})`);
  console.log(`vai=${(report.summary.vai.score * 100).toFixed(1)}% (${report.summary.vai.passed}/${report.summary.vai.scenarios})`);
  console.log(`boundedCoverage=${((report.diagnosticsV3.route.boundedCoverage ?? 0) * 100).toFixed(1)}% falseActivation=${((report.diagnosticsV3.route.falseActivationRate ?? 0) * 100).toFixed(1)}% boundedPrecision=${((report.diagnosticsV3.route.boundedPrecision ?? 0) * 100).toFixed(1)}%`);
  console.log(`brier=${report.diagnosticsV3.calibration.brier} ece=${report.diagnosticsV3.calibration.expectedCalibrationError} deterministic=${(report.diagnosticsV3.determinism.rate * 100).toFixed(1)}%`);
  console.log(`report=${outPath}`);
}

const normalize = (value: string | undefined) => String(value ?? '').replace(/\s+/g, ' ').trim();
main().catch((error) => { console.error(`VAI_COMPETITION_V4_ERROR ${error instanceof Error ? error.stack ?? error.message : String(error)}`); process.exit(1); });
