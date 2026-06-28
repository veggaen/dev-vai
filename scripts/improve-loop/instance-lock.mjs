/**
 * Single-instance lock for the living loop.
 *
 * WHY: the supervisor was startable any number of times. On 2026-06-26 FIVE copies were running
 * at once, all `--apply`, fighting over the single GPU — the corpus stalled and the machine
 * lagged. That violates the one-heavy-task-at-a-time / crash-safe rule (memory: crash-safe-workflow).
 * This makes a second start REFUSE while a live one holds the lock, and self-heal when the prior
 * holder died without cleaning up (crash / BSOD).
 *
 * Mechanism: a PID file. Acquire writes {pid, startedAt} atomically (wx = fail if exists). If the
 * file already exists we read the recorded PID and check whether that process is still alive:
 *   - alive  → another supervisor owns the lock → refuse.
 *   - dead   → it's a STALE lock from a crash → reclaim it (overwrite) and continue.
 * release() removes the file. Pure Node, no deps; safe on Windows (process.kill(pid, 0) works).
 */
import { readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from 'node:fs';

/** True if a process with this PID is currently running. */
function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0); // signal 0 = existence check, never actually signals
    return true;
  } catch (e) {
    // EPERM = exists but we can't signal it (still alive). ESRCH = no such process (dead).
    return e.code === 'EPERM';
  }
}

/**
 * Try to acquire the lock at `lockPath`.
 * @returns {{ok: true, release: () => void, reclaimed: boolean} | {ok: false, holderPid: number, startedAt: string|null}}
 */
export function acquireLock(lockPath) {
  const payload = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });

  const writeFresh = () => {
    // wx: create exclusively — fails if the file already exists (atomic against a racing start).
    const fd = openSync(lockPath, 'wx');
    try { writeFileSync(fd, payload); } finally { closeSync(fd); }
  };

  try {
    writeFresh();
    return { ok: true, release: () => releaseLock(lockPath), reclaimed: false };
  } catch (e) {
    if (e.code !== 'EEXIST') throw e; // a real fs error — surface it
  }

  // A lock file exists. Is its owner still alive?
  let holderPid = NaN;
  let startedAt = null;
  try {
    const prev = JSON.parse(readFileSync(lockPath, 'utf8'));
    holderPid = Number(prev.pid);
    startedAt = prev.startedAt ?? null;
  } catch { /* unreadable/corrupt lock → treat as stale below */ }

  if (isAlive(holderPid)) {
    return { ok: false, holderPid, startedAt };
  }

  // Stale lock (holder crashed). Reclaim it.
  try { writeFileSync(lockPath, payload); } catch { /* fall through; best effort */ }
  return { ok: true, release: () => releaseLock(lockPath), reclaimed: true };
}

/** Remove the lock file. Best-effort and idempotent (no-op if already gone). */
export function releaseLock(lockPath) {
  try { unlinkSync(lockPath); } catch { /* already removed / never created */ }
}
