import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'packages/constants/src/platform-values.json'), 'utf8'));
const scanRoots = [
  'packages/core/src/config',
  'packages/runtime/src',
  'apps/desktop/src',
  'apps/desktop/src-tauri/src',
];
const extensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.rs']);
const ignoredSegments = /(?:^|[\\/])(?:dist|target|node_modules)(?:[\\/]|$)|\.test\.[^.]+$/;
const persisted = Object.values(manifest.persistedNames);
const ports = Object.values(manifest.ports).map(String);

function* files(path) {
  if (!statSync(path).isDirectory()) { yield path; return; }
  for (const name of readdirSync(path)) {
    const child = join(path, name);
    if (ignoredSegments.test(child)) continue;
    if (statSync(child).isDirectory()) yield* files(child);
    else if (extensions.has(extname(child))) yield child;
  }
}

const violations = [];
for (const scanRoot of scanRoots) {
  for (const file of files(join(root, scanRoot))) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const code = line.replace(/\/\/.*$/, '');
      for (const value of persisted) {
        if (new RegExp(`['\"\x60][^'\"\x60]*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^'\"\x60]*['\"\x60]`).test(code)) {
          violations.push(`${relative(root, file)}:${index + 1} hardcodes persisted value ${value}`);
        }
      }
      for (const port of ports) {
        if (new RegExp(`(?:localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|VAI_PORT|DIRECT_PORT|port\\s*[:=])[^\n]{0,40}\b${port}\b`, 'i').test(code)) {
          violations.push(`${relative(root, file)}:${index + 1} hardcodes governed port ${port}`);
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error('Platform constants policy failed. Import @vai/constants (or consume platform-values.json in Rust):');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log('Platform constants policy passed.');
}
