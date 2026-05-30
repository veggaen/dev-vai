import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { createDb, schema, type VaiConfig, type VaiDatabase } from '@vai/core';
import { PlatformAuthService } from '../src/auth/platform-auth.js';

function createPlatformAuthConfig(): VaiConfig['platformAuth'] {
  return {
    enabled: true,
    publicUrl: 'http://localhost:3006',
    appUrl: 'http://localhost:5173',
    sessionCookieName: 'vai_session',
    sessionTtlHours: 24,
    sessionSecret: 'test-session-secret',
    defaultProvider: undefined,
    providers: {
      google: {
        enabled: false,
        label: 'Google OAuth',
        scopes: ['openid', 'email', 'profile'],
      },
      workos: {
        enabled: false,
        label: 'WorkOS AuthKit',
      },
    },
  };
}

function makeRequest(headers: Record<string, string>, ip: string, url = '/'): FastifyRequest {
  return {
    headers,
    ip,
    url,
  } as FastifyRequest;
}

describe('PlatformAuthService local dev auth bypass', () => {
  let db: VaiDatabase;
  let auth: PlatformAuthService;

  beforeEach(() => {
    db = createDb(':memory:');
    auth = new PlatformAuthService(db, createPlatformAuthConfig());
  });

  it('returns a stable authenticated local dev viewer when the bypass header is present on a local request', async () => {
    const viewer = await auth.getViewer(makeRequest({ 'x-vai-dev-auth-bypass': '1' }, '127.0.0.1'));

    expect(viewer.authenticated).toBe(true);
    expect(viewer.user).toEqual({
      id: '__local_dev_user__',
      email: 'dev@localhost',
      name: 'Local Dev',
      avatarUrl: null,
    });

    const storedUser = db.select({
      id: schema.platformUsers.id,
      email: schema.platformUsers.email,
      name: schema.platformUsers.name,
    })
      .from(schema.platformUsers)
      .where(eq(schema.platformUsers.id, '__local_dev_user__'))
      .get();

    expect(storedUser).toEqual({
      id: '__local_dev_user__',
      email: 'dev@localhost',
      name: 'Local Dev',
    });
  });

  it('ignores the bypass header for non-local requests', async () => {
    const viewer = await auth.getViewer(makeRequest({ 'x-vai-dev-auth-bypass': '1' }, '8.8.8.8'));

    expect(viewer.authenticated).toBe(false);
    expect(viewer.user).toBeNull();
  });

  it('accepts the dev auth bypass query on local websocket requests', async () => {
    const viewer = await auth.getViewer(makeRequest({}, '127.0.0.1', '/api/chat?devAuthBypass=1'));

    expect(viewer.authenticated).toBe(true);
    expect(viewer.user?.id).toBe('__local_dev_user__');
  });

  it('ignores the dev auth bypass query for non-local websocket requests', async () => {
    const viewer = await auth.getViewer(makeRequest({}, '8.8.8.8', '/api/chat?devAuthBypass=1'));

    expect(viewer.authenticated).toBe(false);
    expect(viewer.user).toBeNull();
  });
});
