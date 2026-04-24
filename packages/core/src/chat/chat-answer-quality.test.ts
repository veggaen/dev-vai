import { describe, expect, it } from 'vitest';
import { evaluateChatAnswerQuality } from './chat-answer-quality.js';
import type { ConversationGrounding } from './conversation-grounding.js';

const grounding: ConversationGrounding = {
  topic: 'Vai chat context relevance',
  previousUser: 'The chat app sends user profile, selected files, and the last 8 messages as context into Vai.',
  previousAssistant: 'That context bundle should guide the response and prevent generic answers.',
  contextText: 'The chat app sends user profile, selected files, and the last 8 messages as context into Vai. That context bundle should guide the response and prevent generic answers.',
  keywords: ['Vai', 'user context', 'response relevance', 'teacher loop'],
  requestedOutcome: 'choose the highest-leverage next engineering task for Vai chat relevance',
  constraints: ['Vai remains the primary answerer', 'preserve current user context'],
};

describe('evaluateChatAnswerQuality', () => {
  it('passes grounded actionable answers that preserve topic and constraints', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'What would be the best next thing to improve relevance?',
      response: '**Best next task**\nImplement a local context-grounding pass before broad retrieval. Preserve current user context, keep Vai as the primary answerer while external LLMs stay optional critics, and add regression tests for vague follow-ups.',
      grounding,
      strategy: 'context-grounded-followup',
    });

    expect(report.verdict).toBe('pass');
    expect(report.missing.some((requirement) => requirement.kind === 'topic' || requirement.kind === 'drift')).toBe(false);
  });

  it('fails when the answer drifts into known unrelated snippet smells', () => {
    const report = evaluateChatAnswerQuality({
      prompt: 'What would be the best next thing to improve relevance?',
      response: 'Start with goroutines and slices, then compare a Swedish exam rubric before thinking about Vai.',
      grounding,
      strategy: 'context-grounded-followup',
    });

    expect(report.verdict).toBe('fail');
    expect(report.missing.some((requirement) => requirement.kind === 'drift')).toBe(true);
  });
});