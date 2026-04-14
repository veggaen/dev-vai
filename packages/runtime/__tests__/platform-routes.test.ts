import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createDb, ModelRegistry, type ChatRequest, type ChatResponse, type ChatChunk, type ModelAdapter, type VaiConfig, type VaiDatabase } from '@vai/core';
import { PlatformAuthService } from '../src/auth/platform-auth.js';
import { SandboxManager } from '../src/sandbox/manager.js';
import { registerPlatformRoutes } from '../src/routes/platform.js';

class TestAdapter implements ModelAdapter {
  readonly id = 'test:mock';
  readonly displayName = 'Test Mock';
  readonly provider = 'vai' as const;
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

describe('Platform Routes', () => {
  let app: FastifyInstance;
  let db: VaiDatabase;

  beforeEach(async () => {
    db = createDb(':memory:');
    const registry = new ModelRegistry();
    registry.register(new TestAdapter());

    const config: VaiConfig = {
      port: 3006,
      dbPath: ':memory:',
      dbDriver: 'sqlite',
      databaseUrl: undefined,
      providers: {
        vai: { id: 'vai', enabled: true, defaultModel: 'test:mock' },
        anthropic: { id: 'anthropic', enabled: false },
        openai: { id: 'openai', enabled: false },
        google: { id: 'google', enabled: false },
        local: { id: 'local', enabled: false },
      },
      defaultModelId: 'test:mock',
      fallbackChain: { models: ['test:mock'] },
      routingRules: [{ condition: 'default', modelId: 'test:mock' }],
      maxMonthlySpend: 0,
      maxTokensPerRequest: 16000,
      maxConcurrentRequests: 5,
      maxSandboxes: 5,
      sandboxDocker: false,
      ownerEmail: 'owner@test.dev',
      apiKeys: [],
      authEnabled: false,
      rateLimitPerMinute: 60,
      chatPromptRewrite: {
        enabled: true,
        strategy: 'system-message',
        profile: 'standard',
        responseDepth: 'standard',
        applyToModes: ['chat', 'agent', 'builder', 'plan', 'debate'],
        maxUserMessageChars: 2200,
        rules: {
          disambiguateRepoContext: true,
          groundPredictivePrefetch: true,
          groundAnswerEngine: true,
          hardenArchitectureSketches: true,
        },
      },
      platformAuth: {
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
      },
      enableToolCalling: true,
      maxToolIterations: 10,
      enableUsageTracking: true,
      enableEval: false,
    };

    app = Fastify({ logger: false });
    const auth = new PlatformAuthService(db, config.platformAuth);
    registerPlatformRoutes(app, config, registry, new SandboxManager(), auth);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns shared platform bootstrap metadata for Vite and Vinext shells', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/platform/bootstrap',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.product.defaultFrontend).toBe('vite-web');
    expect(body.product.frontendAlternatives).toContain('vinext-web');
    expect(body.models.defaultModelId).toBe('test:mock');
    expect(body.frontends.some((frontend: { id: string }) => frontend.id === 'vinext-web')).toBe(true);
    expect(body.sandbox.stacks.some((stack: { id: string }) => stack.id === 'vinext')).toBe(true);
    expect(body.workflow.modes).toContain('plan');
    expect(body.models.composition.planned).toBe(true);
    expect(body.auth.enabled).toBe(false);
    expect(body.auth.authenticated).toBe(false);
  });
});