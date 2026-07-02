import { describe, expect, it } from 'vitest';
import { VaiEngine } from './vai-engine.js';

/**
 * Regression: the "number of pb hommersåk → village weather blurb" class.
 *
 * A canned entity answer used to pass the grounding guard by merely sharing the ENTITY noun
 * ("hommersåk") with the query, while ignoring what was actually ASKED ("number of…", a count).
 * The intent-coverage gate in isResponseGroundedToQuery now refuses an answer that addresses a
 * different question than the one asked. These tests exercise that guard directly (it's private,
 * so reached via a tiny cast) to lock the behavior against re-introduction of demo-seed pollution.
 */
describe('grounding intent-coverage guard', () => {
  const engine = new VaiEngine({ testMode: true } as unknown as ConstructorParameters<typeof VaiEngine>[0]);
  const grounded = (input: string, response: string): boolean =>
    (engine as unknown as { isResponseGroundedToQuery(i: string, r: string): boolean })
      .isResponseGroundedToQuery(input, response);

  it('rejects a count query answered with non-count entity trivia', () => {
    const villageBlurb =
      'Hommersåk is a village in Sandnes municipality in Rogaland county, Norway, on the Ryfylke coast.';
    expect(grounded('number of pb hommersåk', villageBlurb)).toBe(false);
  });

  it('accepts a count query when the answer actually gives a count', () => {
    expect(grounded('number of pb hommersåk', 'There are 2 Pizzabakeren locations in Hommersåk.')).toBe(true);
  });

  it('rejects a phone/contact query answered with generic description', () => {
    const desc = 'Pizzabakeren is a Norwegian pizza chain with locations across the country.';
    expect(grounded('phone number to pizzabakeren hommersåk', desc)).toBe(false);
  });

  it('accepts a phone query when a phone number is present', () => {
    expect(grounded('phone number to pizzabakeren', 'You can reach Pizzabakeren at +47 51 23 45 67.')).toBe(true);
  });

  it('rejects an address query with no address in the answer', () => {
    expect(grounded('address of rema 1000 sandnes', 'Rema 1000 is a Norwegian discount grocery chain.')).toBe(false);
  });

  it('leaves non-intent entity lookups grounded (no false negatives)', () => {
    // "what is X" carries no count/contact/price intent → the token-overlap path still governs.
    const answer = 'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.';
    expect(grounded('what is typescript', answer)).toBe(true);
  });
});
