import { describe, expect, it, vi } from 'vitest';
import {
  collectVaiOperationalEvidence,
  createVaiOperationalEvidenceProvider,
  type VaiOperationalEvidenceReaders,
} from './operational-evidence.js';

function readers(): VaiOperationalEvidenceReaders {
  return {
    now: () => new Date('2026-07-19T07:54:13.000Z'),
    repository: () => ({
      sourceId: 'git:status', available: true, branch: 'cap/synthesis-page',
      changedFiles: 103, modifiedFiles: 82, untrackedFiles: 21,
    }),
    verification: () => ({
      sourceId: 'verification:receipt', available: true, status: 'pass',
      capturedAt: '2026-07-19T07:50:00.000Z', totalTestsPassed: 1179,
      typechecks: ['@vai/core', '@vai/runtime'], stale: false,
    }),
    selfImprovement: () => ({
      sourceId: 'self-improve:corpus', available: true, queuedFixes: 302,
      qualified: 86, adopted: 0, pendingNominations: 2, integratedNominations: 1,
      latestRunStatus: 'aborted-runtime-down', latestRunAt: '2026-07-02T05:46:56.677Z',
    }),
  };
}

describe('Vai operational evidence', () => {
  it('assembles source-labelled evidence without a model', () => {
    const snapshot = collectVaiOperationalEvidence('C:\\repo', readers());
    expect(snapshot.runtime).toEqual({
      sourceId: 'runtime:process', healthy: true, engine: 'vai:v0',
    });
    expect(snapshot.repository.changedFiles).toBe(103);
    expect(snapshot.verification.totalTestsPassed).toBe(1179);
    expect(snapshot.selfImprovement).toMatchObject({ qualified: 86, adopted: 0 });
  });

  it('caches back-to-back reads to keep self-assessment bounded', () => {
    const base = readers();
    const repository = vi.fn(base.repository!);
    const provider = createVaiOperationalEvidenceProvider('C:\\repo', {
      cacheMs: 60_000,
      readers: { ...base, repository },
    });
    expect(provider()).toBe(provider());
    expect(repository).toHaveBeenCalledTimes(1);
  });
});
