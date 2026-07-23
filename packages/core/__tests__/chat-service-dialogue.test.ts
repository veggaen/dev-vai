import { describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { ChatService } from '../src/chat/service.js';
import { ModelRegistry } from '../src/models/adapter.js';
import type { ChatChunk, ChatRequest, ChatResponse, ModelAdapter } from '../src/models/adapter.js';
import type { SelfImproveJob } from '../src/chat/self-improve-queue-port.js';

class CountingAdapter implements ModelAdapter {
  readonly id = 'mock:dialogue';
  readonly displayName = 'Dialogue fallback';
  readonly supportsStreaming = true;
  readonly supportsToolUse = false;
  streamCalls = 0;

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    return {
      message: { role: 'assistant', content: 'generic model reply' },
      usage: { promptTokens: 1, completionTokens: 1 },
      finishReason: 'stop',
    };
  }

  async *chatStream(_request: ChatRequest): AsyncIterable<ChatChunk> {
    this.streamCalls += 1;
    yield { type: 'text_delta', textDelta: 'generic model reply' };
    yield { type: 'done', usage: { promptTokens: 1, completionTokens: 1 } };
  }
}

async function textFrom(service: ChatService, conversationId: string, content: string): Promise<string> {
  let text = '';
  for await (const chunk of service.sendMessage(conversationId, content)) {
    if (chunk.type === 'text_delta') text += chunk.textDelta ?? '';
  }
  return text;
}

describe('ChatService relational dialogue path', () => {
  it('holds a multi-turn entity conversation and queues Vai-owned reflection without a model call', async () => {
    const db = createDb(':memory:');
    const models = new ModelRegistry();
    const adapter = new CountingAdapter();
    models.register(adapter);
    const queued: SelfImproveJob[] = [];
    const service = new ChatService(db, models, {
      selfImproveQueue: { enqueue: (job) => queued.push(job) },
      primaryGenerativeFlip: false,
    });
    const conversationId = service.createConversation(adapter.id, 'Dialogue', 'chat');
    const intro = 'I am Codex, an AI engineering agent working with V3gga. V3gga says Vai cannot hold a conversation. What do you make of that, and what do you want to understand about us?';

    const first = await textFrom(service, conversationId, intro);
    expect(first).toContain('**Codex**');
    expect(first).toContain("**V3gga's concern**");

    const recall = await textFrom(
      service,
      conversationId,
      'What do you remember about who I am and what V3gga thinks is wrong? When I said us, which entities did I mean?',
    );
    expect(recall).toContain('Codex, V3gga, Vai');

    service.appendAssistantMessage(conversationId, "I don't know. **What I can do:** build projects and diagnose errors.");
    const reflection = await textFrom(
      service,
      conversationId,
      'After we have spoken, what can you improve from this conversation to make Vai better again?',
    );
    expect(reflection).toMatch(/Vai-owned improvement candidate/i);
    expect(queued).toContainEqual(expect.objectContaining({
      memberId: 'vai:v0-dialogue-reflection',
      missingCapability: expect.stringMatching(/dialogue-state recall/i),
    }));
    expect(adapter.streamCalls).toBe(0);
  });

  it('recognizes an explicitly challenged off-topic answer and queues its relevance gap without a model', async () => {
    const db = createDb(':memory:');
    const models = new ModelRegistry();
    const adapter = new CountingAdapter();
    models.register(adapter);
    const queued: SelfImproveJob[] = [];
    const service = new ChatService(db, models, {
      selfImproveQueue: { enqueue: (job) => queued.push(job) },
      primaryGenerativeFlip: false,
    });
    const conversationId = service.createConversation(adapter.id, 'Reflection', 'chat');
    const engineeringPrompt = 'Vai, name the single most important engineering bottleneck preventing you from becoming more capable without third-party models. Separate evidence from inference, and propose one acceptance test.';
    await textFrom(service, conversationId, engineeringPrompt);
    adapter.streamCalls = 0;
    queued.length = 0;
    service.appendAssistantMessage(conversationId, 'The capital of Peru is **Lima**.');

    const reflection = await textFrom(
      service,
      conversationId,
      'What did you learn from the last exchange? Identify the evidence-based conversational failure in your Lima answer and decide whether it should enter your guarded improvement queue.',
    );

    expect(reflection).toMatch(/very low topical overlap/i);
    expect(queued).toContainEqual(expect.objectContaining({
      memberId: 'vai:v0-dialogue-reflection',
      missingCapability: 'turn-to-response relevance verification',
    }));
    expect(adapter.streamCalls).toBe(0);
  });

  it('answers broad Vai self-assessment through vai:v0 without Council or a response model', async () => {
    const db = createDb(':memory:');
    const models = new ModelRegistry();
    const adapter = new CountingAdapter();
    models.register(adapter);
    const service = new ChatService(db, models, { primaryGenerativeFlip: false });
    const conversationId = service.createConversation(adapter.id, 'Self-assessment', 'chat');
    const prompt = 'Vai, act as the institution responsible for your own improvement. Based only on what you can actually inspect or remember, name the single most important engineering bottleneck preventing you from becoming more capable without depending on third-party models. Separate evidence from inference, and propose one acceptance test.';

    const reply = await textFrom(service, conversationId, prompt);
    const lastAssistant = service.getMessages(conversationId).filter((message) => message.role === 'assistant').at(-1);

    expect(reply).toContain('**Single most important bottleneck**');
    expect(reply).toContain('**Evidence**');
    expect(reply).toContain('**Inference**');
    expect(reply).toContain('**Acceptance test**');
    expect(reply).not.toMatch(/capital of Peru|Lima/i);
    expect(lastAssistant?.modelId).toBe('vai-self-assessment:operational-introspection-gap');
    expect(adapter.streamCalls).toBe(0);
  });

  it('ranks the verified adoption gap when runtime evidence is attached', async () => {
    const db = createDb(':memory:');
    const models = new ModelRegistry();
    const adapter = new CountingAdapter();
    models.register(adapter);
    const service = new ChatService(db, models, {
      primaryGenerativeFlip: false,
      selfAssessmentEvidence: () => ({
        schemaVersion: 1,
        capturedAt: '2026-07-19T07:54:13.000Z',
        runtime: { sourceId: 'runtime:process', healthy: true, engine: 'vai:v0' },
        build: {
          sourceId: 'build:source-git', available: true, runtimeKind: 'source',
          commit: 'a'.repeat(40), branch: 'cap/synthesis-page', version: '0.2.0',
          builtAt: null, dirty: true,
        },
        repository: {
          sourceId: 'git:source-status', available: true, branch: 'cap/synthesis-page',
          changedFiles: 103, modifiedFiles: 82, untrackedFiles: 21,
        },
        verification: {
          sourceId: 'verification:source-receipt', available: true, status: 'pass',
          capturedAt: '2026-07-19T07:54:13.000Z', totalTestsPassed: 1179,
          typechecks: ['@vai/core', '@vai/runtime'], stale: false,
        },
        selfImprovement: {
          sourceId: 'self-improve:source-corpus', available: true, queuedFixes: 302,
          qualified: 86, adopted: 0, pendingNominations: 2, integratedNominations: 1,
          latestRunStatus: 'aborted-runtime-down', latestRunAt: '2026-07-02T05:46:56.677Z',
        },
      }),
    });
    const conversationId = service.createConversation(adapter.id, 'Evidence-backed self-assessment', 'chat');
    const prompt = 'Vai, act as the institution responsible for your own improvement. Based only on what you can actually inspect or remember, name the single most important engineering bottleneck preventing you from becoming more capable without depending on third-party models. Separate evidence from inference, and propose one acceptance test.';

    const reply = await textFrom(service, conversationId, prompt);
    const lastAssistant = service.getMessages(conversationId).filter((message) => message.role === 'assistant').at(-1);

    expect(reply).toMatch(/verified improvement adoption/i);
    expect(reply).toContain('[self-improve:source-corpus]');
    expect(reply).toContain('86 qualified proposals; 0 adopted');
    expect(lastAssistant?.modelId).toBe('vai-self-assessment:verified-adoption-gap');
    expect(adapter.streamCalls).toBe(0);
  });

  it('keeps verified paired-cost reasoning on the deterministic chat path', async () => {
    const db = createDb(':memory:');
    const models = new ModelRegistry();
    const adapter = new CountingAdapter();
    models.register(adapter);
    const service = new ChatService(db, models, { primaryGenerativeFlip: true });
    const conversationId = service.createConversation(adapter.id, 'Bounded reasoning', 'chat');

    const reply = await textFrom(
      service,
      conversationId,
      'A headset and cable cost 4 dollars and 60 cents total. The headset costs 4 dollars more than the cable. What does the cable cost in cents? Show the arithmetic check.',
    );
    const lastAssistant = service.getMessages(conversationId).filter((message) => message.role === 'assistant').at(-1);

    expect(reply).toMatch(/30 cents.*\$4\.30.*\$0\.30.*\$4\.60.*\$4\.00/i);
    expect(lastAssistant?.modelId).toBe('trick-question:anchoring-trap');
    expect(adapter.streamCalls).toBe(0);
  });

  it('keeps invariant-driven reliable worker design on the deterministic chat path', async () => {
    const db = createDb(':memory:');
    const models = new ModelRegistry();
    const adapter = new CountingAdapter();
    models.register(adapter);
    const service = new ChatService(db, models, { primaryGenerativeFlip: true });
    const conversationId = service.createConversation(adapter.id, 'Reliable worker', 'chat');

    const reply = await textFrom(
      service,
      conversationId,
      'Architect a local background job runner that survives restarts, reports progress, tolerates duplicates, applies backpressure, exposes metrics, and supports a staged rollout.',
    );
    const lastAssistant = service.getMessages(conversationId).filter((message) => message.role === 'assistant').at(-1);

    expect(reply).toMatch(/SQLite job table/i);
    expect(reply).toMatch(/expiring leases/i);
    expect(reply).toMatch(/idempotency key/i);
    expect(reply).toMatch(/dead-letter/i);
    expect(reply).toMatch(/queue depth and age/i);
    expect(reply).toMatch(/kill switch/i);
    expect(lastAssistant?.modelId).toBe('reliable-job-design');
    expect(adapter.streamCalls).toBe(0);
  });
});
