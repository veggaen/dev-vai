import { describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { ChatService } from '../src/chat/service.js';
import { ModelRegistry } from '../src/models/adapter.js';
import type { ChatChunk, ChatRequest, ChatResponse, ModelAdapter } from '../src/models/adapter.js';

class CountingAdapter implements ModelAdapter {
  readonly id = 'mock:reasoning-fallback';
  readonly displayName = 'Reasoning fallback';
  readonly supportsStreaming = true;
  readonly supportsToolUse = false;
  streamCalls = 0;

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    return { message: { role: 'assistant', content: 'model fallback' }, usage: { promptTokens: 1, completionTokens: 1 }, finishReason: 'stop' };
  }

  async *chatStream(_request: ChatRequest): AsyncIterable<ChatChunk> {
    this.streamCalls += 1;
    yield { type: 'text_delta', textDelta: 'model fallback' };
    yield { type: 'done', usage: { promptTokens: 1, completionTokens: 1 } };
  }
}

async function send(service: ChatService, conversationId: string, content: string): Promise<string> {
  let text = '';
  for await (const chunk of service.sendMessage(conversationId, content)) {
    if (chunk.type === 'text_delta') text += chunk.textDelta ?? '';
  }
  return text;
}

function setup() {
  const db = createDb(':memory:');
  const models = new ModelRegistry();
  const adapter = new CountingAdapter();
  models.register(adapter);
  const service = new ChatService(db, models, { primaryGenerativeFlip: true });
  const conversationId = service.createConversation(adapter.id, 'Bounded reasoning', 'chat');
  return { service, conversationId, adapter };
}

describe('ChatService bounded reasoning path', () => {
  it('solves an unseen unique-order graph without a response model', async () => {
    const { service, conversationId, adapter } = setup();
    const reply = await send(service, conversationId, 'Stages K, L, M each occur once. M is after L. L is after K. Return JSON only with the unique order under key order.');
    const stored = service.getMessages(conversationId).filter((message) => message.role === 'assistant').at(-1);
    expect(reply).toBe('{"order":["K","L","M"]}');
    expect(stored?.modelId).toBe('bounded-reasoning:unique-order');
    expect(adapter.streamCalls).toBe(0);
  });

  it('updates causal belief across persistent turns without a response model', async () => {
    const { service, conversationId, adapter } = setup();
    const first = await send(service, conversationId, 'Hypothesis P blames parser. Hypothesis S blames storage. Failures began after a parser rewrite and still occur when storage is disabled. Which is better supported?');
    const second = await send(service, conversationId, 'New controlled evidence: reverting parser does not change failures, while isolating storage removes every failure. Update the belief.');
    expect(first).toMatch(/^P is better supported/i);
    expect(second).toMatch(/^S is now better supported.*Reverting parser had no effect.*isolating the storage removed every failure/is);
    expect(adapter.streamCalls).toBe(0);
  });

  it('simulates event-loop output instead of requesting a live terminal', async () => {
    const { service, conversationId, adapter } = setup();
    const reply = await send(service, conversationId, "In standard JavaScript give output order: console.log('start'); queueMicrotask(()=>console.log('micro')); setTimeout(()=>console.log('timer'),0); console.log('end'); Return comma-separated labels only.");
    expect(reply).toBe('start,end,micro,timer');
    expect(reply).not.toMatch(/terminal output unavailable/i);
    expect(adapter.streamCalls).toBe(0);
  });

  it('keeps verified bounded turns free of historical route guidance', async () => {
    const db = createDb(':memory:');
    const models = new ModelRegistry();
    const adapter = new CountingAdapter();
    models.register(adapter);
    let guidanceLoads = 0;
    const service = new ChatService(db, models, {
      primaryGenerativeFlip: true,
      loadActiveGuidance: () => {
        guidanceLoads += 1;
        return [{
          id: 'irrelevant-global-lesson',
          conversationId: null,
          from: 'ai' as const,
          signal: 'prefer' as const,
          handler: 'chat-format-strict',
          note: 'unrelated historical Council lesson',
          scope: 'global' as const,
          weight: 1,
          active: true,
          createdAt: new Date(),
        }];
      },
    });
    const conversationId = service.createConversation(adapter.id, 'Bounded guidance isolation', 'chat');

    const reply = await send(service, conversationId, 'Utilities by states s1,s2,s3: A=[7,2,8]; B=[5,5,5]; C=[3,9,4]. Choose minimum maximum regret. Return JSON only with maxRegret by action and chosen.');
    const stored = service.getMessages(conversationId).filter((message) => message.role === 'assistant').at(-1);
    const plan = JSON.parse(stored?.plan ?? '{}') as { hadGuidance?: boolean; steered?: { candidates?: Array<{ guidanceApplied?: string }> } };

    expect(reply).toBe('{"maxRegret":{"A":7,"B":4,"C":4},"chosen":["B","C"]}');
    expect(stored?.modelId).toBe('bounded-reasoning:advanced:minimax-regret');
    expect(guidanceLoads).toBe(0);
    expect(plan.hadGuidance).toBe(false);
    expect(plan.steered?.candidates?.every((candidate) => !candidate.guidanceApplied)).toBe(true);
    expect(adapter.streamCalls).toBe(0);
  });
});
