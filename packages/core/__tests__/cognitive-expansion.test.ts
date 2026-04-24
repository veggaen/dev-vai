import { describe, it, expect } from 'vitest';
import {
  KnowledgeStore,
  sourceTier,
  expandSynonyms,
} from '../src/models/knowledge-store.js';
import { detectRegister } from '../src/input-normalization.js';

describe('sourceTier ranking', () => {
  it('ranks bootstrap highest and falls through to web', () => {
    expect(sourceTier('bootstrap:testing-tools')).toBe(5);
    expect(sourceTier('user-taught')).toBe(4);
    expect(sourceTier('vcus:curated')).toBe(3);
    expect(sourceTier('auto-learned')).toBe(2);
    expect(sourceTier('https://example.com')).toBe(1);
    expect(sourceTier('youtube')).toBe(1);
  });
});

describe('KnowledgeStore source-tier replace-if-better', () => {
  it('upgrades auto-learned entry when user teaches the same pattern', () => {
    const store = new KnowledgeStore();
    store.addEntry('docker', 'old auto summary', 'auto-learned', 'en');
    store.addEntry(
      'docker',
      'Docker is a container platform that packages apps with their dependencies into lightweight, reproducible images.',
      'user-taught',
      'en',
    );
    const match = store.findBestMatch('docker');
    expect(match?.source).toBe('user-taught');
    expect(match?.response).toContain('container platform');
  });

  it('does NOT downgrade bootstrap entry with a later web scrape', () => {
    const store = new KnowledgeStore();
    const canonical = 'Vitest is the fastest TS test runner in 2026; Vite-powered, ESM-native, Jest-compatible.';
    store.addEntry('vitest', canonical, 'bootstrap:testing-tools-2026', 'en');
    store.addEntry('vitest', 'Some random scraped blog paragraph about JavaScript.', 'https://random.blog/post', 'en');
    const match = store.findBestMatch('vitest');
    expect(match?.source).toContain('bootstrap');
    expect(match?.response).toBe(canonical);
  });

  it('replaces existing entry only when new text is meaningfully longer at the same tier', () => {
    const store = new KnowledgeStore();
    const seed = 'Regex is a formal grammar for matching string patterns; supports anchors, groups, and quantifiers across PCRE, ECMAScript, RE2.';
    store.addEntry('regex', seed, 'auto-learned', 'en');
    // Similar length — should NOT replace
    store.addEntry('regex', 'Regex is a pattern language matching strings, supporting anchors, groups, quantifiers across PCRE, ECMAScript, RE2 flavors.', 'auto-learned', 'en');
    expect(store.findBestMatch('regex')?.response).toBe(seed);
    // Significantly longer and clean — should replace
    const expanded = seed + ' Lookarounds, backreferences, and named captures exist but vary by flavor. Most languages ship a standard regex module; Go uses RE2, Python uses re, JavaScript embeds a PCRE-flavored engine in the language core.';
    store.addEntry('regex', expanded, 'auto-learned', 'en');
    expect(store.findBestMatch('regex')?.response).toBe(expanded);
  });

  it('stamps updatedAt on write', () => {
    const store = new KnowledgeStore();
    const before = Date.now();
    store.addEntry('kubernetes', 'Kubernetes is an orchestrator for container workloads.', 'bootstrap', 'en');
    const entry = store.findBestMatch('kubernetes');
    expect(entry?.updatedAt).toBeGreaterThanOrEqual(before);
  });
});

describe('expandSynonyms', () => {
  it('expands js <-> javascript', () => {
    const out = expandSynonyms(['js']);
    expect(out).toContain('js');
    expect(out).toContain('javascript');
    expect(out).toContain('ecmascript');
  });

  it('expands py -> python and leaves unknown words alone', () => {
    const out = expandSynonyms(['py', 'banana']);
    expect(out).toContain('python');
    expect(out).toContain('banana');
  });

  it('dedupes aliases', () => {
    const out = expandSynonyms(['js', 'javascript']);
    const occurrences = out.filter((w) => w === 'javascript').length;
    expect(occurrences).toBe(1);
  });
});

describe('KnowledgeStore retrieval with synonyms', () => {
  it('finds a javascript-indexed entry when the query uses js', () => {
    const store = new KnowledgeStore();
    store.addEntry(
      'javascript closures',
      'A closure in JavaScript is a function that captures variables from its enclosing lexical scope.',
      'bootstrap',
      'en',
    );
    const match = store.findBestMatch('js closures');
    expect(match).not.toBeNull();
    expect(match?.response).toContain('closure');
  });
});

describe('detectRegister', () => {
  it('detects teach-me intent', () => {
    expect(detectRegister('Teach me how rust traits work, step by step')).toBe('teach-me');
    expect(detectRegister('walk me through promises')).toBe('teach-me');
    expect(detectRegister('ELI5 the Kubernetes scheduler')).toBe('teach-me');
  });

  it('detects formal register', () => {
    expect(detectRegister('Kindly explain, regarding the matter at hand, how the cache works.')).toBe('formal');
  });

  it('detects casual register', () => {
    expect(detectRegister('yo dude how do i fix this bug lol')).toBe('casual');
    expect(detectRegister('ngl this is kinda confusing tbh')).toBe('casual');
  });

  it('detects terse register for short commands', () => {
    expect(detectRegister('docker logs')).toBe('terse');
    expect(detectRegister('quick one')).toBe('terse');
  });

  it('falls back to neutral', () => {
    expect(detectRegister('How do closures work in JavaScript?')).toBe('neutral');
    expect(detectRegister('')).toBe('neutral');
  });
});
