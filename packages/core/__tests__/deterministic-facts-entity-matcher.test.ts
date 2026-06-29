import { describe, it, expect } from 'vitest';
import { tryEmitFactShim } from '../src/chat/deterministic-facts-router.js';

/**
 * Guards the compile-once entity-matcher refactor of the fact router's hot path.
 * The old code rebuilt ~570+ regexes per turn across the country/company/brand/
 * person/acronym/definition/compare loops; these assert the new single-compile
 * matchers preserve the answer behavior (and the word-boundary correctness that
 * stops "india" matching "indiana").
 */
describe('fact shim — entity matching after compile-once refactor', () => {
  const ask = (content: string) => tryEmitFactShim({ content });

  it('still resolves a country fact (findEntity path)', () => {
    const r = ask('what is the capital of norway?');
    expect(r?.kind?.startsWith('fact')).toBe(true);
    expect(r?.reply.toLowerCase()).toContain('oslo');
  });

  it('respects word boundaries — "indiana" must not match "india"', () => {
    const r = ask('tell me about indiana');
    // Either no country fact, or not the India fact. Must not claim New Delhi.
    expect(r?.reply?.toLowerCase() ?? '').not.toContain('new delhi');
  });

  it('still resolves a person fact (tryPerson path)', () => {
    const r = ask('when was elon musk born?');
    expect(r?.kind).toBe('fact-person');
    expect(r?.reply.toLowerCase()).toContain('elon musk');
  });

  it('resolves a multi-word person without partial-token bleed', () => {
    const r = ask('who is carl sagan');
    expect(r?.kind).toBe('fact-person');
  });

  it('still resolves an acronym (token mode, case-sensitive uppercase)', () => {
    const r = ask('what does HTTP stand for?');
    expect(r?.kind).toBe('fact-acronym');
  });

  it('does not fire the acronym handler on a lowercase prose occurrence', () => {
    // "http" lowercased in prose should not be treated as the standalone acronym.
    const r = ask('the http call was slow, what should i check?');
    expect(r?.kind).not.toBe('fact-acronym');
  });

  it('still resolves a definition (tryDefinition path)', () => {
    const r = ask('what is a hash table?');
    expect(r?.kind).toBe('fact-definition');
    expect(r?.reply.toLowerCase()).toContain('hash');
  });

  it('still resolves a curated comparison pair (tryCompare path)', () => {
    const r = ask('redis vs memcached, which should i use?');
    expect(r?.kind).toBe('compare-pair');
  });

  it('does not fire a compare pair when only one term is present', () => {
    const r = ask('should i use redis for caching?');
    expect(r?.kind).not.toBe('compare-pair');
  });
});
