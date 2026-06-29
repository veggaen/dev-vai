import { describe, it, expect } from 'vitest';
import { buildEntityMatcher, escapeRegExp } from '../src/chat/entity-matcher.js';

describe('buildEntityMatcher — preserves old findEntity semantics, one compile', () => {
  const m = buildEntityMatcher(['india', 'norway', 'south korea', 'korea', 'new zealand']);

  it('matches a whole-word key', () => {
    expect(m.match('what about norway today')).toBe('norway');
  });

  it('respects word boundaries (india does NOT match indiana)', () => {
    expect(m.match('i live in indiana')).toBeNull();
  });

  it('matches multi-word keys', () => {
    expect(m.match('moving to south korea soon')).toBe('south korea');
    expect(m.match('a trip to new zealand')).toBe('new zealand');
  });

  it('prefers the longest key on overlap (south korea over korea)', () => {
    expect(m.match('south korea visa')).toBe('south korea');
  });

  it('is case-insensitive in word mode', () => {
    expect(m.match('Visiting NORWAY')).toBe('norway');
  });

  it('returns null when nothing matches', () => {
    expect(m.match('completely unrelated text')).toBeNull();
  });

  it('matchAll returns every distinct key, longest-first', () => {
    expect(m.matchAll('india and norway and south korea')).toEqual(['south korea', 'norway', 'india']);
  });

  it('handles an empty table without throwing', () => {
    const empty = buildEntityMatcher([]);
    expect(empty.match('anything')).toBeNull();
    expect(empty.matchAll('anything')).toEqual([]);
  });

  it('drops blank/duplicate keys', () => {
    const dup = buildEntityMatcher(['  norway ', 'norway', '', '   ']);
    expect(dup.match('norway')).toBe('norway');
  });
});

describe('token boundary mode (acronym semantics — case-sensitive, punctuation-tolerant)', () => {
  const m = buildEntityMatcher(['API', 'HTTP', 'HTTPS'], { boundary: 'token' });

  it('matches an uppercase acronym as a standalone token', () => {
    expect(m.match('what is an API?')).toBe('API');
  });

  it('does not match a lowercase occurrence in prose (case-sensitive)', () => {
    expect(m.match('the api was slow')).toBeNull();
  });

  it('prefers HTTPS over HTTP (longest-first)', () => {
    expect(m.match('explain HTTPS please')).toBe('HTTPS');
  });

  it('does not match inside a larger token', () => {
    expect(m.match('SCRAPI is a tool')).toBeNull(); // API not standalone
  });
});

describe('escapeRegExp', () => {
  it('escapes regex metacharacters so keys like c++ / .net are literal', () => {
    const m = buildEntityMatcher(['c++', '.net']);
    expect(escapeRegExp('c++')).toBe('c\\+\\+');
    expect(m.match('I code in c++')).toBe('c++');
  });
});
