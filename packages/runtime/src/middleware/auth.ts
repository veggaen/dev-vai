/**
 * API Key Authentication Middleware
 *
 * Fastify preHandler hook that gates external access behind API keys.
 * Local requests (127.0.0.1 / ::1 / ::ffff:127.0.0.1) bypass auth entirely —
 * v3gga gets max speed with zero friction when running locally.
 *
 * External requests must provide a valid key via:
 *   Authorization: Bearer <key>
 *   X-API-Key: <key>
 *
 * Keys are loaded from VAI_API_KEYS env var (comma-separated).
 * Each key gets its own rate limit bucket.
 */

import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isLocalRequest } from '../security/request-trust.js';

// ── Types ──

export interface AuthConfig {
  /** Whether auth is enabled at all. When false, all requests pass through. */
  enabled: boolean;
  /** Valid API keys (pre-hashed for comparison) */
  keys: readonly string[];
  /** Max requests per key per minute */
  rateLimitPerMinute: number;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

// ── Constants ──

const RATE_WINDOW_MS = 60_000;

// ── Rate limiter (in-memory, per-key) ──

const rateBuckets = new Map<string, RateBucket>();

function checkRateLimit(key: string, limit: number): boolean {
  const now = Date.now();
  let bucket = rateBuckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(key, bucket);
  }

  bucket.count++;
  return bucket.count <= limit;
}

/** Reset rate limit state — exposed for testing only. */
export function _resetRateLimits(): void {
  rateBuckets.clear();
}

/** Periodically prune expired rate buckets to prevent memory leak. */
function pruneExpiredBuckets(): void {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now >= bucket.resetAt) rateBuckets.delete(key);
  }
}

// Prune every 5 minutes
const _pruneInterval = setInterval(pruneExpiredBuckets, 5 * 60_000);
// Allow Node to exit cleanly
if (typeof _pruneInterval.unref === 'function') _pruneInterval.unref();

// ── Key comparison (timing-safe) ──

function keysMatch(provided: string, stored: string): boolean {
  // Hash both to fixed length for timing-safe comparison
  const a = createHmac('sha256', 'vai-auth').update(provided).digest();
  const b = createHmac('sha256', 'vai-auth').update(stored).digest();
  return timingSafeEqual(a, b);
}

// ── Extract key from request ──

function extractApiKey(request: FastifyRequest): string | null {
  // Try Authorization: Bearer <key>
  const authHeader = request.headers.authorization;
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer' && parts[1]) {
      return parts[1];
    }
  }

  // Try X-API-Key header
  const xApiKey = request.headers['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey) {
    return xApiKey;
  }

  return null;
}

// ── Hook factory ──

export function buildAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const keysRaw = env.VAI_API_KEYS?.trim();
  const keys = keysRaw
    ? keysRaw.split(',').map(k => k.trim()).filter(Boolean)
    : [];

  return {
    enabled: keys.length > 0,
    keys,
    rateLimitPerMinute: Number(env.VAI_RATE_LIMIT_PER_MINUTE?.trim()) || 60,
  };
}

/**
 * Register the auth preHandler hook on a Fastify instance.
 * When config.enabled is false, this is a no-op (zero overhead).
 */
export function registerAuthHook(app: FastifyInstance, config: AuthConfig): void {
  if (!config.enabled) {
    console.log('[VAI] Auth: disabled (no API keys configured) — all requests allowed');
    return;
  }

  console.log(`[VAI] Auth: enabled with ${config.keys.length} key(s), rate limit ${config.rateLimitPerMinute}/min`);

  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Local requests always pass — v3gga gets max speed
    if (isLocalRequest(request)) return;

    // Public endpoints that don't need auth
    const path = request.url.split('?')[0];
    if (path === '/' || path === '/health') return;

    // Extract key
    const providedKey = extractApiKey(request);
    if (!providedKey) {
      reply.code(401).send({ error: 'API key required', hint: 'Set Authorization: Bearer <key> or X-API-Key: <key>' });
      return;
    }

    // Validate key (timing-safe comparison against all configured keys)
    const matched = config.keys.some(k => keysMatch(providedKey, k));
    if (!matched) {
      reply.code(403).send({ error: 'Invalid API key' });
      return;
    }

    // Rate limit check
    if (!checkRateLimit(providedKey, config.rateLimitPerMinute)) {
      reply.code(429).send({
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil(RATE_WINDOW_MS / 1000),
      });
      return;
    }
  });
}
