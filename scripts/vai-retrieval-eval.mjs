#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runMemoryRetrievalEval } from '@vai/core';

const DEFAULT_DATASET = 'eval/retrieval/memory-golden.json';

function printHelp() {
  console.log(`Usage: node scripts/vai-retrieval-eval.mjs [options]

Options:
  --dataset <path>       Dataset JSON path (default: ${DEFAULT_DATASET})
  --report-file <path>   Write the normalized JSON report to a file
  --json                 Print the normalized JSON report to stdout
  --help                 Show this help
`);
}

function parseArgs(argv) {
  const args = {
    datasetPath: DEFAULT_DATASET,
    reportFile: null,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--dataset' && next) {
      args.datasetPath = next;
      index += 1;
    } else if (arg === '--report-file' && next) {
      args.reportFile = next;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return args;
}

async function readDataset(path) {
  const absolutePath = resolve(path);
  const raw = await readFile(absolutePath, 'utf8');
  return JSON.parse(raw);
}

async function writeReport(path, report) {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`reportFile=${absolutePath}`);
}

function printSummary(report) {
  console.log(`VAI_RETRIEVAL_EVAL ${report.ok ? 'PASS' : 'FAIL'}`);
  console.log(`dataset=${report.dataset.name} docs=${report.dataset.documentCount} queries=${report.dataset.queryCount}`);
  console.log(
    [
      `engineRecallAtK=${report.metrics.engineRecallAtK.toFixed(2)}`,
      `engineTop1=${report.metrics.engineTop1Accuracy.toFixed(2)}`,
      `apiRecallAtK=${report.metrics.apiRecallAtK.toFixed(2)}`,
      `groundedPassRate=${report.metrics.groundedPassRate.toFixed(2)}`,
      `citationPrecision=${report.metrics.citationPrecision.toFixed(2)}`,
      `answerScore=${report.metrics.answerScore.toFixed(2)}`,
    ].join(' '),
  );

  if (report.failures.length > 0) {
    console.log('failures:');
    for (const failure of report.failures) {
      console.log(`- ${failure}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const dataset = await readDataset(args.datasetPath);
  const report = await runMemoryRetrievalEval(dataset);

  printSummary(report);

  if (args.reportFile) {
    await writeReport(args.reportFile, report);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  }

  process.exitCode = report.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(`VAI_RETRIEVAL_EVAL_ERROR ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
