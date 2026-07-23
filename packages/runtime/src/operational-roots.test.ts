import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PERSISTED_NAMES } from '@vai/constants';
import {
  findVaiSourceRoot,
  resolveVaiOperationalRoots,
} from './operational-roots.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function makeSourceRoot(): string {
  const root = tempRoot('vai-source-');
  writeFileSync(path.join(root, PERSISTED_NAMES.agentsGuide), '# Vai');
  writeFileSync(path.join(root, 'package.json'), '{"name":"vai"}');
  return root;
}

function makeEvidenceRoot(): string {
  const root = tempRoot('vai-build-evidence-');
  writeFileSync(
    path.join(root, PERSISTED_NAMES.buildManifest),
    '{"schemaVersion":1}',
  );
  return root;
}

describe('operational roots', () => {
  it('discovers a source root from the runtime module, never cwd', () => {
    const sourceRoot = makeSourceRoot();
    const runtimeDir = path.join(sourceRoot, 'packages', 'runtime', 'src');
    mkdirSync(runtimeDir, { recursive: true });
    const unrelatedCwd = tempRoot('vai-unrelated-cwd-');
    const cwd = vi.spyOn(process, 'cwd').mockImplementation(() => {
      throw new Error('operational root resolution must not read cwd');
    });
    try {
      expect(findVaiSourceRoot(runtimeDir)).toBe(sourceRoot);
      const roots = resolveVaiOperationalRoots({
        runtimeFile: path.join(runtimeDir, 'index.ts'),
        dbPath: path.join(unrelatedCwd, 'data', 'vai.db'),
        env: {},
      });
      expect(roots).toMatchObject({
        runtimeKind: 'source',
        source: { path: sourceRoot, origin: 'runtime-module' },
      });
    } finally {
      cwd.mockRestore();
    }
  });

  it('uses explicit packaged evidence and keeps source unavailable', () => {
    const evidenceRoot = makeEvidenceRoot();
    const installRoot = tempRoot('vai-install-');
    const roots = resolveVaiOperationalRoots({
      runtimeFile: path.join(installRoot, 'resources', 'runtime', 'dist', 'bundle.cjs'),
      dbPath: path.join(installRoot, 'data', 'vai.db'),
      env: { VAI_BUILD_EVIDENCE_ROOT: evidenceRoot },
    });
    expect(roots).toMatchObject({
      runtimeKind: 'packaged',
      source: { origin: 'unavailable' },
      buildEvidence: { path: evidenceRoot, origin: 'explicit' },
      userData: { path: path.join(installRoot, 'data'), origin: 'database' },
    });
  });

  it('does not hide an invalid explicit source root behind discovery', () => {
    const realSource = makeSourceRoot();
    const runtimeFile = path.join(realSource, 'packages', 'runtime', 'src', 'index.ts');
    const invalidSource = tempRoot('vai-invalid-source-');
    const roots = resolveVaiOperationalRoots({
      runtimeFile,
      dbPath: path.join(realSource, 'vai.db'),
      env: { VAI_SOURCE_ROOT: invalidSource },
    });
    expect(roots.source.path).toBeUndefined();
    expect(roots.source.error).toContain('Explicit Vai source root is invalid');
    expect(roots.runtimeKind).toBe('unknown');
  });
});
