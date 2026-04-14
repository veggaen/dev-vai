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
import { searchPlanBodySchema, searchQueryBodySchema } from '@vai/api-types/search';
import { invalidRequestBody } from '../validation/http-validation.js';

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
      const parsed = searchQueryBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidRequestBody(reply, parsed.error);
      }
      const { query } = parsed.data;

      const result = await searchPipeline.search(query);
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
      const parsed = searchPlanBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return invalidRequestBody(reply, parsed.error);
      }
      const { query } = parsed.data;

      const plan = searchPipeline.plan(query);
      return plan;
    },
  );
}
