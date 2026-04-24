import { describe, expect, it } from 'vitest';
import {
  extractTopicFromQuery,
  topicContentTokens,
  textConcernsTopic,
  normalizeInputForUnderstanding,
  detectRegister,
} from './input-normalization.js';

describe('extractTopicFromQuery', () => {
  it('strips "what do you know of/about/on/regarding X"', () => {
    expect(extractTopicFromQuery('what do you know of redbull')).toBe('redbull');
    expect(extractTopicFromQuery('what do you know about redbull')).toBe('redbull');
    expect(extractTopicFromQuery('what do you know on redbull')).toBe('redbull');
    expect(extractTopicFromQuery('what do you know regarding redbull?')).toBe('redbull');
    expect(extractTopicFromQuery('What do you know around docker containers')).toBe('docker containers');
  });

  it('strips "do you know about/of X"', () => {
    expect(extractTopicFromQuery('do you know about react hooks?')).toBe('react hooks');
    expect(extractTopicFromQuery('do you know of vinext')).toBe('vinext');
  });

  it('strips "have you heard of/about X"', () => {
    expect(extractTopicFromQuery('have you heard of vinext?')).toBe('vinext');
    expect(extractTopicFromQuery('have you ever heard about prisma')).toBe('prisma');
  });

  it('strips "tell me about/of X" including stacked prepositions', () => {
    expect(extractTopicFromQuery('tell me about redbull')).toBe('redbull');
    expect(extractTopicFromQuery('tell me more about typescript')).toBe('typescript');
    // Stacked: framing strip leaves "of typescript", residual strip cleans it.
    expect(extractTopicFromQuery('tell me about of typescript please')).toBe('typescript');
  });

  it('strips definitional / explanatory framings', () => {
    expect(extractTopicFromQuery('what is kubernetes')).toBe('kubernetes');
    expect(extractTopicFromQuery("what's docker?")).toBe('docker');
    expect(extractTopicFromQuery('what are microservices')).toBe('microservices');
    expect(extractTopicFromQuery('explain docker simply')).toBe('docker');
    expect(extractTopicFromQuery('please describe redis')).toBe('redis');
    expect(extractTopicFromQuery('define graphql')).toBe('graphql');
  });

  it('strips "can you" / "could you" wrappers', () => {
    expect(extractTopicFromQuery('can you tell me about postgres')).toBe('postgres');
    expect(extractTopicFromQuery('could you explain rust to me')).toBe('rust to me');
    expect(extractTopicFromQuery('can you summarize webrtc')).toBe('webrtc');
  });

  it('strips "I want/need to know X" framings', () => {
    expect(extractTopicFromQuery('i want to know about deno')).toBe('deno');
    expect(extractTopicFromQuery('I would like to learn regarding bun')).toBe('bun');
  });

  it('strips trailing fillers and qualifiers', () => {
    expect(extractTopicFromQuery('what is docker please')).toBe('docker');
    expect(extractTopicFromQuery('explain typescript in simple words')).toBe('typescript');
    expect(extractTopicFromQuery('what is kubernetes for beginners')).toBe('kubernetes');
    expect(extractTopicFromQuery('what is rust eli5')).toBe('rust');
    expect(extractTopicFromQuery('what is graphql and why')).toBe('graphql');
  });

  it('strips Norwegian framings (Bokmål + Nynorsk)', () => {
    expect(extractTopicFromQuery('hva er docker')).toBe('docker');
    expect(extractTopicFromQuery('kva er rust')).toBe('rust');
    expect(extractTopicFromQuery('fortell meg om react')).toBe('react');
    expect(extractTopicFromQuery('hvordan fungerer kubernetes')).toBe('kubernetes');
  });

  it('strips wrapping quotes and punctuation', () => {
    expect(extractTopicFromQuery('"what do you know about docker?"')).toBe('docker');
    expect(extractTopicFromQuery("'tell me about redis'")).toBe('redis');
    expect(extractTopicFromQuery('what is docker!!!')).toBe('docker');
  });

  it('preserves multi-word topics intact', () => {
    expect(extractTopicFromQuery('what do you know about server side rendering'))
      .toBe('server side rendering');
    expect(extractTopicFromQuery('explain edge functions on vercel'))
      .toBe('edge functions on vercel');
  });

  it('returns the original (sans noise) when stripping consumes everything', () => {
    expect(extractTopicFromQuery('what do you know')).toBe('what do you know');
    expect(extractTopicFromQuery('?')).toBe('');
    expect(extractTopicFromQuery('  ')).toBe('');
  });

  it('does not crash on non-string input', () => {
    expect(extractTopicFromQuery(undefined as unknown as string)).toBe('');
    expect(extractTopicFromQuery(null as unknown as string)).toBe('');
  });

  it('collapses repeated whitespace', () => {
    expect(extractTopicFromQuery('what  is    docker')).toBe('docker');
  });
});

describe('normalizeInputForUnderstanding (sanity)', () => {
  it('preserves topic content while fixing typos', () => {
    expect(normalizeInputForUnderstanding('whats docker')).toBe('what is docker');
  });
});

describe('detectRegister (sanity)', () => {
  it('flags terse short queries', () => {
    expect(detectRegister('docker')).toBe('terse');
  });
  it('flags teach-me framings', () => {
    expect(detectRegister('teach me docker step by step')).toBe('teach-me');
  });
});

describe('topicContentTokens', () => {
  it('returns lowercased non-stopword tokens', () => {
    expect(topicContentTokens('React Server Components')).toEqual(['react', 'server', 'components']);
    expect(topicContentTokens('redbull')).toEqual(['redbull']);
  });

  it('drops closed-class words and short tokens', () => {
    expect(topicContentTokens('the of a')).toEqual([]);
    expect(topicContentTokens('what is docker')).toEqual(['docker']);
  });

  it('handles empty / non-string input', () => {
    expect(topicContentTokens('')).toEqual([]);
    expect(topicContentTokens(undefined as unknown as string)).toEqual([]);
  });

  it('splits on punctuation', () => {
    expect(topicContentTokens('docker, kubernetes')).toEqual(['docker', 'kubernetes']);
  });
});

describe('textConcernsTopic', () => {
  it('matches when any content token appears as a whole word', () => {
    expect(textConcernsTopic('Docker is a container runtime.', 'docker')).toBe(true);
    expect(textConcernsTopic('Docker is a container runtime.', 'kubernetes')).toBe(false);
  });

  it('does not partial-match across word boundaries', () => {
    // "react" should NOT match "reaction" — would otherwise leak unrelated docs.
    expect(textConcernsTopic('Chemical reaction of sodium.', 'react')).toBe(false);
    expect(textConcernsTopic('React hooks are great.', 'react')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(textConcernsTopic('REDBULL is a brand.', 'redbull')).toBe(true);
  });

  it('returns true vacuously when topic has no content tokens', () => {
    expect(textConcernsTopic('anything at all', 'the of a')).toBe(true);
  });

  it('handles multi-word topics by OR-ing tokens', () => {
    expect(textConcernsTopic('Postgres is a relational database.', 'redis postgres'))
      .toBe(true);
  });

  it('rejects empty/non-string text', () => {
    expect(textConcernsTopic('', 'docker')).toBe(false);
    expect(textConcernsTopic(undefined as unknown as string, 'docker')).toBe(false);
  });
});
