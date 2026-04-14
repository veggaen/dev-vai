/**
 * Integration test: conversations API route handlers.
 *
 * Tests the REST API endpoints end-to-end by creating a real Fastify
 * instance with an in-memory DB and mock model adapter.
 *
 * This is the pattern for testing any Fastify route in this project:
 *   1. Create in-memory DB
 *   2. Register adapters/services
 *   3. Build Fastify app and register routes
 *   4. Use app.inject() to simulate HTTP requests (no real network)
 *   5. Assert status codes and response bodies
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createDb, ChatService, ModelRegistry } from '@vai/core';
import type { ModelAdapter, ChatRequest, ChatResponse, ChatChunk, VaiDatabase } from '@vai/core';
import { registerConversationRoutes } from '../src/routes/conversations.js';

/** Minimal mock adapter for testing — returns a predictable response */
class TestAdapter implements ModelAdapter {
  readonly id = 'test:mock';
  readonly displayName = 'Test Mock';
  readonly supportsStreaming = true;
  readonly supportsToolUse = false;
  lastStreamRequest?: ChatRequest;

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    return {
      message: { role: 'assistant', content: 'Hello from test mock' },
      usage: { promptTokens: 5, completionTokens: 10 },
      finishReason: 'stop',
    };
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatChunk> {
    this.lastStreamRequest = request;
    yield { type: 'text_delta', textDelta: 'Hello ' };
    yield { type: 'text_delta', textDelta: 'world' };
    yield { type: 'done', usage: { promptTokens: 5, completionTokens: 2 } };
  }
}

describe('Conversation Routes', () => {
  let app: FastifyInstance;
  let db: VaiDatabase;
  let chatService: ChatService;
  let adapter: TestAdapter;

  beforeEach(async () => {
    // Arrange: fresh DB + adapter + Fastify instance for each test
    db = createDb(':memory:');
    const registry = new ModelRegistry();
    adapter = new TestAdapter();
    registry.register(adapter);
    chatService = new ChatService(db, registry);

    app = Fastify({ logger: false });

    // Mock dependencies for the updated route signature
    const mockAuth = {
      getViewer: async () => ({ authenticated: false, user: null }),
    } as unknown as import('../src/auth/platform-auth.js').PlatformAuthService;

    const mockSandbox = {
      create: async (name: string) => ({
        id: 'mock-sandbox-' + Date.now(),
        name,
        rootDir: '/tmp/mock',
        ownerUserId: null,
        files: {},
        devProcess: null,
        devPort: null,
        logs: [],
        status: 'idle' as const,
        createdAt: new Date(),
      }),
    } as unknown as import('../src/sandbox/manager.js').SandboxManager;

    const mockProjects = {
      syncSandboxProject: () => null,
      removeProjectForSandbox: () => {},
    } as unknown as import('../src/projects/service.js').ProjectService;

    registerConversationRoutes(app, chatService, 'test:mock', mockAuth, mockSandbox, mockProjects);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /api/conversations', () => {
    it('creates a conversation and returns its ID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/conversations',
        payload: { modelId: 'test:mock', title: 'My Chat', mode: 'plan' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBeTruthy();
      expect(typeof body.id).toBe('string');

      const listRes = await app.inject({
        method: 'GET',
        url: '/api/conversations',
      });
      const conversations = listRes.json();
      expect(conversations[0].mode).toBe('plan');
    });

    it('uses the runtime default model when modelId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/conversations',
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBeTruthy();
    });

    it('returns 400 with code validation when the body has unknown keys', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/conversations',
        payload: { modelId: 'test:mock', unexpectedField: true },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('validation');
      expect(body.error).toMatch(/Invalid request body/i);
    });
  });

  describe('GET /api/conversations', () => {
    it('returns empty list initially', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/conversations',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('lists created conversations', async () => {
      // Create two conversations
      await app.inject({
        method: 'POST',
        url: '/api/conversations',
        payload: { modelId: 'test:mock', title: 'Chat 1' },
      });
      await app.inject({
        method: 'POST',
        url: '/api/conversations',
        payload: { modelId: 'test:mock', title: 'Chat 2' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/conversations',
      });

      const list = res.json();
      expect(list).toHaveLength(2);
    });
  });

  describe('PATCH /api/conversations/:id', () => {
    it('updates the persisted conversation mode', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/conversations',
        payload: { modelId: 'test:mock', mode: 'chat' },
      });
      const { id } = createRes.json();

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/conversations/${id}`,
        payload: { mode: 'builder' },
      });

      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().mode).toBe('builder');
    });

    it('updates the linked sandbox project', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/conversations',
        payload: { modelId: 'test:mock', mode: 'chat' },
      });
      const { id } = createRes.json();

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/conversations/${id}`,
        payload: { sandboxProjectId: 'sandbox-123' },
      });

      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().sandboxProjectId).toBe('sandbox-123');
    });
  });

  describe('POST /api/conversations/:id/messages', () => {
    it('sends a message and receives a response', async () => {
      // Create conversation
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/conversations',
        payload: { modelId: 'test:mock' },
      });
      const { id } = createRes.json();

      // Send message via HTTP endpoint
      const msgRes = await app.inject({
        method: 'POST',
        url: `/api/conversations/${id}/messages`,
        payload: { content: 'hello' },
      });

      expect(msgRes.statusCode).toBe(200);
      const body = msgRes.json();
      expect(body.role).toBe('assistant');
      expect(body.content).toBe('Hello world');
      expect(body.usage.promptTokens).toBe(5);
    });

    it('forwards request-level prompt-hardening overrides', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/conversations',
        payload: { modelId: 'test:mock' },
      });
      const { id } = createRes.json();

      const msgRes = await app.inject({
        method: 'POST',
        url: `/api/conversations/${id}/messages`,
        payload: {
          content: 'Design a repo-native answer engine for a large monorepo. Explain signals, guardrails, metrics, and rollout.',
          profile: 'strict',
          responseDepth: 'deep-design-memo',
        },
      });

      expect(msgRes.statusCode).toBe(200);
      const systemText = adapter.lastStreamRequest?.messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n\n') ?? '';

      expect(systemText).toMatch(/Hardening profile: strict/i);
      expect(systemText).toMatch(/Requested response depth: deep-design-memo/i);
      expect(systemText).toMatch(/Respond with a deeper design memo/i);
    });
  });

  describe('GET /api/conversations/:id/messages', () => {
    it('retrieves message history after sending', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/conversations',
        payload: { modelId: 'test:mock' },
      });
      const { id } = createRes.json();

      // Send a message
      await app.inject({
        method: 'POST',
        url: `/api/conversations/${id}/messages`,
        payload: { content: 'Hello Vai' },
      });

      // Fetch history
      const historyRes = await app.inject({
        method: 'GET',
        url: `/api/conversations/${id}/messages`,
      });

      const messages = historyRes.json();
      expect(messages).toHaveLength(2); // user + assistant
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('Hello Vai');
      expect(messages[1].role).toBe('assistant');
    });
  });
});
