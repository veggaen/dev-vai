import { describe, expect, it } from 'vitest';
import { draftContainsCode, isCodeGenerationPrompt, shouldPeerReviewCode } from './code-review-policy.js';

describe('isCodeGenerationPrompt', () => {
  it('detects explicit code-generation asks', () => {
    expect(isCodeGenerationPrompt('Write a React hook for debounced search')).toBe(true);
    expect(isCodeGenerationPrompt('Fix the login API handler')).toBe(true);
  });

  it('detects fenced code in the prompt', () => {
    expect(isCodeGenerationPrompt('Refactor this:\n```ts\nconst x = 1\n```')).toBe(true);
  });

  it('detects language + ask phrasing', () => {
    expect(isCodeGenerationPrompt('How do I write a Python script to parse CSV?')).toBe(true);
  });

  it('returns false for non-code chat', () => {
    expect(isCodeGenerationPrompt('What is the difference between REST and GraphQL?')).toBe(false);
    expect(isCodeGenerationPrompt('')).toBe(false);
  });
});

describe('draftContainsCode', () => {
  it('detects fenced blocks', () => {
    expect(draftContainsCode('Here you go:\n```tsx\nexport const App = () => null\n```')).toBe(true);
  });

  it('detects builder file blocks', () => {
    expect(draftContainsCode('file: src/App.tsx\nexport const App = () => null')).toBe(true);
  });

  it('returns false for prose-only drafts', () => {
    expect(draftContainsCode('REST is simpler for CRUD APIs.')).toBe(false);
  });
});

describe('shouldPeerReviewCode', () => {
  it('requires both a code ask and code in the draft', () => {
    const prompt = 'Implement a debounce hook in TypeScript';
    const draft = '```ts\nexport function useDebounce() {}\n```';
    expect(shouldPeerReviewCode(prompt, draft)).toBe(true);
  });

  it('skips when draft has no code artifact', () => {
    expect(shouldPeerReviewCode('Write a debounce hook', 'Use lodash debounce.')).toBe(false);
  });
});
