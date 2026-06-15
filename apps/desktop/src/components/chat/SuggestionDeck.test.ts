import { describe, expect, it } from 'vitest';
import { BUILD_SUGGESTIONS, CHAT_SUGGESTIONS } from './SuggestionDeck.js';

describe('SuggestionDeck starter workflows', () => {
  it('offers four distinct, actionable workflows in each mode', () => {
    for (const suggestions of [BUILD_SUGGESTIONS, CHAT_SUGGESTIONS]) {
      expect(suggestions).toHaveLength(4);
      expect(new Set(suggestions.map((item) => item.title)).size).toBe(4);
      expect(new Set(suggestions.map((item) => item.prompt)).size).toBe(4);
      expect(suggestions.every((item) => item.prompt.length >= 70)).toBe(true);
    }
  });

  it('makes the build deck prove real product behavior', () => {
    const combined = BUILD_SUGGESTIONS.map((item) => `${item.hint} ${item.prompt}`).join(' ');
    expect(combined).toMatch(/real state/i);
    expect(combined).toMatch(/responsive/i);
    expect(combined).toMatch(/accessible/i);
    expect(combined).toMatch(/verify it in the browser/i);
  });
});
