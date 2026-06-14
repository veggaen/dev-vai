/**
 * Tests for Stage A — the intent resolver. Pure, no model/network.
 * The driving case is the live failure: "what is the price of eth" + a screenshot.
 */
import { describe, it, expect } from 'vitest';
import { resolveIntent } from '../src/consensus/intent-resolver.js';

describe('resolveIntent — value kind', () => {
  it('reads a price question as a price ask', () => {
    expect(resolveIntent('what is the price of eth', '').valueKind).toBe('price');
  });
  it('reads "how much is X worth" as price', () => {
    expect(resolveIntent('how much is bitcoin worth', '').valueKind).toBe('price');
  });
  it('reads a count question as count', () => {
    expect(resolveIntent('how many people live in Oslo', '').valueKind).toBe('count');
  });
  it('reads a when question as date', () => {
    expect(resolveIntent('when was Ethereum founded', '').valueKind).toBe('date');
  });
  it('reads an explanatory question as none', () => {
    expect(resolveIntent('explain how closures work', '').valueKind).toBe('none');
  });
});

describe('resolveIntent — current value (guess "today")', () => {
  it('a price ask wants the CURRENT value by default (the user means today)', () => {
    const r = resolveIntent('what is the price of eth', '');
    expect(r.wantsCurrentValue).toBe(true);
  });
  it('a price ask with an explicit past date does NOT want the current value', () => {
    const r = resolveIntent('what was the price of eth in 2021', '');
    expect(r.wantsCurrentValue).toBe(false);
    expect(r.hasExplicitPastDate).toBe(true);
  });
  it('"current CEO" wants the current value', () => {
    const r = resolveIntent('who is the current CEO of OpenAI', '');
    expect(r.wantsCurrentValue).toBe(true);
  });
  it('a plain explanatory ask does not want a current value', () => {
    expect(resolveIntent('explain how closures work', '').wantsCurrentValue).toBe(false);
  });
});

describe('resolveIntent — subject anchoring', () => {
  it('anchors "eth" to the whole ethereum alias family', () => {
    const r = resolveIntent('what is the price of eth', '');
    expect(r.subject).toBe('ETH');
    expect(r.subjectAliases).toEqual(expect.arrayContaining(['eth', 'ethereum', 'ether']));
  });
  it('anchors bitcoin', () => {
    const r = resolveIntent('btc price today', '');
    expect(r.subjectAliases).toEqual(expect.arrayContaining(['btc', 'bitcoin']));
  });
  it('does NOT pick USD (the unit) as the subject', () => {
    const r = resolveIntent('what is the price of eth in usd', '');
    expect(r.subject).toBe('ETH');
    expect(r.subjectAliases).not.toContain('usd');
  });
  it('falls back to a draft token for a pronoun-only prompt with an image', () => {
    const r = resolveIntent('what is its price?', 'Solana is trading higher today.', true);
    expect(r.subject).not.toBeNull();
  });
});

describe('resolveIntent — image references', () => {
  it('detects an explicit screenshot reference', () => {
    const r = resolveIntent('look at my screenshot what is the price?', '');
    expect(r.referencesImage).toBe(true);
    expect(r.asksToReadImage).toBe(true);
  });
  it('treats an attached image as a reference even without the word "screenshot"', () => {
    const r = resolveIntent('what is the price of eth', '', /*hasImage*/ true);
    expect(r.referencesImage).toBe(true);
    // value-kind question about an attached image needs the image content
    expect(r.asksToReadImage).toBe(true);
  });
  it('a pure-text price question with no image does not reference an image', () => {
    const r = resolveIntent('what is the price of eth', '', false);
    expect(r.referencesImage).toBe(false);
    expect(r.asksToReadImage).toBe(false);
  });
  it('detects a "read the image" ask', () => {
    const r = resolveIntent('what does this image say?', '', true);
    expect(r.asksToReadImage).toBe(true);
  });
});

describe('resolveIntent — the live failure case', () => {
  it('"look at my screenshot what is the price?" + image → current price, image-anchored', () => {
    const r = resolveIntent('so again look at my screenshot what is the price?', 'The price in your screenshot is $3,200.', true);
    expect(r.valueKind).toBe('price');
    expect(r.wantsCurrentValue).toBe(true);   // user wants TODAY's price, not the stale screenshot
    expect(r.referencesImage).toBe(true);
    expect(r.asksToReadImage).toBe(true);
  });
});
