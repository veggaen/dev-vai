/**
 * A2 regression — pageCapability promotion verified through the REAL ChatService.
 *
 * Contract pinned here:
 *   - page goes LIVE only when a real observation exists this turn; a failed/refused
 *     gather (here: SSRF-guarded loopback URL — deterministic, no network) leaves page
 *     in shadow, so it can never win the turn;
 *   - a page-shaped turn WITHOUT fresh-data intent never triggers promotion either;
 *   - non-page turns carry no page candidate at all.
 */

import { describe, it, expect } from 'vitest';
import { createDb } from '../db/client.js';
import { ChatService } from './service.js';
import { ModelRegistry } from '../models/adapter.js';
import type { ModelAdapter, ChatRequest, ChatResponse, ChatChunk } from '../models/adapter.js';
import { isPageQuery } from './capabilities/page-capability.js';

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
    yield { type: 'text_delta', textDelta: 'ok' };
    yield { type: 'done', usage: { promptTokens: 1, completionTokens: 1 }, modelId: this.id };
  }
}

interface RouteCandidate {
  name: string;
  score: number;
  chosen: boolean;
  declined: boolean;
}
interface EmittedRoutePlan {
  chosen: string | null;
  candidates: RouteCandidate[];
}

async function routePlansFor(prompt: string): Promise<EmittedRoutePlan[]> {
  const registry = new ModelRegistry();
  registry.register(new StubAdapter());
  const svc = new ChatService(createDb(':memory:'), registry);
  const convId = svc.createConversation('vai:v0');
  const plans: EmittedRoutePlan[] = [];
  for await (const chunk of svc.sendMessage(convId, prompt)) {
    const plan = (chunk as { thinking?: { routePlan?: EmittedRoutePlan } }).thinking?.routePlan;
    if (plan) plans.push(plan);
  }
  return plans;
}

const liveCandidates = (plans: EmittedRoutePlan[], name: string): RouteCandidate[] =>
  plans.flatMap((p) => p.candidates.filter((c) => c.name === name));
const shadowCandidates = (plans: EmittedRoutePlan[], name: string): RouteCandidate[] =>
  plans.flatMap((p) => p.candidates.filter((c) => c.name === `${name} (shadow)`));

describe('service routing — pageCapability promotion (A2)', () => {
  it('a fresh-data page turn whose observation is refused (SSRF) keeps page in shadow', async () => {
    // Loopback URL: validatePublicUrl rejects it before any browser work — the gather is
    // deterministic and instant, and NO observation exists, so promotion must not happen.
    const prompt = 'is https://127.0.0.1:9/health still up right now?';
    expect(isPageQuery(prompt)).toBe(true);

    const plans = await routePlansFor(prompt);
    expect(plans.length).toBeGreaterThan(0);
    expect(liveCandidates(plans, 'page')).toHaveLength(0);
    // Page must still be visible as a shadow candidate (estimate applies to the shape).
    expect(shadowCandidates(plans, 'page').length).toBeGreaterThan(0);
    for (const p of plans) expect(p.chosen).not.toBe('page');
  }, 30_000);

  it('a page-shaped turn WITHOUT fresh-data intent is never promoted live', async () => {
    const prompt = 'what does https://127.0.0.1:9/docs say about installation?';
    expect(isPageQuery(prompt)).toBe(true);

    const plans = await routePlansFor(prompt);
    expect(liveCandidates(plans, 'page')).toHaveLength(0);
    for (const p of plans) expect(p.chosen).not.toBe('page');
  }, 30_000);

  it('a non-page turn carries no page candidate at all', async () => {
    const prompt = 'what is the capital of France?';
    expect(isPageQuery(prompt)).toBe(false);

    const plans = await routePlansFor(prompt);
    expect(liveCandidates(plans, 'page')).toHaveLength(0);
    expect(shadowCandidates(plans, 'page')).toHaveLength(0);
  }, 30_000);
});
