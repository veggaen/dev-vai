import { describe, expect, it } from 'vitest';
import {
  buildChatTurnQualitySystemHint,
  detectInstructionConstraint,
  resolveTemporaryTurnMode,
  shouldInjectChatStructureHint,
} from '../src/chat/chat-quality.js';

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

describe('resolveTemporaryTurnMode', () => {
  it('uses temporary plan mode for walkthrough-style chat prompts', () => {
    expect(resolveTemporaryTurnMode('chat', 'Walk me through how to harden this auth flow.')).toBe('plan');
    expect(resolveTemporaryTurnMode('chat', 'My Docker container keeps crashing, how do I debug it?')).toBe('plan');
  });

  it('does not force temporary plan mode for simple factual chat prompts', () => {
    expect(resolveTemporaryTurnMode('chat', 'What is Redis?')).toBeNull();
    expect(resolveTemporaryTurnMode('builder', 'Walk me through how to harden this auth flow.')).toBeNull();
  });
});

describe('buildChatTurnQualitySystemHint', () => {
  it('adds corrective-turn and recommendation guidance when the user refines the answer', () => {
    const hint = buildChatTurnQualitySystemHint(
      'chat',
      'No, I mean for a local-first app, which should I change first?',
      [
        { role: 'user', content: 'Should I use hosted auth or local auth?' },
        { role: 'assistant', content: 'Use hosted auth for most teams.' },
      ],
    );

    expect(hint).toMatch(/correcting or refining/i);
    expect(hint).toMatch(/recommendation in the first sentence/i);
    expect(hint).toMatch(/Lead with the direct answer/i);
  });

  it('adds freshness guidance for current-information prompts', () => {
    const hint = buildChatTurnQualitySystemHint(
      'chat',
      'What is the current stable Bun version right now?',
      [],
    );

    expect(hint).toMatch(/Freshness matters/i);
    expect(hint).toMatch(/latest official source/i);
  });

  it('injects a strict minimal-output contract for instruction-constrained turns', () => {
    const hint = buildChatTurnQualitySystemHint(
      'chat',
      'Please only reply with the name of the leader of NATO, no more.',
      [],
    );

    expect(hint).toMatch(/STRICT CONSTRAINT/i);
    expect(hint).toMatch(/Output ONLY the requested value/i);
  });

  it('still emits the quality contract for short instruction-constrained turns', () => {
    const hint = buildChatTurnQualitySystemHint(
      'chat',
      'Just the name please.',
      [],
    );

    expect(hint).not.toBeNull();
    expect(hint).toMatch(/STRICT CONSTRAINT/i);
  });
});

describe('detectInstructionConstraint', () => {
  it('detects explicit "only reply with" phrasing', () => {
    expect(detectInstructionConstraint('please only reply with the name of the leader of nato')).toBe(true);
    expect(detectInstructionConstraint('Just reply with the year, nothing else.')).toBe(true);
    expect(detectInstructionConstraint('answer in one word')).toBe(true);
    expect(detectInstructionConstraint('one-word answer please')).toBe(true);
    expect(detectInstructionConstraint('give me the number, no preamble')).toBe(true);
  });

  it('does not fire on regular factual questions', () => {
    expect(detectInstructionConstraint('who is the king of Norway?')).toBe(false);
    expect(detectInstructionConstraint('explain how React hooks work')).toBe(false);
    expect(detectInstructionConstraint('')).toBe(false);
  });
});
