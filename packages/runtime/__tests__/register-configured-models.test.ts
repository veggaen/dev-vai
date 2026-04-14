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
      openai: { id: 'openai', enabled: true, apiKey: 'test-key', defaultModel: 'gpt-4o' },
      google: { id: 'google', enabled: false, defaultModel: 'gemini-2.5-flash' },
      local: { id: 'local', enabled: true, baseUrl: 'http://localhost:11434', defaultModel: 'llama3.1' },
    },
    defaultModelId: 'anthropic:claude-sonnet-4-20250514',
    fallbackChain: { models: ['anthropic:claude-sonnet-4-20250514', 'openai:gpt-4o', 'vai:v0'] },
    routingRules: [{ condition: 'default', modelId: 'anthropic:claude-sonnet-4-20250514' }],
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
}

describe('registerConfiguredModels', () => {
  it('registers all known profiles for enabled providers and one local model', () => {
    const models = new ModelRegistry();
    const registered = registerConfiguredModels(createConfig(), models);

    expect(registered).toContain('anthropic:claude-sonnet-4-20250514');
    expect(registered).toContain('openai:gpt-4o');
    expect(registered).toContain('local:llama3.1');
    expect(models.listByProvider('anthropic')).toHaveLength(3);
    expect(models.listByProvider('openai')).toHaveLength(3);
    expect(models.listByProvider('google')).toHaveLength(0);
  });
});