/**
 * self-improve-inbox — the cross-PROCESS bridge between the runtime (which produces jobs during
 * live turns) and the loop (which drains them).
 *
 * The runtime (ChatService.triggerSelfImprovement) and the loop (supervisor.mjs drain) run as
 * SEPARATE processes with separate storage. Rather than have them share one SQLite handle (locking
 * + path coupling between two independent processes), the runtime APPENDS jobs to an append-only
 * JSONL inbox, and the loop INGESTS that inbox into its queue table at the start of each drain. This
 * mirrors the existing council-findings.json signal-file pattern — decoupled, crash-safe, each side
 * owning its own store.
 *
 * appendToInbox: called by the runtime (via a tiny TS adapter). ingestInbox: called by the loop.
 */

import { appendFileSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const INBOX_PATH = 'Temporary_files/self-improve-inbox.jsonl';

/** Append one job to the inbox (one JSON object per line). Best-effort; never throws. */
export function appendToInbox(job, { path = INBOX_PATH } = {}) {
  try {
    const dir = dirname(path);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(path, JSON.stringify(sanitize(job)) + '\n');
    return true;
  } catch {
    return false;
  }
}

/** Read + parse the inbox lines (tolerant — skips malformed lines). Does NOT clear it. */
export function readInbox({ path = INBOX_PATH } = {}) {
  if (!existsSync(path)) return [];
  let text = '';
  try { text = readFileSync(path, 'utf8'); } catch { return []; }
  const jobs = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { const o = JSON.parse(t); if (o && o.missingCapability) jobs.push(o); } catch { /* skip */ }
  }
  return jobs;
}

/** Clear the inbox (after a successful ingest). Best-effort. */
export function clearInbox({ path = INBOX_PATH } = {}) {
  try { if (existsSync(path)) writeFileSync(path, ''); } catch { /* best-effort */ }
}

/**
 * INGEST the inbox into the loop's queue table: for each inbox job, resolve a code LOCATION to
 * ground codegen on (from the job's hint, else a class→location map), synthesize the note shape
 * enqueueFromMissingCapability expects, and enqueue it (dedup + shelf checks apply). Clears the
 * inbox afterward. Injected `enqueue` + `resolveLocation` keep it testable. Returns a summary.
 */
export function ingestInbox(db, { enqueue, resolveLocation, effects, path = INBOX_PATH } = {}) {
  const jobs = readInbox({ path });
  if (jobs.length === 0) return { ingested: 0, enqueued: 0, skipped: 0 };
  let enqueued = 0; let skipped = 0;
  for (const job of jobs) {
    const note = {
      memberId: job.memberId ?? null,
      missingCapability: job.missingCapability,
      realIntent: job.realIntent ?? '',
      methodLesson: job.methodLesson ?? '',
    };
    // Where should codegen ground? A job may carry a location hint; else resolve from intent/class.
    const location = job.location ?? (typeof resolveLocation === 'function' ? resolveLocation(job) : null);
    const r = enqueue(db, note, { location, klass: job.klass ?? job.intent ?? 'capability', effects });
    if (r && r.enqueued) enqueued++; else skipped++;
  }
  clearInbox({ path });
  return { ingested: jobs.length, enqueued, skipped };
}

function sanitize(job) {
  // Keep only the fields the loop needs; cap lengths so a hostile/huge note can't bloat the inbox.
  const cap = (s, n) => (s == null ? undefined : String(s).slice(0, n));
  return {
    missingCapability: cap(job.missingCapability, 400),
    realIntent: cap(job.realIntent, 400),
    methodLesson: cap(job.methodLesson, 400),
    prompt: cap(job.prompt, 400),
    intent: cap(job.intent, 60),
    memberId: cap(job.memberId, 60),
    location: cap(job.location, 300),
    klass: cap(job.klass, 60),
    at: new Date().toISOString(),
  };
}
