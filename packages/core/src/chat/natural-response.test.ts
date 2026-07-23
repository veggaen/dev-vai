import { describe, expect, it } from 'vitest';
import { unwrapNaturalLanguageResponseEnvelope } from './natural-response.js';

describe('unwrapNaturalLanguageResponseEnvelope', () => {
  it('unwraps a one-field response object for an ordinary question', () => {
    const response = '```json\n{"response":"Admission starts at 395 kr."}\n```';
    expect(unwrapNaturalLanguageResponseEnvelope('What does it cost to visit?', response))
      .toBe('Admission starts at 395 kr.');
  });

  it('preserves JSON when the user explicitly requests it', () => {
    const response = '{"response":"Admission starts at 395 kr."}';
    expect(unwrapNaturalLanguageResponseEnvelope('Return the answer as JSON', response)).toBe(response);
  });

  it('preserves real structured payloads and non-JSON prose', () => {
    const structured = '{"response":"ok","currency":"NOK"}';
    expect(unwrapNaturalLanguageResponseEnvelope('What does it cost?', structured)).toBe(structured);
    expect(unwrapNaturalLanguageResponseEnvelope('What does it cost?', 'It starts at 395 kr.'))
      .toBe('It starts at 395 kr.');
  });
});
