#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const args = [
  'scripts/verify-t3-blind-rebuilds.mjs',
  '--spec-file',
  'scripts/specs/erhathaway-blind-rebuilds.json',
  '--suite-name',
  'erhathaway',
  '--source-leak-pattern',
  'erhathaway|github\\.com/erhathaway',
  ...process.argv.slice(2),
];

const result = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  env: process.env,
  shell: false,
});

process.exit(result.status ?? 1);
