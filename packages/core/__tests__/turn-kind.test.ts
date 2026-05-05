import { describe, expect, it } from 'vitest';
import { buildTurnKindSystemHint, classifyChatTurn } from '../src/chat/turn-kind.js';

describe('classifyChatTurn', () => {
  it('classifies greetings as conversational', () => {
    expect(classifyChatTurn({
      userContent: 'hey',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('conversational');
  });

  it('classifies literal echo prompts as conversational', () => {
    expect(classifyChatTurn({
      userContent: "say back to me 'hello'",
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('conversational');
  });

  it('classifies current/discovery prompts as research', () => {
    expect(classifyChatTurn({
      userContent: 'who is top master frontend web dev on github',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('research');
  });

  it('classifies follower-ranking prompts as research', () => {
    expect(classifyChatTurn({
      userContent: 'who has the most followers then?',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('research');
  });

  it('classifies active sandbox edit requests as builder', () => {
    expect(classifyChatTurn({
      userContent: 'make the button background blue and tighten the spacing',
      mode: 'chat',
      hasActiveSandbox: true,
    })).toBe('builder');
  });

  it('leaves normal factual questions in analysis mode', () => {
    expect(classifyChatTurn({
      userContent: 'what is bun?',
      mode: 'chat',
      hasActiveSandbox: false,
    })).toBe('analysis');
  });
});

describe('buildTurnKindSystemHint', () => {
  it('returns a conversational guidance hint', () => {
    expect(buildTurnKindSystemHint('conversational')).toMatch(/plain conversational turn/i);
  });

  it('returns direct-answer guidance for analysis turns', () => {
    expect(buildTurnKindSystemHint('analysis')).toMatch(/ordinary reasoning or factual turn/i);
    expect(buildTurnKindSystemHint('analysis')).toMatch(/Do not force research\/source-trail chrome/i);
  });
});
