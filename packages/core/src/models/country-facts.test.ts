import { describe, expect, it } from 'vitest';
import { lookupCountryKeyFromCurrencyPrompt } from './country-facts.js';

describe('country fact prompt lookup', () => {
  it.each([
    ['what currency code does Norway use?', 'norway'],
    ['and what ISO currency code does Sweden use? only the code this time', 'sweden'],
    ['currency code for Denmark?', 'denmark'],
    ['currency code of Finland.', 'finland'],
  ])('recognizes natural currency wording: %s', (prompt, expected) => {
    expect(lookupCountryKeyFromCurrencyPrompt(prompt)).toBe(expected);
  });
});
