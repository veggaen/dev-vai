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
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join, resolve } from 'path';

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

function resolvePackageRoot(reqFrom, name) {
  try {
    return dirname(reqFrom.resolve(`${name}/package.json`));
  } catch {
    // Some packages hide package.json behind "exports".
  }

  let entryPath;
  try {
    entryPath = reqFrom.resolve(name);
  } catch (error) {
    throw new Error(`could not resolve "${name}": ${error.message}`);
  }

  let dir = dirname(entryPath);
  while (true) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(`could not find package root for "${name}" from ${entryPath}`);
}

function resolvePackageRootFromPnpmStore(name) {
  const pnpmDir = join(ROOT, 'node_modules', '.pnpm');
  if (!existsSync(pnpmDir)) return null;

  const encodedName = name.startsWith('@') ? name.replace('/', '+') : name;
  const packagePath = join(...name.split('/'));
  const matches = readdirSync(pnpmDir)
    .filter((entry) => entry === encodedName || entry.startsWith(`${encodedName}@`))
    .sort()
    .reverse();

  for (const entry of matches) {
    const pkgDir = join(pnpmDir, entry, 'node_modules', packagePath);
    if (existsSync(join(pkgDir, 'package.json'))) return pkgDir;
  }

  return null;
}

function resolvePackageRootWithWorkspaceFallback(reqFrom, name) {
  try {
    return resolvePackageRoot(reqFrom, name);
  } catch (primaryError) {
    try {
      return resolvePackageRoot(createRequire(join(ROOT, 'noop.js')), name);
    } catch {
      const pnpmStoreRoot = resolvePackageRootFromPnpmStore(name);
      if (pnpmStoreRoot) return pnpmStoreRoot;
      throw primaryError;
    }
  }
}

/**
 * Copy a package and its full runtime dependency closure into `destNodeModules`
 * as a FLAT node_modules (each package at top level). Needed for packages that
 * read their own files at runtime (jsdom → default-stylesheet.css, css-tree →
 * createRequire) and therefore cannot be esbuild-bundled; they must be
 * `--external` and resolvable from node_modules next to bundle.cjs.
 *
 * pnpm stores deps as siblings under .pnpm/<pkg>@<ver>/node_modules, so we
 * resolve each dependency from ITS PARENT's directory, not a single root.
 */
function copyPackageClosure(rootPkg, fromDir, destNodeModules) {
  const copied = new Set();
  const queue = [[rootPkg, fromDir]];

  while (queue.length > 0) {
    const [name, parentDir] = queue.shift();
    if (copied.has(name)) continue;

    let pkgJsonPath;
    try {
      const reqFrom = createRequire(join(parentDir, 'noop.js'));
      pkgJsonPath = join(resolvePackageRootWithWorkspaceFallback(reqFrom, name), 'package.json');
    } catch {
      // Some packages restrict "exports" and hide package.json; fall back to
      // resolving the package entry and walking up to its package root.
      try {
        const reqFrom = createRequire(join(parentDir, 'noop.js'));
        let dir = dirname(reqFrom.resolve(name));
        while (dir && !existsSync(join(dir, 'package.json'))) dir = dirname(dir);
        pkgJsonPath = join(dir, 'package.json');
      } catch {
        console.warn(`[sidecar]   ! could not resolve "${name}" from ${parentDir} — skipping`);
        continue;
      }
    }

    const pkgDir = dirname(pkgJsonPath);
    copied.add(name);
    const destDir = join(destNodeModules, name);
    mkdirSync(dirname(destDir), { recursive: true });
    cpSync(pkgDir, destDir, { recursive: true, force: true, dereference: true });

    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) };
    for (const dep of Object.keys(deps)) {
      if (!copied.has(dep)) queue.push([dep, pkgDir]);
    }
  }

  return copied;
}

// 1. Always rebuild the runtime bundle so packaged desktop stays in sync with runtime source changes.
console.log('[sidecar] Building runtime bundle...');
execSync('corepack pnpm --filter @vai/runtime build:bundle', { cwd: ROOT, stdio: 'inherit' });

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

// jsdom (+ css-tree etc.) read their own files / use createRequire at runtime,
// so they're `--external:jsdom` in build:bundle. Ship the whole closure flat.
// jsdom is a dependency of @vai/core (not the workspace root), so resolve it
// from the core package's context — pnpm's isolated node_modules hides it
// from scripts/ otherwise.
console.log('[sidecar] Copying jsdom dependency closure (external — cannot be bundled)...');
const coreRequire = createRequire(join(ROOT, 'packages/core/noop.js'));
const JSDOM_DIR = resolve(coreRequire.resolve('jsdom/package.json'), '..');
const jsdomClosure = copyPackageClosure('jsdom', resolve(JSDOM_DIR, '..'), RUNTIME_NODE_MODULES_DIR);
console.log(`[sidecar]   copied ${jsdomClosure.size} packages for jsdom`);

console.log('[sidecar] Copying @huggingface/transformers dependency closure (external — onnx runtime)...');
const runtimeRequire = createRequire(join(ROOT, 'packages/runtime/noop.js'));
const XENOVA_DIR = resolvePackageRoot(runtimeRequire, '@huggingface/transformers');
const xenovaClosure = copyPackageClosure('@huggingface/transformers', resolve(XENOVA_DIR, '..', '..'), RUNTIME_NODE_MODULES_DIR);
console.log(`[sidecar]   copied ${xenovaClosure.size} packages for @huggingface/transformers`);

// sharp ships native binaries via postinstall — copying the package alone is not enough.
const packagedSharp = join(RUNTIME_NODE_MODULES_DIR, 'sharp');
if (existsSync(join(packagedSharp, 'install', 'check.js'))) {
  console.log('[sidecar] Verifying sharp native binaries for packaged Whisper...');
  try {
    execSync('node install/check.js', { cwd: packagedSharp, stdio: 'inherit' });
  } catch (error) {
    console.warn('[sidecar]   ! sharp native verification failed — built-in Whisper may be unavailable:', error);
  }
}

console.log(`[sidecar] Done! Sidecar built at: ${OUTPUT}`);
