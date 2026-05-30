#!/usr/bin/env node
/**
 * Vai scale evaluation orchestrator.
 *
 * Thin wrapper around the existing live WebSocket corpus benchmark that:
 * - standardizes artifacts under artifacts/scale-eval/<runId>/
 * - defaults to the product target: 10k conversations, 1 turn, 30% builder
 * - writes a manifest before and after the run
 * - derives a compact audit.jsonl from response rows for dashboard/report use
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = {
    n: 10_000,
    turns: 1,
    conc: 8,
    builderConc: 2,
    builderRate: 0.30,
    maxBuilders: undefined,
    seed: 42,
    timeoutMs: 90_000,
    baseUrl: process.env.VAI_API || process.env.VAI_API_URL || 'http://127.0.0.1:3006',
    model: process.env.VAI_VERIFY_MODEL || 'vai:v0',
    runId: '',
    dryRun: false,
    dashboard: false,
    cleanup: false,
    wave: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    const [key, inline] = raw.startsWith('--') ? raw.slice(2).split('=') : [raw, undefined];
    const next = inline ?? argv[i + 1];
    const consume = inline === undefined;
    const setString = (field) => {
      out[field] = String(next ?? '');
      if (consume) i += 1;
    };
    const setNumber = (field) => {
      out[field] = Number(next);
      if (consume) i += 1;
    };

    if (key === 'n') setNumber('n');
    else if (key === 'turns') setNumber('turns');
    else if (key === 'conc') setNumber('conc');
    else if (key === 'builder-conc') setNumber('builderConc');
    else if (key === 'builder-rate') setNumber('builderRate');
    else if (key === 'max-builders') setNumber('maxBuilders');
    else if (key === 'seed') setNumber('seed');
    else if (key === 'timeout-ms') setNumber('timeoutMs');
    else if (key === 'base-url') setString('baseUrl');
    else if (key === 'model') setString('model');
    else if (key === 'run-id') setString('runId');
    else if (key === 'dry-run') out.dryRun = true;
    else if (key === 'dashboard') out.dashboard = true;
    else if (key === 'cleanup') out.cleanup = true;
    else if (key === 'wave') out.wave = true;
    else if (key === 'help' || key === 'h') out.help = true;
  }

  out.n = positiveInt(out.n, 10_000);
  out.turns = positiveInt(out.turns, 1);
  out.conc = positiveInt(out.conc, 8);
  out.builderConc = positiveInt(out.builderConc, 2);
  out.builderRate = clamp(Number.isFinite(out.builderRate) ? out.builderRate : 0.30, 0, 1);
  out.maxBuilders = positiveInt(out.maxBuilders, Math.ceil(out.n * out.builderRate));
  out.seed = Number.isFinite(out.seed) ? out.seed : 42;
  out.timeoutMs = positiveInt(out.timeoutMs, 90_000);
  out.baseUrl = out.baseUrl.replace(/\/$/, '');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  out.runId = out.runId || `run-${stamp}`;
  return out;
}

function positiveInt(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function printHelp() {
  console.log(`Vai scale eval

Usage:
  node scripts/vai-scale-eval.mjs [options]

Defaults:
  --n 10000 --turns 1 --builder-rate 0.30 --conc 8 --builder-conc 2

Options:
  --run-id <id>          Artifact folder name under artifacts/scale-eval/
  --dry-run             Generate corpus only; do not call Vai
  --dashboard           Enable the corpus runner dashboard
  --cleanup             Delete conversations created by the run
  --wave                Run turn waves across conversations
  --base-url <url>      Runtime URL
  --model <id>          Model ID
`);
}

function jsonLine(value) {
  return JSON.stringify(value) + '\n';
}

async function writeManifest(file, manifest) {
  await fsp.writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
}

async function deriveAuditJsonl(responseFile, auditFile) {
  if (!fs.existsSync(responseFile)) {
    await fsp.writeFile(auditFile, '');
    return;
  }

  const text = await fsp.readFile(responseFile, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const output = [];

  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      const tags = row.tags ?? row.buckets ?? row.failures ?? [];
      output.push(jsonLine({
        runId: row.runId,
        conversationId: row.conversationId,
        turnIndex: row.turnIndex ?? row.turn ?? 0,
        mode: row.mode,
        kind: row.kind,
        passed: row.pass ?? row.passed ?? tags.length === 0,
        tags,
        latencyMs: row.durationMs ?? row.ms ?? row.latencyMs,
        modelId: row.modelId,
      }));
    } catch {
      // Keep audit derivation best-effort; malformed rows stay in responses.jsonl.
    }
  }

  await fsp.writeFile(auditFile, output.join(''));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const outDir = path.join(ROOT, 'artifacts', 'scale-eval', args.runId);
  await fsp.mkdir(outDir, { recursive: true });

  const manifestFile = path.join(outDir, 'manifest.json');
  const responsesFile = path.join(outDir, 'responses.jsonl');
  const auditFile = path.join(outDir, 'audit.jsonl');
  const summaryFile = path.join(outDir, 'summary.json');
  const reportFile = path.join(outDir, 'report.md');
  const corpusFile = path.join(outDir, 'corpus.jsonl');

  const manifest = {
    schemaVersion: 1,
    runner: 'vai-scale-eval',
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    config: args,
    artifacts: {
      responses: path.relative(ROOT, responsesFile),
      audit: path.relative(ROOT, auditFile),
      summary: path.relative(ROOT, summaryFile),
      report: path.relative(ROOT, reportFile),
      corpus: path.relative(ROOT, corpusFile),
    },
  };
  await writeManifest(manifestFile, manifest);

  const runnerArgs = [
    path.join(ROOT, 'scripts', 'vai-corpus-benchmark.mjs'),
    '--n', String(args.n),
    '--turns', String(args.turns),
    '--conc', String(args.conc),
    '--builder-conc', String(args.builderConc),
    '--builder-rate', String(args.builderRate),
    '--max-builders', String(args.maxBuilders),
    '--seed', String(args.seed),
    '--timeout-ms', String(args.timeoutMs),
    '--base-url', args.baseUrl,
    '--model', args.model,
    '--out', responsesFile,
    '--report', reportFile,
    '--summary', summaryFile,
    '--corpus-out', corpusFile,
  ];

  if (args.dryRun) runnerArgs.push('--dry-run');
  if (args.dashboard) runnerArgs.push('--dashboard');
  if (args.cleanup) runnerArgs.push('--cleanup');
  if (args.wave) runnerArgs.push('--wave');

  const exitCode = await new Promise((resolve) => {
    const child = spawn(process.execPath, runnerArgs, {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });

  await deriveAuditJsonl(responsesFile, auditFile);
  manifest.status = exitCode === 0 ? 'completed' : 'failed';
  manifest.finishedAt = new Date().toISOString();
  manifest.exitCode = exitCode;
  await writeManifest(manifestFile, manifest);

  process.exitCode = exitCode;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
