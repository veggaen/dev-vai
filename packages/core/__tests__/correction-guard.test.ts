/**
 * Tests for Stage F — the multi-turn correction guard. Pure, no model/network.
 * Driving case: Vai said $3,200, user said "you where wrong", Vai must not repeat $3,200.
 */
import { describe, it, expect } from 'vitest';
import { checkCorrectionGuard, collectDisputedValues, type CorrectionTurn } from '../src/consensus/correction-guard.js';

const history = (...pairs: [CorrectionTurn['role'], string][]): CorrectionTurn[] =>
  pairs.map(([role, content]) => ({ role, content }));

describe('collectDisputedValues', () => {
  it('flags the assistant value when the user says it was wrong', () => {
    const h = history(
      ['user', 'what is the price of eth'],
      ['assistant', 'The price of ETH is $3,200.00 USD.'],
      ['user', 'you where wrong'],
    );
    const d = collectDisputedValues(h);
    expect(d).toHaveLength(1);
    expect(d[0].value).toBe(3200);
  });

  it('captures the user-offered correction value', () => {
    const h = history(
      ['assistant', 'ETH is $3,200.'],
      ['user', "that's wrong, it's actually 1,680"],
    );
    const d = collectDisputedValues(h);
    expect(d[0].value).toBe(3200);
    expect(d[0].correctedTo).toBe(1680);
  });

  it('does not flag anything without a correction signal', () => {
    const h = history(
      ['assistant', 'ETH is $3,200.'],
      ['user', 'thanks, and what about btc?'],
    );
    expect(collectDisputedValues(h)).toHaveLength(0);
  });
});

describe('checkCorrectionGuard', () => {
  it('blocks a draft that repeats the disputed value (the live failure)', () => {
    const h = history(
      ['user', 'what is the price of eth'],
      ['assistant', 'The price of ETH is $3,200.00 USD.'],
      ['user', 'you where wrong'],
      ['assistant', "I'm sorry, I can't provide real-time data."],
      ['user', 'so again look at my screenshot what is the price?'],
    );
    const guard = checkCorrectionGuard(h, 'The price in your screenshot is $3,200.00 USD.');
    expect(guard.repeatsDisputedValue).toBe(true);
    expect(guard.disputedValue).toBe(3200);
    expect(guard.repeatedToken).toContain('3,200');
  });

  it('allows a draft with the corrected value', () => {
    const h = history(
      ['assistant', 'ETH is $3,200.'],
      ['user', "that's wrong, it's 1,680"],
    );
    const guard = checkCorrectionGuard(h, 'You are right — ETH is about $1,680.');
    expect(guard.repeatsDisputedValue).toBe(false);
  });

  it('allows a draft with a genuinely different value', () => {
    const h = history(
      ['assistant', 'ETH is $3,200.'],
      ['user', 'you are wrong'],
    );
    const guard = checkCorrectionGuard(h, 'ETH is about $1,679.');
    expect(guard.repeatsDisputedValue).toBe(false);
  });

  it('is a no-op when there is no dispute in history', () => {
    const guard = checkCorrectionGuard(history(['user', 'hi'], ['assistant', 'hello']), 'ETH is $3,200.');
    expect(guard.repeatsDisputedValue).toBe(false);
  });

  it('matches within a small tolerance (3,201 ~ 3,200)', () => {
    const h = history(['assistant', 'ETH is $3,200.'], ['user', 'wrong']);
    expect(checkCorrectionGuard(h, 'It is $3,201.').repeatsDisputedValue).toBe(true);
  });
});
