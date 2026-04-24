import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const targetDir = process.env.VAI_DESKTOP_SYNC_DIR?.trim() || path.join(os.homedir(), 'Documents', 'veggaAi');
const targetExe = path.join(targetDir, 'veggaai.exe');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function log(message) {
  console.log(`[app:update] ${message}`);
}

if (process.platform === 'win32') {
  log('Closing any running VeggaAI desktop process.');
  spawnSync('powershell', ['-NoProfile', '-Command', "Stop-Process -Name veggaai,vai-runtime -Force -ErrorAction SilentlyContinue"], {
    stdio: 'inherit',
  });
}

log('Building and syncing desktop app.');
run('pnpm', ['--filter', '@vai/desktop', 'build:tauri'], {
  env: {
    ...process.env,
    VAI_TAURI_BUNDLES: 'none',
  },
});

log(`Launching ${targetExe}`);
const child = spawn(targetExe, {
  detached: true,
  stdio: 'ignore',
});

child.unref();
log('VeggaAI desktop updated and relaunched.');