import { spawnSync } from 'node:child_process';

const trainerPath = 'Temporary_files/vai-personal-trainer.mjs';
const suites = [
  { mode: 'strict', args: ['--strict', '--json'], timeoutMs: 8 * 60_000 },
  { mode: 'adversarial', args: ['--adversarial', '--json'], timeoutMs: 14 * 60_000 },
  { mode: 'frontend', args: ['--frontend', '--json'], timeoutMs: 12 * 60_000 },
];

function runSuite(mode, args, timeoutMs) {
  const result = spawnSync(process.execPath, [trainerPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: timeoutMs,
  });

  if (result.error) {
    throw new Error(`${mode} suite timed out or failed before completion (${timeoutMs}ms): ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`${mode} suite exited with code ${result.status}\n${result.stderr || result.stdout}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Failed to parse ${mode} JSON output\n${result.stdout}\n${String(error)}`);
  }
}

const reports = suites.map((suite) => runSuite(suite.mode, suite.args, suite.timeoutMs));
const failedSuites = reports.filter((report) => report.passed !== report.total);

console.log('VAI_TRAINER_BENCHMARK');
for (const report of reports) {
  console.log(`${report.mode}: ${report.passed}/${report.total}`);
  for (const failure of report.failures) {
    console.log(`  FAIL ${failure.name}: ${failure.failures.join('; ')}`);
  }
}

if (failedSuites.length > 0) {
  console.error('TRAINER_REGRESSION_DETECTED');
  process.exit(1);
}

console.log('TRAINER_BENCHMARK_PASS');