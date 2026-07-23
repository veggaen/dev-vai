import { spawnSync } from 'node:child_process';
import path from 'node:path';

const workspaceRoot = path.resolve(import.meta.dirname, '..');

function runNode(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: workspaceRoot,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

runNode(path.join(workspaceRoot, 'scripts', 'check-platform-constants.mjs'));
runNode(
  path.join(workspaceRoot, 'node_modules', 'eslint', 'bin', 'eslint.js'),
  ['.'],
);
