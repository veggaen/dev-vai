import { describe, it, expect, vi, afterEach } from 'vitest';
import { LocalOpenAICompatibleAdapter } from './provider-adapters.js';
import type { ModelProfile, ProviderConfig } from '../config/types.js';

/**
 * Anti-crash contract: a per-call `keepAlive` on a LOCAL chat request must override the
 * adapter's default residency, so council members can ask the daemon to evict their model
 * promptly after their turn (only one council model resident at a time on a single GPU).
 */

const profile: ModelProfile = {
  id: 'local:qwen2.5:7b',
  provider: 'local',
  modelName: 'qwen2.5:7b',
  displayName: 'qwen2.5:7b',
  description: 'test',
  contextWindow: 32768,
  maxOutputTokens: 8192,
  capabilities: {
    streaming: false, toolUse: false, vision: false, extendedThinking: false,
    embeddings: false, structuredOutput: false, systemPrompts: true, multiTurn: true,
  },
  cost: { inputPer1M: 0, outputPer1M: 0 },
  speedTier: 'medium',
  qualityTier: 'local',
};
const provider: ProviderConfig = { id: 'local', enabled: true, baseUrl: 'http://localhost:11434', defaultModel: 'qwen2.5:7b' };

function stubFetchCapturingBody(): () => Record<string, unknown> {
  let captured: Record<string, unknown> = {};
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    captured = JSON.parse(String(init.body));
    return {
      ok: true,
      json: async () => ({ message: { content: 'ok' }, prompt_eval_count: 1, eval_count: 1 }),
    } as Response;
  }));
  return () => captured;
}

describe('LocalOpenAICompatibleAdapter keep_alive', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends a per-call keepAlive when provided (council eviction)', async () => {
    const body = stubFetchCapturingBody();
    const adapter = new LocalOpenAICompatibleAdapter(profile, provider);
    await adapter.chat({ messages: [{ role: 'user', content: 'hi' }], keepAlive: '20s' });
    expect(body().keep_alive).toBe('20s');
  });

  it('falls back to the adapter default keep_alive when no per-call value (hot path)', async () => {
    const body = stubFetchCapturingBody();
    const adapter = new LocalOpenAICompatibleAdapter(profile, provider);
    await adapter.chat({ messages: [{ role: 'user', content: 'hi' }] });
    // default is '30m' unless VAI_LOCAL_KEEP_ALIVE overrides it
    expect(body().keep_alive).toBe(process.env.VAI_LOCAL_KEEP_ALIVE?.trim() || '30m');
  });
});
