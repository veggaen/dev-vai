#!/usr/bin/env node
/**
 * Run the in-process scenario bench (packages/core/__tests__/scenarios.test.ts).
 *
 * Sets VAI_SCENARIOS=1 and forwards args to vitest. Cross-platform (no cross-env).
 *
 * Usage:
 *   node scripts/vai-scenarios-run.mjs                 # run all packs
 *   node scripts/vai-scenarios-run.mjs -t ambiguous    # filter by vitest -t
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const target = 'packages/core/__tests__/scenarios.test.ts';
const extraArgs = process.argv.slice(2);

const isWindows = process.platform === 'win32';
const child = spawn(
  isWindows ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'vitest', 'run', target, ...extraArgs],
  {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, VAI_SCENARIOS: '1' },
    shell: isWindows,
  },
);
child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (err) => {
  console.error(`[vai-scenarios-run] ${err.message}`);
  process.exit(2);
});
