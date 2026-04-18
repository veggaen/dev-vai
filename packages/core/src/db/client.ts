import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type VaiDatabase = BetterSQLite3Database<typeof schema>;

const EVAL_RUN_TRACKS = ['comprehension', 'casual', 'creative', 'complex', 'navigation', 'bugfix', 'feature', 'thorsen', 'gym'] as const;
const EVAL_RUN_TRACK_SQL = EVAL_RUN_TRACKS.map((track) => `'${track}'`).join(', ');

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS platform_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    avatar_url TEXT,
    email_verified_at INTEGER,
    last_login_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS platform_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES platform_users(id),
    provider TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    scope TEXT,
    token_type TEXT,
    token_expires_at INTEGER,
    raw_profile TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(provider, provider_account_id)
  );

  CREATE TABLE IF NOT EXISTS platform_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES platform_users(id),
    token_hash TEXT NOT NULL UNIQUE,
    user_agent TEXT,
    ip_address TEXT,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS platform_oauth_states (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    state TEXT NOT NULL UNIQUE,
    code_verifier TEXT NOT NULL,
    return_to TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS platform_device_codes (
    id TEXT PRIMARY KEY,
    device_code TEXT NOT NULL UNIQUE,
    user_code TEXT NOT NULL UNIQUE,
    client_name TEXT NOT NULL,
    client_type TEXT NOT NULL,
    installation_key TEXT,
    launch_target TEXT,
    capabilities TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    approved_by_user_id TEXT REFERENCES platform_users(id),
    expires_at INTEGER NOT NULL,
    approved_at INTEGER,
    last_polled_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS platform_companion_clients (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES platform_users(id),
    installation_key TEXT NOT NULL UNIQUE,
    client_name TEXT NOT NULL,
    client_type TEXT NOT NULL,
    launch_target TEXT NOT NULL,
    capabilities TEXT,
    last_seen_at INTEGER,
    last_polled_at INTEGER,
    created_via_device_code_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS platform_projects (
    id TEXT PRIMARY KEY,
    sandbox_project_id TEXT NOT NULL UNIQUE,
    owner_user_id TEXT REFERENCES platform_users(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    root_dir TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    visibility TEXT NOT NULL DEFAULT 'private',
    last_opened_at INTEGER,
    last_synced_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS platform_project_members (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES platform_projects(id),
    user_id TEXT NOT NULL REFERENCES platform_users(id),
    role TEXT NOT NULL,
    invited_by_user_id TEXT REFERENCES platform_users(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(project_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS platform_project_share_links (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES platform_projects(id),
    token_hash TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    max_uses INTEGER NOT NULL DEFAULT 1,
    use_count INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER,
    revoked_at INTEGER,
    created_by_user_id TEXT REFERENCES platform_users(id),
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS platform_project_handoff_intents (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES platform_projects(id),
    token_hash TEXT NOT NULL UNIQUE,
    target TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_by_user_id TEXT REFERENCES platform_users(id),
    claimed_by_user_id TEXT REFERENCES platform_users(id),
    client_info TEXT,
    expires_at INTEGER NOT NULL,
    claimed_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS platform_project_peers (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES platform_projects(id),
    peer_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    ide TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    launch_target TEXT NOT NULL,
    preferred_client_id TEXT REFERENCES platform_companion_clients(id),
    instructions TEXT,
    created_by_user_id TEXT REFERENCES platform_users(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(project_id, peer_key)
  );

  CREATE TABLE IF NOT EXISTS platform_project_audit_requests (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES platform_projects(id),
    created_by_user_id TEXT REFERENCES platform_users(id),
    prompt TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'project',
    status TEXT NOT NULL DEFAULT 'pending',
    consensus_summary TEXT,
    winning_peer_key TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS platform_project_audit_results (
    id TEXT PRIMARY KEY,
    audit_request_id TEXT NOT NULL REFERENCES platform_project_audit_requests(id),
    project_id TEXT NOT NULL REFERENCES platform_projects(id),
    peer_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    claimed_by_user_id TEXT REFERENCES platform_users(id),
    claimed_by_client_id TEXT REFERENCES platform_companion_clients(id),
    claimed_at INTEGER,
    claim_expires_at INTEGER,
    verdict TEXT,
    confidence INTEGER,
    rationale TEXT,
    submitted_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(audit_request_id, peer_key)
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    model_id TEXT NOT NULL,
    sandbox_project_id TEXT,
    mode TEXT NOT NULL DEFAULT 'chat',
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
    feedback INTEGER,
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
    track TEXT NOT NULL CHECK(track IN (${EVAL_RUN_TRACK_SQL})),
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
  CREATE INDEX IF NOT EXISTS idx_platform_accounts_user ON platform_accounts(user_id);
  CREATE INDEX IF NOT EXISTS idx_platform_sessions_user ON platform_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_platform_oauth_states_provider ON platform_oauth_states(provider);
  CREATE INDEX IF NOT EXISTS idx_platform_device_codes_status ON platform_device_codes(status);
  CREATE INDEX IF NOT EXISTS idx_platform_companion_clients_user ON platform_companion_clients(user_id);
  CREATE INDEX IF NOT EXISTS idx_platform_companion_clients_user_target ON platform_companion_clients(user_id, launch_target);
  CREATE INDEX IF NOT EXISTS idx_platform_projects_owner ON platform_projects(owner_user_id);
  CREATE INDEX IF NOT EXISTS idx_platform_projects_slug ON platform_projects(slug);
  CREATE INDEX IF NOT EXISTS idx_platform_project_members_project ON platform_project_members(project_id);
  CREATE INDEX IF NOT EXISTS idx_platform_project_members_user ON platform_project_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_platform_project_share_links_project ON platform_project_share_links(project_id);
  CREATE INDEX IF NOT EXISTS idx_platform_project_handoff_project ON platform_project_handoff_intents(project_id);
  CREATE INDEX IF NOT EXISTS idx_platform_project_handoff_target_status ON platform_project_handoff_intents(target, status);
  CREATE INDEX IF NOT EXISTS idx_platform_project_peers_project ON platform_project_peers(project_id);
  CREATE INDEX IF NOT EXISTS idx_platform_project_audit_requests_project ON platform_project_audit_requests(project_id);
  CREATE INDEX IF NOT EXISTS idx_platform_project_audit_requests_status ON platform_project_audit_requests(status);
  CREATE INDEX IF NOT EXISTS idx_platform_project_audit_results_project ON platform_project_audit_results(project_id);
  CREATE INDEX IF NOT EXISTS idx_platform_project_audit_results_audit ON platform_project_audit_results(audit_request_id);

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
  `CREATE TABLE IF NOT EXISTS platform_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    avatar_url TEXT,
    email_verified_at INTEGER,
    last_login_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS platform_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES platform_users(id),
    provider TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    scope TEXT,
    token_type TEXT,
    token_expires_at INTEGER,
    raw_profile TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(provider, provider_account_id)
  )`,
  `CREATE TABLE IF NOT EXISTS platform_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES platform_users(id),
    token_hash TEXT NOT NULL UNIQUE,
    user_agent TEXT,
    ip_address TEXT,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS platform_oauth_states (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    state TEXT NOT NULL UNIQUE,
    code_verifier TEXT NOT NULL,
    return_to TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS platform_device_codes (
    id TEXT PRIMARY KEY,
    device_code TEXT NOT NULL UNIQUE,
    user_code TEXT NOT NULL UNIQUE,
    client_name TEXT NOT NULL,
    client_type TEXT NOT NULL,
    installation_key TEXT,
    launch_target TEXT,
    capabilities TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    approved_by_user_id TEXT REFERENCES platform_users(id),
    expires_at INTEGER NOT NULL,
    approved_at INTEGER,
    last_polled_at INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS platform_companion_clients (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES platform_users(id),
    installation_key TEXT NOT NULL UNIQUE,
    client_name TEXT NOT NULL,
    client_type TEXT NOT NULL,
    launch_target TEXT NOT NULL,
    capabilities TEXT,
    last_seen_at INTEGER,
    last_polled_at INTEGER,
    created_via_device_code_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_platform_accounts_user ON platform_accounts(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_sessions_user ON platform_sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_oauth_states_provider ON platform_oauth_states(provider)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_device_codes_status ON platform_device_codes(status)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_companion_clients_user ON platform_companion_clients(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_companion_clients_user_target ON platform_companion_clients(user_id, launch_target)`,
  `CREATE TABLE IF NOT EXISTS platform_projects (
    id TEXT PRIMARY KEY,
    sandbox_project_id TEXT NOT NULL UNIQUE,
    owner_user_id TEXT REFERENCES platform_users(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    root_dir TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    visibility TEXT NOT NULL DEFAULT 'private',
    last_opened_at INTEGER,
    last_synced_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS platform_project_members (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES platform_projects(id),
    user_id TEXT NOT NULL REFERENCES platform_users(id),
    role TEXT NOT NULL,
    invited_by_user_id TEXT REFERENCES platform_users(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(project_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS platform_project_share_links (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES platform_projects(id),
    token_hash TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    max_uses INTEGER NOT NULL DEFAULT 1,
    use_count INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER,
    revoked_at INTEGER,
    created_by_user_id TEXT REFERENCES platform_users(id),
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS platform_project_handoff_intents (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES platform_projects(id),
    token_hash TEXT NOT NULL UNIQUE,
    target TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_by_user_id TEXT REFERENCES platform_users(id),
    claimed_by_user_id TEXT REFERENCES platform_users(id),
    client_info TEXT,
    expires_at INTEGER NOT NULL,
    claimed_at INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS platform_project_peers (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES platform_projects(id),
    peer_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    ide TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    launch_target TEXT NOT NULL,
    preferred_client_id TEXT REFERENCES platform_companion_clients(id),
    instructions TEXT,
    created_by_user_id TEXT REFERENCES platform_users(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(project_id, peer_key)
  )`,
  `CREATE TABLE IF NOT EXISTS platform_project_audit_requests (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES platform_projects(id),
    created_by_user_id TEXT REFERENCES platform_users(id),
    prompt TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'project',
    status TEXT NOT NULL DEFAULT 'pending',
    consensus_summary TEXT,
    winning_peer_key TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS platform_project_audit_results (
    id TEXT PRIMARY KEY,
    audit_request_id TEXT NOT NULL REFERENCES platform_project_audit_requests(id),
    project_id TEXT NOT NULL REFERENCES platform_projects(id),
    peer_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    claimed_by_user_id TEXT REFERENCES platform_users(id),
    claimed_by_client_id TEXT REFERENCES platform_companion_clients(id),
    claimed_at INTEGER,
    claim_expires_at INTEGER,
    verdict TEXT,
    confidence INTEGER,
    rationale TEXT,
    submitted_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(audit_request_id, peer_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_platform_projects_owner ON platform_projects(owner_user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_projects_slug ON platform_projects(slug)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_project_members_project ON platform_project_members(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_project_members_user ON platform_project_members(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_project_share_links_project ON platform_project_share_links(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_project_handoff_project ON platform_project_handoff_intents(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_project_handoff_target_status ON platform_project_handoff_intents(target, status)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_project_peers_project ON platform_project_peers(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_project_audit_requests_project ON platform_project_audit_requests(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_project_audit_requests_status ON platform_project_audit_requests(status)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_project_audit_results_project ON platform_project_audit_results(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_platform_project_audit_results_audit ON platform_project_audit_results(audit_request_id)`,
  `ALTER TABLE platform_device_codes ADD COLUMN installation_key TEXT`,
  `ALTER TABLE platform_device_codes ADD COLUMN launch_target TEXT`,
  `ALTER TABLE platform_device_codes ADD COLUMN capabilities TEXT`,
  `ALTER TABLE platform_project_peers ADD COLUMN preferred_client_id TEXT REFERENCES platform_companion_clients(id)`,
  `ALTER TABLE platform_project_audit_results ADD COLUMN claimed_by_user_id TEXT REFERENCES platform_users(id)`,
  `ALTER TABLE platform_project_audit_results ADD COLUMN claimed_by_client_id TEXT REFERENCES platform_companion_clients(id)`,
  `ALTER TABLE platform_project_audit_results ADD COLUMN claimed_at INTEGER`,
  `ALTER TABLE platform_project_audit_results ADD COLUMN claim_expires_at INTEGER`,
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
  // VPT instrumentation — timing + quality metrics
  `ALTER TABLE messages ADD COLUMN duration_ms INTEGER`,
  `ALTER TABLE sources ADD COLUMN quality_score REAL`,
  `ALTER TABLE sources ADD COLUMN last_validated INTEGER`,
  // Feedback column for thumbs up/down on messages
  `ALTER TABLE messages ADD COLUMN feedback INTEGER`,
  // Persist explicit conversation mode in runtime truth
  `ALTER TABLE conversations ADD COLUMN mode TEXT NOT NULL DEFAULT 'chat'`,
  // Persist an optional sandbox attachment per conversation
  `ALTER TABLE conversations ADD COLUMN sandbox_project_id TEXT`,
  // Per-user conversation ownership
  `ALTER TABLE conversations ADD COLUMN owner_user_id TEXT`,
  // Sharing / visibility
  `ALTER TABLE conversations ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'`,
  `ALTER TABLE conversations ADD COLUMN share_slug TEXT`,
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

function migrateEvalRunsTrackConstraint(sqlite: InstanceType<typeof Database>): void {
  const row = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'eval_runs'").get() as
    | { sql?: string }
    | undefined;
  const tableSql = row?.sql ?? '';
  const hasAllTracks = EVAL_RUN_TRACKS.every((track) => tableSql.includes(`'${track}'`));

  if (!tableSql || hasAllTracks) {
    return;
  }

  sqlite.pragma('foreign_keys = OFF');

  try {
    const migrate = sqlite.transaction(() => {
      sqlite.exec(`
        CREATE TABLE eval_runs_new (
          id TEXT PRIMARY KEY,
          model_id TEXT NOT NULL,
          track TEXT NOT NULL CHECK(track IN (${EVAL_RUN_TRACK_SQL})),
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          config TEXT
        );

        INSERT INTO eval_runs_new (id, model_id, track, started_at, ended_at, config)
        SELECT id, model_id, track, started_at, ended_at, config
        FROM eval_runs;

        DROP TABLE eval_runs;
        ALTER TABLE eval_runs_new RENAME TO eval_runs;
      `);
    });

    migrate();
  } finally {
    sqlite.pragma('foreign_keys = ON');
  }
}

let dbInstance: VaiDatabase | null = null;
let rawDbInstance: InstanceType<typeof Database> | null = null;

function ensureDbParentDir(path?: string): void {
  if (!path || path === ':memory:') return;
  mkdirSync(dirname(path), { recursive: true });
}

export function getDb(path?: string): VaiDatabase {
  if (dbInstance) return dbInstance;

  ensureDbParentDir(path);
  const sqlite = new Database(path ?? ':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(CREATE_TABLES_SQL);
  runMigrations(sqlite);
  migrateEvalRunsTrackConstraint(sqlite);

  rawDbInstance = sqlite;
  dbInstance = drizzle(sqlite, { schema });
  return dbInstance;
}

export function createDb(path?: string): VaiDatabase {
  ensureDbParentDir(path);
  const sqlite = new Database(path ?? ':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(CREATE_TABLES_SQL);
  runMigrations(sqlite);
  migrateEvalRunsTrackConstraint(sqlite);
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
