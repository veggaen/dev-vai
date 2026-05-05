#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const args = [
  'scripts/verify-t3-blind-rebuilds.mjs',
  '--spec-file',
  'scripts/specs/github-blind-rebuild-matrix.json',
  '--suite-name',
  'github-matrix',
  '--source-leak-pattern',
  't3dotgg|juliusmarminge|gaearon|erhathaway|yesiamrocks|pixelgridui|github\\.com/(?:t3dotgg|juliusmarminge|gaearon|erhathaway|yesiamrocks|pixelgridui)',
  ...process.argv.slice(2),
];

const result = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  env: process.env,
  shell: false,
});

process.exit(result.status ?? 1);
