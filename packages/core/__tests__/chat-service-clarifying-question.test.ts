import { describe, expect, it } from 'vitest';
import { ChatService } from '../src/chat/service.js';
import { createDb } from '../src/db/client.js';
import { ModelRegistry, type ChatChunk, type ChatRequest, type ChatResponse, type ModelAdapter } from '../src/models/adapter.js';

class TrackingAdapter implements ModelAdapter {
  readonly id = 'mock:tracking';
  readonly displayName = 'Tracking Model';
  readonly supportsStreaming = true;
  readonly supportsToolUse = false;
  streamCalls = 0;

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    return {
      message: { role: 'assistant', content: 'unexpected model response' },
      usage: { promptTokens: 1, completionTokens: 1 },
      finishReason: 'stop',
    };
  }

  async *chatStream(_request: ChatRequest): AsyncIterable<ChatChunk> {
    this.streamCalls += 1;
    yield { type: 'text_delta', textDelta: 'unexpected model response' };
    yield { type: 'done', usage: { promptTokens: 1, completionTokens: 1 } };
  }
}

describe('ChatService clarifying question discipline', () => {
  it('asks one endpoint question before dispatching a bridge proposal', async () => {
    const registry = new ModelRegistry();
    const adapter = new TrackingAdapter();
    registry.register(adapter);
    const service = new ChatService(createDb(':memory:'), registry);
    const conversationId = service.createConversation(adapter.id);
    const chunks: ChatChunk[] = [];

    for await (const chunk of service.sendMessage(
      conversationId,
      'I want Vai to bridge humans, AI, and tools. Ask me the single question whose answer would most reduce uncertainty before you propose the next implementation.',
    )) {
      chunks.push(chunk);
    }

    const response = chunks
      .filter((chunk) => chunk.type === 'text_delta')
      .map((chunk) => chunk.textDelta)
      .join('');

    expect(response).toBe(
      'Which exact two endpoints should Vai connect first, and what concrete message must travel between them end to end?',
    );
    expect(response.match(/\?/g)).toHaveLength(1);
    expect(adapter.streamCalls).toBe(0);
  });

  it('answers workspace-delta questions before chat-history reasoning or model dispatch', async () => {
    const registry = new ModelRegistry();
    const adapter = new TrackingAdapter();
    registry.register(adapter);
    const service = new ChatService(createDb(':memory:'), registry);
    const conversationId = service.createConversation(adapter.id);
    const chunks: ChatChunk[] = [];

    for await (const chunk of service.sendMessage(
      conversationId,
      'Which files did I change in this repo since my last message? Answer from direct observation only; if you cannot inspect it, say unavailable.',
    )) {
      chunks.push(chunk);
    }

    const response = chunks
      .filter((chunk) => chunk.type === 'text_delta')
      .map((chunk) => chunk.textDelta)
      .join('');

    expect(response).toMatch(/live workspace delta unavailable/i);
    expect(response).not.toMatch(/only message you've sent/i);
    expect(adapter.streamCalls).toBe(0);
  });
});
