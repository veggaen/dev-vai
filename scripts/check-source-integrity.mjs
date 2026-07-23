#!/usr/bin/env node
/**
 * Source-integrity gate for crashed/binary editor writes.
 *
 * Default mode is read-only and fails on literal NUL bytes in tracked text
 * source. `--repair` performs only two semantics-preserving recoveries:
 * trailing NUL padding is removed, and literal NUL characters inside JS/TS
 * source are rewritten as the equivalent `\0` escape. UTF-16 files with a BOM
 * are valid encoded text and are intentionally excluded.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const repair = process.argv.includes('--repair');
const repoRoot = process.cwd();
const textExtensions = new Set([
  '.css', '.html', '.js', '.jsx', '.json', '.md', '.mjs', '.mts',
  '.scss', '.ts', '.tsx', '.txt', '.yaml', '.yml',
]);
const scriptExtensions = new Set(['.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const tracked = execFileSync('git', ['ls-files', '-z'], {
  cwd: repoRoot,
  maxBuffer: 64 * 1024 * 1024,
}).toString('utf8').split('\0').filter(Boolean);

const failures = [];
const repaired = [];

for (const relativePath of tracked) {
  const extension = extname(relativePath).toLowerCase();
  if (!textExtensions.has(extension)) continue;
  const absolutePath = join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) continue;
  const body = readFileSync(absolutePath);
  const utf16Bom = body.length >= 2
    && ((body[0] === 0xff && body[1] === 0xfe) || (body[0] === 0xfe && body[1] === 0xff));
  if (utf16Bom) continue;

  const firstNul = body.indexOf(0);
  if (firstNul < 0) continue;
  const trailingPadding = body.subarray(firstNul).every((byte) => byte === 0);

  if (!repair) {
    failures.push(`${relativePath}: literal NUL byte at offset ${firstNul}${trailingPadding ? ' (trailing padding)' : ''}`);
    continue;
  }

  if (trailingPadding) {
    writeFileSync(absolutePath, body.subarray(0, firstNul));
    repaired.push(`${relativePath}: removed ${body.length - firstNul} trailing NUL byte(s)`);
    continue;
  }

  if (!scriptExtensions.has(extension)) {
    failures.push(`${relativePath}: embedded NUL byte requires manual review`);
    continue;
  }

  const chunks = [];
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== 0) continue;
    chunks.push(body.subarray(start, index), Buffer.from('\\0'));
    start = index + 1;
  }
  chunks.push(body.subarray(start));
  writeFileSync(absolutePath, Buffer.concat(chunks));
  repaired.push(`${relativePath}: escaped embedded NUL byte(s) for review`);
}

for (const message of repaired) console.log(`source integrity repair: ${message}`);
if (failures.length > 0) {
  console.error(`source integrity: ${failures.length} violation(s)`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`source integrity: clean (${tracked.length} tracked paths checked)`);
