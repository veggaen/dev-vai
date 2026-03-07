/**
 * Search Routes — /api/search/*
 *
 * HTTP endpoints for the Perplexity-style structured search pipeline.
 *
 * Endpoints:
 *   POST /api/search      — Full pipeline: clarify → fan out → rank → read → cross-check → conclude
 *   POST /api/search/plan — Preview: returns the VaiSearchPlan without executing
 */

import type { FastifyInstance } from 'fastify';
import type { SearchPipeline } from '@vai/core';

export function registerSearchRoutes(
  app: FastifyInstance,
  searchPipeline: SearchPipeline,
) {
  /**
   * POST /api/search
   *
   * Execute a full structured search. Returns synthesized answer + citations + audit trail.
   *
   * Body: { query: string }
   * Response: SearchResponse
   */
  app.post<{ Body: { query: string } }>(
    '/api/search',
    async (request, reply) => {
      const { query } = request.body;
      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        reply.code(400).send({ error: 'Query is required' });
        return;
      }
      if (query.length > 1000) {
        reply.code(400).send({ error: 'Query too long (max 1000 characters)' });
        return;
      }

      const result = await searchPipeline.search(query.trim());
      return result;
    },
  );

  /**
   * POST /api/search/plan
   *
   * Preview the search plan without executing. Returns the normalized query,
   * extracted intent/entities, and planned fan-out queries.
   *
   * Body: { query: string }
   * Response: VaiSearchPlan
   */
  app.post<{ Body: { query: string } }>(
    '/api/search/plan',
    async (request, reply) => {
      const { query } = request.body;
      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        reply.code(400).send({ error: 'Query is required' });
        return;
      }

      const plan = searchPipeline.plan(query.trim());
      return plan;
    },
  );
}
