#!/usr/bin/env node
/**
 * vai-score — standalone quality scoreboard CLI.
 *
 * Scores any wave-run JSONL (produced by either scripts/vai-corpus-benchmark.mjs
 * over WebSocket or scripts/vai-scale-engine.mjs in-process) into comparable
 * per-capability scores plus one overall score, writing scoreboard.json + .md
 * next to the input and printing a markdown table.
 *
 * Usage:
 *   node scripts/vai-score.mjs <run.jsonl> [--out <basePath>]
 *   pnpm vai:scoreboard artifacts/scale-engine/run-....jsonl
 */

import { existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const argv = process.argv.slice(2);

function getFlag(name) {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 ? argv[i + 1] : null;
}

const positional = argv.find((arg) => !arg.startsWith('--'));
if (!positional) {
  console.error('Usage: node scripts/vai-score.mjs <run.jsonl> [--out <basePath>]');
  process.exit(1);
}

const jsonlPath = isAbsolute(positional) ? positional : join(ROOT, positional);
if (!existsSync(jsonlPath)) {
  console.error(`Input not found: ${jsonlPath}`);
  process.exit(1);
}

const outFlag = getFlag('out');
const out = outFlag ? (isAbsolute(outFlag) ? outFlag : join(ROOT, outFlag)) : undefined;

const { scoreRun } = await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'vai-scoreboard.mjs')).href);
await scoreRun({ jsonlPath, out });
