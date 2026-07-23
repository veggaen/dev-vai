import type { FastifyInstance } from 'fastify';
import {
  createPairingTokenRequestSchema,
  environmentInputSchema,
  environmentSchema,
  pairedSessionSchema,
  pairingExchangeRequestSchema,
} from '@vai/contracts/adoption';
import type { EnvironmentService } from '../environments/service.js';
import { invalidRequestBody } from '../validation/http-validation.js';
import { assertResponseContract } from '../validation/response-contract.js';
import type { PlatformAuthService } from '../auth/platform-auth.js';
import { requireHostAuthority } from '../auth/route-authority.js';

export function registerEnvironmentRoutes(app: FastifyInstance, environments: EnvironmentService, auth: PlatformAuthService): void {
  app.get('/api/environments', async (request, reply) => {
    if (!await requireHostAuthority(auth, request, reply)) return;
    return { environments: environments.listEnvironments().map((item) => environmentSchema.parse(item)) };
  });
  app.post('/api/environments', async (request, reply) => {
    if (!await requireHostAuthority(auth, request, reply)) return;
    const parsed = environmentInputSchema.safeParse(request.body ?? {}); if (!parsed.success) return invalidRequestBody(reply, parsed.error);
    return assertResponseContract(environmentSchema, environments.saveEnvironment(parsed.data), 'POST /api/environments');
  });
  app.delete<{ Params: { id: string } }>('/api/environments/:id', async (request, reply) => {
    if (!await requireHostAuthority(auth, request, reply)) return;
    environments.removeEnvironment(request.params.id); return { ok: true };
  });

  app.post('/api/pairing/tokens', async (request, reply) => {
    if (!await requireHostAuthority(auth, request, reply)) return;
    const parsed = createPairingTokenRequestSchema.safeParse(request.body ?? {}); if (!parsed.success) return invalidRequestBody(reply, parsed.error);
    try { return environments.createPairingToken(parsed.data.environmentId, parsed.data.integrationId, parsed.data.scopes); }
    catch (error) { return reply.status(404).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
  app.post('/api/pairing/exchange', async (request, reply) => {
    const parsed = pairingExchangeRequestSchema.safeParse(request.body ?? {}); if (!parsed.success) return invalidRequestBody(reply, parsed.error);
    try { return environments.exchange(parsed.data.token, parsed.data.deviceLabel); }
    catch (error) { return reply.status(401).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
  app.get('/api/pairing/sessions', async (request, reply) => {
    if (!await requireHostAuthority(auth, request, reply)) return;
    return { sessions: environments.listSessions() };
  });
  app.delete<{ Params: { id: string } }>('/api/pairing/sessions/:id', async (request, reply) => {
    if (!await requireHostAuthority(auth, request, reply)) return;
    try { return assertResponseContract(pairedSessionSchema, environments.revokeSession(request.params.id), 'DELETE /api/pairing/sessions/:id'); }
    catch (error) { return reply.status(404).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
}
