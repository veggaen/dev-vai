/**
 * Session API routes — CRUD for agent dev logs.
 *
 * GET    /api/sessions              — list all sessions
 * GET    /api/sessions/:id          — get session + events
 * POST   /api/sessions              — create a new session
 * PATCH  /api/sessions/:id          — update session metadata
 * DELETE /api/sessions/:id          — delete session + events
 * POST   /api/sessions/:id/events   — append events to session
 * GET    /api/sessions/:id/events   — get events (with optional type filter)
 * POST   /api/sessions/:id/end      — finalize / close a session
 * POST   /api/sessions/import       — import a full session (JSON)
 * GET    /api/sessions/:id/export   — export session as JSON
 * GET    /api/sessions/:id/intelligence — recompute score + lessons + analysis
 * GET    /api/sessions/context      — context summary for agents
 * GET    /api/sessions/search       — cross-session event search
 * POST   /api/sessions/:id/events/:eventId/pin  — pin/unpin event
 * GET    /api/sessions/:id/pinned   — get pinned events
 * POST   /api/sessions/:id/notes    — add pinned note
 * GET    /api/sessions/:id/notes    — get pinned notes
 * DELETE /api/sessions/notes/:noteId — delete pinned note
 * POST   /api/sessions/notes/:noteId/resolve — resolve note
 */

import type { FastifyInstance } from 'fastify';
import { SessionService, ConversationScorer, LearningExtractor, extractLessons, extractTurnPairs, getSessionAnalyzer, type SessionEventType, type PinnedNoteCategory } from '@vai/core';

export function registerSessionRoutes(app: FastifyInstance, sessions: SessionService) {
  /* ── List sessions ── */
  app.get<{
    Querystring: { status?: string; limit?: string; offset?: string };
  }>('/api/sessions', async (request) => {
    const { status, limit, offset } = request.query;
    const sessionList = sessions.listSessions({
      status,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return { sessions: sessionList, total: sessionList.length };
  });

  /* ── Create session ── */
  app.post<{
    Body: {
      title: string;
      description?: string;
      agentName: string;
      modelId: string;
      tags?: string[];
    };
  }>('/api/sessions', async (request) => {
    return sessions.createSession(request.body);
  });

  /* ── Context summary (for agents bootstrapping context) ── */
  app.get<{
    Querystring: { limit?: string };
  }>('/api/sessions/context', async (request) => {
    const limit = request.query.limit ? Number(request.query.limit) : 5;
    return sessions.getContextSummary(limit);
  });

  /* ── Cross-session search ── */
  app.get<{
    Querystring: {
      q: string;
      sessionId?: string;
      types?: string;
      limit?: string;
    };
  }>('/api/sessions/search', async (request) => {
    const { q, sessionId, types, limit } = request.query;
    if (!q) return { results: [], total: 0 };

    const typeList = types
      ? (types.split(',') as SessionEventType[])
      : undefined;

    const results = sessions.searchEvents(q, {
      sessionId,
      types: typeList,
      limit: limit ? Number(limit) : undefined,
    });

    return { results, total: results.length };
  });

  /* ── Import session from JSON ── */
  app.post<{
    Body: {
      session: Record<string, unknown>;
      events: Array<Record<string, unknown>>;
    };
  }>('/api/sessions/import', async (request) => {
    const id = sessions.importSession(request.body as never);
    return { id, success: true };
  });

  /* ── List all session scores ── */
  app.get<{
    Querystring: { grade?: string; limit?: string; offset?: string };
  }>('/api/sessions/scores', async (request) => {
    const { grade, limit, offset } = request.query;
    const scores = sessions.listScores({
      grade,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return { scores, total: scores.length };
  });

  /* ── List all lessons across sessions ── */
  app.get<{
    Querystring: { category?: string; minConfidence?: string; limit?: string };
  }>('/api/sessions/lessons', async (request) => {
    const { category, minConfidence, limit } = request.query;
    const lessons = sessions.listAllLessons({
      category,
      minConfidence: minConfidence ? Number(minConfidence) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return { lessons, total: lessons.length };
  });

  /* ── Resolve pinned note (static path before :id) ── */
  app.post<{
    Params: { noteId: string };
  }>('/api/sessions/notes/:noteId/resolve', async (request) => {
    sessions.resolvePinnedNote(request.params.noteId);
    return { success: true };
  });

  /* ── Delete pinned note ── */
  app.delete<{
    Params: { noteId: string };
  }>('/api/sessions/notes/:noteId', async (request) => {
    sessions.deletePinnedNote(request.params.noteId);
    return { success: true };
  });

  /* ════════════════════════════════════════════════════════════ */
  /* ── Parametric :id routes below ─────────────────────────── */
  /* ════════════════════════════════════════════════════════════ */

  /* ── Get single session with events ── */
  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id',
    async (request) => {
      const session = sessions.getSession(request.params.id);
      if (!session) return { error: 'Session not found' };
      const eventCount = sessions.getEventCount(request.params.id);
      return { session, eventCount };
    },
  );

  /* ── Update session ── */
  app.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      description?: string;
      tags?: string[];
    };
  }>('/api/sessions/:id', async (request) => {
    sessions.updateSession(request.params.id, request.body);
    return sessions.getSession(request.params.id);
  });

  /* ── Delete session ── */
  app.delete<{ Params: { id: string } }>(
    '/api/sessions/:id',
    async (request) => {
      sessions.deleteSession(request.params.id);
      return { success: true };
    },
  );

  /* ── Purge noise events + recompute stats ── */
  app.post<{ Params: { id: string } }>(
    '/api/sessions/:id/purge-noise',
    async (request) => {
      const { id } = request.params;
      const session = sessions.getSession(id);
      if (!session) return { error: 'Session not found' };

      const deleted = sessions.purgeNoiseEvents(id);
      sessions.recomputeAllStats();
      const updated = sessions.getSession(id);

      return {
        success: true,
        eventsDeleted: deleted,
        newStats: updated?.stats,
      };
    },
  );

  /* ── Purge duplicate events + recompute stats ── */
  app.post<{ Params: { id: string } }>(
    '/api/sessions/:id/purge-duplicates',
    async (request) => {
      const { id } = request.params;
      const session = sessions.getSession(id);
      if (!session) return { error: 'Session not found' };

      const deleted = sessions.purgeDuplicates(id);
      sessions.recomputeAllStats();
      const updated = sessions.getSession(id);

      return {
        success: true,
        eventsDeleted: deleted,
        newStats: updated?.stats,
      };
    },
  );

  /* ── Append events ── */
  app.post<{
    Params: { id: string };
    Body: {
      events: Array<{
        type: SessionEventType;
        timestamp?: number;
        durationMs?: number;
        content: string;
        meta: Record<string, unknown>;
      }>;
    };
  }>('/api/sessions/:id/events', async (request) => {
    const { id } = request.params;
    const session = sessions.getSession(id);
    if (!session) return { error: 'Session not found' };

    const added = sessions.addEvents(
      request.body.events.map((e) => ({
        sessionId: id,
        type: e.type,
        timestamp: e.timestamp ?? Date.now(),
        durationMs: e.durationMs,
        content: e.content,
        meta: e.meta as never,
      })),
    );

    return { added: added.length };
  });

  /* ── Get events (filterable) ── */
  app.get<{
    Params: { id: string };
    Querystring: { type?: SessionEventType; limit?: string; offset?: string; after?: string; before?: string; order?: 'asc' | 'desc' };
  }>('/api/sessions/:id/events', async (request) => {
    return sessions.getEvents(request.params.id, {
      type: request.query.type,
      limit: request.query.limit ? Number(request.query.limit) : undefined,
      offset: request.query.offset ? Number(request.query.offset) : undefined,
      after: request.query.after ? Number(request.query.after) : undefined,
      before: request.query.before ? Number(request.query.before) : undefined,
      order: request.query.order,
    });
  });

  /* ── Pin / Unpin event ── */
  app.post<{
    Params: { id: string; eventId: string };
    Body: { pinned?: boolean };
  }>('/api/sessions/:id/events/:eventId/pin', async (request) => {
    const { eventId } = request.params;
    const pinned = request.body.pinned !== false;
    if (pinned) {
      sessions.pinEvent(eventId);
    } else {
      sessions.unpinEvent(eventId);
    }
    return { eventId, pinned };
  });

  /* ── End / close session ── */
  app.post<{
    Params: { id: string };
    Body: { status?: 'completed' | 'failed' };
  }>('/api/sessions/:id/end', async (request) => {
    sessions.endSession(request.params.id, request.body.status ?? 'completed');
    return sessions.getSession(request.params.id);
  });

  /* ── Get session score ── */
  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/score',
    async (request, reply) => {
      const session = sessions.getSession(request.params.id);
      if (!session) return reply.status(404).send({ error: 'Session not found' });
      const score = sessions.getScore(request.params.id);
      return { score };
    },
  );

  /* ── Get full session intelligence ── */
  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/intelligence',
    async (request, reply) => {
      const session = sessions.getSession(request.params.id);
      if (!session) return reply.status(404).send({ error: 'Session not found' });

      const events = sessions.getEvents(request.params.id, {});
      const analyzer = getSessionAnalyzer();
      const analysis = analyzer.analyze(session, events);

      if (events.length === 0) {
        return { score: null, report: null, analysis };
      }

      const scorer = new ConversationScorer();
      const score = scorer.score(events, session.stats);
      sessions.saveScore(request.params.id, score);

      const turnPairs = extractTurnPairs(events);
      const report = extractLessons(turnPairs, score, events);
      sessions.deleteLessonsForSession(request.params.id);
      sessions.saveLessons(report.lessons);

      return { score, report, analysis };
    },
  );

  /* ── Score a session (trigger scoring + persist) ── */
  app.post<{ Params: { id: string } }>(
    '/api/sessions/:id/score',
    async (request, reply) => {
      const session = sessions.getSession(request.params.id);
      if (!session) return reply.status(404).send({ error: 'Session not found' });

      const events = sessions.getEvents(request.params.id);
      if (events.length === 0) return reply.status(400).send({ error: 'Session has no events' });

      const scorer = new ConversationScorer();
      const score = scorer.score(events, session.stats);
      sessions.saveScore(request.params.id, score);

      return { score };
    },
  );

  /* ── Extract lessons from a scored session ── */
  app.post<{ Params: { id: string } }>(
    '/api/sessions/:id/lessons',
    async (request, reply) => {
      const session = sessions.getSession(request.params.id);
      if (!session) return reply.status(404).send({ error: 'Session not found' });

      // Score first if not already scored
      let score = sessions.getScore(request.params.id);
      if (!score) {
        const events = sessions.getEvents(request.params.id);
        if (events.length === 0) return reply.status(400).send({ error: 'Session has no events' });
        const scorer = new ConversationScorer();
        score = scorer.score(events, session.stats);
        sessions.saveScore(request.params.id, score);
      }

      const events = sessions.getEvents(request.params.id);
      const turnPairs = extractTurnPairs(events);
      const report = extractLessons(turnPairs, score, events);

      // Persist lessons (replace old ones for this session)
      sessions.deleteLessonsForSession(request.params.id);
      sessions.saveLessons(report.lessons);

      return { report };
    },
  );

  /* ── Get lessons for a session ── */
  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/lessons',
    async (request, reply) => {
      const session = sessions.getSession(request.params.id);
      if (!session) return reply.status(404).send({ error: 'Session not found' });
      const lessons = sessions.getLessons(request.params.id);
      return { lessons, total: lessons.length };
    },
  );

  /* ── Export session as JSON ── */
  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/export',
    async (request) => {
      const data = sessions.exportSession(request.params.id);
      if (!data) return { error: 'Session not found' };
      return data;
    },
  );

  /* ── Get pinned events for session ── */
  app.get<{
    Params: { id: string };
  }>('/api/sessions/:id/pinned', async (request) => {
    const events = sessions.getPinnedEvents(request.params.id);
    return { events, total: events.length };
  });

  /* ── Add pinned note to session ── */
  app.post<{
    Params: { id: string };
    Body: {
      content: string;
      category?: PinnedNoteCategory;
      eventId?: string;
    };
  }>('/api/sessions/:id/notes', async (request) => {
    return sessions.addPinnedNote({
      sessionId: request.params.id,
      eventId: request.body.eventId,
      content: request.body.content,
      category: request.body.category,
    });
  });

  /* ── Get pinned notes for session ── */
  app.get<{
    Params: { id: string };
    Querystring: {
      category?: PinnedNoteCategory;
      resolved?: string;
    };
  }>('/api/sessions/:id/notes', async (request) => {
    const notes = sessions.getPinnedNotes({
      sessionId: request.params.id,
      category: request.query.category,
      resolved: request.query.resolved === undefined
        ? undefined
        : request.query.resolved === 'true',
    });
    return { notes, total: notes.length };
  });

  /* ── Analyze session — extract intent, outcome, failure patterns ── */
  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/analyze',
    async (request, reply) => {
      const session = sessions.getSession(request.params.id);
      if (!session) return reply.status(404).send({ error: 'Session not found' });
      const events = sessions.getEvents(request.params.id, {});
      const analyzer = getSessionAnalyzer();
      return analyzer.analyze(session, events);
    },
  );

  /* ── Aggregate insights across recent sessions ── */
  app.get<{
    Querystring: { limit?: string };
  }>('/api/sessions/insights', async (request) => {
    const limit = request.query.limit ? Number(request.query.limit) : 20;
    const recentSessions = sessions.listSessions({ limit, status: undefined });
    const analyzer = getSessionAnalyzer();
    const analyses = recentSessions.map(s => {
      const evts = sessions.getEvents(s.id, {});
      return analyzer.analyze(s, evts);
    });
    return analyzer.aggregateInsights(analyses);
  });
}
