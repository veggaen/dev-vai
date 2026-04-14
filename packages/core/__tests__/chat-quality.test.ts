import { describe, expect, it } from 'vitest';
import { shouldInjectChatStructureHint } from '../src/chat/chat-quality.js';

describe('shouldInjectChatStructureHint', () => {
  it('is false for non-chat modes', () => {
    expect(shouldInjectChatStructureHint('agent', 'What is X? Why Y?')).toBe(false);
    expect(shouldInjectChatStructureHint('builder', 'a'.repeat(500))).toBe(false);
  });

  it('is false for very short chat messages', () => {
    expect(shouldInjectChatStructureHint('chat', 'Hi')).toBe(false);
    expect(shouldInjectChatStructureHint('chat', 'What is the capital of France?')).toBe(false);
  });

  it('is true for multiple questions', () => {
    expect(shouldInjectChatStructureHint('chat', 'What is Redis? When should I use it vs Postgres?')).toBe(true);
  });

  it('is true for long prompts', () => {
    const long = `I'm building a dashboard. ${'More context. '.repeat(40)}What should I watch for?`;
    expect(long.length).toBeGreaterThan(280);
    expect(shouldInjectChatStructureHint('chat', long)).toBe(true);
  });

  it('is true for comparison / tradeoff language', () => {
    expect(shouldInjectChatStructureHint('chat', 'Can you compare REST vs GraphQL for my mobile app?')).toBe(true);
    expect(shouldInjectChatStructureHint('chat', 'Walk me through how to harden this auth flow.')).toBe(true);
  });
});
