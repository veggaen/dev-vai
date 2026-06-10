import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { createDb, ChatService, ModelRegistry, type ChatChunk, type ChatRequest, type ChatResponse, type ModelAdapter, type VaiDatabase } from '@vai/core';
import { PlatformAuthService } from '../src/auth/platform-auth.js';
import type { ProjectService } from '../src/projects/service.js';
import { registerChatRoutes } from '../src/routes/chat.js';
import { CompanionContextBroker } from '../src/companion-context/broker.js';
import type { SteeringPacket } from '../src/steering/local-steering-worker.js';

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
    const lastUserMessage = [...request.messages].reverse().find((message) => message.role === 'user')?.content ?? '';
    if (lastUserMessage.includes('slow')) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
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
  let contextBroker: CompanionContextBroker;
  let grokPrompts: string[];
  let workspaceStatusReads: number;
  let workspaceStatusError: Error | null;
  let localSteeringJobs: Array<{ conversationId: string; content: string; source: string }>;
  let localSteeringDelayMs: number;
  let localSteeringVisibleWaitMs: number;
  let localSteeringPacket: SteeringPacket | null;
  let localSteeringError: Error | null;
  let baseUrl: string;

  beforeEach(async () => {
    db = createDb(':memory:');
    const registry = new ModelRegistry();
    adapter = new TestAdapter();
    registry.register(adapter);
    chatService = new ChatService(db, registry);
    contextBroker = new CompanionContextBroker();
    grokPrompts = [];
    workspaceStatusReads = 0;
    workspaceStatusError = null;
    localSteeringJobs = [];
    localSteeringDelayMs = 0;
    localSteeringVisibleWaitMs = 25;
    localSteeringError = null;
    localSteeringPacket = {
      schemaVersion: 1,
      actorId: 'local:test-local-steering',
      promptHash: '1234567890abcdef',
      taskShape: 'debugging',
      qualityContract: {
        answerLength: 'structured',
        mustBeGuiding: true,
        mustBeCurrent: false,
        mustUseJson: false,
        shouldAskClarifyingQuestion: false,
      },
      routeGuidance: [{
        signal: 'prefer',
        handler: 'conversation-reasoning',
        reason: 'The user is asking for debugging guidance.',
      }],
      riskFlags: ['generic-fallback-risk'],
      retrievalHints: ['blank React page'],
      confidence: 0.81,
    };

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
    const projects = {
      canReadSandbox: () => false,
      canWriteSandbox: () => false,
    };
    registerChatRoutes(app, chatService, auth, projects as unknown as ProjectService, {
      ownerEmail: 'owner@test.dev',
      contextBroker,
      contextRequestTimeoutMs: 20,
      grokFriendClient: {
        ask: async (prompt) => {
          grokPrompts.push(prompt);
          return {
            requestId: 'test-grok-request',
            source: 'grok-cli-friend-channel',
            capturedAt: '2026-06-02T15:00:00.000Z',
            durationMs: 12,
            response: 'One grounded critique from Grok.',
          };
        },
      },
      workspaceStatusReader: {
        read: async () => {
          workspaceStatusReads += 1;
          if (workspaceStatusError) {
            throw workspaceStatusError;
          }
          return {
            source: 'git-status-readonly',
            capturedAt: '2026-06-02T16:00:00.000Z',
            durationMs: 7,
            workspaceRoot: 'C:\\workspace',
            entries: [
              ' M packages/runtime/src/routes/chat.ts',
              '?? packages/runtime/src/workspace-status/reader.ts',
            ],
          };
        },
      },
      localSteeringWorker: {
        modelId: 'test-local-steering',
        get visibleWaitMs() {
          return localSteeringVisibleWaitMs;
        },
        isEnabled: () => true,
        run: async (input) => {
          localSteeringJobs.push({
            conversationId: input.conversationId,
            content: input.content,
            source: input.source,
          });
          if (localSteeringDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, localSteeringDelayMs));
          }
          if (localSteeringError) throw localSteeringError;
          return localSteeringPacket;
        },
      },
    });
    baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    await app.close();
  });

  async function sendTextTurnChunks(content: string): Promise<Array<Record<string, unknown>>> {
    const conversationId = chatService.createConversation('test:mock');
    const wsUrl = `${baseUrl.replace('http://', 'ws://')}/api/chat`;
    return await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const chunks: Array<Record<string, unknown>> = [];
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Timed out waiting for websocket response'));
      }, 5_000);

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ conversationId, content }));
      });

      ws.addEventListener('message', (event) => {
        const chunk = JSON.parse(String(event.data)) as Record<string, unknown> & { type: string; error?: string };
        chunks.push(chunk);
        if (chunk.type === 'error') {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(chunk.error ?? 'Unknown websocket error'));
        }
        if (chunk.type === 'done') {
          clearTimeout(timeout);
          ws.close();
          resolve(chunks);
        }
      });

      ws.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('WebSocket error'));
      });
    });
  }

  async function sendTextTurn(content: string): Promise<string> {
    const chunks = await sendTextTurnChunks(content);
    return chunks
      .filter((chunk) => chunk.type === 'text_delta' && typeof chunk.textDelta === 'string')
      .map((chunk) => chunk.textDelta)
      .join('');
  }

  it('does not contain a synthetic live editor answer in route source', () => {
    const routeSource = readFileSync(new URL('../src/routes/chat.ts', import.meta.url), 'utf8');

    expect(routeSource).not.toMatch(/apps\/desktop\/src\/App\.tsx|actual context fetch|live-context-short-circuit/i);
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

  it('publishes structured local advice before done without changing the response', async () => {
    const chunks = await sendTextTurnChunks('hello from the local steering test');
    const fullText = chunks
      .filter((chunk) => chunk.type === 'text_delta')
      .map((chunk) => chunk.textDelta)
      .join('');
    const advisorChunk = chunks.find((chunk) => {
      const progress = chunk.progress as { advisor?: { state?: string } } | undefined;
      return chunk.type === 'progress' && progress?.advisor?.state === 'ready';
    });

    expect(fullText).toBe('Hello world');
    expect(localSteeringJobs).toHaveLength(1);
    expect(localSteeringJobs[0].content).toBe('hello from the local steering test');
    expect(localSteeringJobs[0].source).toBe('websocket');
    expect(advisorChunk).toMatchObject({
      type: 'progress',
      progress: {
        stage: 'local-steering',
        status: 'done',
        advisor: {
          state: 'ready',
          modelId: 'test-local-steering',
          taskShape: 'debugging',
          riskFlags: ['generic-fallback-risk'],
          confidence: 0.81,
        },
      },
    });
    expect(chunks.indexOf(advisorChunk!)).toBeLessThan(chunks.findIndex((chunk) => chunk.type === 'done'));
  });

  it('bounds advisor latency and records when advice continues in the background', async () => {
    localSteeringDelayMs = 80;
    localSteeringVisibleWaitMs = 5;

    const chunks = await sendTextTurnChunks('give me one quick fact');
    const advisorChunk = chunks.find((chunk) => {
      const progress = chunk.progress as { advisor?: { state?: string } } | undefined;
      return chunk.type === 'progress' && progress?.advisor?.state === 'background';
    });

    expect(advisorChunk).toMatchObject({
      progress: {
        label: 'Local model friend continued in the background',
        advisor: {
          state: 'background',
          modelId: 'test-local-steering',
        },
      },
    });
    expect(chunks.at(-1)?.type).toBe('done');
  });

  it('does not forge a live editor filename in the websocket route', async () => {
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
          content: 'what file do I have open right now?',
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

    expect(fullText).toMatch(/live editor file unavailable/i);
    expect(fullText).not.toMatch(/apps\/desktop\/src\/App\.tsx|actual context fetch|adapter called/i);
    expect(adapter.lastStreamRequest).toBeUndefined();
  });

  it('returns a fresh attached editor filename with timestamped provenance', async () => {
    const conversationId = chatService.createConversation('test:mock');
    const wsUrl = `${baseUrl.replace('http://', 'ws://')}/api/chat`;
    const capturedAt = new Date().toISOString();
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
          content: 'what file do I have open right now?',
          editorContext: {
            source: 'vscode-capture-adapter',
            capturedAt,
            openFile: 'packages/core/src/chat/service.ts',
          },
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

    expect(fullText).toMatch(/live editor file/i);
    expect(fullText).toMatch(/packages\/core\/src\/chat\/service\.ts/i);
    expect(fullText).toContain('vscode-capture-adapter');
    expect(fullText).toContain(capturedAt);
    expect(adapter.lastStreamRequest).toBeUndefined();
  });

  it('requests and incorporates a fresh editor filename from the companion broker', async () => {
    const conversationId = chatService.createConversation('test:mock');
    const wsUrl = `${baseUrl.replace('http://', 'ws://')}/api/chat`;
    const capturedAt = new Date().toISOString();
    const responder = setInterval(() => {
      const workItem = contextBroker.poll({ clientId: 'test-vscode-client' });
      if (!workItem) return;

      clearInterval(responder);
      contextBroker.respond(workItem.requestId, 'test-vscode-client', {
        source: 'vscode-capture-adapter',
        capturedAt,
        openFile: 'packages/runtime/src/routes/chat.ts',
      });
    }, 2);

    try {
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
            content: 'what file do I have open right now?',
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

      expect(fullText).toMatch(/live editor file/i);
      expect(fullText).toMatch(/packages\/runtime\/src\/routes\/chat\.ts/i);
      expect(fullText).toContain('vscode-capture-adapter');
      expect(fullText).toContain(capturedAt);
      expect(adapter.lastStreamRequest).toBeUndefined();
    } finally {
      clearInterval(responder);
    }
  });

  it('calls Grok only for an explicit friend-channel request and attributes the result', async () => {
    const fullText = await sendTextTurn('Ask Grok: give one concise critique of this bridge.');

    expect(grokPrompts).toEqual(['give one concise critique of this bridge.']);
    expect(fullText).toMatch(/grok friend-channel result/i);
    expect(fullText).toContain('One grounded critique from Grok.');
    expect(fullText).toContain('grok-cli-friend-channel');
    expect(fullText).toContain('2026-06-02T15:00:00.000Z');
    expect(fullText).toContain('test-grok-request');
    expect(adapter.lastStreamRequest).toBeUndefined();
  });

  it('does not call Grok for a proof question without an attributed result', async () => {
    const fullText = await sendTextTurn('Did you actually call Grok this turn? Give timestamped proof.');

    expect(grokPrompts).toEqual([]);
    expect(fullText).toMatch(/^\*\*No\.\*\*/);
    expect(fullText).toMatch(/cannot claim that a Grok call completed/i);
    expect(adapter.lastStreamRequest).toBeUndefined();
  });

  it('returns an attributed read-only workspace delta without invoking the model adapter', async () => {
    const fullText = await sendTextTurn('Which files changed in my repo right now?');

    expect(workspaceStatusReads).toBe(1);
    expect(fullText).toMatch(/live workspace delta/i);
    expect(fullText).toContain(' M packages/runtime/src/routes/chat.ts');
    expect(fullText).toContain('?? packages/runtime/src/workspace-status/reader.ts');
    expect(fullText).toContain('git-status-readonly');
    expect(fullText).toContain('C:\\workspace');
    expect(fullText).toContain('2026-06-02T16:00:00.000Z');
    expect(adapter.lastStreamRequest).toBeUndefined();
  });

  it('reports workspace-delta read failures without claiming live evidence', async () => {
    workspaceStatusError = new Error('git status timed out');

    const fullText = await sendTextTurn('Which files changed in my repo right now?');

    expect(workspaceStatusReads).toBe(1);
    expect(fullText).toMatch(/live workspace delta unavailable/i);
    expect(fullText).toMatch(/git status timed out/i);
    expect(fullText).not.toContain('captured `');
    expect(adapter.lastStreamRequest).toBeUndefined();
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

  it('accepts local dev auth bypass over websocket query when platform auth is enabled', async () => {
    const localDb = createDb(':memory:');
    const registry = new ModelRegistry();
    const localAdapter = new TestAdapter();
    registry.register(localAdapter);
    const localChatService = new ChatService(localDb, registry);
    const auth = new PlatformAuthService(localDb, {
      enabled: true,
      publicUrl: 'http://localhost:3006',
      appUrl: 'http://localhost:5173',
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
    const localApp = Fastify({ logger: false });
    await localApp.register(websocket);
    const projects = {
      canReadSandbox: () => false,
      canWriteSandbox: () => false,
    };
    registerChatRoutes(localApp, localChatService, auth, projects as unknown as ProjectService, { ownerEmail: 'owner@test.dev' });
    const localBaseUrl = await localApp.listen({ port: 0, host: '127.0.0.1' });

    try {
      const conversationId = localChatService.createConversation('test:mock', undefined, 'chat', '__local_dev_user__');
      const wsUrl = `${localBaseUrl.replace('http://', 'ws://')}/api/chat?devAuthBypass=1`;
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
            content: 'hello',
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
    } finally {
      await localApp.close();
    }
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

  it('rejects overlapping websocket turns for the same conversation', async () => {
    const conversationId = chatService.createConversation('test:mock');
    const wsUrl = `${baseUrl.replace('http://', 'ws://')}/api/chat`;
    const err = await new Promise<{ error?: string; code?: string }>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Timed out waiting for conflict response'));
      }, 5_000);

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({
          conversationId,
          content: 'slow first message',
        }));
        setTimeout(() => {
          ws.send(JSON.stringify({
            conversationId,
            content: 'second message',
          }));
        }, 10);
      });

      ws.addEventListener('message', (event) => {
        const chunk = JSON.parse(String(event.data)) as { type?: string; error?: string; code?: string };
        if (chunk.type === 'error' && chunk.code === 'conflict') {
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

    expect(err.code).toBe('conflict');
    expect(err.error).toMatch(/already in progress/i);
  });
});
