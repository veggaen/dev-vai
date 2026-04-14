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
import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const RUNTIME_BUNDLE = join(ROOT, 'packages/runtime/dist/bundle.cjs');
const BINARIES_DIR = join(ROOT, 'apps/desktop/src-tauri/binaries');
const RESOURCES_DIR = join(ROOT, 'apps/desktop/src-tauri/resources/runtime');
const RUNTIME_DIST_DIR = join(RESOURCES_DIR, 'dist');
const RUNTIME_NODE_MODULES_DIR = join(RESOURCES_DIR, 'node_modules');
const OUTPUT = join(BINARIES_DIR, 'vai-runtime-x86_64-pc-windows-msvc.exe');
const require = createRequire(import.meta.url);
const BETTER_SQLITE3_DIR = resolve(require.resolve('better-sqlite3/package.json'), '..');
const BINDINGS_DIR = resolve(require.resolve('bindings/package.json'), '..');
const FILE_URI_TO_PATH_DIR = resolve(require.resolve('file-uri-to-path/package.json'), '..');

// 1. Always rebuild the runtime bundle so packaged desktop stays in sync with runtime source changes.
console.log('[sidecar] Building runtime bundle...');
execSync('pnpm --filter @vai/runtime build:bundle', { cwd: ROOT, stdio: 'inherit' });

// 2. Ensure output dirs exist
if (!existsSync(BINARIES_DIR)) {
  mkdirSync(BINARIES_DIR, { recursive: true });
}
rmSync(RESOURCES_DIR, { recursive: true, force: true });
mkdirSync(RUNTIME_DIST_DIR, { recursive: true });
mkdirSync(RUNTIME_NODE_MODULES_DIR, { recursive: true });

// 3. Copy the Node runtime binary as the sidecar executable.
console.log('[sidecar] Copying node.exe as sidecar binary...');
copyFileSync(process.execPath, OUTPUT);

// 4. Copy the runtime script and native modules into Tauri resources.
console.log('[sidecar] Copying runtime bundle resources...');
copyFileSync(RUNTIME_BUNDLE, join(RUNTIME_DIST_DIR, 'bundle.cjs'));
cpSync(BETTER_SQLITE3_DIR, join(RUNTIME_NODE_MODULES_DIR, 'better-sqlite3'), { recursive: true, force: true });
cpSync(BINDINGS_DIR, join(RUNTIME_NODE_MODULES_DIR, 'bindings'), { recursive: true, force: true });
cpSync(FILE_URI_TO_PATH_DIR, join(RUNTIME_NODE_MODULES_DIR, 'file-uri-to-path'), { recursive: true, force: true });

console.log(`[sidecar] Done! Sidecar built at: ${OUTPUT}`);
