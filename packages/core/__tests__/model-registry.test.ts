import { describe, it, expect } from 'vitest';
import { ModelRegistry } from '../src/models/adapter.js';
import type { ModelAdapter, ChatRequest, ChatResponse, ChatChunk } from '../src/models/adapter.js';

class FakeAdapter implements ModelAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly supportsStreaming = true;
  readonly supportsToolUse = false;

  constructor(id: string, name: string) {
    this.id = id;
    this.displayName = name;
  }

  async chat(_req: ChatRequest): Promise<ChatResponse> {
    return {
      message: { role: 'assistant', content: 'ok' },
      usage: { promptTokens: 0, completionTokens: 0 },
      finishReason: 'stop',
    };
  }

  async *chatStream(_req: ChatRequest): AsyncIterable<ChatChunk> {
    yield { type: 'done' };
  }
}

describe('ModelRegistry', () => {
  it('registers and retrieves adapters', () => {
    const registry = new ModelRegistry();
    const adapter = new FakeAdapter('test:model', 'Test Model');
    registry.register(adapter);

    expect(registry.get('test:model')).toBe(adapter);
    expect(registry.has('test:model')).toBe(true);
  });

  it('lists all registered adapters', () => {
    const registry = new ModelRegistry();
    registry.register(new FakeAdapter('a', 'A'));
    registry.register(new FakeAdapter('b', 'B'));

    const list = registry.list();
    expect(list).toHaveLength(2);
  });

  it('throws when adapter not found', () => {
    const registry = new ModelRegistry();
    expect(() => registry.get('nonexistent')).toThrow('Model adapter not found');
  });
});
