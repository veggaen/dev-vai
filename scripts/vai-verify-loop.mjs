#!/usr/bin/env node
/**
 * vai-verify-loop.mjs — orchestrates the in-flight verification cycle.
 *
 *   step 1: vitest (unit tests, including acceptance-spectrum)
 *   step 2: bench-precision (sample slice — keeps the loop fast)
 *
 * On any failure we write `artifacts/verify/failure-<step>.txt` and exit 1
 * so a wrapper can decide to escalate to a human Checkpoint α.
 *
 * Per Master.md §4.7 we keep this small, finished, and honest:
 *   - no inline retries, no silent skips, no fake "passed" status
 *   - the script is the single command that proves the slice is green
 *
 * Usage:
 *   node scripts/vai-verify-loop.mjs
 *   node scripts/vai-verify-loop.mjs --skip-bench   # unit tests only
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const artifactsDir = resolve(repoRoot, 'artifacts', 'verify');
mkdirSync(artifactsDir, { recursive: true });

const args = new Set(process.argv.slice(2));
const skipBench = args.has('--skip-bench');

function runStep(label, command, commandArgs) {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const stdoutChunks = [];
    const stderrChunks = [];
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      shell: process.platform === 'win32',
      env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
    });
    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
    child.on('close', (code) => {
      const durationMs = Date.now() - started;
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      resolvePromise({ label, code, durationMs, stdout, stderr });
    });
  });
}

function summarize(result) {
  const status = result.code === 0 ? 'PASS' : 'FAIL';
  const seconds = (result.durationMs / 1000).toFixed(1);
  process.stdout.write(`[${status}] ${result.label} (${seconds}s)\n`);
}

function persistFailure(result) {
  const file = resolve(artifactsDir, `failure-${result.label}.txt`);
  const body = [
    `# Vai verify-loop failure — ${result.label}`,
    `exit code: ${result.code}`,
    `duration: ${(result.durationMs / 1000).toFixed(1)}s`,
    '',
    '## stdout (tail)',
    result.stdout.split(/\r?\n/).slice(-120).join('\n'),
    '',
    '## stderr (tail)',
    result.stderr.split(/\r?\n/).slice(-120).join('\n'),
  ].join('\n');
  writeFileSync(file, body, 'utf8');
  process.stdout.write(`  wrote ${file}\n`);
}

async function main() {
  const steps = [];

  steps.push(await runStep('vitest', 'pnpm', ['-w', 'exec', 'vitest', 'run', '--reporter=basic']));
  summarize(steps[steps.length - 1]);
  if (steps[steps.length - 1].code !== 0) {
    persistFailure(steps[steps.length - 1]);
    process.exitCode = 1;
    return;
  }

  if (!skipBench) {
    // Bench precision is the most informative and fastest of the bench suites.
    steps.push(await runStep('bench-precision', 'node', ['scripts/bench-all.mjs', '--suite=precision']));
    summarize(steps[steps.length - 1]);
    if (steps[steps.length - 1].code !== 0) {
      persistFailure(steps[steps.length - 1]);
      process.exitCode = 1;
      return;
    }
  }

  process.stdout.write('\nVai verify-loop: all steps green.\n');
}

main().catch((error) => {
  process.stderr.write(`vai-verify-loop crashed: ${error?.stack ?? error}\n`);
  process.exitCode = 2;
});
