import { describe, expect, it } from 'vitest';
import {
  formatCorrectedCapitalCurrencyFromBody,
  formatOneWordCapitalFromBody,
  lookupCountryKeyFromCurrencyPrompt,
} from './country-facts.js';

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

describe('capital output contracts', () => {
  it('handles possessive and belonging-to capital phrasing', () => {
    expect(formatOneWordCapitalFromBody("Name Sweden's capital using a single word and nothing else.")).toBe('Stockholm');
    expect(formatOneWordCapitalFromBody('Name the capital belonging to Austria. One word only.')).toBe('Vienna');
  });

  it('applies a spoken country correction before formatting both facts', () => {
    expect(formatCorrectedCapitalCurrencyFromBody(
      'Give the capital of Italy and the currency of Canada. Actually replace Italy with Spain. Use the labels Capital and Currency.',
    )).toBe('Capital: Madrid\nCurrency: CAD');
    expect(formatCorrectedCapitalCurrencyFromBody(
      'Capital of France plus currency of Japan; wait, swap France for Germany. Format as Capital: and Currency:.',
    )).toBe('Capital: Berlin\nCurrency: JPY');
  });
});
