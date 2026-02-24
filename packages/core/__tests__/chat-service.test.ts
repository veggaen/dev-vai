import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../src/db/client.js';
import { ChatService } from '../src/chat/service.js';
import { ModelRegistry } from '../src/models/adapter.js';
import type { ModelAdapter, ChatRequest, ChatResponse, ChatChunk } from '../src/models/adapter.js';
import type { VaiDatabase } from '../src/db/client.js';

class MockAdapter implements ModelAdapter {
  readonly id = 'mock:test';
  readonly displayName = 'Mock Model';
  readonly supportsStreaming = true;
  readonly supportsToolUse = false;

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    return {
      message: { role: 'assistant', content: 'Mock response' },
      usage: { promptTokens: 10, completionTokens: 5 },
      finishReason: 'stop',
    };
  }

  async *chatStream(_request: ChatRequest): AsyncIterable<ChatChunk> {
    yield { type: 'text_delta', textDelta: 'Hello ' };
    yield { type: 'text_delta', textDelta: 'from ' };
    yield { type: 'text_delta', textDelta: 'VeggaAI!' };
    yield { type: 'done', usage: { promptTokens: 10, completionTokens: 3 } };
  }
}

describe('ChatService', () => {
  let db: VaiDatabase;
  let chatService: ChatService;

  beforeEach(() => {
    db = createDb(':memory:');
    const registry = new ModelRegistry();
    registry.register(new MockAdapter());
    chatService = new ChatService(db, registry);
  });

  it('creates a conversation', () => {
    const id = chatService.createConversation('mock:test', 'Test Chat');
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  it('lists conversations', () => {
    chatService.createConversation('mock:test', 'Chat 1');
    chatService.createConversation('mock:test', 'Chat 2');

    const list = chatService.listConversations();
    expect(list).toHaveLength(2);
  });

  it('sends a message and streams response', async () => {
    const convId = chatService.createConversation('mock:test');

    const chunks: ChatChunk[] = [];
    for await (const chunk of chatService.sendMessage(convId, 'Hi')) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);

    const textChunks = chunks.filter((c) => c.type === 'text_delta');
    expect(textChunks.length).toBe(3);

    const fullText = textChunks.map((c) => c.textDelta).join('');
    expect(fullText).toBe('Hello from VeggaAI!');
  });

  it('persists user and assistant messages after streaming', async () => {
    const convId = chatService.createConversation('mock:test');

    // Drain the stream
    for await (const _chunk of chatService.sendMessage(convId, 'Hi')) {
      // consume
    }

    const msgs = chatService.getMessages(convId);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toBe('Hi');
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].content).toBe('Hello from VeggaAI!');
  });

  it('throws when conversation not found', async () => {
    await expect(async () => {
      for await (const _chunk of chatService.sendMessage('nonexistent', 'Hi')) {
        // consume
      }
    }).rejects.toThrow('Conversation not found');
  });

  it('deletes a conversation and its messages', async () => {
    const convId = chatService.createConversation('mock:test');

    for await (const _chunk of chatService.sendMessage(convId, 'Hi')) {
      // consume
    }

    chatService.deleteConversation(convId);

    const list = chatService.listConversations();
    expect(list).toHaveLength(0);

    const msgs = chatService.getMessages(convId);
    expect(msgs).toHaveLength(0);
  });
});
