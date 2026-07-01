import { describe, it, expect } from 'vitest';
import { createDb } from '../src/db/client.js';
import { ChatService, type RoutingConfig } from '../src/chat/service.js';
import { ModelRegistry } from '../src/models/adapter.js';
import type {
  ModelAdapter,
  ChatRequest,
  ChatResponse,
  ChatChunk,
} from '../src/models/adapter.js';

/**
 * Slice 2 surfacing probe (real ChatService): the classified intent, the layer
 * that decided it, and the scorer margin ride through to the streamed
 * `routePlan`, and the `routing.smartIntent` flag gates the scorer fallback.
 */

class StubAdapter implements ModelAdapter {
  readonly id = 'vai:v0';
  readonly displayName = 'Stub';
  readonly supportsStreaming = true;
  readonly supportsToolUse = false;
  /** Captures the system prompts of each chatStream call so a test can assert
   *  which directives ChatService injected before dispatching to the model. */
  readonly capturedSystemPrompts: string[] = [];
  async chat(_r: ChatRequest): Promise<ChatResponse> {
    return {
      message: { role: 'assistant', content: 'stub' },
      usage: { promptTokens: 1, completionTokens: 1 },
      finishReason: 'stop',
      modelId: this.id,
    };
  }
  async *chatStream(r: ChatRequest): AsyncIterable<ChatChunk> {
    this.capturedSystemPrompts.push(
      r.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n'),
    );
    yield { type: 'text_delta', textDelta: 'model-fallback' };
    yield { type: 'done', usage: { promptTokens: 1, completionTokens: 1 }, modelId: this.id };
  }
}

interface RoutePlanShape {
  chosen?: string | null;
  belowFloor?: boolean;
  intent?: string;
  intentSource?: 'regex' | 'scorer';
  intentMargin?: number;
  belowFloorReason?: string;
}

async function planOf(prompt: string, routing?: RoutingConfig): Promise<RoutePlanShape | undefined> {
  const registry = new ModelRegistry();
  registry.register(new StubAdapter());
  const svc = new ChatService(createDb(':memory:'), registry, routing ? { routing } : undefined);
  const convId = svc.createConversation('vai:v0');
  let routePlan: RoutePlanShape | undefined;
  for await (const chunk of svc.sendMessage(convId, prompt)) {
    const c = chunk as ChatChunk & { thinking?: { routePlan?: RoutePlanShape } };
    if (c.type === 'done' && c.thinking?.routePlan) routePlan = c.thinking.routePlan;
  }
  return routePlan;
}

describe('routePlan intent surfacing (live ChatService)', () => {
  it('surfaces intent + regex source on a regex-decided knowledge turn', async () => {
    const plan = await planOf('what is the capital of Japan?');
    expect(plan).toBeDefined();
    expect(plan!.intent).toBe('factual-lookup');
    expect(plan!.intentSource).toBe('regex');
  });

  it('regex-decided turns carry no scorer margin', async () => {
    const plan = await planOf('who is Ada Lovelace?');
    expect(plan!.intentSource).toBe('regex');
    expect(plan!.intentMargin).toBeUndefined();
  });
});

describe('below-floor intent-directed escalation (Slice 3, live ChatService)', () => {
  // The substantive behavior: on a below-floor escalation, ChatService injects a
  // system directive carrying the classified intent's expected shape BEFORE it
  // dispatches to the model — so the model answers on-intent instead of drifting
  // into generic prose. We assert this at the model boundary (the system prompts
  // the adapter actually received), which is where the behavior lives.
  async function systemPromptsFor(prompt: string, routing?: RoutingConfig): Promise<string> {
    const registry = new ModelRegistry();
    const stub = new StubAdapter();
    registry.register(stub);
    const svc = new ChatService(createDb(':memory:'), registry, routing ? { routing } : undefined);
    const convId = svc.createConversation('vai:v0');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of svc.sendMessage(convId, prompt)) { /* drain */ }
    return stub.capturedSystemPrompts.join('\n');
  }

  it('injects a recommendation-shaped directive when a recommendation ask escalates', async () => {
    const sys = await systemPromptsFor('suggest a lightweight approach for offline sync please');
    expect(sys).toContain('classified as a recommendation');
    expect(sys.toLowerCase()).toContain('do not');
  });

  it('injects NO directive for an `other` turn (no shape is fabricated)', async () => {
    const sys = await systemPromptsFor('tell me a short story about a fox');
    expect(sys).not.toContain('classified as');
  });

  it('injects no directive when routing.intentEscalation is off (flag gates it)', async () => {
    const sys = await systemPromptsFor('suggest a lightweight approach for offline sync please', {
      intentEscalation: false,
    });
    expect(sys).not.toContain('classified as');
  });
});
