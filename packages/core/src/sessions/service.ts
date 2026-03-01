/**
 * Session Storage Service — persists agent sessions and events to SQLite.
 *
 * Uses the same VaiDatabase (drizzle + better-sqlite3) as the rest of the app.
 * Sessions are stored in `agent_sessions`, events in `session_events`.
 */

import type { VaiDatabase } from '../db/client.js';
import { getRawDb } from '../db/client.js';
import type {
  AgentSession,
  SessionEvent,
  SessionStats,
  SessionEventType,
} from './types.js';
import { createSessionId, createEventId } from './types.js';

/* ── Raw SQL for table creation (called by migration) ─────────── */

export const SESSION_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS agent_sessions (
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
  );

  CREATE TABLE IF NOT EXISTS session_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id),
    type TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    duration_ms INTEGER,
    content TEXT NOT NULL,
    meta TEXT NOT NULL DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id);
  CREATE INDEX IF NOT EXISTS idx_session_events_type ON session_events(type);
  CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status);
`;

/* ── Service ──────────────────────────────────────────────────── */

export class SessionService {
  constructor(private db: VaiDatabase) {}

  /** Ensure tables exist (idempotent) */
  ensureTables(): void {
    try {
      const raw = this.getRawDb();
      raw.exec(SESSION_TABLES_SQL);
    } catch {
      // Tables already exist or migration handled it — ignore
    }
  }

  /* ── Sessions ── */

  createSession(data: {
    title: string;
    description?: string;
    agentName: string;
    modelId: string;
    tags?: string[];
  }): AgentSession {
    const session: AgentSession = {
      id: createSessionId(),
      title: data.title,
      description: data.description,
      agentName: data.agentName,
      modelId: data.modelId,
      startedAt: Date.now(),
      status: 'active',
      tags: data.tags ?? [],
      stats: {
        messageCount: 0,
        filesCreated: 0,
        filesModified: 0,
        filesRead: 0,
        terminalCommands: 0,
        thinkingBlocks: 0,
        totalDurationMs: 0,
        linesAdded: 0,
        linesRemoved: 0,
        todosCompleted: 0,
        todosTotal: 0,
        errorsEncountered: 0,
      },
    };

    this.rawExec(
      `INSERT INTO agent_sessions (id, title, description, agent_name, model_id, started_at, status, stats, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.title,
        session.description ?? null,
        session.agentName,
        session.modelId,
        session.startedAt,
        session.status,
        JSON.stringify(session.stats),
        JSON.stringify(session.tags),
      ],
    );

    return session;
  }

  getSession(id: string): AgentSession | null {
    const row = this.rawGet(
      'SELECT * FROM agent_sessions WHERE id = ?',
      [id],
    ) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToSession(row);
  }

  listSessions(options?: {
    status?: string;
    limit?: number;
    offset?: number;
  }): AgentSession[] {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    let sql = 'SELECT * FROM agent_sessions';
    const params: unknown[] = [];

    if (options?.status) {
      sql += ' WHERE status = ?';
      params.push(options.status);
    }

    sql += ' ORDER BY started_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.rawAll(sql, params) as Record<string, unknown>[];
    return rows.map((r) => this.rowToSession(r));
  }

  updateSession(
    id: string,
    updates: Partial<Pick<AgentSession, 'title' | 'description' | 'status' | 'endedAt' | 'stats' | 'tags'>>,
  ): void {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.title !== undefined) {
      sets.push('title = ?');
      params.push(updates.title);
    }
    if (updates.description !== undefined) {
      sets.push('description = ?');
      params.push(updates.description);
    }
    if (updates.status !== undefined) {
      sets.push('status = ?');
      params.push(updates.status);
    }
    if (updates.endedAt !== undefined) {
      sets.push('ended_at = ?');
      params.push(updates.endedAt);
    }
    if (updates.stats !== undefined) {
      sets.push('stats = ?');
      params.push(JSON.stringify(updates.stats));
    }
    if (updates.tags !== undefined) {
      sets.push('tags = ?');
      params.push(JSON.stringify(updates.tags));
    }

    if (sets.length > 0) {
      this.rawExec(
        `UPDATE agent_sessions SET ${sets.join(', ')} WHERE id = ?`,
        [...params, id],
      );
    }
  }

  endSession(id: string, status: 'completed' | 'failed' = 'completed'): void {
    const session = this.getSession(id);
    if (!session) return;

    // Recompute stats from events
    const stats = this.computeStats(id);
    stats.totalDurationMs = Date.now() - session.startedAt;

    this.updateSession(id, {
      status,
      endedAt: Date.now(),
      stats,
    });
  }

  deleteSession(id: string): void {
    this.rawExec('DELETE FROM session_events WHERE session_id = ?', [id]);
    this.rawExec('DELETE FROM agent_sessions WHERE id = ?', [id]);
  }

  /* ── Events ── */

  addEvent(event: Omit<SessionEvent, 'id'>): SessionEvent {
    const full: SessionEvent = { ...event, id: createEventId() };

    this.rawExec(
      `INSERT INTO session_events (id, session_id, type, timestamp, duration_ms, content, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        full.id,
        full.sessionId,
        full.type,
        full.timestamp,
        full.durationMs ?? null,
        full.content,
        JSON.stringify(full.meta),
      ],
    );

    // Update session stats incrementally
    this.incrementStats(full);

    return full;
  }

  addEvents(events: Omit<SessionEvent, 'id'>[]): SessionEvent[] {
    return events.map((e) => this.addEvent(e));
  }

  getEvents(
    sessionId: string,
    options?: {
      type?: SessionEventType;
      limit?: number;
      offset?: number;
    },
  ): SessionEvent[] {
    let sql = 'SELECT * FROM session_events WHERE session_id = ?';
    const params: unknown[] = [sessionId];

    if (options?.type) {
      sql += ' AND type = ?';
      params.push(options.type);
    }

    sql += ' ORDER BY timestamp ASC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
      if (options?.offset) {
        sql += ' OFFSET ?';
        params.push(options.offset);
      }
    }

    const rows = this.rawAll(sql, params) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEvent(r));
  }

  getEventCount(sessionId: string): number {
    const row = this.rawGet(
      'SELECT COUNT(*) as count FROM session_events WHERE session_id = ?',
      [sessionId],
    ) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /* ── Stats ── */

  private computeStats(sessionId: string): SessionStats {
    const events = this.getEvents(sessionId);
    const stats: SessionStats = {
      messageCount: 0,
      filesCreated: 0,
      filesModified: 0,
      filesRead: 0,
      terminalCommands: 0,
      thinkingBlocks: 0,
      totalDurationMs: 0,
      linesAdded: 0,
      linesRemoved: 0,
      todosCompleted: 0,
      todosTotal: 0,
      errorsEncountered: 0,
    };

    for (const e of events) {
      const meta = e.meta as unknown as Record<string, unknown>;
      switch (e.type) {
        case 'message':
          stats.messageCount++;
          break;
        case 'thinking':
          stats.thinkingBlocks++;
          break;
        case 'file-create':
          stats.filesCreated++;
          stats.linesAdded += (meta.linesAdded as number) ?? 0;
          break;
        case 'file-edit':
          stats.filesModified++;
          stats.linesAdded += (meta.linesAdded as number) ?? 0;
          stats.linesRemoved += (meta.linesRemoved as number) ?? 0;
          break;
        case 'file-read':
          stats.filesRead++;
          break;
        case 'terminal':
          stats.terminalCommands++;
          break;
        case 'error':
          stats.errorsEncountered++;
          break;
        case 'todo-update': {
          const todos = (meta.todos as Array<{ status: string }>) ?? [];
          stats.todosTotal = todos.length;
          stats.todosCompleted = todos.filter((t) => t.status === 'completed').length;
          break;
        }
      }
    }

    return stats;
  }

  private incrementStats(event: SessionEvent): void {
    const session = this.getSession(event.sessionId);
    if (!session) return;

    const s = { ...session.stats };
    const meta = event.meta as unknown as Record<string, unknown>;

    switch (event.type) {
      case 'message':
        s.messageCount++;
        break;
      case 'thinking':
      case 'planning':
      case 'context-gather':
        s.thinkingBlocks++;
        break;
      case 'file-create':
        s.filesCreated++;
        s.linesAdded += (meta.linesAdded as number) ?? 0;
        break;
      case 'file-edit':
        s.filesModified++;
        s.linesAdded += (meta.linesAdded as number) ?? 0;
        s.linesRemoved += (meta.linesRemoved as number) ?? 0;
        break;
      case 'file-read':
        s.filesRead++;
        break;
      case 'terminal':
        s.terminalCommands++;
        break;
      case 'error':
        s.errorsEncountered++;
        break;
      case 'todo-update': {
        const todos = (meta.todos as Array<{ status: string }>) ?? [];
        s.todosTotal = todos.length;
        s.todosCompleted = todos.filter((t) => t.status === 'completed').length;
        break;
      }
    }

    s.totalDurationMs = Date.now() - session.startedAt;
    this.updateSession(event.sessionId, { stats: s });
  }

  /* ── Import / Export ── */

  exportSession(id: string): { session: AgentSession; events: SessionEvent[] } | null {
    const session = this.getSession(id);
    if (!session) return null;
    const events = this.getEvents(id);
    return { session, events };
  }

  importSession(data: { session: AgentSession; events: SessionEvent[] }): string {
    // Insert session
    this.rawExec(
      `INSERT OR REPLACE INTO agent_sessions (id, title, description, agent_name, model_id, started_at, ended_at, status, stats, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.session.id,
        data.session.title,
        data.session.description ?? null,
        data.session.agentName,
        data.session.modelId,
        data.session.startedAt,
        data.session.endedAt ?? null,
        data.session.status,
        JSON.stringify(data.session.stats),
        JSON.stringify(data.session.tags),
      ],
    );

    // Insert events
    for (const e of data.events) {
      this.rawExec(
        `INSERT OR REPLACE INTO session_events (id, session_id, type, timestamp, duration_ms, content, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [e.id, e.sessionId, e.type, e.timestamp, e.durationMs ?? null, e.content, JSON.stringify(e.meta)],
      );
    }

    return data.session.id;
  }

  /* ── Raw SQL helpers (uses the underlying better-sqlite3 connection) ── */

  private rawExec(sql: string, params: unknown[]): void {
    const raw = this.getRawDb();
    raw.prepare(sql).run(...params);
  }

  private rawGet(sql: string, params: unknown[]): unknown {
    const raw = this.getRawDb();
    return raw.prepare(sql).get(...params);
  }

  private rawAll(sql: string, params: unknown[]): unknown[] {
    const raw = this.getRawDb();
    return raw.prepare(sql).all(...params) as unknown[];
  }

  private getRawDb() {
    // Use the raw better-sqlite3 Database instance exposed by the DB client
    const raw = getRawDb();
    if (!raw) throw new Error('Raw database not available — ensure createDb/getDb is called first');
    return raw as unknown as {
      prepare: (sql: string) => {
        run: (...params: unknown[]) => void;
        get: (...params: unknown[]) => unknown;
        all: (...params: unknown[]) => unknown[];
      };
      exec: (sql: string) => void;
    };
  }

  /* ── Row mapping ── */

  private rowToSession(row: Record<string, unknown>): AgentSession {
    return {
      id: row.id as string,
      title: row.title as string,
      description: (row.description as string) ?? undefined,
      agentName: row.agent_name as string,
      modelId: row.model_id as string,
      startedAt: row.started_at as number,
      endedAt: (row.ended_at as number) ?? undefined,
      status: row.status as AgentSession['status'],
      stats: JSON.parse((row.stats as string) || '{}'),
      tags: JSON.parse((row.tags as string) || '[]'),
    };
  }

  private rowToEvent(row: Record<string, unknown>): SessionEvent {
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      type: row.type as SessionEventType,
      timestamp: row.timestamp as number,
      durationMs: (row.duration_ms as number) ?? undefined,
      content: row.content as string,
      meta: JSON.parse((row.meta as string) || '{}'),
    };
  }
}
