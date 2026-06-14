/**
 * FAST desktop runtime update — for TypeScript-only runtime/core changes.
 *
 * The full `app:update` does a Tauri/Rust rebuild (minutes, heavy CPU). But the desktop runs the
 * runtime as a bundled CJS file the Rust shell merely loads from disk:
 *   <app exe dir>/resources/runtime/dist/bundle.cjs
 * So when ONLY runtime/core TS changed (no Rust shell, no React UI), we just rebuild that ~2s
 * esbuild bundle, drop it into the installed app's resources, and relaunch. No Rust, no GPU.
 *
 * Use this for runtime logic changes (council, chat service, search, etc.).
 * Use `pnpm app:update` only when the Tauri shell or the React frontend changed.
 *
 * Usage:
 *   node scripts/update-desktop-runtime.mjs            # build + sync + relaunch
 *   node scripts/update-desktop-runtime.mjs --no-launch # build + sync only
 *   VAI_DESKTOP_SYNC_DIR=... node scripts/...          # override install dir
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const targetDir = process.env.VAI_DESKTOP_SYNC_DIR?.trim() || path.join(os.homedir(), 'Documents', 'veggaAi');
const targetExe = path.join(targetDir, 'veggaai.exe');
const liveBundle = path.join(targetDir, 'resources', 'runtime', 'dist', 'bundle.cjs');
const builtBundle = path.join(ROOT, 'packages', 'runtime', 'dist', 'bundle.cjs');
const noLaunch = process.argv.includes('--no-launch');

const log = (m) => console.log(`[runtime:update] ${m}`);

if (!existsSync(path.dirname(liveBundle))) {
  console.error(`[runtime:update] Installed app runtime not found at:\n  ${liveBundle}`);
  console.error('Run a full `pnpm app:update` once first (it creates the resources layout).');
  process.exit(1);
}

// 1. Rebuild the runtime bundle (esbuild — fast, no Rust).
log('Building runtime bundle (esbuild)…');
const build = spawnSync('pnpm', ['--filter', '@vai/runtime', 'build:bundle'], {
  cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32',
});
if (build.status !== 0) process.exit(build.status ?? 1);
if (!existsSync(builtBundle)) { console.error(`[runtime:update] Bundle not produced at ${builtBundle}`); process.exit(1); }

// 2. Stop the running app + its sidecar so the file isn't locked.
if (process.platform === 'win32') {
  log('Stopping running VeggaAI + runtime sidecar…');
  spawnSync('powershell', ['-NoProfile', '-Command',
    "Stop-Process -Name veggaai,vai-runtime -Force -ErrorAction SilentlyContinue"], { stdio: 'inherit' });
}

// 3. Copy the fresh bundle into the installed app's resources.
copyFileSync(builtBundle, liveBundle);
const kb = (statSync(liveBundle).size / 1024 / 1024).toFixed(1);
log(`Synced bundle.cjs (${kb} mb) → ${liveBundle}`);

// 4. Relaunch (unless asked not to).
if (noLaunch) { log('Done (no relaunch requested).'); process.exit(0); }
if (!existsSync(targetExe)) { log(`Built + synced, but ${targetExe} not found to relaunch.`); process.exit(0); }
log(`Relaunching ${targetExe}`);
spawn(targetExe, { detached: true, stdio: 'ignore' }).unref();
log('Live desktop now runs the updated runtime.');
