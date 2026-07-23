import type { FastifyInstance, FastifyRequest } from 'fastify';
import { companionContextRespondBodySchema } from '@vai/contracts/companion-context';
import type { PlatformAuthService } from '../auth/platform-auth.js';
import type { CompanionContextBroker } from '../companion-context/broker.js';
import { invalidRequestBody } from '../validation/http-validation.js';

async function identifyCompanion(
  auth: PlatformAuthService,
  request: FastifyRequest,
) {
  const viewer = await auth.getViewer(request);
  const companionClient = viewer.companionClient ?? auth.upsertAnonymousCompanionClient(request);

  return {
    clientId: companionClient?.id ?? null,
    userId: viewer.user?.id ?? null,
  };
}

export function registerCompanionContextRoutes(
  app: FastifyInstance,
  auth: PlatformAuthService,
  broker: CompanionContextBroker,
) {
  app.post('/api/companion-context/poll-consume', async (request, reply) => {
    const companion = await identifyCompanion(auth, request);
    if (!companion.clientId) {
      reply.code(400);
      return { error: 'No companion client identified. Include x-vai-installation-key header.' };
    }

    const workItem = broker.poll({
      clientId: companion.clientId,
      userId: companion.userId,
    });
    if (!workItem) {
      reply.code(204);
      return null;
    }

    return workItem;
  });

  app.post<{
    Params: { requestId: string };
  }>('/api/companion-context/requests/:requestId/respond', async (request, reply) => {
    const parsed = companionContextRespondBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return invalidRequestBody(reply, parsed.error);
    }

    const companion = await identifyCompanion(auth, request);
    if (!companion.clientId) {
      reply.code(400);
      return { error: 'No companion client identified. Include x-vai-installation-key header.' };
    }

    try {
      broker.respond(request.params.requestId, companion.clientId, parsed.data);
      return { ok: true };
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : 'Unable to submit companion context' };
    }
  });
}
