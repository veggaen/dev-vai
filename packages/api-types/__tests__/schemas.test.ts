import { describe, expect, it } from 'vitest';
import { chatWebSocketInboundSchema } from '../src/chat-ws.js';
import {
  createConversationBodySchema,
  patchConversationBodySchema,
  postConversationMessageBodySchema,
} from '../src/conversations.js';
import { createBroadcastBodySchema } from '../src/broadcast.js';

describe('chatWebSocketInboundSchema', () => {
  it('accepts minimal valid payload', () => {
    const r = chatWebSocketInboundSchema.safeParse({
      conversationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      content: 'hi',
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown top-level keys (strict boundary)', () => {
    const r = chatWebSocketInboundSchema.safeParse({
      conversationId: 'x',
      content: 'y',
      extraField: 1,
    });
    expect(r.success).toBe(false);
  });

  it('rejects missing conversationId', () => {
    const r = chatWebSocketInboundSchema.safeParse({ content: 'only' });
    expect(r.success).toBe(false);
  });
});

describe('conversations HTTP body schemas', () => {
  it('createConversationBodySchema rejects unknown keys', () => {
    const r = createConversationBodySchema.safeParse({ modelId: 'x', extra: true });
    expect(r.success).toBe(false);
  });

  it('patchConversationBodySchema accepts partial bodies', () => {
    expect(patchConversationBodySchema.safeParse({}).success).toBe(true);
    expect(patchConversationBodySchema.safeParse({ mode: 'builder' }).success).toBe(true);
  });

  it('postConversationMessageBodySchema requires content', () => {
    expect(postConversationMessageBodySchema.safeParse({ content: 'hi' }).success).toBe(true);
    expect(postConversationMessageBodySchema.safeParse({}).success).toBe(false);
  });
});

describe('broadcast HTTP body schemas', () => {
  it('createBroadcastBodySchema trims content and rejects empty', () => {
    expect(createBroadcastBodySchema.safeParse({ content: '  ok  ' }).success).toBe(true);
    expect(createBroadcastBodySchema.safeParse({ content: '   ' }).success).toBe(false);
  });
});
