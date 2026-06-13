import { describe, expect, it } from 'vitest';
import {
  buildDiscoveredModelProfile,
  discoverOllamaModels,
  extractContextWindow,
  parseDiscoveredModel,
  parseParameterSize,
  rankDiscoveredModels,
  resolveEffectiveLocalChain,
  type DiscoveredOllamaModel,
} from '../src/models/ollama-discovery.js';
import { resolveLocalRuntimeOptions, stripThinkingBlocks } from '../src/models/provider-adapters.js';

function discovered(overrides: Partial<DiscoveredOllamaModel> & { name: string }): DiscoveredOllamaModel {
  return {
    sizeBytes: 0,
    parameterB: null,
    contextWindow: null,
    thinking: false,
    toolUse: false,
    vision: false,
    embedding: false,
    ...overrides,
  };
}

describe('parseParameterSize', () => {
  it('parses billions and millions', () => {
    expect(parseParameterSize('8.2B')).toBe(8.2);
    expect(parseParameterSize('3B')).toBe(3);
    expect(parseParameterSize('770M')).toBe(0.77);
  });

  it('returns null for garbage', () => {
    expect(parseParameterSize(undefined)).toBeNull();
    expect(parseParameterSize('huge')).toBeNull();
  });
});

describe('extractContextWindow', () => {
  it('finds the architecture-keyed context length without hardcoding families', () => {
    expect(extractContextWindow({ 'qwen3.context_length': 40960, 'qwen3.embedding_length': 4096 })).toBe(40960);
    expect(extractContextWindow({ 'futurearch.context_length': 1_000_000 })).toBe(1_000_000);
  });

  it('returns null when absent', () => {
    expect(extractContextWindow(undefined)).toBeNull();
    expect(extractContextWindow({ 'qwen3.embedding_length': 4096 })).toBeNull();
  });
});

describe('parseDiscoveredModel', () => {
  it('merges tag + show metadata into capability flags', () => {
    const model = parseDiscoveredModel(
      { name: 'qwen3:8b', size: 5_200_000_000, details: { parameter_size: '8.2B' } },
      {
        capabilities: ['completion', 'tools', 'thinking'],
        model_info: { 'qwen3.context_length': 40960 },
      },
    );
    expect(model).toEqual({
      name: 'qwen3:8b',
      sizeBytes: 5_200_000_000,
      parameterB: 8.2,
      contextWindow: 40960,
      thinking: true,
      toolUse: true,
      vision: false,
      embedding: false,
    });
  });

  it('degrades to tag-only metadata when /api/show failed', () => {
    const model = parseDiscoveredModel({ name: 'qwen2.5:7b', size: 4_700_000_000 }, null);
    expect(model?.name).toBe('qwen2.5:7b');
    expect(model?.contextWindow).toBeNull();
    expect(model?.thinking).toBe(false);
  });

  it('rejects unnamed tags', () => {
    expect(parseDiscoveredModel({ size: 1 }, null)).toBeNull();
  });
});

describe('rankDiscoveredModels', () => {
  it('ranks by parameter count and excludes embedding-only models', () => {
    const ranked = rankDiscoveredModels([
      discovered({ name: 'small', parameterB: 3 }),
      discovered({ name: 'embed', parameterB: 0.3, embedding: true }),
      discovered({ name: 'big', parameterB: 8.2 }),
    ]);
    expect(ranked.map((m) => m.name)).toEqual(['big', 'small']);
  });
});

describe('buildDiscoveredModelProfile', () => {
  it('uses real context window + thinking capability', () => {
    const profile = buildDiscoveredModelProfile(
      discovered({ name: 'qwen3:8b', parameterB: 8.2, contextWindow: 40960, thinking: true }),
    );
    expect(profile.id).toBe('local:qwen3:8b');
    expect(profile.contextWindow).toBe(40960);
    expect(profile.capabilities.extendedThinking).toBe(true);
    expect(profile.speedTier).toBe('medium');
  });

  it('defaults conservatively when metadata is missing', () => {
    const profile = buildDiscoveredModelProfile(discovered({ name: 'mystery:latest' }));
    expect(profile.contextWindow).toBe(32768);
    expect(profile.capabilities.extendedThinking).toBe(false);
  });
});

describe('resolveEffectiveLocalChain', () => {
  it('keeps the chain untouched when the configured local model is installed', () => {
    expect(resolveEffectiveLocalChain(['local:qwen3:8b', 'vai:v0'], ['local:qwen3:8b', 'local:qwen2.5:3b']))
      .toEqual(['local:qwen3:8b', 'vai:v0']);
  });

  it('replaces a stale local entry with the best installed model', () => {
    expect(resolveEffectiveLocalChain(['local:qwen3:8b', 'vai:v0'], ['local:qwen2.5:7b', 'local:qwen2.5:3b']))
      .toEqual(['local:qwen2.5:7b', 'vai:v0']);
  });

  it('drops the stale entry without duplicating an already-present replacement', () => {
    expect(resolveEffectiveLocalChain(
      ['local:gone:1b', 'local:qwen2.5:7b', 'vai:v0'],
      ['local:qwen2.5:7b'],
    )).toEqual(['local:qwen2.5:7b', 'vai:v0']);
  });

  it('leaves non-local entries alone', () => {
    expect(resolveEffectiveLocalChain(['anthropic:claude-sonnet-4-20250514', 'vai:v0'], ['local:qwen3:8b']))
      .toEqual(['anthropic:claude-sonnet-4-20250514', 'vai:v0']);
  });
});

describe('discoverOllamaModels', () => {
  it('returns null when the daemon is unreachable', async () => {
    const result = await discoverOllamaModels('http://localhost:11434', {
      fetchImpl: (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch,
    });
    expect(result).toBeNull();
  });

  it('discovers models and tolerates per-model show failures', async () => {
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith('/api/tags')) {
        return new Response(JSON.stringify({
          models: [
            { name: 'qwen3:8b', size: 5_200_000_000, details: { parameter_size: '8.2B' } },
            { name: 'qwen2.5:3b', size: 1_900_000_000, details: { parameter_size: '3.1B' } },
          ],
        }));
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
      if (body.model === 'qwen3:8b') {
        return new Response(JSON.stringify({
          capabilities: ['completion', 'tools', 'thinking'],
          model_info: { 'qwen3.context_length': 40960 },
        }));
      }
      throw new Error('show failed');
    }) as unknown as typeof fetch;

    const result = await discoverOllamaModels('http://localhost:11434/', { fetchImpl });
    expect(result?.map((m) => m.name)).toEqual(['qwen3:8b', 'qwen2.5:3b']);
    expect(result?.[0].thinking).toBe(true);
    expect(result?.[0].contextWindow).toBe(40960);
    expect(result?.[1].parameterB).toBe(3.1);
  });
});

describe('resolveLocalRuntimeOptions', () => {
  it('defaults to a 16k context capped by the model window, 30m keep-alive', () => {
    expect(resolveLocalRuntimeOptions(40960, {})).toEqual({ numCtx: 16384, keepAlive: '30m' });
    expect(resolveLocalRuntimeOptions(8192, {})).toEqual({ numCtx: 8192, keepAlive: '30m' });
  });

  it('honors env overrides but never exceeds the model window', () => {
    expect(resolveLocalRuntimeOptions(40960, { VAI_LOCAL_NUM_CTX: '32768', VAI_LOCAL_KEEP_ALIVE: '-1' }))
      .toEqual({ numCtx: 32768, keepAlive: '-1' });
    expect(resolveLocalRuntimeOptions(8192, { VAI_LOCAL_NUM_CTX: '32768' }).numCtx).toBe(8192);
    expect(resolveLocalRuntimeOptions(40960, { VAI_LOCAL_NUM_CTX: 'garbage' }).numCtx).toBe(16384);
  });
});

describe('stripThinkingBlocks', () => {
  it('removes closed think blocks', () => {
    expect(stripThinkingBlocks('<think>chain of thought</think>The answer is 4.')).toBe('The answer is 4.');
  });

  it('removes an unterminated think block (truncated output)', () => {
    expect(stripThinkingBlocks('Partial answer.<think>got cut off')).toBe('Partial answer.');
  });

  it('leaves normal content untouched', () => {
    expect(stripThinkingBlocks('Plain answer with <code> tags.')).toBe('Plain answer with <code> tags.');
  });
});
