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

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    return {
      message: { role: 'assistant', content: 'Hello from test mock' },
      usage: { promptTokens: 5, completionTokens: 10 },
      finishReason: 'stop',
    };
  }

  async *chatStream(_request: ChatRequest): AsyncIterable<ChatChunk> {
    yield { type: 'text_delta', textDelta: 'Hello ' };
    yield { type: 'text_delta', textDelta: 'world' };
    yield { type: 'done', usage: { promptTokens: 5, completionTokens: 2 } };
  }
}

describe('Conversation Routes', () => {
  let app: FastifyInstance;
  let db: VaiDatabase;
  let chatService: ChatService;

  beforeEach(async () => {
    // Arrange: fresh DB + adapter + Fastify instance for each test
    db = createDb(':memory:');
    const registry = new ModelRegistry();
    registry.register(new TestAdapter());
    chatService = new ChatService(db, registry);

    app = Fastify({ logger: false });
    registerConversationRoutes(app, chatService);
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
        payload: { modelId: 'test:mock', title: 'My Chat' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBeTruthy();
      expect(typeof body.id).toBe('string');
    });

    it('fails with 500 when modelId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/conversations',
        payload: {},
      });

      // The DB constraint will fail because modelId is NOT NULL
      expect(res.statusCode).toBe(500);
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
