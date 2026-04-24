import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerSessionRoutes } from '../src/routes/sessions.js';
import { registerProjectRoutes } from '../src/routes/projects.js';

describe('Session Route Validation', () => {
  let app: FastifyInstance;
  const sessions = {
    createSession: vi.fn(() => ({ id: 'ses_1' })),
    importSession: vi.fn(() => 'ses_imported'),
    updateSession: vi.fn(),
    getSession: vi.fn(() => ({ id: 'ses_1', title: 'Session' })),
    addEvents: vi.fn(() => []),
    pinEvent: vi.fn(),
    unpinEvent: vi.fn(),
    endSession: vi.fn(),
    addPinnedNote: vi.fn(() => ({ id: 'note_1' })),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify({ logger: false });
    registerSessionRoutes(app, sessions as any);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects invalid session creation payloads before creating sessions', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        title: 'Test',
        agentName: 'VeggaAI',
        modelId: 'vai:v0',
        extra: true,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'validation', error: 'Invalid request body' });
    expect(sessions.createSession).not.toHaveBeenCalled();
  });

  it('rejects invalid session event payloads before appending events', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions/ses_1/events',
      payload: {
        events: [{ type: 'message', extra: true }],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'validation' });
    expect(sessions.addEvents).not.toHaveBeenCalled();
  });
});

describe('Project Route Validation', () => {
  let app: FastifyInstance;
  const auth = {
    getViewer: vi.fn(async () => ({
      authenticated: true,
      user: { id: 'user_1' },
      companionClient: null,
    })),
  };
  const projects = {
    listProjectsForUser: vi.fn(() => []),
    canReadProject: vi.fn(() => true),
    canWriteProject: vi.fn(() => true),
    getProject: vi.fn(() => null),
    getProjectRole: vi.fn(() => 'owner'),
    listMembers: vi.fn(() => []),
    listPeers: vi.fn(() => []),
    listCompanionClients: vi.fn(() => []),
    replacePeers: vi.fn(() => []),
    listAuditRequests: vi.fn(() => []),
    createAuditRequest: vi.fn(),
    submitAuditResult: vi.fn(),
    pollPendingAuditWork: vi.fn(() => null),
    createShareLink: vi.fn(),
    getShareLinkPreview: vi.fn(() => null),
    redeemShareLink: vi.fn(),
    createHandoffIntent: vi.fn(),
    consumeHandoffIntent: vi.fn(),
    pollPendingHandoff: vi.fn(() => null),
  };
  const sandbox = {
    get: vi.fn(() => null),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify({ logger: false });
    registerProjectRoutes(app, auth as any, projects as any, sandbox as any);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects invalid peer payloads before mutating project peers', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/proj_1/peers',
      payload: {
        peers: [{ displayName: 'Cursor', ide: 'cursor' }],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'validation' });
    expect(projects.replacePeers).not.toHaveBeenCalled();
  });

  it('rejects blank audit prompts before creating audit requests', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/proj_1/audits',
      payload: { prompt: '   ' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'validation' });
    expect(projects.createAuditRequest).not.toHaveBeenCalled();
  });

  it('rejects invalid handoff targets before creating intents', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/proj_1/handoff-intents',
      payload: { target: 'vim' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'validation' });
    expect(projects.createHandoffIntent).not.toHaveBeenCalled();
  });

  it('rejects missing handoff tokens before consuming intents', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/handoff/consume',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'validation' });
    expect(projects.consumeHandoffIntent).not.toHaveBeenCalled();
  });
});
