import { describe, expect, it } from 'vitest';
import { chatWebSocketInboundSchema } from '../src/chat-ws.js';
import {
  createConversationBodySchema,
  patchConversationBodySchema,
  postConversationMessageBodySchema,
} from '../src/conversations.js';
import { createBroadcastBodySchema } from '../src/broadcast.js';
import { feedbackBodySchema } from '../src/feedback.js';
import {
  createSessionBodySchema,
  sessionEventsBodySchema,
} from '../src/sessions.js';
import {
  createProjectAuditBodySchema,
  projectHandoffIntentBodySchema,
  projectPeersBodySchema,
} from '../src/projects.js';

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

describe('feedback HTTP body schema', () => {
  it('accepts legacy conversationId while keeping the contract explicit', () => {
    expect(
      feedbackBodySchema.safeParse({
        conversationId: 'conv-1',
        messageId: 'msg-1',
        helpful: true,
      }).success,
    ).toBe(true);
  });
});

describe('sessions HTTP body schemas', () => {
  it('createSessionBodySchema rejects unknown keys', () => {
    const r = createSessionBodySchema.safeParse({
      title: 'Test',
      agentName: 'VeggaAI',
      modelId: 'vai:v0',
      extra: true,
    });
    expect(r.success).toBe(false);
  });

  it('sessionEventsBodySchema defaults missing meta to an empty object', () => {
    const r = sessionEventsBodySchema.safeParse({
      events: [{ type: 'message', content: 'Hello' }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.events[0]?.meta).toEqual({});
    }
  });
});

describe('projects HTTP body schemas', () => {
  it('createProjectAuditBodySchema rejects blank prompts', () => {
    expect(createProjectAuditBodySchema.safeParse({ prompt: '   ' }).success).toBe(false);
  });

  it('projectPeersBodySchema accepts explicit peer routing entries', () => {
    expect(projectPeersBodySchema.safeParse({
      peers: [{
        displayName: 'Cursor Agent',
        ide: 'cursor',
        model: 'gpt-5',
        launchTarget: 'cursor',
      }],
    }).success).toBe(true);
  });

  it('projectHandoffIntentBodySchema rejects invalid targets', () => {
    expect(projectHandoffIntentBodySchema.safeParse({ target: 'vim' }).success).toBe(false);
  });
});
