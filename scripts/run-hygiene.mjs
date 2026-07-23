#!/usr/bin/env node
/** Cross-platform hygiene pipeline; avoids shell-specific `&&` semantics. */
import { spawnSync } from 'node:child_process';

const checks = [
  'scripts/check-repo-hygiene.mjs',
  'scripts/check-source-integrity.mjs',
  'scripts/check-write-path-discipline.mjs',
];

for (const check of checks) {
  const result = spawnSync(process.execPath, [check], { stdio: 'inherit' });
  if (result.error) {
    console.error(`hygiene runner could not start ${check}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
