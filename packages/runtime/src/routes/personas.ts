import type { FastifyInstance } from 'fastify';
import {
  blindComparisonRequestSchema,
  blindComparisonSessionSchema,
  blindComparisonVoteSchema,
  personaInputSchema,
  personaSchema,
} from '@vai/contracts/adoption';
import type { BlindCompareService, PersonaService } from '../personas/service.js';
import { invalidRequestBody } from '../validation/http-validation.js';
import { assertResponseContract } from '../validation/response-contract.js';
import type { PlatformAuthService } from '../auth/platform-auth.js';
import { requireHostAuthority } from '../auth/route-authority.js';

export function registerPersonaRoutes(app: FastifyInstance, personas: PersonaService, compare: BlindCompareService, auth: PlatformAuthService): void {
  app.get('/api/personas', async (request, reply) => {
    if (!await requireHostAuthority(auth, request, reply)) return;
    return { personas: personas.list().map((persona) => personaSchema.parse(persona)) };
  });
  app.post('/api/personas', async (request, reply) => {
    if (!await requireHostAuthority(auth, request, reply)) return;
    const parsed = personaInputSchema.safeParse(request.body ?? {}); if (!parsed.success) return invalidRequestBody(reply, parsed.error);
    return assertResponseContract(personaSchema, personas.create(parsed.data), 'POST /api/personas');
  });
  app.patch<{ Params: { id: string } }>('/api/personas/:id', async (request, reply) => {
    if (!await requireHostAuthority(auth, request, reply)) return;
    const parsed = personaInputSchema.partial().safeParse(request.body ?? {}); if (!parsed.success) return invalidRequestBody(reply, parsed.error);
    try { return assertResponseContract(personaSchema, personas.update(request.params.id, parsed.data), 'PATCH /api/personas/:id'); }
    catch (error) { return reply.status(404).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
  app.delete<{ Params: { id: string } }>('/api/personas/:id', async (request, reply) => {
    if (!await requireHostAuthority(auth, request, reply)) return;
    personas.remove(request.params.id); return { ok: true };
  });
  app.post('/api/model-compare', async (request, reply) => {
    if (!await requireHostAuthority(auth, request, reply)) return;
    const parsed = blindComparisonRequestSchema.safeParse(request.body ?? {}); if (!parsed.success) return invalidRequestBody(reply, parsed.error);
    try { return assertResponseContract(blindComparisonSessionSchema, await compare.compare(parsed.data.prompt, parsed.data.modelIds, parsed.data.personaIds), 'POST /api/model-compare'); }
    catch (error) { return reply.status(400).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
  app.post<{ Params: { id: string } }>('/api/model-compare/:id/vote', async (request, reply) => {
    if (!await requireHostAuthority(auth, request, reply)) return;
    const parsed = blindComparisonVoteSchema.safeParse(request.body ?? {}); if (!parsed.success) return invalidRequestBody(reply, parsed.error);
    try { return assertResponseContract(blindComparisonSessionSchema, compare.vote(request.params.id, parsed.data.laneId), 'POST /api/model-compare/:id/vote'); }
    catch (error) { return reply.status(404).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
}
