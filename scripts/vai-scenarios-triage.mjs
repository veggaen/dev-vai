#!/usr/bin/env node
/**
 * Triage helper — runs the in-process scenario bench with VAI_SCENARIOS=1 and
 * VAI_SCENARIOS_INCLUDE_PENDING=1, captures the JSON reporter output, and
 * prints a concise per-failure triage line:
 *
 *   <pack>/<scenario> | <strategy> | <assertion that missed>
 *
 * Used while iterating on Phase 5B hand-chain fixes so we can see which
 * pending scenarios are now unlocked and which still route to the wrong arm.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const OUT_FILE = join(REPO_ROOT, '.vai-triage.json');

if (existsSync(OUT_FILE)) unlinkSync(OUT_FILE);

const child = spawn(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'vitest', 'run', 'packages/core/__tests__/scenarios.test.ts',
   '--reporter=json', `--outputFile=${OUT_FILE}`],
  {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      VAI_SCENARIOS: '1',
      VAI_SCENARIOS_INCLUDE_PENDING: '1',
    },
    shell: process.platform === 'win32',
  },
);

child.on('exit', () => {
  if (!existsSync(OUT_FILE)) {
    console.error('[triage] no output file produced');
    process.exit(2);
  }
  const data = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
  const tests = data.testResults?.[0]?.assertionResults ?? [];
  const fails = [];
  const passes = [];
  for (const t of tests) {
    if (t.status === 'passed') {
      passes.push(t.title);
      continue;
    }
    if (t.status !== 'failed') continue;
    const packLabel = (t.ancestorTitles ?? []).slice(-1)[0] ?? '';
    const packId = packLabel.split(' — ')[0].replace(/^pack:\s*/, '').trim();
    const msg = (t.failureMessages ?? []).join('\n');
    const strategy = /strategy:\s*([a-z0-9-]+)/i.exec(msg)?.[1] ?? '?';
    const missed = /no anyOfContains matched:\s*([^\n]+)/i.exec(msg)?.[1]?.slice(0, 90)
      ?? /-\s*(.+?)$/m.exec(msg)?.[1]?.slice(0, 90)
      ?? '(unknown)';
    fails.push(`${packId}/${t.title} | ${strategy} | ${missed}`);
  }
  console.log(`PASS ${passes.length} / FAIL ${fails.length} / TOTAL ${tests.length}\n`);
  console.log('FAILURES (pack/scenario | strategy | missed):');
  for (const line of fails) console.log('  ' + line);
  process.exit(0);
});
