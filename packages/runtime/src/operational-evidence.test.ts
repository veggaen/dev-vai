import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PERSISTED_NAMES } from '@vai/constants';
import {
  collectVaiOperationalEvidence,
  createVaiOperationalEvidenceProvider,
  type VaiOperationalEvidenceReaders,
} from './operational-evidence.js';
import type { VaiOperationalRoots } from './operational-roots.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function sourceRoots(sourcePath = 'C:\\repo'): VaiOperationalRoots {
  return {
    runtimeKind: 'source',
    source: { path: sourcePath, origin: 'explicit' },
    buildEvidence: {
      origin: 'unavailable',
      error: 'No embedded evidence in source tests.',
    },
    userData: { path: 'C:\\data', origin: 'database' },
  };
}

function readers(): VaiOperationalEvidenceReaders {
  return {
    now: () => new Date('2026-07-19T07:54:13.000Z'),
    build: () => ({
      sourceId: 'build:source-git',
      available: true,
      runtimeKind: 'source',
      commit: 'a'.repeat(40),
      branch: 'cap/synthesis-page',
      version: '0.2.0',
      builtAt: null,
      dirty: true,
    }),
    repository: () => ({
      sourceId: 'git:source-status', available: true, branch: 'cap/synthesis-page',
      changedFiles: 103, modifiedFiles: 82, untrackedFiles: 21,
    }),
    verification: () => ({
      sourceId: 'verification:source-receipt', available: true, status: 'pass',
      capturedAt: '2026-07-19T07:50:00.000Z', totalTestsPassed: 1179,
      typechecks: ['@vai/core', '@vai/runtime'], stale: false,
    }),
    selfImprovement: () => ({
      sourceId: 'self-improve:source-corpus', available: true, queuedFixes: 302,
      qualified: 86, adopted: 0, pendingNominations: 2, integratedNominations: 1,
      latestRunStatus: 'aborted-runtime-down', latestRunAt: '2026-07-02T05:46:56.677Z',
    }),
  };
}

describe('Vai operational evidence', () => {
  it('assembles and validates source-labelled evidence without a model', () => {
    const snapshot = collectVaiOperationalEvidence(sourceRoots(), readers());
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      runtime: {
        sourceId: 'runtime:process',
        healthy: true,
        engine: 'vai:v0',
      },
      build: {
        sourceId: 'build:source-git',
        runtimeKind: 'source',
      },
    });
    expect(snapshot.repository.changedFiles).toBe(103);
    expect(snapshot.verification.totalTestsPassed).toBe(1179);
    expect(snapshot.selfImprovement).toMatchObject({ qualified: 86, adopted: 0 });
  });

  it('reads immutable build identity and receipt without inventing a source checkout', () => {
    const evidenceRoot = mkdtempSync(path.join(os.tmpdir(), 'vai-evidence-'));
    temporaryRoots.push(evidenceRoot);
    const receipt = {
      schemaVersion: 1,
      capturedAt: '2026-07-01T00:00:00.000Z',
      status: 'pass',
      totalTestsPassed: 42,
      typechecks: ['@vai/runtime'],
    };
    writeFileSync(
      path.join(evidenceRoot, PERSISTED_NAMES.buildManifest),
      JSON.stringify({
        schemaVersion: 1,
        commit: 'b'.repeat(40),
        branch: 'main',
        dirty: false,
        version: '0.2.0',
        builtAt: '2026-07-20T00:00:00.000Z',
        verificationReceiptSha256: 'c'.repeat(64),
      }),
    );
    writeFileSync(
      path.join(evidenceRoot, PERSISTED_NAMES.verificationReceipt),
      JSON.stringify(receipt),
    );
    const roots: VaiOperationalRoots = {
      runtimeKind: 'packaged',
      source: {
        origin: 'unavailable',
        error: 'No Vai source checkout is attached to this runtime.',
      },
      buildEvidence: { path: evidenceRoot, origin: 'explicit' },
      userData: { path: path.join(evidenceRoot, 'data'), origin: 'database' },
    };

    const snapshot = collectVaiOperationalEvidence(roots, {
      now: () => new Date('2026-07-23T00:00:00.000Z'),
    });

    expect(snapshot.build).toMatchObject({
      available: true,
      runtimeKind: 'packaged',
      commit: 'b'.repeat(40),
      version: '0.2.0',
    });
    expect(snapshot.repository).toMatchObject({
      available: false,
      sourceId: 'git:source-status',
    });
    expect(snapshot.verification).toMatchObject({
      available: true,
      sourceId: 'verification:embedded-receipt',
      stale: false,
      totalTestsPassed: 42,
    });
    expect(snapshot.selfImprovement).toMatchObject({
      available: false,
      sourceId: 'self-improve:source-corpus',
    });
  });

  it('caches back-to-back reads to keep self-assessment bounded', () => {
    const base = readers();
    const repository = vi.fn(base.repository!);
    const provider = createVaiOperationalEvidenceProvider(sourceRoots(), {
      cacheMs: 60_000,
      readers: { ...base, repository },
    });
    expect(provider()).toBe(provider());
    expect(repository).toHaveBeenCalledTimes(1);
  });
});
