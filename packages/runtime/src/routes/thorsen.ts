/**
 * Thorsen Meta-Kernel Routes — /api/thorsen/*
 *
 * HTTP endpoints for the Thorsen intent-to-artifact pipeline.
 * Replaces the need for a separate gRPC server — runs on the same
 * Fastify instance as all other Vai routes.
 *
 * Endpoints:
 *   POST /api/thorsen/synthesize — Resolve an intent into a software artifact
 *   POST /api/thorsen/pulse      — Measure sync latency (Thorsen Curve state)
 *   GET  /api/thorsen/templates   — List available deterministic templates
 *   GET  /api/thorsen/curve       — Get Thorsen Curve thresholds
 */

import type { FastifyInstance } from 'fastify';
import {
  executePipeline,
  getPipelineInfo,
  listTemplates,
  classifySyncState,
  THORSEN_CURVE,
  runSelfImprovement,
  quickHealth,
  type ThorsenIntent,
} from '@vai/core';

export function registerThorsenRoutes(app: FastifyInstance) {
  /**
   * POST /api/thorsen/synthesize
   *
   * The core endpoint. Send a structured intent through the full
   * 6-stage pipeline: receive → normalize → route → synthesize → verify → score.
   * Returns artifact + sync status + full pipeline trace.
   *
   * If ANTHROPIC_API_KEY is set, LLM-backed synthesis is available for
   * intents that don't match a deterministic template.
   */
  app.post<{ Body: ThorsenIntent & { traceMode?: boolean; skipVerify?: boolean } }>(
    '/api/thorsen/synthesize',
    async (request) => {
      const { traceMode, skipVerify, ...intentBody } = request.body;
      const intent: ThorsenIntent = {
        ...intentBody,
        timestampUs: intentBody.timestampUs ?? Date.now() * 1000,
      };

      const apiKey = process.env.ANTHROPIC_API_KEY ?? null;
      const response = await executePipeline(intent, {
        apiKey,
        traceMode: traceMode !== false,
        skipVerify: skipVerify === true,
      });

      return response;
    },
  );

  /**
   * GET /api/thorsen/pipeline
   *
   * Pipeline architecture info — stages, strategies, complexity levels.
   */
  app.get('/api/thorsen/pipeline', async () => {
    return getPipelineInfo();
  });

  /**
   * POST /api/thorsen/pulse
   *
   * Lightweight latency probe. Client sends a timestamp, server
   * responds with the round-trip classification on the Thorsen Curve.
   * Used for continuous sync state monitoring.
   */
  app.post<{ Body: { timestampUs: number; frequency?: number; intensity?: number } }>(
    '/api/thorsen/pulse',
    async (request) => {
      const { timestampUs, frequency, intensity } = request.body;
      const nowUs = Date.now() * 1000;
      const latencyMs = (nowUs - timestampUs) / 1000;

      return {
        state: classifySyncState(latencyMs),
        latencyMs: Math.round(latencyMs * 100) / 100,
        frequency: frequency ?? 0,
        intensity: intensity ?? 0,
        serverTimestampUs: nowUs,
      };
    },
  );

  /**
   * GET /api/thorsen/templates
   *
   * List all available deterministic templates.
   * Each key is "action:domain:logicType".
   */
  app.get('/api/thorsen/templates', async () => {
    const keys = listTemplates();
    return {
      count: keys.length,
      templates: keys.map((key) => {
        const [action, domain, logicType] = key.split(':');
        return { key, action, domain, logicType };
      }),
    };
  });

  /**
   * GET /api/thorsen/curve
   *
   * Return the Thorsen Curve threshold constants.
   */
  app.get('/api/thorsen/curve', async () => {
    return {
      thresholds: THORSEN_CURVE,
      states: [
        { state: 'wormhole', label: 'Unified', description: 'Language-agnostic, <100ms' },
        { state: 'parallel', label: 'Emerging', description: 'Multi-modal braid, 100-200ms' },
        { state: 'linear', label: 'Confused', description: 'Single modality, >200ms' },
      ],
    };
  });

  /**
   * POST /api/thorsen/self-improve
   *
   * Run the full self-improvement cycle: benchmark all templates,
   * analyze gaps, generate suggestions. Returns a complete report.
   */
  app.post('/api/thorsen/self-improve', async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? null;
    return runSelfImprovement({ apiKey, traceMode: true });
  });

  /**
   * GET /api/thorsen/health
   *
   * Quick health check — grade + key metrics.
   */
  app.get('/api/thorsen/health', async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? null;
    return quickHealth({ apiKey });
  });

  /**
   * GET /api/thorsen/coverage
   *
   * Returns a coverage heatmap matrix: action × domain.
   * Each cell indicates whether a deterministic template exists,
   * plus the logic type used. Used by the UI to visualize coverage.
   */
  app.get('/api/thorsen/coverage', async () => {
    const keys = listTemplates();

    // Collect unique actions and domains
    const actionsSet = new Set<string>();
    const domainsSet = new Set<string>();
    const templateMap = new Map<string, { action: string; domain: string; logicType: string }>();

    for (const key of keys) {
      const [action, domain, logicType] = key.split(':');
      actionsSet.add(action!);
      domainsSet.add(domain!);
      templateMap.set(`${action}:${domain}`, { action: action!, domain: domain!, logicType: logicType! });
    }

    const actions = [...actionsSet].sort();
    const domains = [...domainsSet].sort();

    // Build the matrix
    const matrix: Array<{
      action: string;
      domain: string;
      covered: boolean;
      logicType: string | null;
      templateKey: string | null;
    }> = [];

    let covered = 0;
    const total = actions.length * domains.length;

    for (const action of actions) {
      for (const domain of domains) {
        const entry = templateMap.get(`${action}:${domain}`);
        if (entry) {
          covered++;
          matrix.push({
            action,
            domain,
            covered: true,
            logicType: entry.logicType,
            templateKey: `${action}:${domain}:${entry.logicType}`,
          });
        } else {
          matrix.push({
            action,
            domain,
            covered: false,
            logicType: null,
            templateKey: null,
          });
        }
      }
    }

    return {
      actions,
      domains,
      matrix,
      stats: {
        total,
        covered,
        uncovered: total - covered,
        coveragePercent: Math.round((covered / total) * 100),
      },
    };
  });
}
