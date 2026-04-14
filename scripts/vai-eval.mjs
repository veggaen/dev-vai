#!/usr/bin/env node

/**
 * Vai eval harness.
 *
 * Runs the existing runtime eval framework over HTTP and emits
 * machine-checkable JSON plus a compact human summary.
 *
 * Examples:
 *   node scripts/vai-eval.mjs
 *   node scripts/vai-eval.mjs --track comprehension --json
 *   node scripts/vai-eval.mjs --task math-basic-add --task conv-identity
 *   node scripts/vai-eval.mjs --report-file tmp/vai-eval.json
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEFAULT_BASE_URL = process.env.VAI_API ?? 'http://localhost:3006';

function printHelp() {
  console.log(`Usage: node scripts/vai-eval.mjs [options]

Options:
  --base-url <url>       Runtime base URL (default: ${DEFAULT_BASE_URL})
  --model <id>           Model id to evaluate (default: vai:v0)
  --track <name>         Eval track to run (default: comprehension)
  --task <id>            Specific task id to run (repeatable)
  --max-attempts <n>     Retry attempts per task (default: 1)
  --temperature <n>      Temperature override (default: 0)
  --report-file <path>   Write normalized JSON report to a file
  --json                 Print normalized JSON report to stdout
  --list-tracks          Show available tracks and exit
  --help                 Show this help
`);
}

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    modelId: 'vai:v0',
    track: 'comprehension',
    taskIds: [],
    maxAttempts: 1,
    temperature: 0,
    reportFile: null,
    json: false,
    listTracks: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--list-tracks') args.listTracks = true;
    else if (arg === '--base-url' && next) { args.baseUrl = next; i++; }
    else if (arg === '--model' && next) { args.modelId = next; i++; }
    else if (arg === '--track' && next) { args.track = next; i++; }
    else if (arg === '--task' && next) { args.taskIds.push(next); i++; }
    else if (arg === '--max-attempts' && next) { args.maxAttempts = Number.parseInt(next, 10); i++; }
    else if (arg === '--temperature' && next) { args.temperature = Number.parseFloat(next); i++; }
    else if (arg === '--report-file' && next) { args.reportFile = next; i++; }
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  return args;
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new Error(`Request failed ${res.status} ${res.statusText}: ${text}`);
  }

  return body;
}

function buildReport({ baseUrl, modelId, track, selectedTaskIds, run }) {
  const failedTasks = run.tasks
    .filter((task) => !task.passed)
    .map((task) => ({
      taskId: task.taskId,
      score: task.score,
      attempts: task.attempts,
      detail: task.detail ?? '',
      responsePreview: task.modelResponse.slice(0, 200),
    }));

  return {
    ok: failedTasks.length === 0,
    generatedAt: new Date().toISOString(),
    target: {
      baseUrl,
      modelId,
      track,
      taskIds: selectedTaskIds,
    },
    run: {
      runId: run.runId,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      summary: run.summary,
      tasks: run.tasks.map((task) => ({
        taskId: task.taskId,
        passed: task.passed,
        score: task.score,
        attempts: task.attempts,
        tokensIn: task.tokensIn,
        tokensOut: task.tokensOut,
        wallTimeMs: task.wallTimeMs,
        detail: task.detail ?? '',
      })),
    },
    failures: failedTasks,
  };
}

function printSummary(report) {
  const { summary } = report.run;
  console.log(`VAI_EVAL ${report.ok ? 'PASS' : 'FAIL'}`);
  console.log(`model=${report.target.modelId} track=${report.target.track} base=${report.target.baseUrl}`);
  console.log(
    `tasks=${summary.totalTasks} passed=${summary.passed} failed=${summary.failed} avgScore=${summary.avgScore} grade=${summary.grade} wallTimeMs=${summary.totalWallTimeMs}`,
  );

  if (report.failures.length > 0) {
    console.log('failedTasks:');
    for (const failure of report.failures) {
      console.log(`- ${failure.taskId} score=${failure.score} attempts=${failure.attempts} detail=${failure.detail}`);
    }
  }
}

async function writeReportFile(path, report) {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`reportFile=${absolutePath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const tracksResponse = await fetchJson(`${args.baseUrl}/api/eval/tracks`);

  if (args.listTracks) {
    console.log(JSON.stringify(tracksResponse, null, 2));
    return;
  }

  const knownTrack = tracksResponse.tracks.find((entry) => entry.track === args.track);
  if (!knownTrack) {
    throw new Error(`Unknown eval track '${args.track}'. Available: ${tracksResponse.tracks.map((t) => t.track).join(', ')}`);
  }

  const payload = {
    modelId: args.modelId,
    track: args.track,
    ...(args.taskIds.length > 0 ? { taskIds: args.taskIds } : {}),
    maxAttempts: args.maxAttempts,
    temperature: args.temperature,
  };

  const run = await fetchJson(`${args.baseUrl}/api/eval/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const report = buildReport({
    baseUrl: args.baseUrl,
    modelId: args.modelId,
    track: args.track,
    selectedTaskIds: args.taskIds,
    run,
  });

  printSummary(report);

  if (args.reportFile) {
    await writeReportFile(args.reportFile, report);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  }

  process.exitCode = report.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(`VAI_EVAL_ERROR ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});