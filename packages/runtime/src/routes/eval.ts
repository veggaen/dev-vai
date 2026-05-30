/**
 * Eval Framework Routes — /api/eval/*
 *
 * HTTP endpoints for running eval benchmarks against registered models.
 * Exposes the EvalRunner so VeggaAI can self-test and track regression.
 *
 * Endpoints:
 *   GET  /api/eval/tracks    — List registered eval tracks + task counts
 *   POST /api/eval/run       — Run an eval track against a model
 *   GET  /api/eval/tracks/:track/tasks — List tasks in a track
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { EvalRunner, getEvalTracks, getEvalTasks, type EvalTrack, type EvalRunConfig } from '@vai/core';

export interface EvalRouteAuthorization {
  allowed: boolean;
  statusCode?: 401 | 403;
  error?: string;
}

export interface RegisterEvalRoutesOptions {
  /** Keep eval endpoints dark unless explicitly enabled by runtime config. */
  enabled?: boolean;
  /** Optional policy for expensive/mutating eval runs. */
  authorizeRun?: (request: FastifyRequest) => Promise<EvalRouteAuthorization> | EvalRouteAuthorization;
}

export function registerEvalRoutes(
  app: FastifyInstance,
  evalRunner: EvalRunner,
  options: RegisterEvalRoutesOptions = {},
) {
  const enabled = options.enabled ?? true;

  function disabledResponse() {
    return { error: 'Eval framework is disabled' };
  }

  /**
   * GET /api/eval/tracks
   *
   * List all registered eval tracks with their task counts.
   */
  app.get('/api/eval/tracks', async (_request, reply) => {
    if (!enabled) {
      reply.code(404);
      return disabledResponse();
    }
    const tracks = getEvalTracks();
    return {
      tracks: tracks.map(track => ({
        track,
        taskCount: getEvalTasks(track).length,
      })),
    };
  });

  /**
   * GET /api/eval/tracks/:track/tasks
   *
   * List all tasks registered for a specific track.
   */
  app.get<{ Params: { track: string } }>(
    '/api/eval/tracks/:track/tasks',
    async (request, reply) => {
      if (!enabled) {
        reply.code(404);
        return disabledResponse();
      }
      const track = request.params.track as EvalTrack;
      const tasks = getEvalTasks(track);
      return {
        track,
        tasks: tasks.map(t => ({
          id: t.id,
          description: t.description,
          tags: t.tags ?? [],
          strategy: t.expected.strategy,
        })),
      };
    },
  );

  /**
   * POST /api/eval/run
   *
   * Run an eval track. Returns full results with per-task scores.
   *
   * Body: { modelId: string, track: EvalTrack, taskIds?: string[], maxAttempts?: number, temperature?: number }
   */
  app.post<{ Body: EvalRunConfig }>(
    '/api/eval/run',
    async (request, reply) => {
      if (!enabled) {
        reply.code(404);
        return disabledResponse();
      }
      const authorization = await options.authorizeRun?.(request);
      if (authorization && !authorization.allowed) {
        reply.code(authorization.statusCode ?? 403);
        return { error: authorization.error ?? 'Not allowed to run evals' };
      }

      const config = request.body;

      // Validate track has tasks
      const tasks = getEvalTasks(config.track);
      if (tasks.length === 0) {
        return { error: `No tasks registered for track: ${config.track}`, tracks: getEvalTracks() };
      }

      const result = await evalRunner.run(config);
      return result;
    },
  );
}
