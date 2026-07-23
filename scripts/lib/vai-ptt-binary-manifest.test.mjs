import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildPttBinaryManifest } from '../vai-ptt-binary-manifest.mjs';

test('binds the three exact binary files and current source closure', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'vai-ptt-binaries-'));
  const releaseDirectory = path.join(directory, 'target', 'release');
  mkdirSync(releaseDirectory, { recursive: true });
  const files = ['veggaai.exe', 'vai_ptt_target.exe', 'vai_ptt_fixture_driver.exe']
    .map((name, index) => {
      const file = path.join(releaseDirectory, name);
      writeFileSync(file, `binary-${index}`, 'utf8');
      return file;
    });
  const manifest = buildPttBinaryManifest({
    vaiExe: files[0],
    targetExe: files[1],
    driverExe: files[2],
  });
  assert.equal(manifest.schemaVersion, 1);
  assert.match(manifest.sourceFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    Object.values(manifest.binaries).map((binary) => binary.path),
    files.map((file) => path.resolve(file)),
  );
  assert.equal(new Set(Object.values(manifest.binaries).map((binary) => binary.sha256)).size, 3);
});

test('source closure recursively binds the complete desktop and core source trees', () => {
  const files = new Set(
    readFileSync(path.resolve('scripts/vai-ptt-source-files.txt'), 'utf8')
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean),
  );
  for (const required of [
    'apps/desktop/src-tauri/src',
    'apps/desktop/src',
    'packages/api-types/src',
    'packages/core/src',
    'packages/ui/src',
    'package.json',
    'pnpm-workspace.yaml',
    'tsconfig.base.json',
    'scripts/build-desktop.mjs',
    'scripts/build-tauri-desktop.mjs',
  ]) {
    assert.equal(files.has(required), true, required);
  }
});
