#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const args = [
  'scripts/verify-t3-blind-rebuilds.mjs',
  '--spec-file',
  'scripts/specs/julius-blind-rebuilds.json',
  '--suite-name',
  'julius',
  '--source-leak-pattern',
  'juliusmarminge|github\\.com/juliusmarminge',
  ...process.argv.slice(2),
];

const result = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  env: process.env,
  shell: false,
});

process.exit(result.status ?? 1);
