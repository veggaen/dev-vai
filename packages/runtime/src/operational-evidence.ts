import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { PERSISTED_NAMES } from '@vai/constants';
import {
  vaiBuildManifestSchema,
  vaiOperationalEvidenceSnapshotSchema,
  type VaiOperationalEvidenceSnapshot,
} from '@vai/contracts/operational-evidence';
import type { VaiOperationalRoots } from './operational-roots.js';

type BuildEvidence = VaiOperationalEvidenceSnapshot['build'];
type RepositoryEvidence = VaiOperationalEvidenceSnapshot['repository'];
type VerificationEvidence = VaiOperationalEvidenceSnapshot['verification'];
type SelfImprovementEvidence = VaiOperationalEvidenceSnapshot['selfImprovement'];

export interface VaiOperationalEvidenceReaders {
  readonly now?: () => Date;
  readonly build?: (roots: VaiOperationalRoots) => BuildEvidence;
  readonly repository?: (roots: VaiOperationalRoots) => RepositoryEvidence;
  readonly verification?: (
    roots: VaiOperationalRoots,
    now: Date,
  ) => VerificationEvidence;
  readonly selfImprovement?: (
    roots: VaiOperationalRoots,
  ) => SelfImprovementEvidence;
}

function boundedError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, ' ').trim().slice(0, 180) || 'unknown read failure';
}

function unavailableBuild(
  roots: VaiOperationalRoots,
  error: unknown,
): BuildEvidence {
  return {
    sourceId: roots.runtimeKind === 'packaged'
      ? 'build:embedded-manifest'
      : 'build:source-git',
    available: false,
    runtimeKind: roots.runtimeKind,
    commit: null,
    branch: null,
    version: null,
    builtAt: null,
    dirty: null,
    error: boundedError(error),
  };
}

function unavailableRepository(error: unknown): RepositoryEvidence {
  return {
    sourceId: 'git:source-status',
    available: false,
    branch: null,
    changedFiles: null,
    modifiedFiles: null,
    untrackedFiles: null,
    error: boundedError(error),
  };
}

function unavailableVerification(
  error: unknown,
  sourceId = 'verification:source-receipt',
): VerificationEvidence {
  return {
    sourceId,
    available: false,
    status: 'unknown',
    capturedAt: null,
    totalTestsPassed: null,
    typechecks: [],
    stale: true,
    error: boundedError(error),
  };
}

function unavailableSelfImprovement(error: unknown): SelfImprovementEvidence {
  return {
    sourceId: 'self-improve:source-corpus',
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

function readSourceVersion(sourceRoot: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(
      path.join(sourceRoot, 'apps', 'desktop', 'package.json'),
      'utf8',
    )) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version.trim()
      ? parsed.version.trim()
      : null;
  } catch {
    return null;
  }
}

function readBuild(roots: VaiOperationalRoots): BuildEvidence {
  if (roots.runtimeKind === 'source' && roots.source.path) {
    try {
      const commandOptions = {
        cwd: roots.source.path,
        encoding: 'utf8' as const,
        timeout: 1_200,
        windowsHide: true,
      };
      const commit = execFileSync(
        'git',
        ['rev-parse', 'HEAD'],
        commandOptions,
      ).trim();
      const branch = execFileSync(
        'git',
        ['branch', '--show-current'],
        commandOptions,
      ).trim() || null;
      const dirty = execFileSync(
        'git',
        ['status', '--porcelain', '--untracked-files=all'],
        { ...commandOptions, maxBuffer: 2 * 1024 * 1024 },
      ).trim().length > 0;
      return {
        sourceId: 'build:source-git',
        available: true,
        runtimeKind: 'source',
        commit,
        branch,
        version: readSourceVersion(roots.source.path),
        builtAt: null,
        dirty,
      };
    } catch (error) {
      return unavailableBuild(roots, error);
    }
  }

  if (roots.buildEvidence.path) {
    const manifestPath = path.join(
      roots.buildEvidence.path,
      PERSISTED_NAMES.buildManifest,
    );
    try {
      const manifest = vaiBuildManifestSchema.parse(
        JSON.parse(readFileSync(manifestPath, 'utf8')),
      );
      return {
        sourceId: 'build:embedded-manifest',
        available: true,
        runtimeKind: 'packaged',
        commit: manifest.commit,
        branch: manifest.branch,
        version: manifest.version,
        builtAt: manifest.builtAt,
        dirty: manifest.dirty,
      };
    } catch (error) {
      return unavailableBuild(roots, error);
    }
  }

  return unavailableBuild(
    roots,
    roots.buildEvidence.error
      ?? roots.source.error
      ?? 'No build identity source is available.',
  );
}

function readRepository(roots: VaiOperationalRoots): RepositoryEvidence {
  if (!roots.source.path) {
    return unavailableRepository(
      roots.source.error ?? 'No Vai source checkout is attached to this runtime.',
    );
  }
  try {
    const output = execFileSync(
      'git',
      ['status', '--short', '--branch', '--untracked-files=all'],
      {
        cwd: roots.source.path,
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
      sourceId: 'git:source-status',
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readVerification(
  roots: VaiOperationalRoots,
  now: Date,
): VerificationEvidence {
  const sourceReceipt = roots.source.path
    ? path.join(
        roots.source.path,
        'docs',
        PERSISTED_NAMES.verificationReceipt,
      )
    : undefined;
  const embeddedReceipt = roots.buildEvidence.path
    ? path.join(
        roots.buildEvidence.path,
        PERSISTED_NAMES.verificationReceipt,
      )
    : undefined;
  const receiptPath = sourceReceipt ?? embeddedReceipt;
  const sourceId = sourceReceipt
    ? 'verification:source-receipt'
    : 'verification:embedded-receipt';
  if (!receiptPath) {
    return unavailableVerification(
      roots.source.error
        ?? roots.buildEvidence.error
        ?? 'No verification evidence root is available.',
      sourceId,
    );
  }
  if (!existsSync(receiptPath)) {
    return unavailableVerification('verification receipt not found', sourceId);
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(receiptPath, 'utf8'));
    if (!isRecord(parsed)) throw new Error('verification receipt is not an object');
    const capturedAt = typeof parsed.capturedAt === 'string' ? parsed.capturedAt : null;
    const capturedMs = capturedAt ? Date.parse(capturedAt) : Number.NaN;
    const status = parsed.status === 'pass' || parsed.status === 'fail'
      ? parsed.status
      : 'unknown';
    const totalTestsPassed = typeof parsed.totalTestsPassed === 'number'
      && Number.isFinite(parsed.totalTestsPassed)
      ? parsed.totalTestsPassed
      : null;
    const typechecks = Array.isArray(parsed.typechecks)
      ? parsed.typechecks.filter((entry): entry is string => typeof entry === 'string')
      : [];
    return {
      sourceId,
      available: true,
      status,
      capturedAt,
      totalTestsPassed,
      typechecks,
      stale: !Number.isFinite(capturedMs)
        || (Boolean(sourceReceipt)
          && Math.abs(now.getTime() - capturedMs) > 24 * 60 * 60 * 1_000),
    };
  } catch (error) {
    return unavailableVerification(error, sourceId);
  }
}

function readSelfImprovement(
  roots: VaiOperationalRoots,
): SelfImprovementEvidence {
  if (!roots.source.path) {
    return unavailableSelfImprovement(
      'No live Vai source workspace is attached; embedded builds contain no mutable improvement corpus.',
    );
  }
  const dbPath = path.join(
    roots.source.path,
    'scripts',
    'improve-loop',
    PERSISTED_NAMES.selfImprovementCorpus,
  );
  if (!existsSync(dbPath)) {
    return unavailableSelfImprovement('self-improvement corpus not found');
  }
  let db: Database.Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const tableRows = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'",
    ).all() as Array<{ name: string }>;
    const tables = new Set(tableRows.map((row) => row.name));
    const queuedFixes = tables.has('fixes')
      ? Number((db.prepare(
          "SELECT COUNT(*) AS count FROM fixes WHERE status='queued'",
        ).get() as { count?: number } | undefined)?.count ?? 0)
      : null;
    const compute = tables.has('compute_log')
      ? db.prepare(
          'SELECT COALESCE(SUM(qualified), 0) AS qualified, COALESCE(SUM(adopted), 0) AS adopted FROM compute_log',
        ).get() as { qualified?: number; adopted?: number }
      : undefined;
    const nominationRows = tables.has('self_improve_queue')
      ? db.prepare(
          'SELECT status, COUNT(*) AS count FROM self_improve_queue GROUP BY status',
        ).all() as Array<{ status: string; count: number }>
      : [];
    const nominations = new Map(
      nominationRows.map((row) => [row.status, Number(row.count)]),
    );
    const latestRun = tables.has('runs')
      ? db.prepare(
          'SELECT status, started_at, ended_at FROM runs ORDER BY id DESC LIMIT 1',
        ).get() as {
          status?: string;
          started_at?: string;
          ended_at?: string | null;
        } | undefined
      : undefined;
    return {
      sourceId: 'self-improve:source-corpus',
      available: true,
      queuedFixes,
      qualified: compute ? Number(compute.qualified ?? 0) : null,
      adopted: compute ? Number(compute.adopted ?? 0) : null,
      pendingNominations: tables.has('self_improve_queue')
        ? (nominations.get('queued') ?? 0)
        : null,
      integratedNominations: tables.has('self_improve_queue')
        ? (nominations.get('integrated') ?? 0)
        : null,
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
  roots: VaiOperationalRoots,
  readers: VaiOperationalEvidenceReaders = {},
): VaiOperationalEvidenceSnapshot {
  const now = readers.now?.() ?? new Date();
  return vaiOperationalEvidenceSnapshotSchema.parse({
    schemaVersion: 1,
    capturedAt: now.toISOString(),
    runtime: {
      sourceId: 'runtime:process',
      healthy: true,
      engine: 'vai:v0',
    },
    build: (readers.build ?? readBuild)(roots),
    repository: (readers.repository ?? readRepository)(roots),
    verification: (readers.verification ?? readVerification)(roots, now),
    selfImprovement: (readers.selfImprovement ?? readSelfImprovement)(roots),
  });
}

/**
 * Create the runtime provider. A short cache avoids repeatedly walking Git and
 * SQLite when introspection and chat inspect the same state back-to-back.
 */
export function createVaiOperationalEvidenceProvider(
  roots: VaiOperationalRoots,
  options: {
    readonly cacheMs?: number;
    readonly readers?: VaiOperationalEvidenceReaders;
  } = {},
): () => VaiOperationalEvidenceSnapshot {
  const cacheMs = options.cacheMs ?? 2_000;
  let cached: VaiOperationalEvidenceSnapshot | undefined;
  let cachedAt = 0;
  return () => {
    const now = Date.now();
    if (cached && now - cachedAt <= cacheMs) return cached;
    cached = collectVaiOperationalEvidence(roots, options.readers);
    cachedAt = now;
    return cached;
  };
}
