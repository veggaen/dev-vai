import type { FastifyInstance } from 'fastify';
import {
  agentLaunchRequestSchema,
  agentSessionEventsResponseSchema,
  agentSessionSnapshotSchema,
  capabilityGrantInputSchema,
  capabilityGrantSchema,
} from '@vai/contracts/adoption';
import type { AgentProcessManager } from '../agents/process-manager.js';
import type { AgentProviderRegistry } from '../agents/provider-adapter.js';
import type { WorktreeManager } from '../agents/worktree-manager.js';
import { invalidRequestBody } from '../validation/http-validation.js';
import { assertResponseContract } from '../validation/response-contract.js';
import { capabilityDenialMessage, decideToolCapabilities } from '@vai/core';
import type { CapabilityGrantService } from '../security/capability-grants.js';
import type { PersonaService } from '../personas/service.js';
import type { PlatformAuthService } from '../auth/platform-auth.js';
import { requireHostAuthority } from '../auth/route-authority.js';

export function registerAgentSessionRoutes(
  app: FastifyInstance,
  manager: AgentProcessManager,
  providers: AgentProviderRegistry,
  worktrees: WorktreeManager,
  capabilities: CapabilityGrantService,
  personas: PersonaService,
  auth: PlatformAuthService,
): void {
  app.get('/api/agent-sessions/providers', async () => ({
    providers: providers.list().map((adapter) => ({ id: adapter.id, displayName: adapter.displayName })),
  }));

  app.get<{ Querystring: { workspaceId?: string } }>('/api/capabilities', async (request, reply) => {
    if (!await requireHostAuthority(auth, request, reply)) return;
    return { grants: capabilities.list(request.query.workspaceId).map((grant) => capabilityGrantSchema.parse(grant)) };
  });
  app.put('/api/capabilities', async (request, reply) => {
    const viewer = await requireHostAuthority(auth, request, reply);
    if (!viewer) return;
    const parsed = capabilityGrantInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalidRequestBody(reply, parsed.error);
    return capabilityGrantSchema.parse(capabilities.grant(parsed.data, viewer.user?.id ?? 'local-os-user'));
  });

  app.post('/api/agent-sessions', async (request, reply) => {
    const viewer = await requireHostAuthority(auth, request, reply);
    if (!viewer) return;
    const parsed = agentLaunchRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return invalidRequestBody(reply, parsed.error);
    try {
      const adapter = providers.get(parsed.data.providerId);
      const hostGrant = capabilities.resolve(parsed.data.workspaceRoot, parsed.data.sessionId);
      const capabilityDecision = decideToolCapabilities({
        required: adapter.requiredCapabilities,
        workspaceScope: hostGrant.workspaceScope,
        sessionScope: hostGrant.sessionScope,
      });
      if (!capabilityDecision.allowed) {
        return reply.status(403).send({
          error: capabilityDenialMessage(`agent:${adapter.id}`, capabilityDecision),
          code: 'capability_denied', denied: capabilityDecision.denied,
        });
      }
      const receipt = await worktrees.create(parsed.data.workspaceRoot, parsed.data.sessionId);
      const personaProfiles = parsed.data.personaIds.map((id) => personas.get(id)).filter((persona) => Boolean(persona));
      const prompt = personaProfiles.length > 0
        ? [
          'Apply these user-selected persona profiles together. Cross-check disagreements explicitly.',
          ...personaProfiles.map((persona) => `Persona ${persona!.name}:\n${persona!.systemPrompt}`),
          `Task:\n${parsed.data.prompt}`,
        ].join('\n\n')
        : parsed.data.prompt;
      return assertResponseContract(
        agentSessionSnapshotSchema,
        manager.launch({ ...parsed.data, prompt, workspaceScope: hostGrant.workspaceScope, sessionScope: hostGrant.sessionScope }, receipt.root),
        'POST /api/agent-sessions',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(409).send({ error: message, code: 'agent_launch_failed' });
    }
  });

  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    '/api/agent-sessions/:id/events',
    async (request, reply) => {
      if (!await requireHostAuthority(auth, request, reply)) return;
      try {
        const after = Number.parseInt(request.query.after ?? '-1', 10);
        return assertResponseContract(
          agentSessionEventsResponseSchema,
          manager.read(request.params.id, Number.isFinite(after) ? after : -1),
          'GET /api/agent-sessions/:id/events',
        );
      } catch (error) {
        return reply.status(404).send({ error: error instanceof Error ? error.message : String(error), code: 'not_found' });
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/api/agent-sessions/:id', async (request, reply) => {
    if (!await requireHostAuthority(auth, request, reply)) return;
    try {
      return assertResponseContract(agentSessionSnapshotSchema, manager.cancel(request.params.id), 'DELETE /api/agent-sessions/:id');
    } catch (error) {
      return reply.status(404).send({ error: error instanceof Error ? error.message : String(error), code: 'not_found' });
    }
  });
}
