import { describe, it, expect } from 'vitest';
import type { ModelAdapter } from '../models/adapter.js';
import { createCouncilMember } from './member.js';
import type { CouncilInput } from './types.js';

/**
 * Locks the fix for "deepseek-r1 seated but never responds": a thinking-capable model
 * (extendedThinking) must get a LARGER token budget in the council so it can finish its
 * <think> block AND still emit the structured JSON note. A non-thinking model keeps the
 * lean default. Without this, the whole 600-token budget is spent inside <think>, the
 * stripped content is empty, the note fails to parse, and the member is silently dropped.
 */

const VALID_NOTE = JSON.stringify({
  realIntent: 'x',
  hiddenMeaning: '',
  missingCapability: '',
  suggestedAction: 'answer-directly',
  searchQuery: '',
  verdict: 'good',
  confidence: 0.8,
  methodLesson: 'm',
  concerns: [],
});

function capturingAdapter(extendedThinking: boolean): ModelAdapter & { lastMaxTokens?: number; lastThink?: boolean } {
  const adapter: any = {
    id: extendedThinking ? 'local:deepseek-r1:8b' : 'local:qwen2.5:7b',
    displayName: extendedThinking ? 'Local deepseek-r1:8b' : 'Local qwen2.5:7b',
    capabilities: { extendedThinking },
    async chat(req: any) {
      adapter.lastMaxTokens = req.maxTokens;
      adapter.lastThink = req.think;
      return { message: { role: 'assistant', content: VALID_NOTE } };
    },
    async *chatStream() { /* unused */ },
    supportsToolUse: false,
  };
  return adapter;
}

const input: CouncilInput = {
  prompt: 'does this meet?',
  draft: 'a draft to review',
} as CouncilInput;

describe('council member — thinking-model token budget', () => {
  it('gives a thinking model (deepseek-r1) enough budget to finish thinking AND emit the note', async () => {
    const adapter = capturingAdapter(true);
    const member = createCouncilMember({ adapter, topic: 'reasoning' });
    await member.review(input);
    // Must clear the ~2k-token think phase with headroom for the JSON note (measured: a 2k
    // cap was cut off mid-think → empty content → member dropped).
    expect(adapter.lastMaxTokens).toBeGreaterThanOrEqual(5000);
  });

  it('reviews a thinking model with think:ON so reasoning goes to a separate channel', async () => {
    const adapter = capturingAdapter(true);
    const member = createCouncilMember({ adapter, topic: 'reasoning' });
    await member.review(input);
    expect(adapter.lastThink).toBe(true);
  });

  it('leaves a non-thinking model (qwen) on the lean default budget and think untouched', async () => {
    const adapter = capturingAdapter(false);
    const member = createCouncilMember({ adapter, topic: 'reasoning' });
    await member.review(input);
    expect(adapter.lastMaxTokens).toBe(600);
    expect(adapter.lastThink).toBeUndefined();
  });

  it('an explicit larger maxTokens still wins for a non-thinking model', async () => {
    const adapter = capturingAdapter(false);
    const member = createCouncilMember({ adapter, topic: 'reasoning', maxTokens: 8192 });
    await member.review(input);
    expect(adapter.lastMaxTokens).toBe(8192);
  });
});
