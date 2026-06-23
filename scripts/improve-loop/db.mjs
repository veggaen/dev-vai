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
  `);
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
       (run_id, prompt_id, class, read_as, outcome, agreement, answer_excerpt, passed, grade_reason, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, prompt_id) DO UPDATE SET
       read_as=excluded.read_as, outcome=excluded.outcome, agreement=excluded.agreement,
       answer_excerpt=excluded.answer_excerpt, passed=excluded.passed,
       grade_reason=excluded.grade_reason, duration_ms=excluded.duration_ms`,
  ).run(
    r.runId, r.promptId, r.klass, r.readAs ?? null, r.outcome ?? null, r.agreement ?? null,
    (r.answerExcerpt ?? '').slice(0, 600), r.passed ? 1 : 0, r.gradeReason ?? null,
    r.durationMs ?? null, new Date().toISOString(),
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

/** Campaign trend: pass-rate per finished run, for the eventual Campaign zoom. */
export function campaignTrend(db) {
  return db.prepare(
    `SELECT r.id AS run_id, r.started_at,
            COUNT(res.id) AS total,
            COALESCE(SUM(res.passed),0) AS passed
     FROM runs r LEFT JOIN results res ON res.run_id = r.id
     GROUP BY r.id ORDER BY r.id`,
  ).all();
}
