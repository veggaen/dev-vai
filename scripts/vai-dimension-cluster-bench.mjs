#!/usr/bin/env node
/**
 * Dimension-cluster benchmark CLI (in-process — run with tsx).
 *
 *   npx tsx scripts/vai-dimension-cluster-bench.mjs
 *   npx tsx scripts/vai-dimension-cluster-bench.mjs --json --report-file out/dim.json
 *   npx tsx scripts/vai-dimension-cluster-bench.mjs --strict        # exit 1 if reduction < threshold
 *
 * Replays the dimension-cluster scenarios twice (prompt-only baseline vs the
 * augmented security-review + contract-ledger build) and reports the failure
 * rate per failure family plus the combined reduction. See
 * packages/core/src/eval/dimension-cluster-bench.ts for the method + caveats.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDimensionClusterBench } from '@vai/core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SCENARIOS = resolve(ROOT, 'eval/dimension-clusters/scenarios.json');

function parseArgs(argv) {
  const args = { json: false, strict: false, reportFile: null, threshold: 50, scenarios: DEFAULT_SCENARIOS, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--json') args.json = true;
    else if (a === '--strict') args.strict = true;
    else if (a === '--report-file' && next) { args.reportFile = next; i++; }
    else if (a === '--threshold' && next) { args.threshold = Number(next); i++; }
    else if (a === '--scenarios' && next) { args.scenarios = resolve(next); i++; }
    else throw new Error(`Unknown or incomplete argument: ${a}`);
  }
  return args;
}

function pct(n) {
  return `${Math.round(n * 100)}%`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: npx tsx scripts/vai-dimension-cluster-bench.mjs [--json] [--strict] [--threshold N] [--report-file path] [--scenarios path]');
    return;
  }

  const pack = JSON.parse(readFileSync(args.scenarios, 'utf8'));
  const report = await runDimensionClusterBench(pack.scenarios);
  const ok = report.combinedReductionPct >= args.threshold;

  console.log(`VAI_DIM_CLUSTER ${ok ? 'PASS' : 'FAIL'}  (threshold ${args.threshold}% combined reduction)`);
  console.log(`scenarios=${report.total} baselineFailures=${report.baselineFailures} augmentedFailures=${report.augmentedFailures} combinedReduction=${report.combinedReductionPct}%`);
  console.log('');
  console.log('cluster                     n  baselineFail  augmentedFail  reduction');
  for (const c of report.clusters) {
    console.log(
      `${c.cluster.padEnd(26)} ${String(c.total).padStart(2)}  ${pct(c.baselineFailRate).padStart(11)}  ${pct(c.augmentedFailRate).padStart(13)}  ${String(c.reductionPct + '%').padStart(9)}`,
    );
  }

  // Surface any augmented scenario that still fails, plus which handler answered.
  const stillFailing = report.results.filter((r) => !r.augmented.passed);
  if (stillFailing.length > 0) {
    console.log('\nAugmented still failing:');
    for (const r of stillFailing) {
      console.log(`- [${r.cluster}] ${r.id} (handler=${r.augmented.handler}): ${r.augmented.failures.join('; ')}`);
    }
  }

  if (args.reportFile) {
    const abs = resolve(args.reportFile);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`\nreportFile=${abs}`);
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  }

  process.exitCode = args.strict ? (ok ? 0 : 1) : 0;
}

main().catch((error) => {
  console.error(`VAI_DIM_CLUSTER_ERROR ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
});
