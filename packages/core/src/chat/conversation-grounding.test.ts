import { describe, expect, it } from 'vitest';
import type { ConversationGroundingDependencies } from './conversation-grounding.js';
import {
  buildConversationGrounding,
  classifyContextGroundedFollowUpIntent,
  shouldDeferContextGroundedFollowUp,
} from './conversation-grounding.js';

const deps: ConversationGroundingDependencies = {
  inferRecentFollowUpTopic: (history) => {
    const combined = history.map((message) => message.content).join('\n');
    if (/react/i.test(combined) && /hooks/i.test(combined)) return 'React hooks';
    if (/vai/i.test(combined) && /chat/i.test(combined)) return 'Vai chat context relevance';
    return null;
  },
  isStableFollowUpTopic: (topic) => topic.trim().length > 0 && topic !== 'general',
  condenseStableFollowUpTopic: (text) => text.replace(/^no,?\s*i mean\s*/i, '').trim(),
  detectTopic: (text) => {
    if (/vai/i.test(text) && /chat/i.test(text)) return 'Vai chat context relevance';
    if (/next\.?js/i.test(text) && /prisma/i.test(text) && /todo/i.test(text)) return 'Next.js Prisma todo app';
    if (/react/i.test(text) && /hooks/i.test(text)) return 'React hooks';
    return 'general';
  },
  topicStopWords: new Set(['the', 'and', 'with', 'that', 'this', 'from', 'into']),
};

describe('conversation grounding', () => {
  it('builds a grounded brief with requested outcome and constraints for Vai chat follow-ups', () => {
    const grounding = buildConversationGrounding(
      'Go deeper on that. Make it stronger with automated teacher loops, but do not make external LLMs the main brain.',
      [
        { role: 'user', content: 'I am building Vai chat and need responses to stay relevant to user context instead of drifting into weird snippets.' },
        { role: 'assistant', content: 'The best next task is a context-grounded answer contract before broad retrieval.' },
        { role: 'user', content: 'Go deeper on that. Make it stronger with automated teacher loops, but do not make external LLMs the main brain.' },
      ],
      deps,
    );

    expect(grounding?.topic).toBe('Vai chat context relevance');
    expect(grounding?.requestedOutcome).toMatch(/(?:improve Vai chat relevance|highest-leverage next engineering task)/i);
    expect(grounding?.constraints).toContain('Vai remains the primary answerer');
    expect(grounding?.keywords).toEqual(expect.arrayContaining(['Vai', 'teacher loop']));
  });

  it('defers grounded synthesis when the user is asking to build right now', () => {
    expect(shouldDeferContextGroundedFollowUp('Can you make it now for me?', [
      { role: 'assistant', content: 'I would harden the current app first.' },
      { role: 'user', content: 'Can you make it now for me?' },
    ])).toBe(true);
  });

  it('classifies best-next and simplification follow-ups from grounded context', () => {
    expect(classifyContextGroundedFollowUpIntent('what would be the best next thing to improve relevance?', 'Vai chat context relevance')).toBe('best-next');
    expect(classifyContextGroundedFollowUpIntent('can you explain that more simply?', 'React hooks')).toBe('simple-explain');
  });
});