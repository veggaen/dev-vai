#!/usr/bin/env node
/** Higher-reasoning, frozen-holdout Vai competition. */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { VaiEngine } from '../packages/core/src/models/vai-engine.js';
import {
  buildCompetitionReport,
  renderCompetitionMarkdown,
  scoreScenario,
} from './lib/vai-competition-core.mjs';
import {
  COMPETITION_V2_SUITE_ID,
  competitionV2Scenarios,
} from './lib/vai-competition-v2-suite.mjs';
import { COMPETITION_V2_FRESH1_SCENARIOS } from './lib/vai-competition-v2-fresh1.mjs';
import { COMPETITION_V2_FRESH2_SCENARIOS } from './lib/vai-competition-v2-fresh2.mjs';
import { COMPETITION_V2_FRESH3_SCENARIOS } from './lib/vai-competition-v2-fresh3.mjs';

type Split = 'visible' | 'holdout' | 'mutation' | 'all' | 'fresh1' | 'fresh2' | 'fresh3' | 'expanded' | 'expanded2' | 'expanded3';
type Scenario = ReturnType<typeof competitionV2Scenarios>[number];

function selectScenarios(split: Split): Scenario[] {
  if (split === 'fresh1') return [...COMPETITION_V2_FRESH1_SCENARIOS] as Scenario[];
  if (split === 'fresh2') return [...COMPETITION_V2_FRESH2_SCENARIOS] as Scenario[];
  if (split === 'fresh3') return [...COMPETITION_V2_FRESH3_SCENARIOS] as Scenario[];
  if (split === 'expanded') return [...competitionV2Scenarios('all'), ...COMPETITION_V2_FRESH1_SCENARIOS] as Scenario[];
  if (split === 'expanded2') return [...competitionV2Scenarios('all'), ...COMPETITION_V2_FRESH1_SCENARIOS, ...COMPETITION_V2_FRESH2_SCENARIOS] as Scenario[];
  if (split === 'expanded3') return [...competitionV2Scenarios('all'), ...COMPETITION_V2_FRESH1_SCENARIOS, ...COMPETITION_V2_FRESH2_SCENARIOS, ...COMPETITION_V2_FRESH3_SCENARIOS] as Scenario[];
  return competitionV2Scenarios(split);
}

function parseArgs(argv: string[]): { split: Split; out: string; json: boolean } {
  let split: Split = 'visible';
  let out = path.join('artifacts', 'vai-competition-v2', 'latest-visible.json');
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--split') {
      const value = argv[++index] as Split | undefined;
      if (!value || !['visible', 'holdout', 'mutation', 'all', 'fresh1', 'fresh2', 'fresh3', 'expanded', 'expanded2', 'expanded3'].includes(value)) throw new Error(`Invalid split: ${value}`);
      split = value;
      if (out.endsWith('latest-visible.json')) out = path.join('artifacts', 'vai-competition-v2', `latest-${split}.json`);
    } else if (arg === '--out') {
      const value = argv[++index];
      if (!value) throw new Error('--out requires a path');
      out = value;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--help') {
      console.log('Usage: node --import tsx scripts/vai-competition-v2.mts [--split visible|holdout|mutation|all|fresh1|fresh2|fresh3|expanded|expanded2|expanded3] [--out report.json] [--json]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { split, out, json };
}

function suiteFingerprint(scenarios: readonly Scenario[]): string {
  const stable = JSON.stringify(scenarios, (_key, value) => value instanceof RegExp
    ? { regex: value.source, flags: value.flags }
    : value);
  return createHash('sha256').update(stable).digest('hex');
}

async function runVaiScenario(engine: VaiEngine, scenario: Scenario) {
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const answers: string[] = [];
  const metadata: Array<{ strategy: string | null; confidence: number | null; wallTimeMs: number }> = [];
  for (const turn of scenario.turns) {
    const startedAt = performance.now();
    const response = await engine.chat({ messages: [...history, { role: 'user', content: turn.prompt }], noLearn: true });
    const answer = response.message.content ?? '';
    const meta = (engine as unknown as { lastResponseMeta?: { strategy?: string; confidence?: number } }).lastResponseMeta;
    answers.push(answer);
    metadata.push({
      strategy: meta?.strategy ?? null,
      confidence: typeof meta?.confidence === 'number' ? meta.confidence : null,
      wallTimeMs: Math.round(performance.now() - startedAt),
    });
    history.push({ role: 'user', content: turn.prompt }, { role: 'assistant', content: answer });
  }
  return { answers, metadata };
}

function printReport(report: ReturnType<typeof buildCompetitionReport>, outPath: string) {
  console.log(`VAI_COMPETITION_V2 ${report.methodology.controls.passed ? 'SCORER-CONTROLS-PASS' : 'SCORER-CONTROLS-FAIL'}`);
  console.log(`suite=${report.suiteId} split=${report.split} fingerprint=${report.metadata.suiteFingerprint}`);
  console.log(`Codex ${(report.summary.codex.score * 100).toFixed(1)}% (${report.summary.codex.passed}/${report.summary.codex.scenarios})`);
  console.log(`Vai   ${(report.summary.vai.score * 100).toFixed(1)}% (${report.summary.vai.passed}/${report.summary.vai.scenarios})`);
  for (const category of Object.keys(report.summary.byCategory.codex).sort()) {
    const codex = report.summary.byCategory.codex[category] ?? 0;
    const vai = report.summary.byCategory.vai[category] ?? 0;
    console.log(`category=${category.padEnd(24)} codex=${(codex * 100).toFixed(1).padStart(5)} vai=${(vai * 100).toFixed(1).padStart(5)} gap=${((codex - vai) * 100).toFixed(1).padStart(5)}`);
  }
  console.log(`report=${outPath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scenarios = selectScenarios(args.split);
  const engine = new VaiEngine({ testMode: true });
  const codexRows = [];
  const vaiRows = [];
  const strategies: Record<string, unknown> = {};

  for (const scenario of scenarios) {
    codexRows.push(scoreScenario(scenario, scenario.turns.map((turn) => turn.referenceAnswer)));
    const vai = await runVaiScenario(engine, scenario);
    vaiRows.push(scoreScenario(scenario, vai.answers));
    strategies[scenario.id] = vai.metadata;
  }

  const report = buildCompetitionReport({
    suiteId: COMPETITION_V2_SUITE_ID,
    split: args.split,
    codexRows,
    vaiRows,
    metadata: {
      suiteFingerprint: suiteFingerprint(scenarios),
      scenarioCount: scenarios.length,
      turnCount: scenarios.reduce((sum, scenario) => sum + scenario.turns.length, 0),
      vaiStrategies: strategies,
    },
  });
  const outPath = path.resolve(args.out);
  const markdownPath = outPath.replace(/\.json$/i, '.md');
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(markdownPath, renderCompetitionMarkdown(report), 'utf8');
  printReport(report, outPath);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  if (!report.methodology.controls.passed || report.summary.codex.passed !== scenarios.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`VAI_COMPETITION_V2_ERROR ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
