import { describe, expect, it } from 'vitest';
import {
  classifyQuestionIntent,
  isActionYesNoQuestion,
  splitCompoundQuestion,
  combineCompoundAnswers,
} from './question-intent.js';

describe('classifyQuestionIntent', () => {
  it('classifies action yes/no questions', () => {
    expect(classifyQuestionIntent('does starbucks make cappuccino?')).toBe('action-yesno');
    expect(classifyQuestionIntent('do they sell oat milk?')).toBe('action-yesno');
    expect(classifyQuestionIntent('can dogs eat chocolate?')).toBe('action-yesno');
  });

  it('does NOT treat a copular "is X?" as an action question', () => {
    expect(classifyQuestionIntent('is the sky blue?')).not.toBe('action-yesno');
    expect(classifyQuestionIntent('what is starbucks?')).toBe('definition');
  });

  it('classifies definitions and factual lookups', () => {
    expect(classifyQuestionIntent('what is docker?')).toBe('definition');
    expect(classifyQuestionIntent('who is elon musk?')).toBe('definition');
    expect(classifyQuestionIntent('what is the capital of france?')).toBe('factual-lookup');
  });

  it('classifies build and meta intents', () => {
    expect(classifyQuestionIntent('build me a todo app')).toBe('build');
    expect(classifyQuestionIntent('what was my first message?')).toBe('meta');
  });

  it('isActionYesNoQuestion matches the classifier', () => {
    expect(isActionYesNoQuestion('does tesla make phones?')).toBe(true);
    expect(isActionYesNoQuestion('what is a vpn?')).toBe(false);
  });
});

describe('splitCompoundQuestion', () => {
  it('splits two clear yes/no sub-questions', () => {
    expect(splitCompoundQuestion('is the sky blue and is grass green?')).toEqual([
      'is the sky blue?', 'is grass green?',
    ]);
    expect(splitCompoundQuestion('does starbucks make cappuccino and does mcdonalds sell burgers?')).toEqual([
      'does starbucks make cappuccino?', 'does mcdonalds sell burgers?',
    ]);
  });

  it('does NOT split statements or adjective lists', () => {
    expect(splitCompoundQuestion('the app is fast and reliable')).toBeNull();
    expect(splitCompoundQuestion('are you fast and reliable')).toBeNull(); // "reliable" < 3 words
  });

  it('does NOT split build instructions or single questions', () => {
    expect(splitCompoundQuestion('build an app and add auth')).toBeNull();
    expect(splitCompoundQuestion('what is the capital of france?')).toBeNull();
  });

  it('does NOT split a single comparison question', () => {
    // Regression: this used to split into two parts and lose the cited-research route.
    expect(splitCompoundQuestion('What is SearXNG and why would I use it over DuckDuckGo Instant Answer API?')).toBeNull();
    expect(splitCompoundQuestion('what is the difference between react and vue?')).toBeNull();
  });

  it('never splits code/build payloads', () => {
    expect(splitCompoundQuestion('```ts title="a.ts" and ```')).toBeNull();
  });

  it('combines answers with blank-line separation', () => {
    expect(combineCompoundAnswers(['Yes, the sky is blue.', 'Yes, grass is green.']))
      .toBe('Yes, the sky is blue.\n\nYes, grass is green.');
  });
});
