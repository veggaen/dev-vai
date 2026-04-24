import { spawnSync } from 'node:child_process';
import path from 'node:path';

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const desktopDir = process.cwd();
const workspaceRoot = path.resolve(desktopDir, '..', '..');
const bundles = process.env.VAI_TAURI_BUNDLES?.trim();
const tauriBuildArgs = ['exec', 'tauri', 'build'];

if (bundles === 'none') {
  tauriBuildArgs.push('--no-bundle');
} else if (bundles) {
  tauriBuildArgs.push('--bundles', bundles);
}

run('node', ['scripts/build-sidecar.mjs'], workspaceRoot);
run('pnpm', tauriBuildArgs, desktopDir);
run('node', ['../../scripts/sync-desktop-build.mjs'], desktopDir);