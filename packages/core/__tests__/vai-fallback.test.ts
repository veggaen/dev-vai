import { describe, expect, it } from 'vitest';
import {
  VAI_FALLBACK_CONFIDENCE_THRESHOLD,
  decideVaiFallback,
  pickFallbackModelId,
} from '../src/chat/vai-fallback.js';

describe('vai-fallback', () => {
  it('falls back when confidence is below the threshold', () => {
    expect(decideVaiFallback({
      text: 'Tentative answer',
      confidence: VAI_FALLBACK_CONFIDENCE_THRESHOLD - 0.1,
    })).toEqual({
      shouldFallback: true,
      reason: 'low-confidence',
    });
  });

  it('falls back on canonical no-knowledge text even without a confidence score', () => {
    expect(decideVaiFallback({
      text: "I don't have a solid answer for that yet.",
    })).toEqual({
      shouldFallback: true,
      reason: 'no-knowledge',
    });
  });

  it('does not fall back for normal text when confidence is absent or high enough', () => {
    expect(decideVaiFallback({
      text: 'Here is a direct answer.',
    })).toEqual({
      shouldFallback: false,
      reason: null,
    });

    expect(decideVaiFallback({
      text: 'Here is a direct answer.',
      confidence: VAI_FALLBACK_CONFIDENCE_THRESHOLD,
    })).toEqual({
      shouldFallback: false,
      reason: null,
    });
  });

  it('picks the first available external model from the configured chain', () => {
    const available = new Set(['mock:test', 'openai:gpt-4o-mini']);
    expect(pickFallbackModelId(
      ['vai:v0', 'missing:model', 'mock:test', 'openai:gpt-4o-mini'],
      (modelId) => available.has(modelId),
    )).toBe('mock:test');
  });

  it('prefers a codex model for coding-heavy fallback turns when one is available', () => {
    const available = new Set(['anthropic:claude-sonnet-4-20250514', 'openai:gpt-5.3-codex']);
    expect(pickFallbackModelId(
      ['anthropic:claude-sonnet-4-20250514', 'openai:gpt-5.3-codex', 'vai:v0'],
      (modelId) => available.has(modelId),
      { content: 'Fix this TypeScript component and refactor the API handler', mode: 'chat' },
    )).toBe('openai:gpt-5.3-codex');
  });
});
