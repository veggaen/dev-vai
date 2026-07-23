import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopManifestPath = path.join(repoRoot, 'apps', 'desktop', 'package.json');
const cargoLockPath = path.join(repoRoot, 'apps', 'desktop', 'src-tauri', 'Cargo.lock');

const [desktopManifestText, cargoLock] = await Promise.all([
  readFile(desktopManifestPath, 'utf8'),
  readFile(cargoLockPath, 'utf8'),
]);
const desktopManifest = JSON.parse(desktopManifestText);
const apiVersion = desktopManifest.dependencies?.['@tauri-apps/api'];
if (typeof apiVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(apiVersion)) {
  console.error(
    '[tauri-version-line] @tauri-apps/api must be an exact version in apps/desktop/package.json; '
    + `received ${JSON.stringify(apiVersion)}.`,
  );
  process.exitCode = 1;
} else {
  const rustMatch = cargoLock.match(
    /\[\[package\]\]\r?\nname = "tauri"\r?\nversion = "([^"]+)"/,
  );
  if (!rustMatch) {
    console.error('[tauri-version-line] Could not find the Rust tauri package in Cargo.lock.');
    process.exitCode = 1;
  } else {
    const rustVersion = rustMatch[1];
    const apiLine = apiVersion.split('.').slice(0, 2).join('.');
    const rustLine = rustVersion.split('.').slice(0, 2).join('.');
    if (apiLine !== rustLine) {
      console.error(
        `[tauri-version-line] Runtime boundary mismatch: @tauri-apps/api ${apiVersion} `
        + `is not on the Rust tauri ${rustVersion} version line. Align both to ${rustLine}.x.`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        `[tauri-version-line] PASS: @tauri-apps/api ${apiVersion} and Rust tauri ${rustVersion} share ${apiLine}.x.`,
      );
    }
  }
}
