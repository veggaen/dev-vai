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
 */

import type { FastifyInstance } from 'fastify';
import { SessionService, type SessionEventType } from '@vai/core';

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

  /* ── Get single session with events ── */
  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id',
    async (request) => {
      const session = sessions.getSession(request.params.id);
      if (!session) return { error: 'Session not found' };
      const events = sessions.getEvents(request.params.id);
      return { session, events, eventCount: events.length };
    },
  );

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
    Querystring: { type?: SessionEventType; limit?: string; offset?: string };
  }>('/api/sessions/:id/events', async (request) => {
    return sessions.getEvents(request.params.id, {
      type: request.query.type,
      limit: request.query.limit ? Number(request.query.limit) : undefined,
      offset: request.query.offset ? Number(request.query.offset) : undefined,
    });
  });

  /* ── End / close session ── */
  app.post<{
    Params: { id: string };
    Body: { status?: 'completed' | 'failed' };
  }>('/api/sessions/:id/end', async (request) => {
    sessions.endSession(request.params.id, request.body.status ?? 'completed');
    return sessions.getSession(request.params.id);
  });

  /* ── Export session as JSON ── */
  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/export',
    async (request) => {
      const data = sessions.exportSession(request.params.id);
      if (!data) return { error: 'Session not found' };
      return data;
    },
  );

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
}
