#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { currentSourceFingerprint } from './vai-ptt-target-audit.mjs';

export function buildPttBinaryManifest({ vaiExe, targetExe, driverExe }) {
  const binaries = Object.fromEntries(Object.entries({
    vai: vaiExe,
    target: targetExe,
    driver: driverExe,
  }).map(([name, value]) => {
    const resolved = path.resolve(value);
    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      throw new Error(`${name} binary does not exist: ${resolved}`);
    }
    const canonical = realpathSync.native(resolved);
    const bytes = readFileSync(canonical);
    return [name, {
      path: canonical,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }];
  }));
  const expectedNames = {
    vai: 'veggaai.exe',
    target: 'vai_ptt_target.exe',
    driver: 'vai_ptt_fixture_driver.exe',
  };
  for (const [name, binary] of Object.entries(binaries)) {
    const segments = binary.path.toLowerCase().split(/[\\/]+/);
    if (path.basename(binary.path).toLowerCase() !== expectedNames[name]
      || !segments.some((value, index) => value === 'target' && segments[index + 1] === 'release')) {
      throw new Error(`${name} must be the exact Cargo target/release executable`);
    }
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceFingerprint: currentSourceFingerprint(),
    buildContract: {
      cargoProfile: 'release',
      dangerousPttFixture: true,
      renderer: 'embedded-release-assets',
      cargoLock: path.resolve('apps/desktop/src-tauri/Cargo.lock'),
      cargoManifest: path.resolve('apps/desktop/src-tauri/Cargo.toml'),
      tauriConfig: path.resolve('apps/desktop/src-tauri/tauri.conf.json'),
    },
    binaries,
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { vaiExe: '', targetExe: '', driverExe: '', out: '' };
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === '--vai-exe') result.vaiExe = args[++index] ?? '';
    else if (key === '--target-exe') result.targetExe = args[++index] ?? '';
    else if (key === '--driver-exe') result.driverExe = args[++index] ?? '';
    else if (key === '--out') result.out = args[++index] ?? '';
    else if (key === '--help') {
      console.log('Usage: node scripts/vai-ptt-binary-manifest.mjs --vai-exe veggaai.exe --target-exe vai_ptt_target.exe --driver-exe vai_ptt_fixture_driver.exe --out binary-manifest.json');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${key}`);
  }
  if (Object.values(result).some((value) => !value)) throw new Error('All binary paths and --out are required');
  return result;
}

function main() {
  const args = parseArgs();
  const output = path.resolve(args.out);
  if (existsSync(output)) throw new Error(`Refusing to overwrite binary manifest: ${output}`);
  mkdirSync(path.dirname(output), { recursive: true });
  const manifest = buildPttBinaryManifest(args);
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  console.log(`VAI_PTT_BINARY_MANIFEST ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) {
    console.error(`VAI_PTT_BINARY_MANIFEST_ERROR ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
