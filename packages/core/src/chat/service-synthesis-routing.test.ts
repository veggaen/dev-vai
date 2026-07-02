/**
 * A1 anti-hijack regression — synthesis routing verified through the REAL ChatService.
 *
 * Project rule: routing must be proven at the service boundary (sendMessage → emitted
 * thinking.routePlan), NOT through the VaiEngine shim — the service is where the gate
 * (isSynthesisQuery), evidence gathering, handler registration and dispatch actually
 * compose. Each test drives a full turn with a stub adapter and inspects every route
 * plan the turn emitted.
 *
 * Contract pinned here:
 *   - a synthesis-shaped turn ("summarize what we know … across all sources" phrased to
 *     also be git-shaped so evidence gathering runs) RANKS the synthesis handler as a
 *     live candidate in the route plan;
 *   - simple factual, single-fact, and build turns NEVER carry a synthesis candidate
 *     (the gate keeps the handler list unchanged) and never choose it.
 */

import { describe, it, expect } from 'vitest';
import { createDb } from '../db/client.js';
import { ChatService } from './service.js';
import { ModelRegistry } from '../models/adapter.js';
import type { ModelAdapter, ChatRequest, ChatResponse, ChatChunk } from '../models/adapter.js';
import { isSynthesisQuery } from './capabilities/synthesis-capability.js';

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
  belowFloor?: boolean;
  candidates: RouteCandidate[];
}

/** Drive one real service turn; collect EVERY route plan any chunk carried. */
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

const synthesisCandidatesOf = (plans: EmittedRoutePlan[]): RouteCandidate[] =>
  plans.flatMap((p) => p.candidates.filter((c) => /^synthesis\b/.test(c.name)));

describe('service routing — synthesis capability (A1 anti-hijack)', () => {
  it('a synthesis-shaped turn with git evidence ranks the synthesis handler live', async () => {
    // Phrased to be BOTH synthesis-shaped (gate registers the handler) and git-shaped
    // ("my changes" → DIFF_RE), so the service gathers real git evidence pre-dispatch.
    const prompt = 'summarize what we know about my changes across all sources';
    expect(isSynthesisQuery(prompt)).toBe(true);

    const plans = await routePlansFor(prompt);
    expect(plans.length, 'turn must emit at least one route plan').toBeGreaterThan(0);

    const synth = synthesisCandidatesOf(plans);
    expect(synth.length, 'synthesis must be scored as a live candidate').toBeGreaterThan(0);
    // Live candidate (not the "(shadow)" suffix form) with a real score.
    expect(synth.some((c) => c.name === 'synthesis' && c.score > 0)).toBe(true);
  }, 30_000);

  it('a simple factual turn never carries or chooses synthesis', async () => {
    const prompt = 'what is the capital of France?';
    expect(isSynthesisQuery(prompt)).toBe(false);

    const plans = await routePlansFor(prompt);
    expect(synthesisCandidatesOf(plans)).toHaveLength(0);
    for (const p of plans) expect(p.chosen).not.toBe('synthesis');
  }, 30_000);

  it('a single-fact lookup never carries or chooses synthesis', async () => {
    const prompt = 'what is the bitcoin price?';
    expect(isSynthesisQuery(prompt)).toBe(false);

    const plans = await routePlansFor(prompt);
    expect(synthesisCandidatesOf(plans)).toHaveLength(0);
    for (const p of plans) expect(p.chosen).not.toBe('synthesis');
  }, 30_000);

  it('a build turn phrased with synthesis words is suppressed (never hijacked)', async () => {
    const prompt = 'build a page that compares pricing data across sources';
    expect(isSynthesisQuery(prompt)).toBe(false);

    const plans = await routePlansFor(prompt);
    expect(synthesisCandidatesOf(plans)).toHaveLength(0);
    for (const p of plans) expect(p.chosen).not.toBe('synthesis');
  }, 60_000);
});
