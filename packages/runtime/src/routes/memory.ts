import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PlatformAuthService } from '../auth/platform-auth.js';
import { MemoryService, type MemoryKind } from '../memory/service.js';

/**
 * Vai Memory API — the governed, typed replacement for the word-overlap graph.
 * Slice 1: list / extract / add / archive / delete, all scoped to the viewer.
 * Extraction is explicit here (not yet auto-run) so quality can be observed first.
 */

interface ChatServiceLike {
  getMessages(conversationId: string): Array<{ role?: string; content?: string }>;
}

const KINDS = new Set<MemoryKind>(['decision', 'project', 'preference', 'fact']);

export interface MemoryRouteDeps {
  readonly memory: MemoryService;
  readonly chatService: ChatServiceLike;
  readonly auth: PlatformAuthService;
}

async function resolveUserId(auth: PlatformAuthService, request: FastifyRequest): Promise<string | null> {
  const viewer = await auth.getViewer(request);
  const authEnabled = typeof auth.isEnabled === 'function' ? auth.isEnabled() : true;
  if (authEnabled && !viewer.authenticated) return null;
  return viewer.user?.id ?? 'local';
}

export function registerMemoryRoutes(app: FastifyInstance, deps: MemoryRouteDeps): void {
  const { memory, chatService, auth } = deps;

  app.get('/api/memory', async (request, reply) => {
    const userId = await resolveUserId(auth, request);
    if (!userId) return reply.send({ memories: [] });
    return reply.send({ memories: memory.list(userId) });
  });

  app.post<{ Params: { conversationId: string } }>('/api/memory/extract/:conversationId', async (request, reply) => {
    const userId = await resolveUserId(auth, request);
    if (!userId) return reply.status(401).send({ error: 'Sign in to build memory.' });
    const { conversationId } = request.params;
    let transcript: string;
    try {
      const msgs = chatService.getMessages(conversationId);
      transcript = msgs.map((m) => `${m.role ?? 'user'}: ${m.content ?? ''}`).join('\n');
    } catch {
      return reply.status(404).send({ error: 'Conversation not found.' });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const added = await memory.extractFromText(userId, conversationId, transcript, controller.signal);
      return reply.send({ added, count: added.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      app.log.warn({ err: message }, 'memory extraction failed');
      return reply.status(502).send({ error: `Extraction failed: ${message}` });
    } finally {
      clearTimeout(timer);
    }
  });

  app.post<{ Body: { kind?: string; content?: string; sourceExcerpt?: string; conversationId?: string } }>('/api/memory', async (request, reply) => {
    const userId = await resolveUserId(auth, request);
    if (!userId) return reply.status(401).send({ error: 'Sign in to add memory.' });
    const kind = request.body?.kind as MemoryKind;
    const content = (request.body?.content ?? '').trim();
    if (!KINDS.has(kind)) return reply.status(400).send({ error: 'Invalid memory kind.' });
    if (!content) return reply.status(400).send({ error: 'Memory content is required.' });
    const row = memory.add(userId, kind, content, request.body?.sourceExcerpt, request.body?.conversationId);
    return reply.send({ memory: row });
  });

  app.patch<{ Params: { id: string }; Body: { status?: string } }>('/api/memory/:id', async (request, reply) => {
    const userId = await resolveUserId(auth, request);
    if (!userId) return reply.status(401).send({ error: 'Sign in required.' });
    const status = request.body?.status;
    if (status !== 'active' && status !== 'archived') return reply.status(400).send({ error: 'Invalid status.' });
    memory.setStatus(userId, request.params.id, status);
    return reply.send({ ok: true });
  });

  app.delete<{ Params: { id: string } }>('/api/memory/:id', async (request, reply) => {
    const userId = await resolveUserId(auth, request);
    if (!userId) return reply.status(401).send({ error: 'Sign in required.' });
    memory.remove(userId, request.params.id);
    return reply.send({ ok: true });
  });
}
