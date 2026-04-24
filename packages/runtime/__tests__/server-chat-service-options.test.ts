import { describe, expect, it, vi } from 'vitest';
import type { VaiConfig, IngestPipeline, VaiEngine } from '@vai/core';
import { buildChatServiceOptions, getDefaultAllowedOrigins } from '../src/server.js';

function createChatConfig(): Pick<VaiConfig, 'chatPromptRewrite' | 'fallbackChain'> {
  return {
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
    fallbackChain: {
      models: ['anthropic:claude-sonnet-4-20250514', 'openai:gpt-4o', 'vai:v0'],
    },
  };
}

describe('buildChatServiceOptions', () => {
  it('passes the configured fallback chain into live chat service options and logs retrieval quality', () => {
    const config = createChatConfig();
    const retrieved = [
      { text: 'Docker is a container platform.', source: 'bootstrap:test', score: 0.91 },
    ];
    const retrieveRelevant = vi.fn(() => retrieved);
    const logRetrievalQuality = vi.fn();

    const options = buildChatServiceOptions(
      config,
      { retrieveRelevant } as Pick<VaiEngine, 'retrieveRelevant'>,
      { logRetrievalQuality } as Pick<IngestPipeline, 'logRetrievalQuality'>,
    );

    expect(options.promptRewrite).toBe(config.chatPromptRewrite);
    expect(options.vaiFallbackChain).toEqual(config.fallbackChain.models);
    expect(options.retrieveKnowledge?.('what is docker', 4)).toEqual(retrieved);
    expect(retrieveRelevant).toHaveBeenCalledWith('what is docker', 4);
    expect(logRetrievalQuality).toHaveBeenCalledWith('what is docker', retrieved, 'chat');
  });
});

describe('getDefaultAllowedOrigins', () => {
  it('trusts localhost and loopback dev desktop origins by default', () => {
    const origins = getDefaultAllowedOrigins(3006);

    expect(origins).toContain('http://localhost:5173');
    expect(origins).toContain('http://127.0.0.1:5173');
    expect(origins).toContain('http://localhost:3006');
    expect(origins).toContain('http://127.0.0.1:3006');
    expect(origins).toContain('tauri://localhost');
  });

  it('uses the configured runtime port for runtime loopback origins', () => {
    const origins = getDefaultAllowedOrigins(4010);

    expect(origins).toContain('http://localhost:4010');
    expect(origins).toContain('http://127.0.0.1:4010');
    expect(origins).not.toContain('http://localhost:3006');
  });
});
