/**
 * Tests for API key authentication middleware.
 *
 * Verifies:
 *   - Local requests bypass auth (v3gga gets max speed)
 *   - External requests require valid API key
 *   - Invalid/missing keys are rejected
 *   - Rate limiting works per key
 *   - Auth disabled (no keys configured) = all requests pass
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { buildAuthConfig, registerAuthHook, _resetRateLimits, type AuthConfig } from '../src/middleware/auth.js';

// ── Auth Config Building ──

describe('buildAuthConfig', () => {
  it('disabled when no keys configured', () => {
    const config = buildAuthConfig({});
    expect(config.enabled).toBe(false);
    expect(config.keys.length).toBe(0);
  });

  it('enabled with comma-separated keys', () => {
    const config = buildAuthConfig({ VAI_API_KEYS: 'key1,key2,key3' });
    expect(config.enabled).toBe(true);
    expect(config.keys).toEqual(['key1', 'key2', 'key3']);
  });

  it('trims whitespace from keys', () => {
    const config = buildAuthConfig({ VAI_API_KEYS: ' key1 , key2 ' });
    expect(config.keys).toEqual(['key1', 'key2']);
  });

  it('filters out empty keys', () => {
    const config = buildAuthConfig({ VAI_API_KEYS: 'key1,,key2,' });
    expect(config.keys).toEqual(['key1', 'key2']);
  });

  it('uses custom rate limit', () => {
    const config = buildAuthConfig({
      VAI_API_KEYS: 'key1',
      VAI_RATE_LIMIT_PER_MINUTE: '120',
    });
    expect(config.rateLimitPerMinute).toBe(120);
  });

  it('defaults rate limit to 60/min', () => {
    const config = buildAuthConfig({ VAI_API_KEYS: 'key1' });
    expect(config.rateLimitPerMinute).toBe(60);
  });
});

// ── Auth Hook Integration Tests ──

describe('registerAuthHook', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    _resetRateLimits();
    app = Fastify({ logger: false });
    // Add a simple test route
    app.get('/api/test', async () => ({ ok: true }));
    app.get('/', async () => ({ name: 'VeggaAI' }));
    app.get('/health', async () => ({ status: 'ok' }));
  });

  it('allows all requests when auth is disabled', async () => {
    const config: AuthConfig = { enabled: false, keys: [], rateLimitPerMinute: 60 };
    registerAuthHook(app, config);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
      headers: { 'x-forwarded-for': '8.8.8.8' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('allows / without auth even when enabled', async () => {
    const config: AuthConfig = { enabled: true, keys: ['testkey123'], rateLimitPerMinute: 60 };
    registerAuthHook(app, config);
    await app.ready();

    // Root endpoint should be public
    const res = await app.inject({
      method: 'GET',
      url: '/',
      remoteAddress: '8.8.8.8',
    });
    expect(res.statusCode).toBe(200);
  });

  it('allows /health without auth even when enabled', async () => {
    const config: AuthConfig = { enabled: true, keys: ['testkey123'], rateLimitPerMinute: 60 };
    registerAuthHook(app, config);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: '8.8.8.8',
    });
    expect(res.statusCode).toBe(200);
  });

  it('allows local requests (127.0.0.1) without auth', async () => {
    const config: AuthConfig = { enabled: true, keys: ['testkey123'], rateLimitPerMinute: 60 };
    registerAuthHook(app, config);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
      remoteAddress: '127.0.0.1',
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects external requests without API key', async () => {
    const config: AuthConfig = { enabled: true, keys: ['testkey123'], rateLimitPerMinute: 60 };
    registerAuthHook(app, config);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
      remoteAddress: '8.8.8.8',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('API key required');
  });

  it('accepts valid Bearer token', async () => {
    const config: AuthConfig = { enabled: true, keys: ['testkey123'], rateLimitPerMinute: 60 };
    registerAuthHook(app, config);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
      remoteAddress: '8.8.8.8',
      headers: { authorization: 'Bearer testkey123' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('accepts valid X-API-Key header', async () => {
    const config: AuthConfig = { enabled: true, keys: ['testkey123'], rateLimitPerMinute: 60 };
    registerAuthHook(app, config);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
      remoteAddress: '8.8.8.8',
      headers: { 'x-api-key': 'testkey123' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects invalid API key', async () => {
    const config: AuthConfig = { enabled: true, keys: ['testkey123'], rateLimitPerMinute: 60 };
    registerAuthHook(app, config);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
      remoteAddress: '8.8.8.8',
      headers: { authorization: 'Bearer wrong-key' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('Invalid API key');
  });

  it('enforces rate limit per key', async () => {
    const config: AuthConfig = { enabled: true, keys: ['testkey123'], rateLimitPerMinute: 2 };
    registerAuthHook(app, config);
    await app.ready();

    // Request 1 — ok
    const r1 = await app.inject({
      method: 'GET', url: '/api/test', remoteAddress: '8.8.8.8',
      headers: { 'x-api-key': 'testkey123' },
    });
    expect(r1.statusCode).toBe(200);

    // Request 2 — ok
    const r2 = await app.inject({
      method: 'GET', url: '/api/test', remoteAddress: '8.8.8.8',
      headers: { 'x-api-key': 'testkey123' },
    });
    expect(r2.statusCode).toBe(200);

    // Request 3 — rate limited
    const r3 = await app.inject({
      method: 'GET', url: '/api/test', remoteAddress: '8.8.8.8',
      headers: { 'x-api-key': 'testkey123' },
    });
    expect(r3.statusCode).toBe(429);
    expect(r3.json().error).toContain('Rate limit');
  });
});
