#!/usr/bin/env node
/**
 * Codex-vs-Vai institutional viability competition.
 *
 * Run:
 *   node --import tsx scripts/vai-competition.mts --split visible --out artifacts/vai-competition/baseline-visible.json
 *   node --import tsx scripts/vai-competition.mts --split holdout --out artifacts/vai-competition/holdout-after.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { VaiEngine } from '../packages/core/src/models/vai-engine.js';
import {
  buildCompetitionReport,
  renderCompetitionMarkdown,
  scoreScenario,
} from './lib/vai-competition-core.mjs';
import {
  COMPETITION_SUITE_ID,
  competitionScenarios,
} from './lib/vai-competition-suite.mjs';

type Split = 'visible' | 'holdout' | 'challenge2' | 'holdout2' | 'all';

function parseArgs(argv: string[]): { split: Split; out: string; json: boolean } {
  let split: Split = 'visible';
  let out = path.join('artifacts', 'vai-competition', 'latest-visible.json');
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--split') {
      const value = argv[++index] as Split | undefined;
      if (!value || !['visible', 'holdout', 'challenge2', 'holdout2', 'all'].includes(value)) throw new Error(`Invalid split: ${value}`);
      split = value;
      if (out.endsWith('latest-visible.json')) out = path.join('artifacts', 'vai-competition', `latest-${split}.json`);
    } else if (arg === '--out') {
      const value = argv[++index];
      if (!value) throw new Error('--out requires a path');
      out = value;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--help') {
      console.log('Usage: node --import tsx scripts/vai-competition.mts [--split visible|holdout|challenge2|holdout2|all] [--out report.json] [--json]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { split, out, json };
}

async function runVaiScenario(engine: VaiEngine, scenario: ReturnType<typeof competitionScenarios>[number]) {
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const answers: string[] = [];
  const metadata: Array<{ strategy: string | null; confidence: number | null; wallTimeMs: number }> = [];
  for (const turn of scenario.turns) {
    const startedAt = performance.now();
    const response = await engine.chat({
      messages: [...history, { role: 'user', content: turn.prompt }],
      noLearn: true,
    });
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
  console.log(`VAI_COMPETITION ${report.methodology.controls.passed ? 'SCORER-CONTROLS-PASS' : 'SCORER-CONTROLS-FAIL'}`);
  console.log(`suite=${report.suiteId} split=${report.split}`);
  console.log(`Codex ${(report.summary.codex.score * 100).toFixed(1)}% (${report.summary.codex.passed}/${report.summary.codex.scenarios})`);
  console.log(`Vai   ${(report.summary.vai.score * 100).toFixed(1)}% (${report.summary.vai.passed}/${report.summary.vai.scenarios})`);
  console.log(`head-to-head codex=${report.summary.headToHead.codexWins} vai=${report.summary.headToHead.vaiWins} ties=${report.summary.headToHead.ties}`);
  if (report.diagnosis.largestGap) {
    console.log(`largest-gap=${report.diagnosis.largestGap.category} lead=${(report.diagnosis.largestGap.avgCodexLead * 100).toFixed(1)}pt`);
  }
  for (const row of report.comparisons) {
    console.log(`${row.winner.padEnd(5)} ${row.scenarioId.padEnd(34)} codex=${(row.codexScore * 100).toFixed(0).padStart(3)} vai=${(row.vaiScore * 100).toFixed(0).padStart(3)}`);
  }
  console.log(`report=${outPath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scenarios = competitionScenarios(args.split);
  const engine = new VaiEngine({ testMode: true });
  const codexRows = [];
  const vaiRows = [];
  const strategies: Record<string, unknown> = {};

  for (const scenario of scenarios) {
    const referenceAnswers = scenario.turns.map((turn) => turn.referenceAnswer);
    codexRows.push(scoreScenario(scenario, referenceAnswers));
    const vai = await runVaiScenario(engine, scenario);
    vaiRows.push(scoreScenario(scenario, vai.answers));
    strategies[scenario.id] = vai.metadata;
  }

  const report = buildCompetitionReport({
    suiteId: COMPETITION_SUITE_ID,
    split: args.split,
    codexRows,
    vaiRows,
    metadata: {
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
  if (!report.methodology.controls.passed) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`VAI_COMPETITION_ERROR ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
