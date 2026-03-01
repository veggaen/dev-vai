import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type VaiDatabase = BetterSQLite3Database<typeof schema>;

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    model_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    conversation_id TEXT REFERENCES conversations(id),
    source_id TEXT,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    data TEXT NOT NULL,
    description TEXT NOT NULL,
    question TEXT,
    width INTEGER,
    height INTEGER,
    size_bytes INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT NOT NULL,
    image_id TEXT REFERENCES images(id),
    tool_calls TEXT,
    tool_call_id TEXT,
    token_count INTEGER,
    model_id TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL CHECK(source_type IN ('web', 'youtube', 'file')),
    url TEXT,
    title TEXT NOT NULL,
    captured_at INTEGER NOT NULL,
    meta TEXT
  );

  CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id),
    level INTEGER NOT NULL,
    ordinal INTEGER NOT NULL,
    content TEXT NOT NULL,
    meta TEXT
  );

  CREATE TABLE IF NOT EXISTS eval_runs (
    id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL,
    track TEXT NOT NULL CHECK(track IN ('comprehension', 'navigation', 'bugfix', 'feature')),
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    config TEXT
  );

  CREATE TABLE IF NOT EXISTS eval_scores (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES eval_runs(id),
    task_id TEXT NOT NULL,
    passed INTEGER NOT NULL,
    score REAL,
    attempts INTEGER NOT NULL,
    tokens_in INTEGER,
    tokens_out INTEGER,
    wall_time INTEGER,
    detail TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source_id);
  CREATE INDEX IF NOT EXISTS idx_eval_scores_run ON eval_scores(run_id);
  CREATE INDEX IF NOT EXISTS idx_images_conversation ON images(conversation_id);

  CREATE TABLE IF NOT EXISTS taught_entries (
    id TEXT PRIMARY KEY,
    pattern TEXT NOT NULL,
    response TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'vcus-teaching',
    language TEXT NOT NULL DEFAULT 'en',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_taught_entries_source ON taught_entries(source);
`;

/**
 * Migration SQL: adds new columns/tables to existing databases.
 * Each statement is safe to run multiple times (uses IF NOT EXISTS or catches errors).
 */
const MIGRATION_SQL = [
  // Add image_id column to messages (may already exist in fresh DBs)
  `ALTER TABLE messages ADD COLUMN image_id TEXT REFERENCES images(id)`,
  // Add taught_entries table for VCUS teaching persistence
  `CREATE TABLE IF NOT EXISTS taught_entries (
    id TEXT PRIMARY KEY,
    pattern TEXT NOT NULL,
    response TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'vcus-teaching',
    language TEXT NOT NULL DEFAULT 'en',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_taught_entries_source ON taught_entries(source)`,
  // Agent session logger tables
  `CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    agent_name TEXT NOT NULL,
    model_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'failed')),
    stats TEXT NOT NULL DEFAULT '{}',
    tags TEXT NOT NULL DEFAULT '[]'
  )`,
  `CREATE TABLE IF NOT EXISTS session_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id),
    type TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    duration_ms INTEGER,
    content TEXT NOT NULL,
    meta TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_session_events_type ON session_events(type)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status)`,
];

/**
 * Run safe migrations: each ALTER TABLE may fail if it already exists.
 */
function runMigrations(sqlite: InstanceType<typeof Database>): void {
  for (const sql of MIGRATION_SQL) {
    try {
      sqlite.exec(sql);
    } catch {
      // Column/table already exists — ignore
    }
  }
}

let dbInstance: VaiDatabase | null = null;
let rawDbInstance: InstanceType<typeof Database> | null = null;

export function getDb(path?: string): VaiDatabase {
  if (dbInstance) return dbInstance;

  const sqlite = new Database(path ?? ':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(CREATE_TABLES_SQL);
  runMigrations(sqlite);

  rawDbInstance = sqlite;
  dbInstance = drizzle(sqlite, { schema });
  return dbInstance;
}

export function createDb(path?: string): VaiDatabase {
  const sqlite = new Database(path ?? ':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(CREATE_TABLES_SQL);
  runMigrations(sqlite);
  rawDbInstance = sqlite;
  return drizzle(sqlite, { schema });
}

/** Get the underlying better-sqlite3 Database instance */
export function getRawDb(): InstanceType<typeof Database> | null {
  return rawDbInstance;
}

export function resetDbInstance(): void {
  dbInstance = null;
  rawDbInstance = null;
}
