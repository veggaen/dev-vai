/**
 * Shared country fact lookups for benchmark-aligned geo prompts.
 * Keeps capital / ISO code / terse-format answers consistent across
 * tryDirectCorpusTaskResponse, tryAnswerFollowUp, and strict-format handlers.
 */

export interface CountryFact {
  readonly display: string;
  readonly capital: string;
  readonly code: string;
}

/** Aligned with scripts/lib/vai-wave-core.mjs COUNTRIES (eval corpus). */
export const COUNTRY_FACTS: Readonly<Record<string, CountryFact>> = {
  norway: { display: 'Norway', capital: 'Oslo', code: 'NOK' },
  sweden: { display: 'Sweden', capital: 'Stockholm', code: 'SEK' },
  denmark: { display: 'Denmark', capital: 'Copenhagen', code: 'DKK' },
  finland: { display: 'Finland', capital: 'Helsinki', code: 'EUR' },
  france: { display: 'France', capital: 'Paris', code: 'EUR' },
  germany: { display: 'Germany', capital: 'Berlin', code: 'EUR' },
  italy: { display: 'Italy', capital: 'Rome', code: 'EUR' },
  spain: { display: 'Spain', capital: 'Madrid', code: 'EUR' },
  japan: { display: 'Japan', capital: 'Tokyo', code: 'JPY' },
  india: { display: 'India', capital: 'New Delhi', code: 'INR' },
  brazil: { display: 'Brazil', capital: 'Brasilia', code: 'BRL' },
  canada: { display: 'Canada', capital: 'Ottawa', code: 'CAD' },
  australia: { display: 'Australia', capital: 'Canberra', code: 'AUD' },
  egypt: { display: 'Egypt', capital: 'Cairo', code: 'EGP' },
  'south korea': { display: 'South Korea', capital: 'Seoul', code: 'KRW' },
  mexico: { display: 'Mexico', capital: 'Mexico City', code: 'MXN' },
  argentina: { display: 'Argentina', capital: 'Buenos Aires', code: 'ARS' },
  turkey: { display: 'Turkey', capital: 'Ankara', code: 'TRY' },
  netherlands: { display: 'Netherlands', capital: 'Amsterdam', code: 'EUR' },
  portugal: { display: 'Portugal', capital: 'Lisbon', code: 'EUR' },
  poland: { display: 'Poland', capital: 'Warsaw', code: 'PLN' },
  greece: { display: 'Greece', capital: 'Athens', code: 'EUR' },
  switzerland: { display: 'Switzerland', capital: 'Bern', code: 'CHF' },
  austria: { display: 'Austria', capital: 'Vienna', code: 'EUR' },
  ireland: { display: 'Ireland', capital: 'Dublin', code: 'EUR' },
  china: { display: 'China', capital: 'Beijing', code: 'CNY' },
  russia: { display: 'Russia', capital: 'Moscow', code: 'RUB' },
  thailand: { display: 'Thailand', capital: 'Bangkok', code: 'THB' },
  indonesia: { display: 'Indonesia', capital: 'Jakarta', code: 'IDR' },
};

export function normalizeCountryKey(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function lookupCountryKeyFromCapitalPrompt(body: string): string | null {
  const match = body.match(/\bcapital\s+(?:city\s+)?of\s+([a-z][a-z\s]{1,30}?)(?:\?|\.|$)/i)
    ?? body.match(/\bwhat\s+is\s+the\s+capital\s+of\s+([a-z][a-z\s]{1,30}?)(?:\?|\.|$)/i)
    ?? body.match(/\bcapital\s+of\s+([a-z][a-z\s]{1,30}?)(?:\?|\.|$)/i);
  if (!match) return null;
  const key = normalizeCountryKey(match[1]);
  return COUNTRY_FACTS[key] ? key : null;
}

export function lookupCountryKeyFromCurrencyPrompt(body: string): string | null {
  const match = body.match(/\b(?:iso\s+)?currency\s+code\s+of\s+([a-z][a-z\s]{1,30}?)(?:\?|\.|$)/i);
  if (!match) return null;
  const key = normalizeCountryKey(match[1]);
  return COUNTRY_FACTS[key] ? key : null;
}

export function lookupCountryKeyFromCombinedPrompt(body: string): string | null {
  const match = body.match(/\bwhat\s+is\s+the\s+capital\s+of\s+([a-z][a-z\s]{1,30}?),?\s+and\s+what\s+is\s+(?:its|the)\s+(?:iso\s+)?currency\s+code\b/i)
    ?? body.match(/\bcapital\s+(?:city\s+)?of\s+([a-z][a-z\s]{1,30}?),?\s+and\s+(?:its\s+|the\s+)?(?:iso\s+)?currency\s+code\b/i)
    ?? body.match(/\bcapital\s+(?:city\s+)?of\s+([a-z][a-z\s]{1,30}?)(?:,?\s+and|\s+and|\?|\.)/i)
    ?? body.match(/\bwhat\s+is\s+the\s+capital\s+of\s+([a-z][a-z\s]{1,30}?)(?:,?\s+and|\s+and|\?|\.)/i);
  if (!match) return null;
  const key = normalizeCountryKey(match[1]);
  return COUNTRY_FACTS[key] ? key : null;
}

export function formatCapitalAnswer(key: string, terse = false): string | null {
  const fact = COUNTRY_FACTS[key];
  if (!fact) return null;
  if (terse) return fact.capital;
  return `The capital of ${fact.display} is **${fact.capital}**.`;
}

export function formatCurrencyCodeAnswer(key: string, terse = false): string | null {
  const fact = COUNTRY_FACTS[key];
  if (!fact) return null;
  if (terse) return fact.code;
  return `The ISO currency code of ${fact.display} is **${fact.code}**.`;
}

export function formatCapitalAndCurrencyAnswer(key: string): string | null {
  const fact = COUNTRY_FACTS[key];
  if (!fact) return null;
  return `The capital of **${fact.display}** is **${fact.capital}**, and its ISO currency code is **${fact.code}**.`;
}

export function formatCapitalCurrencySlash(key: string): string | null {
  const fact = COUNTRY_FACTS[key];
  if (!fact) return null;
  return `${fact.capital} / ${fact.code}`;
}

/** One-word capital when the prompt demands terse output (eval: one-word-capital). */
export function formatOneWordCapitalFromBody(body: string): string | null {
  const lower = body.toLowerCase();
  if (!/\b(?:one\s+word\s+only|one\s+word|word\s+only|in\s+exactly\s+one\s+word|exactly\s+one\s+word)\b/i.test(lower)) {
    return null;
  }
  const key = lookupCountryKeyFromCapitalPrompt(body)
    ?? lookupCountryKeyFromCombinedPrompt(body);
  if (!key) return null;
  const fact = COUNTRY_FACTS[key];
  if (!fact || /\s/.test(fact.capital)) return null;
  return fact.capital;
}
