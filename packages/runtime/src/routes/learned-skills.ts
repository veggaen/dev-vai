import type { FastifyInstance } from 'fastify';
import { skillObservationSchema, skillRecordInputSchema, skillRecordSchema } from '@vai/contracts/adoption';
import type { SkillConfidenceService } from '../skills/confidence-service.js';
import { invalidRequestBody } from '../validation/http-validation.js';
import { assertResponseContract } from '../validation/response-contract.js';
import type { PlatformAuthService } from '../auth/platform-auth.js';
import { requireHostAuthority } from '../auth/route-authority.js';

export function registerLearnedSkillRoutes(app: FastifyInstance, skills: SkillConfidenceService, auth: PlatformAuthService): void {
  app.get('/api/learned-skills', async (request, reply) => {
    if (!await requireHostAuthority(auth, request, reply)) return;
    return { skills: skills.list().map((skill) => skillRecordSchema.parse(skill)) };
  });
  app.post('/api/learned-skills', async (request, reply) => {
    if (!await requireHostAuthority(auth, request, reply)) return;
    const parsed = skillRecordInputSchema.safeParse(request.body ?? {}); if (!parsed.success) return invalidRequestBody(reply, parsed.error);
    return assertResponseContract(skillRecordSchema, skills.create(parsed.data), 'POST /api/learned-skills');
  });
  app.patch<{ Params: { id: string } }>('/api/learned-skills/:id', async (request, reply) => {
    if (!await requireHostAuthority(auth, request, reply)) return;
    const parsed = skillRecordInputSchema.pick({ name: true, content: true, capabilityCeiling: true }).partial().safeParse(request.body ?? {});
    if (!parsed.success) return invalidRequestBody(reply, parsed.error);
    try { return assertResponseContract(skillRecordSchema, skills.update(request.params.id, parsed.data), 'PATCH /api/learned-skills/:id'); }
    catch (error) { return reply.status(404).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
  app.post<{ Params: { id: string } }>('/api/learned-skills/:id/observe', async (request, reply) => {
    if (!await requireHostAuthority(auth, request, reply)) return;
    const parsed = skillObservationSchema.safeParse(request.body ?? {}); if (!parsed.success) return invalidRequestBody(reply, parsed.error);
    try { return assertResponseContract(skillRecordSchema, skills.observe(request.params.id, parsed.data.success), 'POST /api/learned-skills/:id/observe'); }
    catch (error) { return reply.status(404).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
  app.delete<{ Params: { id: string } }>('/api/learned-skills/:id', async (request, reply) => {
    if (!await requireHostAuthority(auth, request, reply)) return;
    skills.remove(request.params.id); return { ok: true };
  });
}
