import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { createDb, eq, schema, type VaiConfig, type VaiDatabase } from '@vai/core';
import { PlatformAuthService } from '../src/auth/platform-auth.js';

function hashSessionToken(secret: string, token: string): string {
  return createHash('sha256').update(`${secret}:${token}`).digest('hex');
}

function seedSession(db: VaiDatabase, token: string, lastSeenAt = new Date()): string {
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
    lastSeenAt, createdAt: now,
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
      name: null,
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
      name: null,
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

  it('derives UI roles from server-owned allow-lists', async () => {
    const token = 'owner-session-token';
    seedSession(db, token);
    auth = new PlatformAuthService(db, createPlatformAuthConfig(), {
      ownerEmail: 'ws@example.com',
      adminEmails: ['admin@example.com'],
    });

    const viewer = await auth.getViewer(makeRequest({ authorization: `Bearer ${token}` }, '127.0.0.1'));

    expect(viewer.role).toBe('owner');
  });

  it('refreshes stale session activity without rewriting every authenticated request', async () => {
    const token = 'stale-session-token';
    const staleLastSeenAt = new Date(Date.now() - 2 * 60_000);
    seedSession(db, token, staleLastSeenAt);

    await auth.getViewer(makeRequest({ authorization: `Bearer ${token}` }, '127.0.0.1'));
    const refreshed = db.select({ lastSeenAt: schema.platformSessions.lastSeenAt })
      .from(schema.platformSessions)
      .get();

    expect(refreshed?.lastSeenAt.getTime()).toBeGreaterThan(staleLastSeenAt.getTime());

    await auth.getViewer(makeRequest({ authorization: `Bearer ${token}` }, '127.0.0.1'));
    const stable = db.select({ lastSeenAt: schema.platformSessions.lastSeenAt })
      .from(schema.platformSessions)
      .get();

    expect(stable?.lastSeenAt.getTime()).toBe(refreshed?.lastSeenAt.getTime());
  });

  it('does not let a provided companion id replace another installation key', () => {
    const first = auth.upsertAnonymousCompanionClient(makeRequest({
      'x-vai-installation-key': 'installation-a',
      'x-vai-client-name': 'Desktop A',
    }, '127.0.0.1'));
    const second = auth.upsertAnonymousCompanionClient(makeRequest({
      'x-vai-installation-key': 'installation-b',
      'x-vai-client-name': 'Desktop B',
      'x-vai-companion-client-id': first!.id,
    }, '127.0.0.1'));

    expect(second?.id).not.toBe(first?.id);
    expect(db.select().from(schema.platformCompanionClients).all()).toHaveLength(2);
  });

  it('does not rewrite an unchanged companion heartbeat inside the touch interval', () => {
    const request = makeRequest({
      'x-vai-installation-key': 'stable-installation',
      'x-vai-client-name': 'Stable Desktop',
    }, '127.0.0.1');
    const companion = auth.upsertAnonymousCompanionClient(request)!;
    const stableUpdatedAt = new Date('2024-01-01T00:00:00.000Z');

    db.update(schema.platformCompanionClients)
      .set({ updatedAt: stableUpdatedAt })
      .where(eq(schema.platformCompanionClients.id, companion.id))
      .run();

    auth.upsertAnonymousCompanionClient(request);

    const stored = db.select().from(schema.platformCompanionClients)
      .where(eq(schema.platformCompanionClients.id, companion.id))
      .get();
    expect(stored?.updatedAt.getTime()).toBe(stableUpdatedAt.getTime());
  });

  it('does not trust an unconfigured Referer origin for OAuth return targets', async () => {
    const baseConfig = createPlatformAuthConfig();
    auth = new PlatformAuthService(db, {
      ...baseConfig,
      defaultProvider: 'google',
      providers: {
        ...baseConfig.providers,
        google: {
          enabled: true,
          label: 'Google OAuth',
          clientId: 'google-client-id',
          scopes: ['openid', 'email', 'profile'],
        },
      },
    });

    await auth.buildProviderStartUrl(
      'google',
      makeRequest({ referer: 'https://attacker.example/sign-in' }, '127.0.0.1'),
      'https://attacker.example/steal-session',
    );

    const storedState = db.select().from(schema.platformOauthStates).get();
    expect(storedState?.returnTo).toBe('http://localhost:5173');
  });

  it('allows local preview returns without trusting arbitrary external origins', async () => {
    const baseConfig = createPlatformAuthConfig();
    auth = new PlatformAuthService(db, {
      ...baseConfig,
      defaultProvider: 'google',
      providers: {
        ...baseConfig.providers,
        google: {
          enabled: true,
          label: 'Google OAuth',
          clientId: 'google-client-id',
          scopes: ['openid', 'email', 'profile'],
        },
      },
    });

    await auth.buildProviderStartUrl(
      'google',
      makeRequest({}, '127.0.0.1'),
      'http://localhost:4100/api/auth/platform/callback',
    );

    const storedState = db.select().from(schema.platformOauthStates).get();
    expect(storedState?.returnTo).toBe('http://localhost:4100/api/auth/platform/callback');
  });

  it('exchanges preview login handoffs once and never stores the platform session in the redirect', () => {
    const token = 'preview-cookie-session';
    seedSession(db, token);

    const code = auth.issueLoginHandoff(token, 'http://localhost:4100');
    const exchange = auth.exchangeLoginHandoff(code, makeRequest({}, '127.0.0.1'));

    expect(exchange.user.email).toBe('ws@example.com');
    expect(exchange.sessionToken).not.toBe(token);
    expect(() => auth.exchangeLoginHandoff(code, makeRequest({}, '127.0.0.1')))
      .toThrow('Login handoff is missing or expired.');
  });
});
