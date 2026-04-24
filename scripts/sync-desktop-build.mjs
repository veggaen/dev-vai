import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, '..');
const desktopRoot = path.join(workspaceRoot, 'apps', 'desktop', 'src-tauri');
const releaseDir = path.join(desktopRoot, 'target', 'release');
const bundleResourcesDir = path.join(releaseDir, 'resources');
const workspaceEnvFile = path.join(workspaceRoot, '.env');

const configuredTarget = process.env.VAI_DESKTOP_SYNC_DIR?.trim();
const defaultTarget = path.join(os.homedir(), 'Documents', 'veggaAi');
const targetDir = configuredTarget || defaultTarget;

const requiredArtifacts = [
  path.join(releaseDir, 'veggaai.exe'),
  path.join(releaseDir, 'vai-runtime.exe'),
];

function log(message) {
  console.log(`[desktop-sync] ${message}`);
}

if (process.platform !== 'win32') {
  log('Skipping sync because desktop sync is only configured for Windows.');
  process.exit(0);
}

for (const artifact of requiredArtifacts) {
  if (!existsSync(artifact)) {
    console.error(`[desktop-sync] Missing build artifact: ${artifact}`);
    process.exit(1);
  }
}

mkdirSync(targetDir, { recursive: true });

const targets = [
  {
    from: path.join(releaseDir, 'veggaai.exe'),
    to: path.join(targetDir, 'veggaai.exe'),
  },
  {
    from: path.join(releaseDir, 'vai-runtime.exe'),
    to: path.join(targetDir, 'vai-runtime.exe'),
  },
];

for (const entry of targets) {
  cpSync(entry.from, entry.to, { force: true });
  log(`Updated ${entry.to}`);
}

if (existsSync(bundleResourcesDir)) {
  cpSync(bundleResourcesDir, path.join(targetDir, 'resources'), {
    recursive: true,
    force: true,
  });
  log(`Updated ${path.join(targetDir, 'resources')}`);
}

if (existsSync(workspaceEnvFile)) {
  cpSync(workspaceEnvFile, path.join(targetDir, '.env'), { force: true });
  log(`Updated ${path.join(targetDir, '.env')}`);
}

log(`Desktop build synced to ${targetDir}`);