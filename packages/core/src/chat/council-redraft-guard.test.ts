import { describe, it, expect } from 'vitest';
import {
  isCouncilRedraftInstruction,
  classifyContextGroundedFollowUpIntent,
} from './conversation-grounding.js';
import { buildCouncilRedraftInstruction } from './service.js';

/**
 * Regression guard for the measured routing-drift bug:
 *
 * When the council didn't clear a draft, the redraft appends an instruction as the
 * latest user turn. Its vocabulary (answer/context/intent/improve/better) was tripping
 * the chat-quality branch of classifyContextGroundedFollowUpIntent, so the redraft of
 * "Who wrote Romeo and Juliet?" came back as the "Best next task" engineering memo.
 *
 * The fix: the answer path detects a redraft instruction (isCouncilRedraftInstruction)
 * and bails out of the context-grounded follow-up synthesizer, re-answering the
 * original question instead.
 */

describe('council redraft hijack guard', () => {
  it('detects a real council redraft instruction', () => {
    const instruction = buildCouncilRedraftInstruction({
      realIntent: 'Provide accurate information about the author of Romeo and Juliet',
      recommendedAction: 'reread-intent',
      methodLessons: [],
      missingCapabilities: [],
      concerns: [],
    });
    expect(isCouncilRedraftInstruction(instruction)).toBe(true);
  });

  it('does NOT flag an ordinary user message', () => {
    expect(isCouncilRedraftInstruction('Who wrote Romeo and Juliet?')).toBe(false);
    expect(isCouncilRedraftInstruction('what is the best next step for my project?')).toBe(false);
  });

  it('confirms the redraft text WOULD trip the chat-quality classifier (why the guard is needed)', () => {
    // This is the latent trap the guard protects against: the redraft instruction,
    // if classified as a user follow-up, is read as a "best-next" self-improvement ask.
    const instruction = buildCouncilRedraftInstruction({
      realIntent: 'Provide accurate information about the author of Romeo and Juliet',
      recommendedAction: 'reread-intent',
      methodLessons: [],
      missingCapabilities: [],
      concerns: [],
    });
    const intent = classifyContextGroundedFollowUpIntent(instruction, 'Who wrote Romeo and Juliet?');
    // It classifies as a self-improvement intent — exactly why we must short-circuit
    // BEFORE reaching this classifier when the input is a redraft instruction.
    expect(intent).not.toBeNull();
  });
});
