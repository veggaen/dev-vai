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
  PinnedNote,
  PinnedNoteCategory,
  ContextSummary,
  SearchResult,
} from './types.js';
import { createSessionId, createEventId, createPinnedNoteId } from './types.js';

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
    meta TEXT NOT NULL DEFAULT '{}',
    pinned INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS pinned_notes (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES agent_sessions(id),
    event_id TEXT REFERENCES session_events(id),
    content TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'decision' CHECK(category IN ('decision', 'blocker', 'breakthrough', 'todo', 'context', 'custom')),
    created_at INTEGER NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id);
  CREATE INDEX IF NOT EXISTS idx_session_events_type ON session_events(type);
  CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status);
  CREATE INDEX IF NOT EXISTS idx_pinned_notes_category ON pinned_notes(category);
  CREATE INDEX IF NOT EXISTS idx_session_events_pinned ON session_events(pinned) WHERE pinned = 1;
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
    // Run forward migrations for existing databases
    this.migrate();
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
    let sql = `SELECT s.*, (
      SELECT MAX(e.timestamp) FROM session_events e WHERE e.session_id = s.id
    ) AS last_activity_at FROM agent_sessions s`;
    const params: unknown[] = [];

    if (options?.status) {
      sql += ' WHERE s.status = ?';
      params.push(options.status);
    }

    sql += ' ORDER BY COALESCE(last_activity_at, s.started_at) DESC LIMIT ? OFFSET ?';
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
    this.rawExec('DELETE FROM pinned_notes WHERE session_id = ?', [id]);
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
      after?: number;
    },
  ): SessionEvent[] {
    let sql = 'SELECT * FROM session_events WHERE session_id = ?';
    const params: unknown[] = [sessionId];

    if (options?.type) {
      sql += ' AND type = ?';
      params.push(options.type);
    }

    if (options?.after) {
      sql += ' AND timestamp > ?';
      params.push(options.after);
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
      case 'message:user' as SessionEventType:    // backward compat (old extension versions)
      case 'message:assistant' as SessionEventType:
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

  /* ── Migration (upgrade existing DBs) ── */

  migrate(): void {
    const raw = this.getRawDb();

    // Add pinned column to session_events if missing
    try {
      raw.exec('ALTER TABLE session_events ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
    } catch {
      // Column already exists
    }

    // Create pinned_notes table if missing
    try {
      raw.exec(`
        CREATE TABLE IF NOT EXISTS pinned_notes (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES agent_sessions(id),
          event_id TEXT REFERENCES session_events(id),
          content TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'custom',
          created_at INTEGER NOT NULL,
          resolved INTEGER NOT NULL DEFAULT 0
        )
      `);
      raw.exec('CREATE INDEX IF NOT EXISTS idx_pinned_notes_category ON pinned_notes(category)');
      raw.exec('CREATE INDEX IF NOT EXISTS idx_session_events_pinned ON session_events(pinned) WHERE pinned = 1');
    } catch {
      // Already exists
    }

    // Fix message:user / message:assistant event types → 'message' + meta.role
    // These were incorrectly stored by older versions of capture-chat-history
    try {
      const badEvents = raw.prepare(
        `SELECT id, type, meta FROM session_events WHERE type IN ('message:user', 'message:assistant')`,
      ).all() as Array<{ id: string; type: string; meta: string }>;

      if (badEvents.length > 0) {
        for (const evt of badEvents) {
          const role = evt.type === 'message:user' ? 'user' : 'assistant';
          let meta: Record<string, unknown> = {};
          try {
            meta = JSON.parse(evt.meta);
          } catch { /* empty */ }
          meta.eventType = 'message';
          meta.role = role;
          raw.prepare(
            `UPDATE session_events SET type = 'message', meta = ? WHERE id = ?`,
          ).run(JSON.stringify(meta), evt.id);
        }
        console.log(`[sessions] Migrated ${badEvents.length} message:user/assistant events → message + role`);
      }
    } catch (err) {
      console.error('[sessions] Migration error fixing message types:', err);
    }

    // Recompute stats for all sessions to fix inaccurate counts
    try {
      this.recomputeAllStats();
    } catch (err) {
      console.error('[sessions] Migration error recomputing stats:', err);
    }
  }

  /**
   * Purge noise events from a session (diagnostics spam, fsmonitor cookies, attachment churn).
   * Returns the number of events deleted.
   */
  purgeNoiseEvents(sessionId: string): number {
    const raw = this.getRawDb();

    // Count before
    const beforeRow = raw.prepare('SELECT COUNT(*) as cnt FROM session_events WHERE session_id = ?').get(sessionId) as { cnt: number };
    const before = beforeRow?.cnt ?? 0;

    // Delete diagnostics state-change events
    raw.prepare(`
      DELETE FROM session_events
      WHERE session_id = ? AND type = 'state-change'
        AND json_extract(meta, '$.state') = 'diagnostics'
    `).run(sessionId);

    // Delete fsmonitor cookie file-delete events
    raw.prepare(`
      DELETE FROM session_events
      WHERE session_id = ? AND type = 'file-delete'
        AND (content LIKE '%.git/fsmonitor%' OR content LIKE '%.git\\fsmonitor%')
    `).run(sessionId);

    // Delete extension attach/reattach spam
    raw.prepare(`
      DELETE FROM session_events
      WHERE session_id = ? AND type = 'state-change'
        AND json_extract(meta, '$.state') = 'attached'
    `).run(sessionId);

    const afterRow = raw.prepare('SELECT COUNT(*) as cnt FROM session_events WHERE session_id = ?').get(sessionId) as { cnt: number };
    const after = afterRow?.cnt ?? 0;

    return before - after;
  }

  /**
   * Recompute stats for all sessions based on actual event data.
   * Fixes any inaccurate counts from bugs or schema changes.
   */
  recomputeAllStats(): void {
    const sessions = this.listSessions({ limit: 9999 });
    for (const session of sessions) {
      const events = this.getEvents(session.id);
      const s = {
        messageCount: 0,
        thinkingBlocks: 0,
        filesCreated: 0,
        filesModified: 0,
        filesRead: 0,
        linesAdded: 0,
        linesRemoved: 0,
        terminalCommands: 0,
        errorsEncountered: 0,
        todosTotal: 0,
        todosCompleted: 0,
        totalDurationMs: 0,
      };

      for (const event of events) {
        const meta = event.meta as unknown as Record<string, unknown>;
        switch (event.type) {
          case 'message':
          case 'message:user' as SessionEventType:
          case 'message:assistant' as SessionEventType:
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
      }

      if (events.length > 0) {
        s.totalDurationMs = events[events.length - 1].timestamp - session.startedAt;
      }

      this.updateSession(session.id, { stats: s });
    }
  }

  /* ── Search ── */

  searchEvents(query: string, options?: {
    sessionId?: string;
    types?: SessionEventType[];
    limit?: number;
  }): SearchResult[] {
    const limit = options?.limit ?? 50;
    const lowerQuery = query.toLowerCase();
    const words = lowerQuery.split(/\s+/).filter(Boolean);

    let sql = `
      SELECT e.*, s.title as session_title
      FROM session_events e
      JOIN agent_sessions s ON e.session_id = s.id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (options?.sessionId) {
      sql += ' AND e.session_id = ?';
      params.push(options.sessionId);
    }
    if (options?.types?.length) {
      sql += ` AND e.type IN (${options.types.map(() => '?').join(',')})`;
      params.push(...options.types);
    }

    // Content + meta match (case-insensitive via LIKE)
    // All words must appear in content or meta
    for (const w of words) {
      sql += ' AND (LOWER(e.content) LIKE ? OR LOWER(e.meta) LIKE ?)';
      params.push(`%${w}%`, `%${w}%`);
    }

    sql += ' ORDER BY e.timestamp DESC LIMIT ?';
    params.push(limit);

    const rows = this.rawAll(sql, params) as Array<Record<string, unknown>>;

    return rows.map((row) => {
      const content = ((row.content as string) || '').toLowerCase();
      const meta = ((row.meta as string) || '').toLowerCase();
      const combined = content + ' ' + meta;

      // Simple relevance: percentage of query words found
      const matchCount = words.filter(
        (w) => combined.includes(w),
      ).length;

      return {
        event: this.rowToEvent(row),
        sessionTitle: row.session_title as string,
        sessionId: row.session_id as string,
        matchScore: words.length > 0 ? matchCount / words.length : 1,
      };
    });
  }

  /* ── Context Summary (for agents) ── */

  getContextSummary(sessionCount = 5): ContextSummary {
    // Get recent sessions
    const recentSessions = this.listSessions({ limit: sessionCount });

    // Get total counts
    const totalRow = this.rawGet(
      'SELECT COUNT(*) as cnt FROM agent_sessions',
      [],
    ) as { cnt: number } | undefined;
    const totalEventsRow = this.rawGet(
      'SELECT COUNT(*) as cnt FROM session_events',
      [],
    ) as { cnt: number } | undefined;

    // Get unresolved pinned notes
    const unresolvedNotes = this.getPinnedNotes({ resolved: false });

    const sessionSummaries = recentSessions.map((session) => {
      const events = this.getEvents(session.id);

      // Extract key decisions from planning events and notes
      const keyDecisions: string[] = [];
      const filesTouched = new Set<string>();
      const errors: string[] = [];

      for (const e of events) {
        const meta = e.meta as unknown as Record<string, unknown>;

        if (e.type === 'planning' && meta.decisions) {
          keyDecisions.push(...(meta.decisions as string[]));
        }
        if (e.type === 'note') {
          keyDecisions.push(e.content);
        }
        if (['file-create', 'file-edit', 'file-delete'].includes(e.type) && meta.filePath) {
          filesTouched.add(meta.filePath as string);
        }
        if (e.type === 'error') {
          errors.push(e.content);
        }
      }

      return {
        id: session.id,
        title: session.title,
        status: session.status,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        stats: session.stats,
        keyDecisions: keyDecisions.slice(0, 10),
        filesTouched: [...filesTouched].slice(0, 30),
        errors: errors.slice(0, 5),
      };
    });

    return {
      recentSessions: sessionSummaries,
      unresolvedNotes,
      totalSessions: totalRow?.cnt ?? 0,
      totalEvents: totalEventsRow?.cnt ?? 0,
    };
  }

  /* ── Pin / Unpin Events ── */

  pinEvent(eventId: string): void {
    this.rawExec(
      'UPDATE session_events SET pinned = 1 WHERE id = ?',
      [eventId],
    );
  }

  unpinEvent(eventId: string): void {
    this.rawExec(
      'UPDATE session_events SET pinned = 0 WHERE id = ?',
      [eventId],
    );
  }

  getPinnedEvents(sessionId?: string): SessionEvent[] {
    let sql = 'SELECT * FROM session_events WHERE pinned = 1';
    const params: unknown[] = [];
    if (sessionId) {
      sql += ' AND session_id = ?';
      params.push(sessionId);
    }
    sql += ' ORDER BY timestamp DESC';
    const rows = this.rawAll(sql, params) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEvent(r));
  }

  /* ── Pinned Notes ── */

  addPinnedNote(data: {
    sessionId: string;
    eventId?: string;
    content: string;
    category?: PinnedNoteCategory;
  }): PinnedNote {
    const note: PinnedNote = {
      id: createPinnedNoteId(),
      sessionId: data.sessionId,
      eventId: data.eventId,
      content: data.content,
      category: data.category ?? 'custom',
      createdAt: Date.now(),
      resolved: false,
    };

    this.rawExec(
      `INSERT INTO pinned_notes (id, session_id, event_id, content, category, created_at, resolved)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [note.id, note.sessionId, note.eventId ?? null, note.content, note.category, note.createdAt, note.resolved ? 1 : 0],
    );

    return note;
  }

  resolvePinnedNote(noteId: string): void {
    this.rawExec(
      'UPDATE pinned_notes SET resolved = 1 WHERE id = ?',
      [noteId],
    );
  }

  deletePinnedNote(noteId: string): void {
    this.rawExec('DELETE FROM pinned_notes WHERE id = ?', [noteId]);
  }

  getPinnedNotes(options?: {
    sessionId?: string;
    category?: PinnedNoteCategory;
    resolved?: boolean;
  }): PinnedNote[] {
    let sql = 'SELECT * FROM pinned_notes WHERE 1=1';
    const params: unknown[] = [];

    if (options?.sessionId) {
      sql += ' AND session_id = ?';
      params.push(options.sessionId);
    }
    if (options?.category) {
      sql += ' AND category = ?';
      params.push(options.category);
    }
    if (options?.resolved !== undefined) {
      sql += ' AND resolved = ?';
      params.push(options.resolved ? 1 : 0);
    }

    sql += ' ORDER BY created_at DESC';
    const rows = this.rawAll(sql, params) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: row.id as string,
      sessionId: row.session_id as string,
      eventId: (row.event_id as string) ?? undefined,
      content: row.content as string,
      category: row.category as PinnedNoteCategory,
      createdAt: row.created_at as number,
      resolved: (row.resolved as number) === 1,
    }));
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
      lastActivityAt: (row.last_activity_at as number) ?? undefined,
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
