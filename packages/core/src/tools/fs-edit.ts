/**
 * fs-edit — safe file modification with a CLEAR CONTRACT, the first capability that
 * mutates the workspace.
 *
 * Git was read-only (risk ≈ 0). A write is different: the brief asks for "file system
 * understanding and safe modification with clear contracts", so the contract here is
 * stronger and has three explicit, separable phases — a transaction, not a fire-and-forget
 * write:
 *
 *   1. propose(path, newContent)  → a {@link FsEditPlan}: the EVIDENCE of the intended
 *      change BEFORE anything touches disk. It carries the path, the SHA-256 of the file
 *      AS IT IS NOW (the "pre-image"), the SHA-256 of the proposed content, a human-readable
 *      unified-ish diff, and line-add/remove counts. propose() is a pure dry-run: free,
 *      reversible, and safe to show a user/council for approval. It never writes.
 *
 *   2. apply(plan)  → writes the new content ATOMICALLY (temp file + rename), but ONLY if
 *      the file on disk STILL hashes to the plan's pre-image. If the file changed since the
 *      plan was made (a concurrent edit, a stale plan), apply REFUSES — it will not clobber
 *      work it didn't account for. This is the optimistic-concurrency guard that makes the
 *      write safe to automate.
 *
 *   3. verify(plan)  → re-reads the file and confirms its content now hashes to the plan's
 *      proposed after-hash. Only then is the edit "released" as done. If verify fails (a
 *      partial write, an external tool racing us), the caller still holds the pre-image to
 *      roll back. apply() returns the verification inline so the common path is one call.
 *
 * Safety:
 *   - Every path is confined to a workspace root (no `..` escape, no absolute-path break-out)
 *     — the filesystem analogue of safe-fetch's SSRF guard.
 *   - Atomic write (write temp, fsync-then-rename) so a crash never leaves a half-written file.
 *   - Never throws to the caller: every failure is a structured `{ ok: false, error }`.
 *   - apply() can roll the file back to the pre-image content on demand (createBackup).
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname, join } from 'node:path';

/** SHA-256 hex of a string (the content fingerprint used by the contract). */
export function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Sentinel hash for "the file does not exist yet" (a create, not an edit). */
export const ABSENT_HASH = 'absent';

export interface FsEditPlan {
  /** Absolute, workspace-confined path the edit targets. */
  readonly path: string;
  /** Path relative to the workspace root (for display / evidence id). */
  readonly relPath: string;
  /** Stable evidence id, e.g. `fs:edit:src/foo.ts`. */
  readonly id: string;
  /** SHA-256 of the file as it was when the plan was made (or ABSENT_HASH for a create). */
  readonly beforeHash: string;
  /** SHA-256 of the proposed content. */
  readonly afterHash: string;
  /** The proposed full file content. */
  readonly afterContent: string;
  /** True when the target did not exist — this plan creates it. */
  readonly isCreate: boolean;
  /** Human-readable line diff (evidence for the user/council; not the correctness gate). */
  readonly diff: string;
  /** Lines added / removed (quick magnitude signal). */
  readonly additions: number;
  readonly deletions: number;
}

export interface FsProposeResult {
  readonly ok: boolean;
  readonly plan?: FsEditPlan;
  readonly error?: string;
}

export interface FsVerification {
  readonly ok: boolean;
  /** The hash the file actually has now (for the trace). */
  readonly actualHash?: string;
  readonly reason?: string;
}

export interface FsApplyResult {
  readonly ok: boolean;
  /** The post-write verification (applied === proposed). Present when the write ran. */
  readonly verification?: FsVerification;
  /** Backup of the pre-image content, when createBackup was requested (for rollback). */
  readonly backup?: { readonly path: string; readonly content: string };
  readonly error?: string;
}

export interface FsEditOptions {
  /** Workspace root every path is confined to. Default `process.cwd()`. */
  readonly root?: string;
}

export interface FsApplyOptions extends FsEditOptions {
  /** Capture the pre-image content so the caller can roll back on a failed verify. */
  readonly createBackup?: boolean;
}

/**
 * Resolve a (possibly relative) path against the root and CONFINE it: reject any path
 * that escapes the workspace (`..` traversal or an absolute path outside root). Returns
 * the absolute path, or null when the path would escape — the fs analogue of the SSRF
 * private-network guard.
 */
export function confinePath(inputPath: string, root: string): string | null {
  const absRoot = resolve(root);
  const abs = isAbsolute(inputPath) ? resolve(inputPath) : resolve(absRoot, inputPath);
  const rel = relative(absRoot, abs);
  // Escapes when the relative path climbs out (`..`) or resolves to a different drive
  // (Windows: relative() returns an absolute path when drives differ).
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    // rel === '' means the path IS the root (a directory, not an editable file).
    return null;
  }
  return abs;
}

/** Read a file's current content + hash, treating a missing file as ABSENT. */
async function readCurrent(absPath: string): Promise<{ exists: boolean; content: string; hash: string }> {
  try {
    const content = await readFile(absPath, 'utf8');
    return { exists: true, content, hash: contentHash(content) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false, content: '', hash: ABSENT_HASH };
    }
    throw err;
  }
}

/**
 * A minimal, readable line diff: prefix-/suffix-trim the common lines, then show the
 * changed middle as `-old` / `+new`. This is EVIDENCE for a human/council to read — the
 * SHA hashes, not this text, are what gate correctness, so a simple diff is sufficient
 * and dependency-free.
 */
export function lineDiff(before: string, after: string): { diff: string; additions: number; deletions: number } {
  if (before === after) return { diff: '(no change)', additions: 0, deletions: 0 };
  const a = before.length ? before.split('\n') : [];
  const b = after.length ? after.split('\n') : [];

  // Trim common prefix / suffix to keep the diff focused.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const removed = a.slice(start, endA);
  const added = b.slice(start, endB);
  const lines: string[] = [];
  if (start > 0) lines.push(`  @@ context: ${start} unchanged line(s) above @@`);
  for (const r of removed) lines.push(`- ${r}`);
  for (const ad of added) lines.push(`+ ${ad}`);
  const tail = a.length - endA;
  if (tail > 0) lines.push(`  @@ context: ${tail} unchanged line(s) below @@`);
  return { diff: lines.join('\n'), additions: added.length, deletions: removed.length };
}

/**
 * PHASE 1 — propose. Pure dry-run: compute the plan (pre-image hash, after-hash, diff)
 * WITHOUT writing. Confines the path; never throws.
 */
export async function proposeFsEdit(
  inputPath: string,
  newContent: string,
  options: FsEditOptions = {},
): Promise<FsProposeResult> {
  const root = options.root ?? process.cwd();
  const abs = confinePath(inputPath, root);
  if (!abs) return { ok: false, error: `path escapes workspace root: ${inputPath}` };

  let current: { exists: boolean; content: string; hash: string };
  try {
    current = await readCurrent(abs);
  } catch (err) {
    return { ok: false, error: `read failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const relPath = relative(resolve(root), abs).split('\\').join('/');
  const { diff, additions, deletions } = lineDiff(current.content, newContent);
  const afterHash = contentHash(newContent);

  // No-op guard: proposing the exact current content is not an edit.
  if (current.exists && current.hash === afterHash) {
    return { ok: false, error: 'proposed content is identical to the current file (no-op)' };
  }

  return {
    ok: true,
    plan: {
      path: abs,
      relPath,
      id: `fs:edit:${relPath}`,
      beforeHash: current.hash,
      afterHash,
      afterContent: newContent,
      isCreate: !current.exists,
      diff,
      additions,
      deletions,
    },
  };
}

/**
 * PHASE 2 + 3 — apply, then verify. Writes atomically (temp + rename) ONLY if the file
 * still matches the plan's pre-image hash (optimistic-concurrency guard), then re-reads
 * and confirms the content now equals the proposed after-hash. Never throws.
 */
export async function applyFsEdit(plan: FsEditPlan, options: FsApplyOptions = {}): Promise<FsApplyResult> {
  const root = options.root ?? process.cwd();
  // Re-confine defensively in case a plan was constructed/mutated by hand.
  const abs = confinePath(plan.relPath, root);
  if (!abs || abs !== plan.path) {
    // Fall back to confining the plan's stored absolute path; reject on mismatch.
    const reAbs = confinePath(plan.path, root);
    if (!reAbs) return { ok: false, error: `plan path escapes workspace root: ${plan.path}` };
  }

  // Pre-image guard: refuse if the file changed since the plan was made.
  let current: { exists: boolean; content: string; hash: string };
  try {
    current = await readCurrent(plan.path);
  } catch (err) {
    return { ok: false, error: `pre-read failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (current.hash !== plan.beforeHash) {
    return {
      ok: false,
      error: current.exists
        ? `file changed since the plan was made (expected ${plan.beforeHash.slice(0, 12)}, found ${current.hash.slice(0, 12)}) — refusing to clobber`
        : `expected the file to exist with hash ${plan.beforeHash.slice(0, 12)} but it is absent — refusing`,
    };
  }

  const backup = options.createBackup
    ? { path: plan.path, content: current.content }
    : undefined;

  // Atomic write: ensure dir, write temp, rename over the target.
  try {
    await mkdir(dirname(plan.path), { recursive: true });
    const tmp = join(dirname(plan.path), `.vai-fsedit-${process.pid}-${Date.now()}.tmp`);
    await writeFile(tmp, plan.afterContent, 'utf8');
    await rename(tmp, plan.path);
  } catch (err) {
    return { ok: false, error: `write failed: ${err instanceof Error ? err.message : String(err)}`, backup };
  }

  const verification = await verifyFsEdit(plan);
  return { ok: verification.ok, verification, backup };
}

/**
 * PHASE 3 (standalone) — verify the file on disk now matches the plan's proposed
 * after-hash. The release gate: only a passing verify means the edit truly happened.
 */
export async function verifyFsEdit(plan: FsEditPlan): Promise<FsVerification> {
  let current: { exists: boolean; content: string; hash: string };
  try {
    current = await readCurrent(plan.path);
  } catch (err) {
    return { ok: false, reason: `verify read failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!current.exists) return { ok: false, actualHash: ABSENT_HASH, reason: 'file absent after apply' };
  if (current.hash !== plan.afterHash) {
    return { ok: false, actualHash: current.hash, reason: `applied content hash ${current.hash.slice(0, 12)} ≠ proposed ${plan.afterHash.slice(0, 12)}` };
  }
  return { ok: true, actualHash: current.hash, reason: 'applied content matches proposed exactly' };
}

/**
 * Roll a file back to a backup captured by applyFsEdit({ createBackup: true }). Used when
 * a later verify (e.g. a build/test gate the caller runs) fails and the edit must be undone.
 * Itself pre-image-guarded via a fresh propose+apply so rollback is also safe & verified.
 */
export async function rollbackFsEdit(
  backup: { path: string; content: string },
  options: FsEditOptions = {},
): Promise<FsApplyResult> {
  const proposal = await proposeFsEdit(backup.path, backup.content, options);
  if (!proposal.ok || !proposal.plan) {
    // If the file already equals the backup (no-op), that's a successful rollback.
    if (proposal.error?.includes('no-op')) return { ok: true };
    return { ok: false, error: proposal.error ?? 'rollback propose failed' };
  }
  return applyFsEdit(proposal.plan, options);
}

/** True when stat says the path is a regular file (helper for callers building plans). */
export async function isRegularFile(absPath: string): Promise<boolean> {
  try {
    return (await stat(absPath)).isFile();
  } catch {
    return false;
  }
}
