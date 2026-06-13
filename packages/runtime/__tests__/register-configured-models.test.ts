import { describe, expect, it } from 'vitest';
import { ModelRegistry, type VaiConfig } from '@vai/core';
import { registerConfiguredModels } from '../src/models/register-configured-models.js';

function createConfig(): VaiConfig {
  return {
    port: 3006,
    dbPath: ':memory:',
    dbDriver: 'sqlite',
    providers: {
      vai: { id: 'vai', enabled: true },
      anthropic: { id: 'anthropic', enabled: true, apiKey: 'test-key', defaultModel: 'claude-sonnet-4-20250514' },
      openai: { id: 'openai', enabled: true, apiKey: 'test-key', defaultModel: 'gpt-5.4-mini' },
      google: { id: 'google', enabled: false, defaultModel: 'gemini-2.5-flash' },
      local: { id: 'local', enabled: true, baseUrl: 'http://localhost:11434', defaultModel: 'llama3.1' },
    },
    defaultModelId: 'anthropic:claude-sonnet-4-20250514',
    fallbackChain: { models: ['anthropic:claude-sonnet-4-20250514', 'openai:gpt-5.4-mini', 'openai:gpt-5.3-codex', 'openai:gpt-5.4', 'vai:v0'] },
    routingRules: [{ condition: 'default', modelId: 'anthropic:claude-sonnet-4-20250514' }],
    maxMonthlySpend: 0,
    maxTokensPerRequest: 16000,
    maxConcurrentRequests: 5,
    maxSandboxes: 5,
    sandboxDocker: false,
    ownerEmail: 'owner@test.dev',
    adminEmails: [],
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
    },
    enableToolCalling: true,
    maxToolIterations: 10,
    enableUsageTracking: true,
    enableEval: false,
  };
}

describe('registerConfiguredModels', () => {
  it('registers all known profiles for enabled providers and the static local model when discovery is unavailable', async () => {
    const models = new ModelRegistry();
    const { registered, rankedLocalIds } = await registerConfiguredModels(createConfig(), models, {
      discover: async () => null,
    });

    expect(registered).toContain('anthropic:claude-sonnet-4-20250514');
    expect(registered).toContain('openai:gpt-5.4-mini');
    expect(registered).toContain('openai:gpt-5.3-codex');
    expect(registered).toContain('local:llama3.1');
    expect(rankedLocalIds).toEqual([]);
    expect(models.listByProvider('anthropic')).toHaveLength(3);
    expect(models.listByProvider('openai')).toHaveLength(7);
    expect(models.listByProvider('google')).toHaveLength(0);
  });

  it('registers every discovered local model ranked best-first with real capabilities', async () => {
    const models = new ModelRegistry();
    const { registered, rankedLocalIds } = await registerConfiguredModels(createConfig(), models, {
      discover: async () => [
        {
          name: 'qwen2.5:3b',
          sizeBytes: 1_900_000_000,
          parameterB: 3.1,
          contextWindow: null,
          thinking: false,
          toolUse: false,
          vision: false,
          embedding: false,
        },
        {
          name: 'qwen3:8b',
          sizeBytes: 5_200_000_000,
          parameterB: 8.2,
          contextWindow: 40960,
          thinking: true,
          toolUse: true,
          vision: false,
          embedding: false,
        },
      ],
    });

    expect(rankedLocalIds).toEqual(['local:qwen3:8b', 'local:qwen2.5:3b']);
    expect(registered).toContain('local:qwen3:8b');
    // configured llama3.1 is not installed → not registered, only a warning
    expect(registered).not.toContain('local:llama3.1');
    const qwen3 = models.get('local:qwen3:8b');
    expect(qwen3.contextWindow).toBe(40960);
    expect(qwen3.capabilities.extendedThinking).toBe(true);
  });
});
