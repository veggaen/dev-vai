/**
 * self-improve-queue — Level 1 of "the Council triggers its own improvement loops".
 *
 * A council member ALREADY emits `missingCapability` in its structured note (a field on
 * CouncilMemberNote) when it decides Vai's CODE is missing something needed to answer well. Today
 * that signal is advisory and evaporates. This module turns it into a first-class ACTION: a member
 * naming a missing capability ENQUEUES a self-improvement job, which a drainer later routes into the
 * gated feature-build → feature-review pipeline (peer-reviewed, branch-guarded, changelog'd).
 *
 * The member TRIGGERS but never BYPASSES: it emits intent (a queued job, pure data — like a vote);
 * the tested gated pipeline does the work, and the OTHER members review it. A member cannot approve
 * its own change.
 *
 * SAFETY / anti-flood (the two constraints in tension — perpetual yet safe):
 *   - DEDUP by tokenized fingerprint (reuses feature-review's shelf fingerprint) so the same gap
 *     isn't queued twice, and a gap that matches a SHELVED (already-rejected) idea is NOT re-queued
 *     unless the shelf says it's revivable.
 *   - A per-drain-cycle BUDGET caps how many jobs the council can spawn, so a rough day of hard
 *     questions can't queue 50 code changes. Enqueue is cheap; draining stays one-heavy-task-serial.
 *
 * Pure logic + injected DB so every branch is unit-testable without a model or a live corpus.
 */

import { tokenizeRejectedIdea, ideaOverlap, checkShelvedIdeas } from './feature-review.mjs';

/** Default cap on how many queued jobs a single drain cycle will actually run. */
export const DEFAULT_DRAIN_BUDGET = 3;
/** A live message/gap this similar to a shelved idea is treated as "already tried" (skip enqueue). */
export const SHELF_OVERLAP_THRESHOLD = 0.34;

/** Ensure the queue table exists (additive; never drops). Call once before use. */
export function ensureQueueTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS self_improve_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL,
    instruction TEXT NOT NULL,
    why TEXT,
    location TEXT,
    member_id TEXT,
    klass TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    outcome TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
  );`);
  // A fingerprint is unique among OPEN jobs; a closed one may repeat later (revival).
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_siq_open ON self_improve_queue(fingerprint) WHERE status=\'queued\''); }
  catch { /* older sqlite without partial index — dedup falls back to the query in enqueue */ }
}

/**
 * Synthesize the improvement INSTRUCTION from a council note. `missingCapability` is the core; we
 * enrich it with the method lesson and the real intent so the builder has grounded direction.
 * Pure. Returns null when there's nothing actionable (empty/again-vague missingCapability).
 */
export function instructionFromNote(note = {}) {
  const cap = clean(note.missingCapability);
  if (!cap || cap.length < 6 || /^(none|n\/a|unknown|nothing)$/i.test(cap)) return null;
  const parts = [`Add the capability Vai was missing: ${cap}.`];
  if (clean(note.realIntent)) parts.push(`The user actually wanted: ${clean(note.realIntent)}.`);
  if (clean(note.methodLesson)) parts.push(`How to handle this class next time: ${clean(note.methodLesson)}.`);
  return parts.join(' ');
}

/**
 * ENQUEUE a self-improvement job from a council note IF it names a real missing capability and the
 * job isn't a duplicate or a still-dead shelved idea. Injected effects keep it pure:
 *   effects.recordKnowledge, effects.topKnowledge, effects.knowledgeConfidence (for the shelf check)
 * Returns { enqueued, reason, fingerprint?, id? }.
 */
export function enqueueFromMissingCapability(db, note, { location = null, klass = 'capability', effects = {} } = {}) {
  const instruction = instructionFromNote(note);
  if (!instruction) return { enqueued: false, reason: 'note has no actionable missingCapability' };

  const fp = tokenizeRejectedIdea({ instruction, file: location ?? '', reasons: [clean(note.methodLesson) || ''] });

  // 1) Already-open job with the same fingerprint? Skip (dedup).
  const open = db.prepare("SELECT id FROM self_improve_queue WHERE fingerprint=? AND status='queued' LIMIT 1").get(fp.key);
  if (open) return { enqueued: false, reason: 'an identical job is already queued', fingerprint: fp, id: open.id };

  // 2) Matches a SHELVED (already-rejected) idea that is NOT revivable? Skip — "we tried this".
  if (typeof effects.topKnowledge === 'function') {
    const shelved = checkShelvedIdeas(db, instruction, {
      topKnowledge: effects.topKnowledge,
      knowledgeConfidence: effects.knowledgeConfidence,
      overlapThreshold: SHELF_OVERLAP_THRESHOLD,
    });
    const stillDead = shelved.find((s) => !s.revivable);
    if (stillDead) return { enqueued: false, reason: `matches a shelved idea we already rejected (overlap ${stillDead.overlap})`, fingerprint: fp };
  }

  const now = new Date().toISOString();
  const info = db.prepare(
    'INSERT INTO self_improve_queue (fingerprint,instruction,why,location,member_id,klass,status,created_at) VALUES (?,?,?,?,?,?,?,?)',
  ).run(fp.key, instruction, clean(note.missingCapability), location, note.memberId ?? null, klass, 'queued', now);
  if (typeof effects.recordKnowledge === 'function') {
    effects.recordKnowledge(db, { scope: 'council:self-improve', claim: `member ${note.memberId ?? '?'} queued a self-improvement: ${clean(note.missingCapability).slice(0, 80)}`, kind: 'observation', confirm: true });
  }
  return { enqueued: true, reason: 'queued', fingerprint: fp, id: Number(info.lastInsertRowid) };
}

/** Enqueue from a WHOLE council result (many notes) — one job per distinct actionable capability. */
export function enqueueFromCouncil(db, notes = [], opts = {}) {
  const results = [];
  const seen = new Set();
  for (const note of notes) {
    const instruction = instructionFromNote(note);
    if (!instruction) continue;
    const key = tokenizeRejectedIdea({ instruction }).key;
    if (seen.has(key)) continue; // two members named the same gap this turn → one job
    seen.add(key);
    results.push(enqueueFromMissingCapability(db, note, opts));
  }
  return results;
}

/** The current open queue (newest first) — for the drainer + a watch UI. */
export function openJobs(db, limit = 20) {
  try {
    return db.prepare("SELECT id,fingerprint,instruction,why,location,member_id,klass,created_at FROM self_improve_queue WHERE status='queued' ORDER BY id DESC LIMIT ?").all(limit);
  } catch { return []; }
}

/** Mark a job's terminal outcome (integrated/shelved/held/aborted/failed). */
export function closeJob(db, id, status, outcome = '') {
  db.prepare("UPDATE self_improve_queue SET status=?, outcome=?, updated_at=? WHERE id=?")
    .run(status, String(outcome).slice(0, 300), new Date().toISOString(), id);
}

/**
 * DRAIN the queue: run up to `budget` queued jobs through the injected `runJob` (which the caller
 * wires to the feature-build → feature-review pipeline). Serial by construction (the caller awaits
 * each) so one-heavy-task-at-a-time holds no matter how many jobs are queued. Records each outcome.
 * `runJob(job)` must resolve to { outcome, detail }.
 * Returns a summary { ran, results }.
 */
export async function drainSelfImproveQueue(db, { budget = DEFAULT_DRAIN_BUDGET, runJob, onEvent = () => {} } = {}) {
  ensureQueueTable(db);
  const jobs = openJobs(db, budget);
  const results = [];
  for (const job of jobs) {
    onEvent({ type: 'job:start', job });
    let res;
    try { res = await runJob(job); }
    catch (e) { res = { outcome: 'failed', detail: String(e).slice(0, 160) }; }
    closeJob(db, job.id, res?.outcome ?? 'failed', res?.detail ?? '');
    onEvent({ type: 'job:done', job, result: res });
    results.push({ id: job.id, ...res });
  }
  return { ran: results.length, results };
}

function clean(s) { return String(s ?? '').replace(/\s+/g, ' ').trim(); }
