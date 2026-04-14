import type { FastifyInstance } from 'fastify';
import { getSkillRegistry, getSubAgentRouter } from '@vai/core';

export function registerSkillRoutes(app: FastifyInstance) {
  /** List all loaded skills */
  app.get('/api/skills', async () => {
    const registry = getSkillRegistry();
    return registry.list().map(s => ({
      name: s.manifest.name,
      description: s.manifest.description,
      triggers: s.manifest.triggers,
      tools: s.manifest.tools,
      permissions: s.manifest.permissions,
      requires: s.manifest.requires ?? [],
      trust: s.manifest.trust,
      version: s.manifest.version ?? null,
      author: s.manifest.author ?? null,
      path: s.path,
    }));
  });

  /** Get a specific skill by name */
  app.get<{ Params: { name: string } }>('/api/skills/:name', async (request, reply) => {
    const registry = getSkillRegistry();
    const skill = registry.get(request.params.name);
    if (!skill) {
      return reply.status(404).send({ error: `Skill '${request.params.name}' not found` });
    }
    return {
      manifest: skill.manifest,
      instructions: skill.instructions,
      path: skill.path,
      context: registry.buildContext(skill.manifest.name),
    };
  });

  /** Match skills for a query (debug/preview) */
  app.get<{ Querystring: { q: string } }>('/api/skills/match', async (request, reply) => {
    const q = request.query.q;
    if (!q) return reply.status(400).send({ error: 'Missing query parameter: q' });

    const registry = getSkillRegistry();
    const router = getSubAgentRouter();

    const matched = registry.matchForQuery(q).map(s => s.manifest.name);
    const routing = router.describe(q);

    return { query: q, matched, routing };
  });
}
