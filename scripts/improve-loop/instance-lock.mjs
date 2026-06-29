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

/** Tiny synchronous wait — acquireLock is sync, and the write window we're out-waiting is sub-ms. */
function busyWaitMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin briefly */ }
}

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
  // CAREFUL with a corrupt/empty payload: a contender can observe the lock during the WINNER's
  // openSync('wx')→writeFileSync window, before the payload is written. Treating that empty read as
  // "stale" would let the contender unlink + steal a lock that's actively being created (CodeRabbit
  // #25, race). So we RE-READ a corrupt payload a few times with a short backoff; only if it stays
  // unparseable do we treat it as a genuinely stale/corrupt lock and reclaim it.
  let holderPid = NaN;
  let startedAt = null;
  let parsedOk = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const prev = JSON.parse(readFileSync(lockPath, 'utf8'));
      holderPid = Number(prev.pid);
      startedAt = prev.startedAt ?? null;
      parsedOk = Number.isInteger(holderPid) && holderPid > 0;
      if (parsedOk) break;
    } catch { /* mid-write or corrupt — retry briefly before deciding it's stale */ }
    busyWaitMs(20); // short, synchronous: the write window is microseconds; this just out-waits it
  }

  // A readable payload with a LIVE pid → another supervisor owns it → refuse.
  if (parsedOk && isAlive(holderPid)) {
    return { ok: false, holderPid, startedAt };
  }

  // Stale lock (holder crashed). Reclaim it ATOMICALLY: unlink the dead lock, then re-attempt the
  // exclusive `wx` create. If two contenders race, only ONE wins the re-create — the loser gets
  // EEXIST and must re-read the (now-fresh) lock to report the real winner, never falsely returning
  // ok:true. (A plain overwrite was non-exclusive: both racers could write + both claim success.)
  try { unlinkSync(lockPath); } catch { /* another contender may have unlinked first — fine */ }
  try {
    writeFresh();
    return { ok: true, release: () => releaseLock(lockPath), reclaimed: true };
  } catch (e) {
    if (e.code !== 'EEXIST') throw e; // real fs error — surface it
    // Lost the reclaim race: someone else created the lock first. Report THEM, not a false success.
    let pid = NaN; let since = null;
    try { const p = JSON.parse(readFileSync(lockPath, 'utf8')); pid = Number(p.pid); since = p.startedAt ?? null; } catch {}
    return { ok: false, holderPid: pid, startedAt: since };
  }
}

/** Remove the lock file. Best-effort and idempotent (no-op if already gone). */
export function releaseLock(lockPath) {
  try { unlinkSync(lockPath); } catch { /* already removed / never created */ }
}
