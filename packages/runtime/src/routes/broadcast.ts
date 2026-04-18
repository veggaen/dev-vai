import type { FastifyInstance } from 'fastify';
import { PlatformAuthService, type PlatformViewer } from '../auth/platform-auth.js';
import { ProjectService } from '../projects/service.js';
import {
  broadcastRespondBodySchema,
  companionChatInfoBodySchema,
  companionModelsBodySchema,
  createBroadcastBodySchema,
} from '@vai/api-types/broadcast';
import { invalidRequestBody } from '../validation/http-validation.js';
import { isLocalDevMutationAllowed } from '../security/request-trust.js';

type AuthenticatedViewer = PlatformViewer & {
  authenticated: true;
  user: NonNullable<PlatformViewer['user']>;
};

async function _requireViewer(
  auth: PlatformAuthService,
  request: any,
  reply: any,
): Promise<AuthenticatedViewer | null> {
  const viewer = await auth.getViewer(request);
  if (!viewer.authenticated || !viewer.user) {
    reply.code(401);
    return null;
  }
  return viewer as AuthenticatedViewer;
}

export function registerBroadcastRoutes(
  app: FastifyInstance,
  auth: PlatformAuthService,
  projects: ProjectService,
) {
  // ── Create a broadcast message ─────────────────────────────
  // Desktop/web sends a message to all or selected IDE clients
  app.post<{
    Body: {
      content: string;
      projectId?: string;
      targetClientIds?: string[];
      ttlMs?: number;
      meta?: { preferredModel?: string; targetChatApp?: string; targetSessionId?: string };
    };
  }>('/api/broadcasts', async (request, reply) => {
    const parsed = createBroadcastBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return invalidRequestBody(reply, parsed.error);
    }

    const platformViewer = await auth.getViewer(request);
    let userId: string;
    if (platformViewer.authenticated && platformViewer.user) {
      userId = platformViewer.user.id;
    } else {
      // Local-dev fallback: allow anonymous broadcast creation using the local system user
      userId = auth.ensureLocalSystemUser();
    }

    const { content, projectId, targetClientIds, ttlMs, meta } = parsed.data;

    // Verify project access if projectId provided
    if (projectId && !projects.canReadProject(projectId, userId)) {
      reply.code(403);
      return { error: 'You do not have access to this project' };
    }

    const broadcast = projects.createBroadcast(userId, content, {
      projectId,
      targetClientIds,
      ttlMs,
      meta,
    });

    return broadcast;
  });

  // ── Poll for pending broadcast work (IDE extensions call this) ──
  // Similar to /api/projects/audits/poll-consume
  app.post('/api/broadcasts/poll-consume', async (request, reply) => {
    const installKey = request.headers['x-vai-installation-key'];
    app.log.info({ installKey, headers: Object.keys(request.headers) }, '[poll-consume] incoming request');

    const viewer = await auth.getViewer(request);
    let clientId = viewer.companionClient?.id;
    app.log.info({ viewerAuth: viewer.authenticated, viewerClientId: clientId }, '[poll-consume] viewer result');

    // Anonymous fallback: try installation-key-based companion client
    if (!clientId) {
      const anonClient = auth.upsertAnonymousCompanionClient(request);
      clientId = anonClient?.id;
      app.log.info({ anonClientId: clientId }, '[poll-consume] anon fallback result');
    }
    if (!clientId) {
      reply.code(400);
      return { error: 'No companion client identified. Include x-vai-installation-key header.' };
    }

    // Purge expired broadcasts while we're here
    projects.purgeExpiredBroadcasts();

    // Update lastPolledAt for this companion client
    projects.touchCompanionClientPoll(clientId);

    const workItem = projects.pollBroadcastWork(clientId);
    app.log.info({ clientId, hasWorkItem: !!workItem, workItemId: workItem?.deliveryId }, '[poll-consume] poll result');
    if (!workItem) {
      reply.code(204);
      return null;
    }

    return workItem;
  });

  // ── Submit a broadcast response (IDE extensions call this) ──
  app.post<{
    Params: { deliveryId: string };
    Body: {
      responseContent: string;
      meta?: { model?: string; tokensIn?: number; tokensOut?: number; durationMs?: number };
    };
  }>('/api/broadcasts/deliveries/:deliveryId/respond', async (request, reply) => {
    const parsed = broadcastRespondBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return invalidRequestBody(reply, parsed.error);
    }

    const viewer = await auth.getViewer(request);
    let clientId = viewer.companionClient?.id;

    // Anonymous fallback: try installation-key-based companion client
    if (!clientId) {
      const anonClient = auth.upsertAnonymousCompanionClient(request);
      clientId = anonClient?.id;
    }
    if (!clientId) {
      reply.code(400);
      return { error: 'No companion client identified' };
    }

    const { responseContent, meta } = parsed.data;

    try {
      return projects.submitBroadcastResponse(
        request.params.deliveryId,
        clientId,
        responseContent,
        meta,
      );
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : 'Unable to submit response' };
    }
  });

  // ── Get broadcast with all responses (desktop fetches this) ──
  app.get<{ Params: { id: string } }>('/api/broadcasts/:id', async (request, reply) => {
    const platformViewer = await auth.getViewer(request);
    const userId = platformViewer.authenticated && platformViewer.user
      ? platformViewer.user.id
      : auth.ensureLocalSystemUser();

    const broadcast = projects.getBroadcastWithResponses(request.params.id);
    if (!broadcast) {
      reply.code(404);
      return { error: 'Broadcast not found' };
    }

    if (broadcast.senderUserId !== userId) {
      reply.code(403);
      return { error: 'You can only view your own broadcasts' };
    }

    return broadcast;
  });

  // ── List recent broadcasts (desktop fetches this) ──
  app.get<{ Querystring: { projectId?: string; limit?: string } }>('/api/broadcasts', async (request, _reply) => {
    const platformViewer = await auth.getViewer(request);
    const userId = platformViewer.authenticated && platformViewer.user
      ? platformViewer.user.id
      : auth.ensureLocalSystemUser();

    const limit = request.query.limit ? Number.parseInt(request.query.limit, 10) : undefined;

    return projects.listBroadcasts(userId, {
      projectId: request.query.projectId,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
  });

  // ── List all companion clients for the authenticated user ──
  // Desktop uses this to show IDE online/offline status in settings
  // Falls back to listing all clients when not authenticated (local dev)
  app.get('/api/companion-clients', async (request, _reply) => {
    const viewer = await auth.getViewer(request);
    if (viewer.authenticated && viewer.user) {
      return projects.listUserCompanionClients(viewer.user.id);
    }
    // Anonymous fallback: list all known companion clients (safe for local dev)
    return projects.listAllCompanionClients();
  });

  // ── Update available models for a companion client ──
  // Extension calls this to report which LLM models it can use
  // Allows anonymous registration via installation key when not signed in
  app.patch<{
    Body: { models: Array<{ id: string; family: string; name: string; vendor: string }> };
  }>('/api/companion-clients/models', async (request, reply) => {
    const parsed = companionModelsBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return invalidRequestBody(reply, parsed.error);
    }

    const viewer = await auth.getViewer(request);
    let clientId = viewer.companionClient?.id;

    // If not authenticated, try anonymous companion client registration
    if (!clientId) {
      const anonClient = auth.upsertAnonymousCompanionClient(request);
      clientId = anonClient?.id;
    }

    if (!clientId) {
      reply.code(400);
      return { error: 'No companion client identified. Include x-vai-installation-key header.' };
    }

    const { models } = parsed.data;

    projects.updateCompanionClientModels(clientId, models);
    return { ok: true, count: models.length };
  });

  // ── Update available chat info for a companion client ──
  // Extension calls this to report which chat apps and sessions are available
  // Allows anonymous registration via installation key when not signed in
  app.patch<{
    Body: { chatApps: Array<{ id: string; label: string }>; sessions: Array<{ sessionId: string; title: string; lastModified: number; chatApp: string }> };
  }>('/api/companion-clients/chat-info', async (request, reply) => {
    const parsed = companionChatInfoBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return invalidRequestBody(reply, parsed.error);
    }

    const viewer = await auth.getViewer(request);
    let clientId = viewer.companionClient?.id;

    // If not authenticated, try anonymous companion client registration
    if (!clientId) {
      const anonClient = auth.upsertAnonymousCompanionClient(request);
      clientId = anonClient?.id;
    }

    if (!clientId) {
      reply.code(400);
      return { error: 'No companion client identified. Include x-vai-installation-key header.' };
    }

    const { chatApps, sessions } = parsed.data;

    projects.updateCompanionClientChatInfo(clientId, { chatApps, sessions });
    return { ok: true, chatApps: chatApps.length, sessions: sessions.length };
  });

  // ── Delete companion client by ID (local dev only) ──
  app.delete<{ Params: { id: string } }>('/api/companion-clients/:id', async (request, reply) => {
    if (!isLocalDevMutationAllowed(request)) {
      reply.code(403);
      return { error: 'Companion client deletion is only allowed from a local dev runtime.' };
    }
    projects.deleteCompanionClient(request.params.id);
    return { ok: true };
  });

  // ── Cleanup test companion clients by installationKey prefix ──
  app.delete<{ Querystring: { prefix: string } }>('/api/companion-clients', async (request, reply) => {
    if (!isLocalDevMutationAllowed(request)) {
      reply.code(403);
      return { error: 'Companion client cleanup is only allowed from a local dev runtime.' };
    }
    const prefix = request.query.prefix;
    if (!prefix || prefix.length < 5) {
      reply.code(400);
      return { error: 'prefix must be at least 5 characters' };
    }
    const deleted = projects.deleteCompanionClientsByKeyPrefix(prefix);
    return { ok: true, deleted };
  });
}
