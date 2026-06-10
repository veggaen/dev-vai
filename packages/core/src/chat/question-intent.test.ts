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
    expect(classifyQuestionIntent('does spotify have podcasts?')).toBe('action-yesno');
    expect(classifyQuestionIntent('can dogs eat chocolate?')).toBe('action-yesno');
  });

  it('does NOT treat a copular "is X?" as an action question', () => {
    expect(classifyQuestionIntent('is the sky blue?')).not.toBe('action-yesno');
    expect(classifyQuestionIntent('what is starbucks?')).toBe('definition');
  });

  it('leaves conversational you/we prompts to the conversation and builder routes', () => {
    expect(classifyQuestionIntent('can you make me a website?')).toBe('other');
    expect(classifyQuestionIntent('can we use something of our own?')).toBe('other');
  });

  it('classifies definitions and factual lookups', () => {
    expect(classifyQuestionIntent('what is docker?')).toBe('definition');
    expect(classifyQuestionIntent('who is elon musk?')).toBe('definition');
    expect(classifyQuestionIntent('what is the capital of france?')).toBe('factual-lookup');
  });

  it('classifies local recommendations before generic what-are definitions', () => {
    expect(classifyQuestionIntent('what are good resturants in Hommersåk Norway?')).toBe('recommendation');
  });

  it('classifies build and meta intents', () => {
    expect(classifyQuestionIntent('build me a todo app')).toBe('build');
    expect(classifyQuestionIntent('what was my first message?')).toBe('meta');
  });

  it('does not treat explicit research prompts as action yes/no', () => {
    expect(classifyQuestionIntent('do research on remote work burnout')).toBe('other');
    expect(isActionYesNoQuestion('do research on remote work burnout')).toBe(false);
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

  it('expands an elliptical repeated property lookup', () => {
    expect(splitCompoundQuestion('what is the capital of france and the capital of germany?')).toEqual([
      'what is the capital of france?', 'what is the capital of germany?',
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

  it('strips a conversational lead-in before splitting', () => {
    // Replaces the removed hard-coded tryMixedMathPlanetCompound shim.
    expect(splitCompoundQuestion('okay then — what is 144 divided by 12 and which planet is closest to the sun')).toEqual([
      'what is 144 divided by 12?', 'which planet is closest to the sun?',
    ]);
    expect(splitCompoundQuestion('okay then try this, what is 13 plus 8 minus 2 and what is the capital of Norway?')).toEqual([
      'what is 13 plus 8 minus 2?', 'what is the capital of Norway?',
    ]);
    expect(splitCompoundQuestion('okay then try this, what is 13 plus 8 minus 2, and what is the capital of Norway? reply with the math result and capital only')).toEqual([
      'what is 13 plus 8 minus 2?', 'what is the capital of Norway?',
    ]);
    expect(splitCompoundQuestion('i need 2 things, 23 plus 9 minus 1, and the capital city of Denmark. answer only with the result and the city')).toEqual([
      'what is 23 plus 9 minus 1?', 'what is the capital city of Denmark?',
    ]);
    expect(splitCompoundQuestion('hello quick question: tell me the capital of Sweden and also work out 10 + 10 - 6. just give me both answers pls')).toEqual([
      'what is the capital of Sweden?', 'what is 10 + 10 - 6?',
    ]);

    // Voice / dictation style leads and connectives (common when speaking to chat)
    expect(splitCompoundQuestion('hey so tell me the capital of france and the capital of norway')).toEqual([
      'what is the capital of france?',
      'what is the capital of norway?',
    ]);
    expect(splitCompoundQuestion('and tell me what is 7 plus 8 and also what is the capital of denmark')).toEqual([
      'what is 7 plus 8?',
      'what is the capital of denmark?',
    ]);
  });

  it('never splits code/build payloads', () => {
    expect(splitCompoundQuestion('```ts title="a.ts" and ```')).toBeNull();
  });

  it('combines answers with blank-line separation (no subs)', () => {
    expect(combineCompoundAnswers(['Yes, the sky is blue.', 'Yes, grass is green.']))
      .toBe('Yes, the sky is blue.\n\nYes, grass is green.');
  });

  it('combines with labeled headings when subQuestions provided (voice-friendly multi-part)', () => {
    const parts = ['what is the capital of france', 'what is the capital of germany'];
    const answers = ['Paris.', 'Berlin.'];
    const out = combineCompoundAnswers(answers, parts);
    expect(out).toContain('**what is the capital of france?**');
    expect(out).toContain('Paris.');
    expect(out).toContain('**what is the capital of germany?**');
    expect(out).toContain('Berlin.');
  });
});
