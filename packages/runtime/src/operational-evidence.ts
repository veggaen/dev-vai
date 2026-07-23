import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { VaiOperationalEvidenceSnapshot } from '@vai/core';

type RepositoryEvidence = VaiOperationalEvidenceSnapshot['repository'];
type VerificationEvidence = VaiOperationalEvidenceSnapshot['verification'];
type SelfImprovementEvidence = VaiOperationalEvidenceSnapshot['selfImprovement'];

export interface VaiOperationalEvidenceReaders {
  readonly now?: () => Date;
  readonly repository?: (repoRoot: string) => RepositoryEvidence;
  readonly verification?: (repoRoot: string, now: Date) => VerificationEvidence;
  readonly selfImprovement?: (repoRoot: string) => SelfImprovementEvidence;
}

function boundedError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, ' ').trim().slice(0, 180) || 'unknown read failure';
}

function unavailableRepository(error: unknown): RepositoryEvidence {
  return {
    sourceId: 'git:status',
    available: false,
    branch: null,
    changedFiles: null,
    modifiedFiles: null,
    untrackedFiles: null,
    error: boundedError(error),
  };
}

function readRepository(repoRoot: string): RepositoryEvidence {
  try {
    const output = execFileSync(
      'git',
      ['status', '--short', '--branch', '--untracked-files=all'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 1_200,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    const lines = output.split(/\r?\n/).filter(Boolean);
    const header = lines[0]?.startsWith('## ') ? lines.shift()! : '';
    const branchToken = header.slice(3).split('...')[0]?.split(/\s+/)[0] ?? '';
    const branch = !branchToken || branchToken === 'HEAD' || branchToken === 'No'
      ? null
      : branchToken;
    const untrackedFiles = lines.filter((line) => line.startsWith('??')).length;
    const modifiedFiles = lines.length - untrackedFiles;
    return {
      sourceId: 'git:status',
      available: true,
      branch,
      changedFiles: lines.length,
      modifiedFiles,
      untrackedFiles,
    };
  } catch (error) {
    return unavailableRepository(error);
  }
}

function unavailableVerification(error: unknown): VerificationEvidence {
  return {
    sourceId: 'verification:receipt',
    available: false,
    status: 'unknown',
    capturedAt: null,
    totalTestsPassed: null,
    typechecks: [],
    stale: true,
    error: boundedError(error),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readVerification(repoRoot: string, now: Date): VerificationEvidence {
  const receiptPath = path.join(repoRoot, 'docs', 'vai-verification-receipt.json');
  if (!existsSync(receiptPath)) return unavailableVerification('verification receipt not found');
  try {
    const parsed: unknown = JSON.parse(readFileSync(receiptPath, 'utf8'));
    if (!isRecord(parsed)) throw new Error('verification receipt is not an object');
    const capturedAt = typeof parsed.capturedAt === 'string' ? parsed.capturedAt : null;
    const capturedMs = capturedAt ? Date.parse(capturedAt) : Number.NaN;
    const status = parsed.status === 'pass' || parsed.status === 'fail' ? parsed.status : 'unknown';
    const totalTestsPassed = typeof parsed.totalTestsPassed === 'number'
      && Number.isFinite(parsed.totalTestsPassed)
      ? parsed.totalTestsPassed
      : null;
    const typechecks = Array.isArray(parsed.typechecks)
      ? parsed.typechecks.filter((entry): entry is string => typeof entry === 'string')
      : [];
    return {
      sourceId: 'verification:receipt',
      available: true,
      status,
      capturedAt,
      totalTestsPassed,
      typechecks,
      stale: !Number.isFinite(capturedMs) || Math.abs(now.getTime() - capturedMs) > 24 * 60 * 60 * 1_000,
    };
  } catch (error) {
    return unavailableVerification(error);
  }
}

function unavailableSelfImprovement(error: unknown): SelfImprovementEvidence {
  return {
    sourceId: 'self-improve:corpus',
    available: false,
    queuedFixes: null,
    qualified: null,
    adopted: null,
    pendingNominations: null,
    integratedNominations: null,
    latestRunStatus: null,
    latestRunAt: null,
    error: boundedError(error),
  };
}

function readSelfImprovement(repoRoot: string): SelfImprovementEvidence {
  const dbPath = path.join(repoRoot, 'scripts', 'improve-loop', '.corpus.sqlite');
  if (!existsSync(dbPath)) return unavailableSelfImprovement('self-improvement corpus not found');
  let db: Database.Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const tables = new Set(tableRows.map((row) => row.name));
    const queuedFixes = tables.has('fixes')
      ? Number((db.prepare("SELECT COUNT(*) AS count FROM fixes WHERE status='queued'").get() as { count?: number } | undefined)?.count ?? 0)
      : null;
    const compute = tables.has('compute_log')
      ? db.prepare('SELECT COALESCE(SUM(qualified), 0) AS qualified, COALESCE(SUM(adopted), 0) AS adopted FROM compute_log').get() as { qualified?: number; adopted?: number }
      : undefined;
    const nominationRows = tables.has('self_improve_queue')
      ? db.prepare('SELECT status, COUNT(*) AS count FROM self_improve_queue GROUP BY status').all() as Array<{ status: string; count: number }>
      : [];
    const nominations = new Map(nominationRows.map((row) => [row.status, Number(row.count)]));
    const latestRun = tables.has('runs')
      ? db.prepare('SELECT status, started_at, ended_at FROM runs ORDER BY id DESC LIMIT 1').get() as { status?: string; started_at?: string; ended_at?: string | null } | undefined
      : undefined;
    return {
      sourceId: 'self-improve:corpus',
      available: true,
      queuedFixes,
      qualified: compute ? Number(compute.qualified ?? 0) : null,
      adopted: compute ? Number(compute.adopted ?? 0) : null,
      pendingNominations: tables.has('self_improve_queue') ? (nominations.get('queued') ?? 0) : null,
      integratedNominations: tables.has('self_improve_queue') ? (nominations.get('integrated') ?? 0) : null,
      latestRunStatus: latestRun?.status ?? null,
      latestRunAt: latestRun?.ended_at ?? latestRun?.started_at ?? null,
    };
  } catch (error) {
    return unavailableSelfImprovement(error);
  } finally {
    db?.close();
  }
}

/** Collect a bounded, read-only packet that Vai can cite during self-assessment. */
export function collectVaiOperationalEvidence(
  repoRoot: string,
  readers: VaiOperationalEvidenceReaders = {},
): VaiOperationalEvidenceSnapshot {
  const now = readers.now?.() ?? new Date();
  return {
    capturedAt: now.toISOString(),
    runtime: {
      sourceId: 'runtime:process',
      healthy: true,
      engine: 'vai:v0',
    },
    repository: (readers.repository ?? readRepository)(repoRoot),
    verification: (readers.verification ?? readVerification)(repoRoot, now),
    selfImprovement: (readers.selfImprovement ?? readSelfImprovement)(repoRoot),
  };
}

/**
 * Create the runtime provider. A short cache avoids repeatedly walking Git and
 * SQLite when introspection and chat inspect the same state back-to-back.
 */
export function createVaiOperationalEvidenceProvider(
  repoRoot: string,
  options: { readonly cacheMs?: number; readonly readers?: VaiOperationalEvidenceReaders } = {},
): () => VaiOperationalEvidenceSnapshot {
  const cacheMs = options.cacheMs ?? 2_000;
  let cached: VaiOperationalEvidenceSnapshot | undefined;
  let cachedAt = 0;
  return () => {
    const now = Date.now();
    if (cached && now - cachedAt <= cacheMs) return cached;
    cached = collectVaiOperationalEvidence(repoRoot, options.readers);
    cachedAt = now;
    return cached;
  };
}
