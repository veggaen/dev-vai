import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { createDb, schema, type VaiConfig, type VaiDatabase } from '@vai/core';
import { PlatformAuthService } from '../src/auth/platform-auth.js';

function hashSessionToken(secret: string, token: string): string {
  return createHash('sha256').update(`${secret}:${token}`).digest('hex');
}

function seedSession(db: VaiDatabase, token: string): string {
  const now = new Date();
  const userId = 'ws-user-1';
  db.insert(schema.platformUsers).values({
    id: userId, email: 'ws@example.com', name: 'WS User', avatarUrl: null,
    createdAt: now, updatedAt: now,
  }).run();
  db.insert(schema.platformSessions).values({
    id: 'ws-session-1', userId,
    tokenHash: hashSessionToken('test-session-secret', token),
    userAgent: null, ipAddress: null,
    expiresAt: new Date(now.getTime() + 60_000),
    lastSeenAt: now, createdAt: now,
  }).run();
  return userId;
}

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

  it('authenticates a websocket upgrade via the access_token query param', async () => {
    const token = 'ws-session-token-abc';
    const userId = seedSession(db, token);

    const viewer = await auth.getViewer(makeRequest(
      { upgrade: 'websocket' },
      '203.0.113.10',
      `/api/chat?access_token=${token}`,
    ));

    expect(viewer.authenticated).toBe(true);
    expect(viewer.user?.id).toBe(userId);
  });

  it('ignores the access_token query param on a normal (non-websocket) request', async () => {
    const token = 'ws-session-token-abc';
    seedSession(db, token);

    const viewer = await auth.getViewer(makeRequest(
      {},
      '203.0.113.10',
      `/api/conversations?access_token=${token}`,
    ));

    expect(viewer.authenticated).toBe(false);
    expect(viewer.user).toBeNull();
  });
});
