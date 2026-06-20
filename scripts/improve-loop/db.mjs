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
