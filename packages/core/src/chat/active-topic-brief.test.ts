import { describe, expect, it } from 'vitest';
import type { Message } from '../models/adapter.js';
import { extractActiveTopicBrief, hasTopicOverlap } from './active-topic-brief.js';

const history: Message[] = [
  { role: 'user', content: 'I am building a Next.js Prisma todo app and want it to stay testable.' },
  { role: 'assistant', content: 'Start with a server action for creating todos and a Prisma migration for the schema. Add a Vitest integration test that hits the action against an in-memory SQLite.' },
];

describe('extractActiveTopicBrief', () => {
  it('extracts content tokens from the last assistant + last user turns', () => {
    const brief = extractActiveTopicBrief('make it better', history);
    expect(brief.hasPriorAssistant).toBe(true);
    // Should include domain tokens from the assistant turn (the user-turn
    // tokens may be capped out by `maxTopicWords` when the assistant turn
    // is long).
    expect(brief.topicWords).toEqual(expect.arrayContaining(['prisma', 'todos', 'vitest']));
  });

  it('strips stop-words and short tokens', () => {
    const brief = extractActiveTopicBrief('go deeper', history);
    expect(brief.topicWords).not.toContain('the');
    expect(brief.topicWords).not.toContain('and');
    expect(brief.topicWords.every((t) => t.length >= 3)).toBe(true);
  });

  it('returns an empty hasPriorAssistant=false brief on first turn', () => {
    const brief = extractActiveTopicBrief('what is the capital of Norway', []);
    expect(brief.hasPriorAssistant).toBe(false);
    expect(brief.topicWords).toEqual(expect.arrayContaining(['capital', 'norway']));
  });

  it('caps topic words and truncates heads', () => {
    const long = 'a '.repeat(500) + 'recursion closure mutex deadlock';
    const brief = extractActiveTopicBrief(long, [
      { role: 'user', content: long },
      { role: 'assistant', content: long },
    ], { maxTopicWords: 4 });
    expect(brief.topicWords.length).toBeLessThanOrEqual(4);
    expect(brief.lastAssistantHead.length).toBeLessThan(260);
  });

  it('includes selectedFiles when provided', () => {
    const brief = extractActiveTopicBrief('make it better', history, {
      selectedFiles: ['src/app/todos/page.tsx'],
    });
    expect(brief.selectedFiles).toEqual(['src/app/todos/page.tsx']);
  });
});

describe('hasTopicOverlap', () => {
  it('returns true when input shares a content token with the brief', () => {
    const brief = extractActiveTopicBrief('make it better', history);
    expect(hasTopicOverlap('how do I test the prisma migration', brief)).toBe(true);
  });

  it('returns true on anaphoric input even with no shared tokens', () => {
    const brief = extractActiveTopicBrief('make it better', history);
    expect(hasTopicOverlap('go deeper', brief)).toBe(true);
    expect(hasTopicOverlap('continue', brief)).toBe(true);
  });

  it('returns false for an unrelated standalone question', () => {
    const brief = extractActiveTopicBrief('make it better', history);
    expect(hasTopicOverlap('what is the capital of Norway', brief)).toBe(false);
  });

  it('returns false for an empty brief and non-anaphoric input', () => {
    const brief = extractActiveTopicBrief('anything', []);
    expect(hasTopicOverlap('what is recursion', brief)).toBe(false);
  });

  it('matches case-insensitively on shared tokens', () => {
    const brief = extractActiveTopicBrief('x', history);
    expect(hasTopicOverlap('PRISMA migration question', brief)).toBe(true);
  });

  it.each([
    'tell me more about it',
    'same thing again',
    'expand on that',
    'keep going',
  ])('treats anaphoric phrase %j as overlap', (input) => {
    const brief = extractActiveTopicBrief('x', history);
    expect(hasTopicOverlap(input, brief)).toBe(true);
  });

  it('does not treat a single shared stop-word as overlap', () => {
    const brief = extractActiveTopicBrief('x', history);
    // "the" and "and" are stop-words and won't appear in topicWords, so
    // an input made of only stop-words + a non-overlapping noun must not
    // match.
    expect(hasTopicOverlap('what is gravity', brief)).toBe(false);
  });
});
