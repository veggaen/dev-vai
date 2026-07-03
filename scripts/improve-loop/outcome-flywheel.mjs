/**
 * Outcome flywheel — the loop learns from its OWN terminal outcomes.
 *
 * Before this module, the pipeline was open-ended at the back: jobs ended as
 * integrated/shelved/held/failed, the changelog recorded why… and nothing changed about
 * what the loop tried next. The same failure modes could repeat forever.
 *
 * The flywheel closes that back edge each cycle:
 *
 *   1. LESSONS — mine recent changelog entries (shelved/held/reverted) for RECURRING
 *      rejection reasons (peer rejects + dissent). A reason seen twice is a pattern, not
 *      noise — it becomes a standing "known failure mode" directive.
 *   2. RETRIES — a job HELD for human review that nobody touched for N days gets ONE
 *      bounded retry, with the learned failure modes appended to its instruction so the
 *      rebuild attacks the reasons it was held, not just the original ask. Generations
 *      are capped (fingerprint suffix ':rN') so a dead idea can never loop.
 *
 * Every effect is injected and every helper is pure — tests run on node:sqlite with no
 * models, no GPU, no network. The GPU-heavy work (the rebuild itself) stays where it
 * belongs: in the drain, one job at a time.
 */

export const FLYWHEEL_DEFAULTS = Object.freeze({
  enabled: true,
  /** A held job untouched this long is considered unreviewed — retry it with lessons. */
  heldAgeDays: 2,
  /** Max held→retry promotions per cycle (keeps the drain budget honest). */
  maxRetries: 2,
  /** Max retry generations per fingerprint — after this, a held idea stays parked. */
  maxGenerations: 2,
  /** How many recent changelog entries to mine for lessons. */
  entryWindow: 40,
});

const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

/** Normalize a rejection reason to a comparable key (case/punct/number-insensitive). */
export function normalizeReason(reason) {
  return clean(reason)
    .toLowerCase()
    .replace(/[0-9]+/g, 'N')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 2)
    .slice(0, 8)
    .join(' ');
}

/**
 * Mine recent changelog entries for recurring failure reasons. Pure.
 * Returns [{ lesson, count, sources }] sorted by count desc — only patterns (count ≥ 2)
 * unless a single reason came with an explicit peer majority reject.
 */
export function harvestLessons(entries = [], { max = 5 } = {}) {
  const buckets = new Map();
  for (const e of entries) {
    if (!e || !['shelved', 'held', 'reverted'].includes(e.kind)) continue;
    const reasons = [
      ...(e.peers?.rejects ?? []),
      ...(e.peers?.dissent ?? []),
    ].map(clean).filter(Boolean);
    for (const reason of reasons) {
      const key = normalizeReason(reason);
      if (!key) continue;
      const b = buckets.get(key) ?? { lesson: reason, count: 0, sources: [] };
      b.count += 1;
      if (e.title && !b.sources.includes(e.title)) b.sources.push(e.title);
      buckets.set(key, b);
    }
  }
  return [...buckets.values()]
    .filter((b) => b.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, max);
}

/** Render lessons as a directive the builder prepends to its instruction. Pure. */
export function lessonDirective(lessons = []) {
  if (lessons.length === 0) return '';
  const lines = lessons.map((l) => `- ${l.lesson} (seen ${l.count}×)`);
  return `Known failure modes from past attempts — do NOT repeat these:\n${lines.join('\n')}`;
}

/** Parse the retry generation off a fingerprint ('abc:r2' → 2; 'abc' → 0). Pure. */
export function retryGeneration(fingerprint = '') {
  const m = /:r(\d+)$/.exec(fingerprint);
  return m ? Number(m[1]) : 0;
}

/** Held jobs old enough to retry, oldest first, bounded. */
export function retryCandidates(db, { now = new Date(), heldAgeDays, maxRetries, maxGenerations }) {
  const cutoff = new Date(now.getTime() - heldAgeDays * 86_400_000).toISOString();
  // Rows already promoted once are excluded explicitly (not just by their bumped
  // timestamp) — a held job gets exactly one retry per generation, ever.
  const rows = db.prepare(
    "SELECT * FROM self_improve_queue WHERE status='held' AND COALESCE(outcome,'') NOT LIKE '%retried as gen%' AND COALESCE(updated_at, created_at) <= ? ORDER BY COALESCE(updated_at, created_at) ASC",
  ).all(cutoff);
  return rows
    .filter((r) => retryGeneration(r.fingerprint) < maxGenerations)
    .slice(0, maxRetries);
}

/**
 * One flywheel turn: harvest lessons, promote aged held jobs to lesson-annotated retries.
 * Returns { lessons, retried, skipped } for the supervisor log. All writes are bounded
 * and fingerprint-deduped; a retry that collides with an open job is skipped.
 */
export function runOutcomeFlywheel(db, { entries = [], now = new Date(), config = {} } = {}) {
  const cfg = { ...FLYWHEEL_DEFAULTS, ...config };
  if (!cfg.enabled) return { lessons: [], retried: 0, skipped: 0, disabled: true };

  const lessons = harvestLessons(entries.slice(0, cfg.entryWindow));
  const directive = lessonDirective(lessons);

  let retried = 0;
  let skipped = 0;
  for (const row of retryCandidates(db, { now, ...cfg })) {
    const gen = retryGeneration(row.fingerprint) + 1;
    const fp = `${row.fingerprint.replace(/:r\d+$/, '')}:r${gen}`;
    const open = db.prepare(
      "SELECT id FROM self_improve_queue WHERE fingerprint=? AND status='queued' LIMIT 1",
    ).get(fp);
    if (open) { skipped += 1; continue; }
    const instruction = directive
      ? `${row.instruction}\n\n${directive}`
      : row.instruction;
    const ts = now.toISOString();
    db.prepare(
      'INSERT INTO self_improve_queue (fingerprint,instruction,why,location,member_id,klass,status,created_at) VALUES (?,?,?,?,?,?,?,?)',
    ).run(fp, instruction, `retry ${gen} of held job #${row.id}: ${row.why ?? ''}`.trim(), row.location, row.member_id, row.klass, 'queued', ts);
    db.prepare(
      "UPDATE self_improve_queue SET outcome=COALESCE(outcome,'') || ' → retried as gen ' || ?, updated_at=? WHERE id=?",
    ).run(String(gen), ts, row.id);
    retried += 1;
  }

  return { lessons, retried, skipped };
}
