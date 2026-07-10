#!/usr/bin/env node
/**
 * Repo hygiene gate — slop is a defect class.
 *
 * Fails CI (and `pnpm hygiene`) when:
 *   1. A tracked file/dir appears at repo root that is not on the allowlist.
 *   2. A tracked path anywhere matches a banned-slop pattern
 *      (scratch logs, __pycache__, ztemp dirs, db/bak dumps, "_debug" files,
 *      filenames with spaces).
 *   3. A tracked file is zero bytes (dead placeholder).
 *
 * Root allowlist is explicit on purpose: adding a new root entry should be a
 * deliberate, reviewed decision, not a drive-by.
 */
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT_ALLOWLIST = new Set([
  // config / meta
  '.coderabbit.yaml',
  '.cursor',
  '.env.example',
  '.gitattributes',
  '.github',
  '.gitignore',
  '.npmrc',
  '.nvmrc',
  '.prettierignore',
  '.prettierrc.json',
  'eslint.config.js',
  'tsconfig.base.json',
  'turbo.json',
  'vitest.config.ts',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  // docs / doctrine
  'AGENTS.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'MASTER_PROMPT.md',
  'MDS',
  'Master.example.md',
  'Master.md',
  'README.md',
  'SECURITY.md',
  'docs',
  // workspaces
  'apps',
  'packages',
  'scripts',
  'tests',
  'eval',
  'skills',
  'skills-lock.json',
  // runtime knowledge (referenced by improve-loop + runtime server)
  'vai-knowledge.json',
  // docker
  'Dockerfile',
  'docker',
  'docker-compose.dev.yml',
  'docker-compose.sandboxes.yml',
  'docker-compose.yml',
]);

const BANNED_PATTERNS = [
  { re: /(^|\/)__pycache__(\/|$)/, why: 'python bytecode cache' },
  { re: /(^|\/)ztemp[^/]*(\/|$)/i, why: 'ztemp scratch dir' },
  { re: /\.log$/, why: 'log file (generated output)' },
  { re: /\.(db|sqlite|sqlite3)$/, why: 'database file' },
  { re: /\.bak(\.|-|$)/, why: 'backup dump' },
  { re: /(^|\/)_debug[^/]*$/, why: 'debug scratch file' },
  { re: /COPYALL/i, why: 'editor-dump scratch file' },
  { re: / /, why: 'filename contains spaces' },
];

// Paths intentionally exempt from banned patterns (each needs a reason).
const EXEMPT = [
  // (none currently)
];

const repoRoot = process.cwd();
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 })
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

const failures = [];

// 1. Root allowlist
const rootEntries = new Set(tracked.map((p) => p.split('/')[0]));
for (const entry of rootEntries) {
  if (!ROOT_ALLOWLIST.has(entry)) {
    failures.push(`root entry not on allowlist: ${entry} (add deliberately in scripts/check-repo-hygiene.mjs or remove it)`);
  }
}

// 2. Banned patterns + 3. zero-byte files
for (const p of tracked) {
  if (EXEMPT.some((e) => p === e || p.startsWith(`${e}/`))) continue;
  for (const { re, why } of BANNED_PATTERNS) {
    if (re.test(p)) {
      failures.push(`banned pattern (${why}): ${p}`);
      break;
    }
  }
  try {
    const st = statSync(join(repoRoot, p));
    if (st.isFile() && st.size === 0) failures.push(`zero-byte tracked file: ${p}`);
  } catch {
    /* file may be deleted in working tree; git will surface that elsewhere */
  }
}

if (failures.length > 0) {
  console.error(`repo hygiene: ${failures.length} violation(s)\n`);
  for (const f of failures.sort()) console.error(`  ✗ ${f}`);
  console.error('\nSlop is a defect class. Quarantine dead files, gitignore generated output,');
  console.error('or (deliberately) extend the allowlist in scripts/check-repo-hygiene.mjs.');
  process.exit(1);
}

console.log(`repo hygiene: clean (${tracked.length} tracked files, ${rootEntries.size} root entries)`);
