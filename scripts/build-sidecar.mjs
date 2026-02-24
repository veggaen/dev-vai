/**
 * Build the VAI runtime as a Node.js Single Executable Application (SEA).
 *
 * This wraps the bundled runtime into a standalone .exe that Tauri
 * embeds as a sidecar — no Node.js installation needed on the user's machine.
 *
 * Prerequisites:
 *   - Node.js 22+ (for SEA support)
 *   - pnpm --filter @vai/runtime build:bundle (produces dist/bundle.cjs)
 *
 * Usage:
 *   node scripts/build-sidecar.mjs
 */

import { execSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const RUNTIME_BUNDLE = join(ROOT, 'packages/runtime/dist/bundle.cjs');
const BINARIES_DIR = join(ROOT, 'apps/desktop/src-tauri/binaries');
const SEA_CONFIG = join(BINARIES_DIR, 'sea-config.json');
const BLOB = join(BINARIES_DIR, 'sea-prep.blob');
const OUTPUT = join(BINARIES_DIR, 'vai-runtime-x86_64-pc-windows-msvc.exe');

// 1. Ensure the runtime bundle exists
if (!existsSync(RUNTIME_BUNDLE)) {
  console.log('[sidecar] Building runtime bundle...');
  execSync('pnpm --filter @vai/runtime build:bundle', { cwd: ROOT, stdio: 'inherit' });
}

// 2. Ensure binaries dir exists
if (!existsSync(BINARIES_DIR)) {
  mkdirSync(BINARIES_DIR, { recursive: true });
}

// 3. Write SEA config
writeFileSync(
  SEA_CONFIG,
  JSON.stringify(
    {
      main: RUNTIME_BUNDLE,
      output: BLOB,
      disableExperimentalSEAWarning: true,
    },
    null,
    2,
  ),
);

// 4. Generate SEA blob
console.log('[sidecar] Generating SEA blob...');
execSync(`node --experimental-sea-config "${SEA_CONFIG}"`, { stdio: 'inherit' });

// 5. Copy node.exe as base
console.log('[sidecar] Copying node.exe as sidecar base...');
copyFileSync(process.execPath, OUTPUT);

// 6. Inject blob into executable
console.log('[sidecar] Injecting SEA blob...');
execSync(
  `npx postject "${OUTPUT}" NODE_SEA_BLOB "${BLOB}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
  { stdio: 'inherit' },
);

console.log(`[sidecar] Done! Sidecar built at: ${OUTPUT}`);
