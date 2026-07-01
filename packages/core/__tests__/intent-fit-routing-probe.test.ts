import { describe, it, expect } from 'vitest';
import { createDb } from '../src/db/client.js';
import { ChatService } from '../src/chat/service.js';
import { ModelRegistry } from '../src/models/adapter.js';
import type {
  ModelAdapter,
  ChatRequest,
  ChatResponse,
  ChatChunk,
} from '../src/models/adapter.js';

/**
 * Live routing probe for the intent-fit change, driven through the REAL
 * ChatService (not the VaiEngine shim, not a hand-rolled dispatcher). For each
 * prompt we send a real turn and read the route plan the service streamed on its
 * `done` chunk, asserting WHICH deterministic handler won and that the fit reason
 * explains why.
 *
 * Scope finding (verified while building this probe, recorded honestly): the
 * scored handler registry (`dispatchTurn`) is only REACHED by turns that survive
 * the upstream deterministic short-circuits (builder gate, business-opportunity,
 * web/research + recommendation routing, etc.). In practice that is the knowledge
 * lane — `factual-lookup` / `definition` questions and identity/meta turns. Build
 * and recommendation asks are intercepted upstream and never reach the registry,
 * so intent-fit's SUPPRESSION rules for those intents are defense-in-depth (a
 * safety net if an upstream router ever lets one through) rather than a
 * day-to-day, registry-observable effect. The observable, proven win of this
 * change is sharper BOOST-driven ranking on the knowledge turns that DO reach the
 * registry — which is exactly what these assertions pin.
 */

class StubAdapter implements ModelAdapter {
  readonly id = 'vai:v0';
  readonly displayName = 'Stub';
  readonly supportsStreaming = true;
  readonly supportsToolUse = false;
  async chat(_r: ChatRequest): Promise<ChatResponse> {
    return {
      message: { role: 'assistant', content: 'stub' },
      usage: { promptTokens: 1, completionTokens: 1 },
      finishReason: 'stop',
      modelId: this.id,
    };
  }
  async *chatStream(_r: ChatRequest): AsyncIterable<ChatChunk> {
    // Model fallback — only reached if NO deterministic handler answered.
    yield { type: 'text_delta', textDelta: 'model-fallback' };
    yield { type: 'done', usage: { promptTokens: 1, completionTokens: 1 }, modelId: this.id };
  }
}

interface RouteCandidate {
  readonly name: string;
  readonly score: number;
  readonly baseScore?: number;
  readonly chosen?: boolean;
  readonly reason?: string;
}

async function routeOf(prompt: string): Promise<{
  reachedRegistry: boolean;
  chosen: string | null;
  strategy?: string;
  candidates: RouteCandidate[];
}> {
  const registry = new ModelRegistry();
  registry.register(new StubAdapter());
  const svc = new ChatService(createDb(':memory:'), registry);
  const convId = svc.createConversation('vai:v0');

  let routePlan: { chosen?: string | null; candidates?: RouteCandidate[] } | undefined;
  let strategy: string | undefined;
  for await (const chunk of svc.sendMessage(convId, prompt)) {
    const c = chunk as ChatChunk & {
      thinking?: { strategy?: string; routePlan?: { chosen?: string | null; candidates?: RouteCandidate[] } };
    };
    if (c.type === 'done' && c.thinking) {
      strategy = c.thinking.strategy;
      if (c.thinking.routePlan) routePlan = c.thinking.routePlan;
    }
  }
  return {
    reachedRegistry: routePlan !== undefined,
    chosen: routePlan?.chosen ?? null,
    strategy,
    candidates: routePlan?.candidates ?? [],
  };
}

function factShim(c: RouteCandidate[]) {
  return c.find((x) => x.name === 'chat-fact-shim');
}

describe('intent-fit routing probe (live ChatService)', () => {
  it('boosts fact-shim ABOVE its 0.91 prior on a genuine fact lookup, with an on-lane reason', async () => {
    const r = await routeOf('what is the capital of Japan?');
    expect(r.reachedRegistry).toBe(true);
    const fs = factShim(r.candidates);
    expect(fs).toBeDefined();
    // The boost is observable and live: 0.91 prior → boosted above 0.91.
    expect(fs!.score).toBeGreaterThan(0.91);
    expect(fs!.reason ?? '').toContain('on-lane');
    // And it actually wins the turn.
    expect(r.chosen).toBe('chat-fact-shim');
  });

  it('boosts fact-shim on a definition lookup ("who is …") so it wins the knowledge lane', async () => {
    const r = await routeOf('who is Ada Lovelace?');
    expect(r.reachedRegistry).toBe(true);
    const fs = factShim(r.candidates);
    expect(fs).toBeDefined();
    expect(fs!.score).toBeGreaterThan(0.91);
    expect(fs!.reason ?? '').toContain('on-lane');
  });

  it('routes an identity question to the Vai-identity lane (not a generic fact)', async () => {
    const r = await routeOf('tell me about your engine');
    expect(r.reachedRegistry).toBe(true);
    expect(r.chosen).toBe('chat-vai-identity');
  });

  it('routes a business-idea ask to the business-opportunity lane, not a country-fact card (Norway class)', async () => {
    // The documented failure class: "a good software business idea for Norway?" used
    // to be answered by a Norway country-fact card. With the promoted, rankable
    // business-opportunity handler (Slice 1) seated at 0.945 — above fact-shim (0.91)
    // — it now owns the turn, and fact-shim is off-lane/suppressed below it.
    const r = await routeOf('what is a good software business idea for Norway that is unique?');
    expect(r.reachedRegistry).toBe(true);
    expect(r.chosen).toBe('business-opportunity');
    const fs = factShim(r.candidates);
    if (fs) {
      const biz = r.candidates.find((c) => c.name === 'business-opportunity');
      expect(biz).toBeDefined();
      expect(biz!.score).toBeGreaterThan(fs.score);
    }
  });

  it('surfaces intent-fit reasons into the streamed route plan (auditable trail)', async () => {
    // A knowledge lookup reliably reaches the registry; assert the fit reason rides
    // through to the visible plan so humans/AI can see WHY a handler scored as it did.
    const r = await routeOf('what is a closure in javascript?');
    expect(r.reachedRegistry).toBe(true);
    expect(r.candidates.length).toBeGreaterThan(0);
    const withFitReason = r.candidates.filter((c) => /on-lane|off-lane/.test(c.reason ?? ''));
    expect(withFitReason.length).toBeGreaterThan(0);
  });
});
