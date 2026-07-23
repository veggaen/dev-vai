import { describe, expect, it } from 'vitest';
import {
  chatProgressStepSchema,
  chatWebSocketInboundSchema,
  chatWebSocketOutboundSchema,
} from '../src/chat-ws.js';
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

describe('chatProgressStepSchema', () => {
  it('accepts structured shadow-advisor traces and rejects hidden prompt data', () => {
    const valid = chatProgressStepSchema.safeParse({
      stage: 'local-steering',
      label: 'Local model friend returned advice',
      status: 'done',
      advisor: {
        schemaVersion: 1,
        actorId: 'local:qwen2.5:7b',
        modelId: 'qwen2.5:7b',
        state: 'ready',
        taskShape: 'debugging',
        qualityContract: {
          answerLength: 'structured',
          mustBeGuiding: true,
          mustBeCurrent: false,
          mustUseJson: false,
          shouldAskClarifyingQuestion: false,
        },
        routeGuidance: [],
        riskFlags: ['generic-fallback-risk'],
        retrievalHints: ['blank React page'],
        confidence: 0.81,
      },
    });
    expect(valid.success).toBe(true);

    const leakedPrompt = chatProgressStepSchema.safeParse({
      stage: 'local-steering',
      label: 'Advice',
      status: 'done',
      advisor: {
        schemaVersion: 1,
        actorId: 'local:qwen2.5:7b',
        modelId: 'qwen2.5:7b',
        state: 'ready',
        routeGuidance: [],
        riskFlags: [],
        retrievalHints: [],
        rawPrompt: 'secret user text',
      },
    });
    expect(leakedPrompt.success).toBe(false);
  });

  it('accepts rich process log kinds for inspectable process UI', () => {
    const result = chatProgressStepSchema.safeParse({
      stage: 'inspect',
      label: 'Inspected the workspace',
      status: 'done',
      processLog: [
        { kind: 'read', label: 'Read file', body: 'src/App.tsx' },
        { kind: 'show', label: 'Show UI state', body: 'preview open' },
        { kind: 'event', label: 'User expanded process tree' },
        { kind: 'tool-response', label: 'Tool response', body: 'ok' },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('accepts council member identity and timing for submodel timelines', () => {
    const result = chatProgressStepSchema.safeParse({
      stage: 'council-vai-round-1',
      label: 'Council reviewed Vai\'s proposal',
      status: 'done',
      councilMembers: [{
        memberId: 'local:qwen3:8b',
        name: 'Local qwen3:8b',
        topic: 'code',
        verdict: 'needs-work',
        confidence: 0.82,
        durationMs: 1234,
        suggestedAction: 'reread-intent',
      }],
    });

    expect(result.success).toBe(true);
  });

  it('validates semantic outcomes and stable evidence ids at the wire boundary', () => {
    const valid = chatProgressStepSchema.safeParse({
      stage: 'verify',
      label: 'Verification stopped',
      status: 'done',
      outcome: 'interrupted',
      evidenceId: 'progress:3:verify',
      toolRuns: [{
        id: 'typecheck-1',
        name: 'typecheck',
        status: 'failed',
        outcome: 'failed',
        evidenceId: 'progress:3:verify:tool:typecheck-1',
      }],
    });
    expect(valid.success).toBe(true);

    const invalid = chatProgressStepSchema.safeParse({
      stage: 'verify',
      label: 'Verification stopped',
      status: 'done',
      outcome: 'maybe',
    });
    expect(invalid.success).toBe(false);
  });

  it('carries the semantic terminal result independently of transport completion', () => {
    expect(chatWebSocketOutboundSchema.safeParse({
      type: 'done',
      turnOutcome: 'withheld',
      durationMs: 120,
    }).success).toBe(true);
    expect(chatWebSocketOutboundSchema.safeParse({
      type: 'done',
      turnOutcome: 'unknown',
    }).success).toBe(false);
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
