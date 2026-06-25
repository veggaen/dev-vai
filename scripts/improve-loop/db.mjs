/**
 * Crash-safe corpus + run state for the Vai self-improvement loop.
 *
 * One SQLite file is the single source of truth. Every prompt result is committed
 * the instant it is graded, so a BSOD (the user's PC does this under combined
 * GPU+disk load — see memory: crash-safe-workflow) resumes EXACTLY where it
 * stopped: no re-run, no lost corpus rows.
 *
 * Tables:
 *   runs       — one row per loop invocation (campaign trend lives here)
 *   prompts    — the growing regression corpus: prompt → expected interpretation → class
 *   results    — one row per (run, prompt): what Vai actually did + the grade
 *   fixes      — mined fix candidates queued for human approval (never auto-applied)
 *
 * The loop is READ-ONLY on Vai's source. It writes only to this db.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

export function openDb(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;'); // survive a crash mid-write
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt TEXT NOT NULL UNIQUE,
      class TEXT NOT NULL,
      expected_intent TEXT NOT NULL,
      origin TEXT NOT NULL,            -- 'seed' | 'generated'
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      prompt_id INTEGER NOT NULL,
      class TEXT NOT NULL,
      read_as TEXT,                    -- council.realIntent
      outcome TEXT,
      agreement REAL,
      answer_excerpt TEXT,
      passed INTEGER NOT NULL,         -- 1 = interpretation matched expectation
      grade_reason TEXT,
      duration_ms INTEGER,
      answer_excellence REAL,          -- 0..10 craft score of the produced answer
      answer_excellence_json TEXT,     -- full rubric verdict (scores/flaws/lesson)
      created_at TEXT NOT NULL,
      UNIQUE (run_id, prompt_id)       -- idempotent: re-run a prompt = replace
    );
    CREATE TABLE IF NOT EXISTS fixes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      class TEXT NOT NULL,
      failure_count INTEGER NOT NULL,
      location TEXT,                   -- best-guess file:line
      summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',  -- queued | approved | rejected | applied
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS visual_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      app_url TEXT,
      out_dir TEXT,
      report_path TEXT,
      event_stream TEXT,
      passed INTEGER,
      summary TEXT
    );
    CREATE TABLE IF NOT EXISTS visual_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visual_run_id INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      ts TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (visual_run_id, seq)
    );
    CREATE TABLE IF NOT EXISTS visual_live (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      visual_run_id INTEGER,
      seq INTEGER,
      type TEXT,
      data TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS taste_lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson TEXT NOT NULL UNIQUE,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      times_seen INTEGER NOT NULL DEFAULT 1,
      last_visual_run_id INTEGER,
      last_overall REAL
    );
    CREATE TABLE IF NOT EXISTS answer_lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson TEXT NOT NULL UNIQUE,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      times_seen INTEGER NOT NULL DEFAULT 1,
      last_run_id INTEGER,
      last_overall REAL
    );
    -- project_knowledge — the KNOWLEDGE SPINE. Unlike *_lessons (vague prose the model
    -- averages into slop), a knowledge row is an EVIDENCE-BOUND, COUNTED fact about THIS
    -- project, with a confidence that RISES on confirmation and FALLS on contradiction so
    -- stale knowledge decays instead of misleading forever. scope groups facts by where
    -- they apply (e.g. 'propose-fix', 'model:qwen3:8b', 'file:...'). claim is the actionable
    -- fact. evidence is the machine-checkable backing (counts, file refs). kind distinguishes
    -- a 'guard' (encodes a deterministic check) from an 'observation'.
    CREATE TABLE IF NOT EXISTS project_knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      claim TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'observation',  -- 'guard' | 'observation'
      evidence TEXT,
      confirmations INTEGER NOT NULL DEFAULT 0,
      contradictions INTEGER NOT NULL DEFAULT 0,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      UNIQUE(scope, claim)
    );
    -- loop_events — the STRUCTURED TRACE of the process engine. Every decision (what was
    -- eligible, what ran, what it cost, what it produced) is one row, so "is perpetual motion
    -- TRUE?" is answerable from data, not vibes. cycle groups a cycle; phase = plan|run|health.
    CREATE TABLE IF NOT EXISTS loop_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cycle INTEGER NOT NULL,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,           -- 'plan' | 'run:start' | 'run:done' | 'run:error' | 'health' | 'cycle'
      process TEXT,                 -- which process (null for cycle/health rows)
      ok INTEGER,                   -- 1/0 for run outcomes
      compute REAL,                 -- cost units spent
      ms INTEGER,                   -- wall time
      detail TEXT                   -- JSON blob (scorecard, result summary, verdict…)
    );
    -- loop_state — durable per-key counters the cheap when()/value() guards read (e.g.
    -- cyclesSinceVisual). A tiny KV, NOT a growing corpus — bounded by the number of keys.
    CREATE TABLE IF NOT EXISTS loop_state (
      key TEXT PRIMARY KEY,
      value REAL NOT NULL,
      updated_at TEXT NOT NULL
    );
    -- fix_quarantine — a dead-fix ban list. A proposed fix (file+find+replace) that fails verify
    -- repeatedly must NOT be re-attempted forever (the BSOD-empty-file doom-loop: ~900 cycles
    -- re-trying the same un-appliable patch). After STRIKE_LIMIT failures the signature is banned,
    -- and apply-consensus skips it. Bounded: one row per distinct dead fix, not a growing corpus.
    CREATE TABLE IF NOT EXISTS fix_quarantine (
      sig TEXT PRIMARY KEY,          -- hash of file|find|replace
      file TEXT, find TEXT, "replace" TEXT,
      strikes INTEGER NOT NULL DEFAULT 0,
      banned INTEGER NOT NULL DEFAULT 0,
      last_detail TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  // Lazy migration: upgrade corpus DBs created before the answer-excellence
  // rubric landed, without dropping their accumulated rows.
  for (const col of ['answer_excellence REAL', 'answer_excellence_json TEXT']) {
    try { db.exec(`ALTER TABLE results ADD COLUMN ${col};`); } catch { /* column already present */ }
  }
  return db;
}

export function startRun(db, note) {
  const stmt = db.prepare('INSERT INTO runs (started_at, note) VALUES (?, ?)');
  const info = stmt.run(new Date().toISOString(), note ?? null);
  return Number(info.lastInsertRowid);
}

export function endRun(db, runId, status) {
  db.prepare('UPDATE runs SET ended_at = ?, status = ? WHERE id = ?')
    .run(new Date().toISOString(), status, runId);
}

/** Single-row live heartbeat so the dashboard shows the IN-FLIGHT turn (partial
 *  qwen output, phase, elapsed) instead of a ~70s dead gap between results. */
export function liveHeartbeat(db, { runId, prompt, klass, phase, partial, elapsedMs }) {
  db.exec(`CREATE TABLE IF NOT EXISTS live (
    id INTEGER PRIMARY KEY CHECK (id = 1), run_id INTEGER, prompt TEXT, class TEXT,
    phase TEXT, partial TEXT, elapsed_ms INTEGER, updated_at TEXT);`);
  db.prepare(
    `INSERT INTO live (id, run_id, prompt, class, phase, partial, elapsed_ms, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id, prompt=excluded.prompt,
       class=excluded.class, phase=excluded.phase, partial=excluded.partial,
       elapsed_ms=excluded.elapsed_ms, updated_at=excluded.updated_at`,
  ).run(runId, prompt ?? '', klass ?? '', phase ?? '', (partial ?? '').slice(0, 1200), elapsedMs ?? 0, new Date().toISOString());
}

export function readHeartbeat(db) {
  try { return db.prepare('SELECT * FROM live WHERE id = 1').get() ?? null; } catch { return null; }
}

export function startVisualRun(db, { appUrl, outDir }) {
  const info = db.prepare('INSERT INTO visual_runs (started_at, app_url, out_dir) VALUES (?, ?, ?)')
    .run(new Date().toISOString(), appUrl ?? null, outDir ?? null);
  return Number(info.lastInsertRowid);
}

export function endVisualRun(db, visualRunId, { status, passed, reportPath, eventStream, summary }) {
  db.prepare(
    `UPDATE visual_runs
     SET ended_at = ?, status = ?, passed = ?, report_path = COALESCE(?, report_path),
         event_stream = COALESCE(?, event_stream), summary = ?
     WHERE id = ?`,
  ).run(
    new Date().toISOString(),
    status,
    passed == null ? null : (passed ? 1 : 0),
    reportPath ?? null,
    eventStream ?? null,
    summary ?? null,
    visualRunId,
  );
}

export function recordVisualEvent(db, visualRunId, event) {
  if (!event || typeof event !== 'object') return false;
  if (event.type === 'hand.pointer' && Number(event.seq) % 5 !== 0) return false;

  const data = JSON.stringify(event.data ?? {});
  db.prepare(
    `INSERT INTO visual_events (visual_run_id, seq, ts, type, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(visual_run_id, seq) DO UPDATE SET
       ts=excluded.ts, type=excluded.type, data=excluded.data`,
  ).run(
    visualRunId,
    Number(event.seq) || 0,
    event.ts ?? new Date().toISOString(),
    String(event.type ?? 'unknown').slice(0, 80),
    data.slice(0, 4000),
    new Date().toISOString(),
  );
  db.prepare(
    `INSERT INTO visual_live (id, visual_run_id, seq, type, data, updated_at)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET visual_run_id=excluded.visual_run_id,
       seq=excluded.seq, type=excluded.type, data=excluded.data, updated_at=excluded.updated_at`,
  ).run(
    visualRunId,
    Number(event.seq) || 0,
    String(event.type ?? 'unknown').slice(0, 80),
    data.slice(0, 4000),
    new Date().toISOString(),
  );
  return true;
}

export function readVisualLive(db) {
  try { return db.prepare('SELECT * FROM visual_live WHERE id = 1').get() ?? null; } catch { return null; }
}

/** Accumulate a taste lesson across runs (deduped); how Vai builds taste through repetition. */
export function recordTasteLesson(db, { lesson, visualRunId, overall }) {
  if (!lesson) return;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO taste_lessons (lesson, first_seen, last_seen, times_seen, last_visual_run_id, last_overall)
     VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(lesson) DO UPDATE SET
       last_seen=excluded.last_seen, times_seen=taste_lessons.times_seen+1,
       last_visual_run_id=excluded.last_visual_run_id, last_overall=excluded.last_overall`,
  ).run(lesson, now, now, visualRunId ?? null, overall ?? null);
}

export function topTasteLessons(db, limit = 8) {
  try {
    return db.prepare('SELECT lesson, times_seen, last_overall FROM taste_lessons ORDER BY times_seen DESC, id DESC LIMIT ?').all(limit);
  } catch {
    return [];
  }
}

/** Accumulate an answer-craft lesson across runs (deduped); the text-lane twin of
 *  recordTasteLesson — how Vai builds answer taste through repetition. */
export function recordAnswerLesson(db, { lesson, runId, overall }) {
  if (!lesson) return;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO answer_lessons (lesson, first_seen, last_seen, times_seen, last_run_id, last_overall)
     VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(lesson) DO UPDATE SET
       last_seen=excluded.last_seen, times_seen=answer_lessons.times_seen+1,
       last_run_id=excluded.last_run_id, last_overall=excluded.last_overall`,
  ).run(lesson, now, now, runId ?? null, overall ?? null);
}

export function topAnswerLessons(db, limit = 8) {
  try {
    return db.prepare('SELECT lesson, times_seen, last_overall FROM answer_lessons ORDER BY times_seen DESC, id DESC LIMIT ?').all(limit);
  } catch {
    return [];
  }
}

// ── KNOWLEDGE SPINE ──────────────────────────────────────────────────────────
// capture → (confidence) → apply. The store the loop reads to stop repeating mistakes.

/**
 * Record (or reinforce) a piece of project knowledge. confirm=true bumps confirmations
 * (the fact held again), confirm=false bumps contradictions (the fact was wrong this time).
 * Idempotent per (scope, claim); evidence is overwritten with the latest backing. This is
 * the CAPTURE half of the spine — call it wherever the loop produces a verifiable outcome.
 */
export function recordKnowledge(db, { scope, claim, kind = 'observation', evidence = null, confirm = true } = {}) {
  if (!scope || !claim) return;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO project_knowledge (scope, claim, kind, evidence, confirmations, contradictions, first_seen, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope, claim) DO UPDATE SET
       last_seen = excluded.last_seen,
       evidence  = COALESCE(excluded.evidence, project_knowledge.evidence),
       confirmations  = project_knowledge.confirmations  + ?,
       contradictions = project_knowledge.contradictions + ?`,
  ).run(scope, claim, kind, evidence, confirm ? 1 : 0, confirm ? 0 : 1, now, now, confirm ? 1 : 0, confirm ? 0 : 1);
}

// ── Dead-fix quarantine (loop-detection / anti-doom-loop) ────────────────────────────────────
// A fix that fails verify STRIKE_LIMIT times is banned so the loop stops re-attempting it and
// spends the compute on real work instead. Pure signature so it's stable across cycles.
export const STRIKE_LIMIT = 2;

/** Stable signature for a fix attempt. Same file+find+replace ⇒ same sig ⇒ strikes accumulate. */
export function fixSignature({ file = '', find = '', replace = '' } = {}) {
  return createHash('sha1').update(`${file}|${find}|${replace}`).digest('hex').slice(0, 16);
}

/** Record one verify FAILURE for a fix; bans it once it reaches STRIKE_LIMIT. Returns {strikes,banned}. */
export function strikeFix(db, fix, detail = '') {
  const sig = fixSignature(fix);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO fix_quarantine (sig, file, find, "replace", strikes, banned, last_detail, updated_at)
     VALUES (?, ?, ?, ?, 1, 0, ?, ?)
     ON CONFLICT(sig) DO UPDATE SET
       strikes = fix_quarantine.strikes + 1,
       banned  = CASE WHEN fix_quarantine.strikes + 1 >= ${STRIKE_LIMIT} THEN 1 ELSE 0 END,
       last_detail = excluded.last_detail,
       updated_at  = excluded.updated_at`,
  ).run(sig, fix.file ?? '', fix.find ?? '', fix.replace ?? '', String(detail).slice(0, 300), now);
  const row = db.prepare('SELECT strikes, banned FROM fix_quarantine WHERE sig=?').get(sig);
  return { strikes: Number(row.strikes), banned: !!row.banned };
}

/** True if this exact fix has been banned (failed verify ≥ STRIKE_LIMIT times). */
export function isFixBanned(db, fix) {
  const row = db.prepare('SELECT banned FROM fix_quarantine WHERE sig=?').get(fixSignature(fix));
  return !!(row && row.banned);
}

/** The current ban list (for the watch UI): which dead fixes are quarantined, newest first. */
export function bannedFixes(db, limit = 20) {
  try {
    return db.prepare(
      'SELECT file, find, "replace", strikes, last_detail, updated_at FROM fix_quarantine WHERE banned=1 ORDER BY updated_at DESC LIMIT ?',
    ).all(limit);
  } catch { return []; }
}


/**
 * Confidence of a knowledge row in [0,1], Laplace-smoothed: (confirm+1)/(confirm+contra+2).
 * A fact confirmed 9× / contradicted 0× ≈ 0.91; confirmed 1 / contradicted 4 ≈ 0.29 (decays).
 * Pure so callers/tests can score rows without a query.
 */
export function knowledgeConfidence(row) {
  const c = Number(row?.confirmations ?? 0);
  const x = Number(row?.contradictions ?? 0);
  return (c + 1) / (c + x + 2);
}

/**
 * Top knowledge for a scope, most-confident first, above a confidence floor so low/contradicted
 * facts don't get re-injected (they're decaying out). This is the APPLY half — callers inject
 * these into the relevant prompt. scope can be exact ('propose-fix') — prefix matching is the
 * caller's job if it wants 'model:*'.
 */
export function topKnowledge(db, scope, { limit = 5, minConfidence = 0.5 } = {}) {
  try {
    const rows = db.prepare('SELECT * FROM project_knowledge WHERE scope = ?').all(scope);
    return rows
      .map((r) => ({ ...r, confidence: knowledgeConfidence(r) }))
      .filter((r) => r.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence || b.confirmations - a.confirmations)
      .slice(0, limit);
  } catch {
    return [];
  }
}

// ── ENGINE TRACE + DURABLE STATE ─────────────────────────────────────────────
// The structured log that makes "is perpetual motion TRUE?" answerable from data.

/** Append one engine event. Never throws into the loop (a logging failure must not stop work). */
export function logLoopEvent(db, { cycle, kind, process = null, ok = null, compute = null, ms = null, detail = null } = {}) {
  try {
    db.prepare(
      `INSERT INTO loop_events (cycle, at, kind, process, ok, compute, ms, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      cycle ?? 0, new Date().toISOString(), kind, process,
      ok == null ? null : (ok ? 1 : 0), compute, ms,
      detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)),
    );
  } catch { /* logging is best-effort */ }
}

/** Recent engine events (newest first) — for the operator/dashboard + verification. */
export function recentLoopEvents(db, limit = 50) {
  try { return db.prepare('SELECT * FROM loop_events ORDER BY id DESC LIMIT ?').all(limit); }
  catch { return []; }
}

/** Aggregate the trace into proof-of-motion stats: per-process run/ok counts, compute spent,
 *  outcomes produced. This is the data behind "the loop is legitimately working." */
export function loopEventStats(db, { sinceCycle = 0 } = {}) {
  try {
    const rows = db.prepare(
      `SELECT process,
              SUM(CASE WHEN kind='run:done' THEN 1 ELSE 0 END) AS done,
              SUM(CASE WHEN kind='run:error' THEN 1 ELSE 0 END) AS errors,
              COALESCE(SUM(compute),0) AS compute
       FROM loop_events WHERE cycle > ? AND process IS NOT NULL
       GROUP BY process ORDER BY done DESC`,
    ).all(sinceCycle);
    const cycles = db.prepare('SELECT COUNT(DISTINCT cycle) c FROM loop_events WHERE cycle > ?').get(sinceCycle).c;
    return { cycles, perProcess: rows };
  } catch { return { cycles: 0, perProcess: [] }; }
}

/** Durable KV the cheap guards read (e.g. cyclesSinceVisual). getLoopState returns def if unset. */
export function getLoopState(db, key, def = 0) {
  try { const r = db.prepare('SELECT value FROM loop_state WHERE key = ?').get(key); return r ? Number(r.value) : def; }
  catch { return def; }
}
export function setLoopState(db, key, value) {
  try {
    db.prepare(
      `INSERT INTO loop_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(key, Number(value), new Date().toISOString());
  } catch { /* best-effort */ }
}
/** Atomic-ish increment for cycle counters (read+write in one call). */
export function bumpLoopState(db, key, by = 1) {
  const next = getLoopState(db, key, 0) + by;
  setLoopState(db, key, next);
  return next;
}

/** Answer-excellence distribution for a run (or campaign-wide when runId is null):
 *  count graded, average craft score, and the worst score seen — the gradient the
 *  loop climbs on text output. */
export function answerExcellenceStats(db, runId = null) {
  try {
    const filter = runId == null
      ? 'WHERE answer_excellence IS NOT NULL'
      : 'WHERE run_id = ? AND answer_excellence IS NOT NULL';
    const args = runId == null ? [] : [runId];
    const row = db.prepare(
      `SELECT COUNT(answer_excellence) AS n, AVG(answer_excellence) AS avg, MIN(answer_excellence) AS worst
       FROM results ${filter}`,
    ).get(...args);
    return { n: Number(row?.n ?? 0), avg: row?.avg == null ? null : Number(row.avg), worst: row?.worst == null ? null : Number(row.worst) };
  } catch {
    return { n: 0, avg: null, worst: null };
  }
}

export function latestVisualEvents(db, limit = 30) {
  return db.prepare(
    `SELECT e.*, r.status AS run_status, r.passed AS run_passed, r.report_path, r.event_stream
     FROM visual_events e JOIN visual_runs r ON r.id = e.visual_run_id
     ORDER BY e.id DESC LIMIT ?`,
  ).all(limit);
}

export function latestVisualRun(db) {
  try { return db.prepare('SELECT * FROM visual_runs ORDER BY id DESC LIMIT 1').get() ?? null; } catch { return null; }
}

/** All sampled events for one visual run, oldest first (the council/operator trail). */
export function visualRunEvents(db, visualRunId) {
  try {
    return db.prepare('SELECT seq, ts, type, data FROM visual_events WHERE visual_run_id = ? ORDER BY seq ASC').all(visualRunId);
  } catch {
    return [];
  }
}

/**
 * Compact "council packet" for the latest (or a given) visual run.
 *
 * Built ONLY from the sampled SQLite trail — never the full report file, never
 * screenshots or the pointer trace. This is what a council member or helper agent
 * reads to know "did Vai's eyes/hands work, and is the composer reachable", without
 * being fed images or thousands of pointer points.
 */
export function buildVisualCouncilPacket(db, visualRunId = null) {
  const run = visualRunId
    ? db.prepare('SELECT * FROM visual_runs WHERE id = ?').get(visualRunId) ?? null
    : latestVisualRun(db);
  if (!run) return null;

  const events = visualRunEvents(db, run.id);
  const parse = (raw) => { try { return JSON.parse(raw || '{}'); } catch { return {}; } };

  const checks = events
    .filter((e) => e.type === 'check')
    .map((e) => { const d = parse(e.data); return { name: d.name, passed: !!d.passed, detail: d.detail || '' }; });

  const target = (() => {
    const e = [...events].reverse().find((ev) => ev.type === 'vision.target');
    if (!e) return null;
    const d = parse(e.data);
    return { reachable: !!d.targetReceivesPointer, topLabel: d.topLabel || null, targetLabel: d.targetLabel || null };
  })();

  const done = (() => {
    const e = [...events].reverse().find((ev) => ev.type === 'probe.done');
    return e ? parse(e.data) : null;
  })();

  // Taste verdict (evidence-bound rubric) — the higher-level UX/human-appeal judgment.
  const rubricEvent = [...events].reverse().find((ev) => ev.type === 'vision.rubric');
  const rubric = rubricEvent ? parse(rubricEvent.data) : null;
  const flawEvents = events.filter((ev) => ev.type === 'vision.flaw').map((ev) => parse(ev.data));

  const warnings = events
    .filter((e) => e.type === 'console.error' || e.type === 'page.error' || e.type === 'request.failed')
    .map((e) => { const d = parse(e.data); return `${e.type}: ${(d.text || '').slice(0, 160)}`; });
  const optionalBlocked = events.filter((e) => e.type === 'request.blocked_external').length;

  const screenshots = events.filter((e) => e.type === 'vision.snapshot').length;
  const checksPassed = checks.filter((c) => c.passed).length;

  return {
    visualRunId: run.id,
    status: run.status,
    passed: run.passed == null ? null : !!run.passed,
    appUrl: run.app_url ?? null,
    reportPath: run.report_path ?? null,
    eventStream: run.event_stream ?? null,
    startedAt: run.started_at ?? null,
    endedAt: run.ended_at ?? null,
    checks: { passed: checksPassed, total: checks.length, list: checks },
    composerReachable: target?.reachable ?? null,
    topLayerTarget: target?.topLabel ?? null,
    screenshots,
    warnings,
    optionalBlockedResources: optionalBlocked,
    sampledEvents: events.length,
    // Taste verdict travels in the council packet but stays compact: scores + appeal +
    // flaw counts + the single taste lesson, plus the top few distinct flaws (not all repeats).
    taste: rubric ? {
      overall: rubric.overall,
      scores: rubric.scores,
      humanAppeal: rubric.humanAppeal,
      flawCounts: rubric.flawCounts,
      genericFlags: rubric.genericFlags,
      tasteLesson: rubric.tasteLesson,
      headline: rubric.headline,
      topFlaws: flawEvents
        .filter((f, i, arr) => arr.findIndex((x) => x.symptom === f.symptom && x.evidence?.selector === f.evidence?.selector) === i)
        .sort((a, b) => ({ P0: 0, P1: 1, P2: 2, P3: 3 }[a.severity] - { P0: 0, P1: 1, P2: 2, P3: 3 }[b.severity]))
        .slice(0, 5)
        .map((f) => ({ severity: f.severity, symptom: f.symptom, fixDirection: f.fixDirection, selector: f.evidence?.selector ?? null })),
    } : null,
    headline: `visual #${run.id} ${run.status}${run.passed == null ? '' : run.passed ? '/pass' : '/fail'} · ${checksPassed}/${checks.length} checks · composer ${target?.reachable ? 'reachable' : target == null ? 'unknown' : 'covered'}${rubric ? ` · taste ${rubric.overall}/10 wow ${rubric.humanAppeal?.wow}/10` : ''}${warnings.length ? ` · ${warnings.length} warning(s)` : ''}`,
  };
}

/** Insert a corpus prompt if absent; return its id either way. */
export function upsertPrompt(db, { prompt, klass, expectedIntent, origin }) {
  db.prepare(
    `INSERT INTO prompts (prompt, class, expected_intent, origin, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(prompt) DO NOTHING`,
  ).run(prompt, klass, expectedIntent, origin, new Date().toISOString());
  return Number(db.prepare('SELECT id FROM prompts WHERE prompt = ?').get(prompt).id);
}

/** Has this prompt already been scored in this run? (resume guard) */
export function alreadyScored(db, runId, promptId) {
  return !!db.prepare('SELECT 1 FROM results WHERE run_id = ? AND prompt_id = ?').get(runId, promptId);
}

export function recordResult(db, r) {
  db.prepare(
    `INSERT INTO results
       (run_id, prompt_id, class, read_as, outcome, agreement, answer_excerpt, passed, grade_reason, duration_ms, answer_excellence, answer_excellence_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, prompt_id) DO UPDATE SET
       read_as=excluded.read_as, outcome=excluded.outcome, agreement=excluded.agreement,
       answer_excerpt=excluded.answer_excerpt, passed=excluded.passed,
       grade_reason=excluded.grade_reason, duration_ms=excluded.duration_ms,
       answer_excellence=excluded.answer_excellence, answer_excellence_json=excluded.answer_excellence_json`,
  ).run(
    r.runId, r.promptId, r.klass, r.readAs ?? null, r.outcome ?? null, r.agreement ?? null,
    (r.answerExcerpt ?? '').slice(0, 600), r.passed ? 1 : 0, r.gradeReason ?? null,
    r.durationMs ?? null,
    r.answerExcellence ?? null,
    r.answerExcellenceJson ?? null,
    new Date().toISOString(),
  );
}

export function queueFix(db, f) {
  db.prepare(
    `INSERT INTO fixes (run_id, class, failure_count, location, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(f.runId, f.klass, f.failureCount, f.location ?? null, f.summary, new Date().toISOString());
}

/** Per-class pass-rate for a run — drives the TUI bars. */
export function classStats(db, runId) {
  return db.prepare(
    `SELECT class,
            COUNT(*) AS total,
            SUM(passed) AS passed
     FROM results WHERE run_id = ?
     GROUP BY class ORDER BY class`,
  ).all(runId);
}

/**
 * Infra-pollution guard (Verification-First). An older brain.mjs recorded grader/runtime
 * OUTAGES as Vai FAILURES ("grader unavailable — counted as fail"). Those rows describe an
 * infra hiccup, not a Vai answer, so counting them craters the measured pass-rate and lies
 * to the motion meter. Current code SKIPS such turns instead of recording them, but the
 * historical rows remain — and any stray legacy/manual write could reintroduce them. This
 * predicate excludes them from every aggregate so the trend reflects Vai behavior only.
 * SQL fragment (no leading AND) so callers compose it into their WHERE clause.
 */
export const NOT_INFRA_RESULT_SQL =
  `(res.grade_reason IS NULL OR (res.grade_reason NOT LIKE '%grader unavailable%' AND res.grade_reason NOT LIKE '%counted as fail%'))`;
/** Same predicate for queries that alias the results table as `results`/no-alias. */
const NOT_INFRA_RESULT_BARE =
  `(grade_reason IS NULL OR (grade_reason NOT LIKE '%grader unavailable%' AND grade_reason NOT LIKE '%counted as fail%'))`;

/** Campaign trend: pass-rate per finished run, for the eventual Campaign zoom. */
export function campaignTrend(db) {
  return db.prepare(
    `SELECT r.id AS run_id, r.started_at,
            COUNT(CASE WHEN ${NOT_INFRA_RESULT_SQL} THEN res.id END) AS total,
            COALESCE(SUM(CASE WHEN ${NOT_INFRA_RESULT_SQL} THEN res.passed ELSE 0 END),0) AS passed
     FROM runs r LEFT JOIN results res ON res.run_id = r.id
     GROUP BY r.id ORDER BY r.id`,
  ).all();
}

/**
 * The EXACT prompts currently failing for a class — each prompt's MOST RECENT result
 * (max run_id) is a failure. This is the honest acceptance-verifier target: re-run THESE
 * specific rows after a fix and confirm THEY moved, instead of trusting corpus-wide drift.
 * try/catch-guarded so a fresh corpus returns [] instead of crashing.
 * @returns {{prompt_id:number, prompt:string, expected_intent:string, run_id:number, grade_reason:string}[]}
 */
export function failingRowsForClass(db, klass) {
  try {
    return db.prepare(
      `SELECT r.prompt_id, p.prompt, p.expected_intent, r.run_id, r.grade_reason
       FROM results r
       JOIN prompts p ON p.id = r.prompt_id
       JOIN (SELECT prompt_id, MAX(run_id) AS mrun FROM results WHERE class = ? GROUP BY prompt_id) m
         ON m.prompt_id = r.prompt_id AND m.mrun = r.run_id
       WHERE r.class = ? AND r.passed = 0
       ORDER BY r.prompt_id`,
    ).all(klass, klass);
  } catch {
    return [];
  }
}

/** Campaign-wide per-class pass-rate across ALL runs — the grader reads this to
 *  spend the scarce one-at-a-time GPU budget on the LOWEST pass-rate class, not on
 *  whichever class happened to fail in the latest tiny run. try/catch-guarded so a
 *  fresh corpus (no results table populated yet) reports [] instead of crashing. */
export function campaignClassStats(db) {
  try {
    return db.prepare(
      `SELECT class, COUNT(*) AS total, COALESCE(SUM(passed),0) AS passed
       FROM results WHERE ${NOT_INFRA_RESULT_BARE} GROUP BY class ORDER BY class`,
    ).all();
  } catch {
    return [];
  }
}

/** Answer-excellence trend: average craft score + sample count per run, oldest
 *  first. The cross-run quality gradient the motion meter reads to tell whether
 *  the council's OUTPUT is getting better over the perpetual run, not just its
 *  read-the-prompt pass-rate. Runs with no scored answers report n=0, avg=null. */
export function answerExcellenceTrend(db) {
  try {
    return db.prepare(
      `SELECT r.id AS run_id, r.started_at,
              COUNT(res.answer_excellence) AS n,
              AVG(res.answer_excellence) AS avg
       FROM runs r LEFT JOIN results res ON res.run_id = r.id
       GROUP BY r.id ORDER BY r.id`,
    ).all();
  } catch {
    return [];
  }
}

/** Proposal quality: of the failure CLASSES we proposed fixes for, how many
 *  converged into a grep-verified consensus winner. Convergence is a per-class
 *  question — propose-fix emits many persona proposals per class and consensus-fix
 *  converges them into a verified winner for that class — so the metric is measured
 *  at the class grain and SCOPED to the proposed classes. That keeps it bounded
 *  [0,1] and stops unrelated lanes (e.g. the visual ui/* consensus the supervisor
 *  also writes into this table) from inflating it past 100%. Low hit-rate with
 *  enough proposed classes = the propose prompt is weak (the signal the innovation
 *  engine reads to suggest a prompt experiment). Both tables are lazy, so a fresh
 *  corpus reports zeros instead of crashing. */
export function proposalQualityStats(db) {
  const count = (sql) => { try { return Number(db.prepare(sql).get().c) || 0; } catch { return 0; } };
  const total = count('SELECT COUNT(DISTINCT class) c FROM proposals');
  const converged = count(
    'SELECT COUNT(DISTINCT p.class) c FROM proposals p '
    + 'WHERE EXISTS (SELECT 1 FROM consensus c WHERE c.verified=1 AND c.class=p.class)',
  );
  return { total, converged, hitRate: total > 0 ? converged / total : 0 };
}

/** Council health: fraction of results where the council actually convened (read_as
 *  non-empty). A low response-rate means members aren't answering parseably — the
 *  signal for a model experiment. runId null = campaign-wide. */
export function councilResponseRate(db, runId = null) {
  try {
    const where = runId == null ? '' : 'WHERE run_id = ?';
    const args = runId == null ? [] : [runId];
    const row = db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN read_as IS NOT NULL AND TRIM(read_as) <> '' THEN 1 ELSE 0 END) AS responded
       FROM results ${where}`,
    ).get(...args);
    const total = Number(row?.total) || 0;
    const responded = Number(row?.responded) || 0;
    return { total, responded, responseRate: total > 0 ? responded / total : 1 };
  } catch {
    return { total: 0, responded: 0, responseRate: 1 };
  }
}

/** Low-excellence count: graded answers scoring below `threshold` (out of 10) — the
 *  raw count of weak-craft answers the grading experiments aim to shrink. The
 *  threshold `?` sits in the SELECT (before the WHERE), so it is always the first
 *  bound param; runId, when present, follows. */
export function lowExcellenceCount(db, runId = null, threshold = 6) {
  try {
    const where = runId == null
      ? 'WHERE answer_excellence IS NOT NULL'
      : 'WHERE run_id = ? AND answer_excellence IS NOT NULL';
    const args = runId == null ? [threshold] : [threshold, runId];
    const row = db.prepare(
      `SELECT COUNT(*) AS graded,
              SUM(CASE WHEN answer_excellence < ? THEN 1 ELSE 0 END) AS low
       FROM results ${where}`,
    ).get(...args);
    return { graded: Number(row?.graded) || 0, low: Number(row?.low) || 0, threshold };
  } catch {
    return { graded: 0, low: 0, threshold };
  }
}
