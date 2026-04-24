import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { createDb, ChatService, ModelRegistry, type ChatChunk, type ChatRequest, type ChatResponse, type ModelAdapter, type VaiDatabase } from '@vai/core';
import { PlatformAuthService } from '../src/auth/platform-auth.js';
import { registerChatRoutes } from '../src/routes/chat.js';

class TestAdapter implements ModelAdapter {
  readonly id = 'test:mock';
  readonly displayName = 'Test Mock';
  readonly supportsStreaming = true;
  readonly supportsToolUse = false;
  lastStreamRequest?: ChatRequest;

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    return {
      message: { role: 'assistant', content: 'Hello world' },
      usage: { promptTokens: 5, completionTokens: 2 },
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

describe('Chat Routes', () => {
  let app: FastifyInstance;
  let db: VaiDatabase;
  let chatService: ChatService;
  let adapter: TestAdapter;
  let baseUrl: string;

  beforeEach(async () => {
    db = createDb(':memory:');
    const registry = new ModelRegistry();
    adapter = new TestAdapter();
    registry.register(adapter);
    chatService = new ChatService(db, registry);

    const auth = new PlatformAuthService(db, {
      enabled: false,
      publicUrl: 'http://localhost:3006',
      appUrl: 'http://localhost:1420',
      sessionCookieName: 'vai_session',
      sessionTtlHours: 24 * 30,
      sessionSecret: 'test-session-secret',
      providers: {
        google: {
          enabled: false,
          scopes: ['openid', 'email', 'profile'],
        },
      },
    });

    app = Fastify({ logger: false });
    await app.register(websocket);
    registerChatRoutes(app, chatService, auth, { ownerEmail: 'owner@test.dev' });
    baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await app.close();
  });

  it('forwards request-level prompt-hardening overrides over websocket', async () => {
    const conversationId = chatService.createConversation('test:mock');
    const wsUrl = `${baseUrl.replace('http://', 'ws://')}/api/chat`;
    const fullText = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      let response = '';
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Timed out waiting for websocket response'));
      }, 5_000);

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({
          conversationId,
          content: 'Design a repo-native answer engine for a large monorepo. Explain signals, guardrails, metrics, and rollout.',
          profile: 'strict',
          responseDepth: 'deep-design-memo',
        }));
      });

      ws.addEventListener('message', (event) => {
        const chunk = JSON.parse(String(event.data)) as
          | { type: 'text_delta'; textDelta?: string }
          | { type: 'done' }
          | { type: 'error'; error: string };

        if (chunk.type === 'text_delta' && chunk.textDelta) {
          response += chunk.textDelta;
        }
        if (chunk.type === 'error') {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(chunk.error));
        }
        if (chunk.type === 'done') {
          clearTimeout(timeout);
          ws.close();
          resolve(response);
        }
      });

      ws.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('WebSocket error'));
      });
    });

    expect(fullText).toBe('Hello world');
    const systemText = adapter.lastStreamRequest?.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n') ?? '';

    expect(systemText).toMatch(/Hardening profile: strict/i);
    expect(systemText).toMatch(/Requested response depth: deep-design-memo/i);
    expect(systemText).toMatch(/Respond with a deeper design memo/i);
  });

  it('auto-creates a conversation and emits conversation_resolved when the id is unknown', async () => {
    const wsUrl = `${baseUrl.replace('http://', 'ws://')}/api/chat`;
    const result = await new Promise<{ resolvedId?: string; fullText: string }>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      let response = '';
      let resolvedId: string | undefined;
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Timed out'));
      }, 5_000);

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({
          conversationId: 'this-id-does-not-exist',
          content: 'hello',
          modelId: 'test:mock',
        }));
      });

      ws.addEventListener('message', (event) => {
        const chunk = JSON.parse(String(event.data)) as
          | { type: 'conversation_resolved'; conversationId?: string }
          | { type: 'text_delta'; textDelta?: string }
          | { type: 'done' }
          | { type: 'error'; error: string };

        if (chunk.type === 'conversation_resolved') {
          resolvedId = chunk.conversationId;
        }
        if (chunk.type === 'text_delta' && chunk.textDelta) {
          response += chunk.textDelta;
        }
        if (chunk.type === 'error') {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(chunk.error));
        }
        if (chunk.type === 'done') {
          clearTimeout(timeout);
          ws.close();
          resolve({ resolvedId, fullText: response });
        }
      });

      ws.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('WebSocket error'));
      });
    });

    expect(result.resolvedId).toBeTruthy();
    expect(result.resolvedId).not.toBe('this-id-does-not-exist');
    expect(result.fullText).toBe('Hello world');
    // The resolved id is now a real conversation in the DB.
    expect(chatService.getConversation(result.resolvedId!)?.modelId).toBe('test:mock');
  });

  it('returns validation error for strict-schema violations over websocket', async () => {
    const conversationId = chatService.createConversation('test:mock');
    const wsUrl = `${baseUrl.replace('http://', 'ws://')}/api/chat`;
    const err = await new Promise<{ error?: string; code?: string }>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Timed out'));
      }, 5_000);

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({
          conversationId,
          content: 'hello',
          notARealField: true,
        }));
      });

      ws.addEventListener('message', (event) => {
        const chunk = JSON.parse(String(event.data)) as { type?: string; error?: string; code?: string };
        if (chunk.type === 'error') {
          clearTimeout(timeout);
          ws.close();
          resolve(chunk);
        }
      });

      ws.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('WebSocket error'));
      });
    });

    expect(err.code).toBe('validation');
    expect(err.error).toBeTruthy();
  });
});