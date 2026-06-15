import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createDb, type VaiDatabase } from '@vai/core';
import { PlatformAuthService } from '../src/auth/platform-auth.js';
import { CompanionContextBroker } from '../src/companion-context/broker.js';
import { registerCompanionContextRoutes } from '../src/routes/companion-context.js';

describe('companion context routes', () => {
  let app: FastifyInstance;
  let db: VaiDatabase;
  let broker: CompanionContextBroker;

  beforeEach(() => {
    db = createDb(':memory:');
    const auth = new PlatformAuthService(db, {
      enabled: false,
      publicUrl: 'http://localhost:3006',
      appUrl: 'http://localhost:5173',
      sessionCookieName: 'vai_session',
      sessionTtlHours: 24,
      sessionSecret: 'test-session-secret',
      providers: {
        google: {
          enabled: false,
          scopes: ['openid', 'email', 'profile'],
        },
      },
    });
    broker = new CompanionContextBroker();
    app = Fastify({ logger: false });
    registerCompanionContextRoutes(app, auth, broker);
  });

  afterEach(async () => {
    await app.close();
  });

  it('delivers a work item and accepts timestamped companion evidence', async () => {
    const capturedAt = new Date().toISOString();
    const result = broker.request({
      requestedFields: ['openFile'],
      timeoutMs: 100,
    });
    const headers = {
      'x-vai-installation-key': 'test-vscode-installation',
      'x-vai-client-name': 'VS Code Test',
      'x-vai-client-type': 'vscode-extension',
    };

    let poll = await app.inject({
      method: 'POST',
      url: '/api/companion-context/poll-consume',
      headers,
    });
    // The broker request can race with immediate consume in CI; allow a few polls.
    for (let attempt = 0; attempt < 4 && poll.statusCode === 204; attempt += 1) {
      poll = await app.inject({
        method: 'POST',
        url: '/api/companion-context/poll-consume',
        headers,
      });
    }
    expect(poll.statusCode).toBe(200);
    const workItem = poll.json() as { requestId: string; requestedFields: string[] };
    expect(workItem.requestedFields).toEqual(['openFile']);

    const respond = await app.inject({
      method: 'POST',
      url: `/api/companion-context/requests/${workItem.requestId}/respond`,
      headers,
      payload: {
        source: 'vscode-capture-adapter',
        capturedAt,
        openFile: 'packages/runtime/src/server.ts',
      },
    });
    expect(respond.statusCode).toBe(200);
    await expect(result).resolves.toEqual({
      source: 'vscode-capture-adapter',
      capturedAt,
      openFile: 'packages/runtime/src/server.ts',
    });
  });

  it('requires a companion installation key for polling', async () => {
    const poll = await app.inject({
      method: 'POST',
      url: '/api/companion-context/poll-consume',
    });

    expect(poll.statusCode).toBe(400);
    expect(poll.json()).toMatchObject({
      error: expect.stringMatching(/installation-key/i),
    });
  });
});
