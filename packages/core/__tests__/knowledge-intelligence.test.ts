import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeStore } from '../src/models/vai-engine.js';
import {
  KnowledgeDecomposer,
  KnowledgeConnector,
  KnowledgeHygiene,
  QuestionDecomposer,
  KnowledgeIntelligence,
  classifyQuestionCategory,
} from '../src/models/knowledge-intelligence.js';

// ─── KnowledgeDecomposer ────────────────────────────────────────

describe('KnowledgeDecomposer', () => {
  let decomposer: KnowledgeDecomposer;

  beforeEach(() => {
    decomposer = new KnowledgeDecomposer();
  });

  it('decomposes multi-sentence text into atomic facts', () => {
    const facts = decomposer.decomposeText(
      'React is a UI library. It was created by Meta. It uses JSX for templating.',
      0,
    );
    expect(facts.length).toBe(3);
    expect(facts[0].text).toContain('React');
    expect(facts[1].text).toContain('Meta');
    expect(facts[2].text).toContain('JSX');
  });

  it('splits compound sentences at conjunctions', () => {
    const facts = decomposer.decomposeText(
      'Docker uses containers for isolation, and Kubernetes orchestrates those containers at scale.',
      0,
    );
    expect(facts.length).toBeGreaterThanOrEqual(2);
  });

  it('handles short text as single fact', () => {
    const facts = decomposer.decomposeText('React hooks', 0);
    expect(facts.length).toBe(1);
    expect(facts[0].text).toBe('React hooks');
  });

  it('builds sub-patterns from entries', () => {
    const entries = [
      { pattern: 'react', response: 'React is a UI library for building user interfaces', frequency: 1, source: 'test', language: 'en' as const },
      { pattern: 'vue', response: 'Vue is a UI library for building user interfaces with templates', frequency: 1, source: 'test', language: 'en' as const },
      { pattern: 'angular', response: 'Angular is a UI framework for building user interfaces with TypeScript', frequency: 1, source: 'test', language: 'en' as const },
    ];

    const patterns = decomposer.buildSubPatterns(entries);
    expect(patterns.size).toBeGreaterThan(0);

    // "building user" or "user interfaces" should appear in multiple entries
    const hasShared = Array.from(patterns.values()).some(
      p => p.frequency >= 2 && p.entryIndices.length >= 2,
    );
    expect(hasShared).toBe(true);
  });

  it('finds sub-pattern matches for a query', () => {
    const entries = [
      { pattern: 'react hooks', response: 'React hooks let you use state and lifecycle features in functional components', frequency: 1, source: 'test', language: 'en' as const },
      { pattern: 'vue composition', response: 'Vue composition API provides state and lifecycle hooks for functional components', frequency: 1, source: 'test', language: 'en' as const },
      { pattern: 'svelte', response: 'Svelte compiles components to vanilla JavaScript with no virtual DOM', frequency: 1, source: 'test', language: 'en' as const },
    ];

    decomposer.buildSubPatterns(entries);
    const matches = decomposer.findBySubPatterns('state and lifecycle in functional components');

    // React and Vue entries should match due to shared "functional components" sub-pattern
    expect(matches.length).toBeGreaterThan(0);
    const matchedIndices = matches.map(m => m.entryIndex);
    expect(matchedIndices).toContain(0); // react hooks
    expect(matchedIndices).toContain(1); // vue composition
  });

  it('getTopPatterns returns most frequent patterns', () => {
    const entries = [
      { pattern: 'a', response: 'building web apps with react', frequency: 1, source: 'test', language: 'en' as const },
      { pattern: 'b', response: 'building web apps with vue', frequency: 1, source: 'test', language: 'en' as const },
      { pattern: 'c', response: 'building web apps with angular', frequency: 1, source: 'test', language: 'en' as const },
    ];

    decomposer.buildSubPatterns(entries);
    const top = decomposer.getTopPatterns(5);
    expect(top.length).toBeGreaterThan(0);
    // Top pattern should have frequency >= 2
    expect(top[0].frequency).toBeGreaterThanOrEqual(2);
  });
});

// ─── KnowledgeConnector ─────────────────────────────────────────

describe('KnowledgeConnector', () => {
  it('builds connections between related entries', () => {
    const entries = [
      { pattern: 'react', response: 'React is a UI library for building user interfaces', frequency: 1, source: 'test', language: 'en' as const },
      { pattern: 'vue', response: 'Vue is a UI library for building user interfaces with templates', frequency: 1, source: 'test', language: 'en' as const },
      { pattern: 'sql', response: 'SQL is a language for querying relational databases', frequency: 1, source: 'test', language: 'en' as const },
    ];

    const decomposer = new KnowledgeDecomposer();
    decomposer.buildSubPatterns(entries);

    const connector = new KnowledgeConnector();
    connector.buildGraph(entries, decomposer);

    // React and Vue should be connected (shared "UI library", "building user interfaces")
    const reactConns = connector.getConnected(0);
    const connectedToReact = reactConns.map(c => c.to);
    expect(connectedToReact).toContain(1); // Vue
  });

  it('traverses the connection graph', () => {
    const entries = [
      { pattern: 'a', response: 'React is a library for building web interfaces', frequency: 1, source: 'test', language: 'en' as const },
      { pattern: 'b', response: 'Vue is a library for building web interfaces', frequency: 1, source: 'test', language: 'en' as const },
      { pattern: 'c', response: 'JavaScript is the language for building web interfaces', frequency: 1, source: 'test', language: 'en' as const },
    ];

    const decomposer = new KnowledgeDecomposer();
    decomposer.buildSubPatterns(entries);

    const connector = new KnowledgeConnector();
    connector.buildGraph(entries, decomposer);

    const fromReact = connector.traverse(0, 2, 5);
    expect(fromReact.length).toBeGreaterThan(0);
  });

  it('finds clusters of related entries', () => {
    const entries = [
      { pattern: 'a', response: 'React is a library for building web applications', frequency: 1, source: 'test', language: 'en' as const },
      { pattern: 'b', response: 'Vue is a library for building web applications', frequency: 1, source: 'test', language: 'en' as const },
      { pattern: 'c', response: 'Angular is a library for building web applications', frequency: 1, source: 'test', language: 'en' as const },
      { pattern: 'd', response: 'PostgreSQL is a relational database management system', frequency: 1, source: 'test', language: 'en' as const },
    ];

    const decomposer = new KnowledgeDecomposer();
    decomposer.buildSubPatterns(entries);

    const connector = new KnowledgeConnector();
    connector.buildGraph(entries, decomposer);

    const clusters = connector.findClusters(2);
    // React/Vue/Angular should form a cluster
    if (clusters.length > 0) {
      expect(clusters[0].entries.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// ─── KnowledgeHygiene ───────────────────────────────────────────

describe('KnowledgeHygiene', () => {
  let hygiene: KnowledgeHygiene;

  beforeEach(() => {
    hygiene = new KnowledgeHygiene();
  });

  it('finds duplicate entries', () => {
    const entries = [
      { pattern: 'react hooks', response: 'React hooks let you use state in functional components', frequency: 1, source: 'test', language: 'en' as const },
      { pattern: 'react hooks usage', response: 'React hooks let you use state in functional components easily', frequency: 1, source: 'test', language: 'en' as const },
      { pattern: 'sql joins', response: 'SQL joins combine rows from two or more tables', frequency: 1, source: 'test', language: 'en' as const },
    ];

    const groups = hygiene.findDuplicates(entries);
    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups[0].canonical).toBe(0);
    expect(groups[0].duplicates).toContain(1);
  });

  it('scores entry quality higher for informative content', () => {
    const good = {
      pattern: 'docker networking',
      response: 'Docker networking allows containers to communicate with each other and the outside world through bridge, overlay, and host network drivers.',
      frequency: 3,
      source: 'vcus:docker-guide',
      language: 'en' as const,
    };
    const bad = {
      pattern: 'x',
      response: 'ok',
      frequency: 1,
      source: 'http://example.com',
      language: 'en' as const,
    };

    expect(hygiene.scoreQuality(good)).toBeGreaterThan(hygiene.scoreQuality(bad));
  });

  it('identifies junk as low quality', () => {
    const junk = {
      pattern: 'yt sidebar',
      response: '3:15 • 12K avspillinger • for 2 år siden • Channel Name • 5:20 • 8K avspillinger • for 3 år siden',
      frequency: 1,
      source: 'http://youtube.com/watch',
      language: 'en' as const,
    };

    const good = {
      pattern: 'docker',
      response: 'Docker is a platform for building, shipping, and running applications in containers.',
      frequency: 2,
      source: 'vcus:docker',
      language: 'en' as const,
    };

    // Junk should score significantly lower than good content
    expect(hygiene.scoreQuality(junk)).toBeLessThan(hygiene.scoreQuality(good));
  });

  it('analyze produces a hygiene report', () => {
    const entries = [
      { pattern: 'a', response: 'React is a library for building UIs with JSX', frequency: 1, source: 'bootstrap', language: 'en' as const },
      { pattern: 'b', response: 'React is a library for building UIs using JSX syntax', frequency: 1, source: 'test', language: 'en' as const },
      { pattern: 'c', response: 'ok', frequency: 1, source: 'http://example.com', language: 'en' as const },
    ];

    const result = hygiene.analyze(entries);
    expect(result.report.totalBefore).toBe(3);
    expect(result.qualityScores.size).toBe(3);
  });
});

// ─── QuestionDecomposer ─────────────────────────────────────────

describe('QuestionDecomposer', () => {
  let qd: QuestionDecomposer;

  beforeEach(() => {
    qd = new QuestionDecomposer();
  });

  it('decomposes compound questions with "and"', () => {
    const subs = qd.decompose('What is React and how does it compare to Vue?');
    expect(subs.length).toBeGreaterThanOrEqual(2);
  });

  it('decomposes comparative questions', () => {
    const subs = qd.decompose('React vs Vue');
    expect(subs.length).toBe(3); // what is React, what is Vue, compare
    expect(subs[2].type).toBe('compare');
  });

  it('decomposes multi-topic "about" questions', () => {
    const subs = qd.decompose('Tell me about Docker networking and volumes');
    expect(subs.length).toBeGreaterThanOrEqual(2);
    const topics = subs.map(s => s.text.toLowerCase());
    expect(topics.some(t => t.includes('networking'))).toBe(true);
    expect(topics.some(t => t.includes('volumes'))).toBe(true);
  });

  it('returns single question for simple input', () => {
    const subs = qd.decompose('What is React?');
    expect(subs.length).toBe(1);
    expect(subs[0].type).toBe('what');
  });

  it('adds question marks to fragments', () => {
    const subs = qd.decompose('What is React');
    expect(subs.length).toBe(1);
    expect(subs[0].text).toBe('What is React?');
  });

  it('handles "how to X and Y" patterns', () => {
    const subs = qd.decompose('How to install Docker and configure networking');
    expect(subs.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── KnowledgeIntelligence (Orchestrator) ───────────────────────

describe('KnowledgeIntelligence', () => {
  let store: KnowledgeStore;
  let intelligence: KnowledgeIntelligence;

  beforeEach(() => {
    store = new KnowledgeStore();
    // Seed with knowledge
    store.addEntry('react', 'React is a UI library for building user interfaces with JSX. Created by Meta.', 'bootstrap', 'en');
    store.addEntry('vue', 'Vue is a progressive framework for building user interfaces. It uses templates.', 'bootstrap', 'en');
    store.addEntry('angular', 'Angular is a platform for building mobile and desktop web applications with TypeScript.', 'bootstrap', 'en');
    store.addEntry('docker', 'Docker is a platform for containerization. Containers package applications with their dependencies.', 'bootstrap', 'en');
    store.addEntry('kubernetes', 'Kubernetes orchestrates containers at scale. It manages deployment, scaling, and operations of containerized applications.', 'bootstrap', 'en');

    intelligence = new KnowledgeIntelligence(store);
  });

  it('builds intelligence indexes', () => {
    intelligence.build();
    const stats = intelligence.getStats();
    expect(stats.built).toBe(true);
    expect(stats.entries).toBe(5);
    expect(stats.subPatterns).toBeGreaterThan(0);
  });

  it('answers compound questions by decomposition', () => {
    intelligence.build();
    const answer = intelligence.answerDecomposed('What is React and what is Vue?');
    // May or may not find answers depending on matching
    if (answer) {
      expect(answer.confidence).toBeGreaterThan(0);
      expect(answer.text.length).toBeGreaterThan(0);
    }
  });

  it('answers comparative questions', () => {
    intelligence.build();
    const answer = intelligence.answerDecomposed('React vs Angular');
    if (answer) {
      expect(answer.subAnswers.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('getStats reports correct entry count', () => {
    const stats = intelligence.getStats();
    expect(stats.entries).toBe(5);
    expect(stats.built).toBe(false);
  });

  it('analyzeHygiene returns a report', () => {
    const result = intelligence.analyzeHygiene();
    expect(result.report.totalBefore).toBe(5);
    expect(result.qualityScores.size).toBe(5);
  });

  it('auto-builds on first answerDecomposed call', () => {
    // Don't call build() explicitly
    const answer = intelligence.answerDecomposed('What is Docker and Kubernetes?');
    const stats = intelligence.getStats();
    expect(stats.built).toBe(true);
    // Answer may or may not be found, but indexes should be built
  });
});

// ─── Bloom Filter (via KnowledgeStore.mightKnow) ───────────────

describe('KnowledgeStore Bloom Filter', () => {
  it('returns true for added topics', () => {
    const store = new KnowledgeStore();
    store.addEntry('react hooks', 'React hooks let you use state in function components.', 'bootstrap', 'en');
    store.addEntry('docker compose', 'Docker Compose manages multi-container applications.', 'bootstrap', 'en');

    expect(store.mightKnow('react hooks')).toBe(true);
    expect(store.mightKnow('docker compose')).toBe(true);
  });

  it('returns false for never-added topics (with high probability)', () => {
    const store = new KnowledgeStore();
    store.addEntry('react', 'React is a UI library.', 'bootstrap', 'en');

    // This topic was never added — should return false (no false negatives)
    // Note: Bloom filters can have false positives but NOT false negatives
    // Using a very distinct topic to minimize false positive chance
    expect(store.mightKnow('xylophone orchestration fundamentals')).toBe(false);
  });

  it('is case-insensitive', () => {
    const store = new KnowledgeStore();
    store.addEntry('TypeScript Generics', 'Generics enable type-safe reusable code.', 'bootstrap', 'en');

    expect(store.mightKnow('typescript generics')).toBe(true);
    expect(store.mightKnow('TYPESCRIPT GENERICS')).toBe(true);
  });

  it('populates from importData', () => {
    const store1 = new KnowledgeStore();
    store1.addEntry('prisma orm', 'Prisma is a next-gen ORM for Node.js.', 'bootstrap', 'en');
    const exported = store1.exportData();

    const store2 = new KnowledgeStore();
    store2.importData(exported);
    expect(store2.mightKnow('prisma orm')).toBe(true);
  });
});

// ─── QuestionType Functional Grouping ───────────────────────────

describe('classifyQuestionCategory', () => {
  it('classifies W-questions as interrogative', () => {
    expect(classifyQuestionCategory('what')).toBe('interrogative');
    expect(classifyQuestionCategory('why')).toBe('interrogative');
    expect(classifyQuestionCategory('when')).toBe('interrogative');
    expect(classifyQuestionCategory('where')).toBe('interrogative');
    expect(classifyQuestionCategory('who')).toBe('interrogative');
    expect(classifyQuestionCategory('which')).toBe('interrogative');
  });

  it('classifies how as procedural', () => {
    expect(classifyQuestionCategory('how')).toBe('procedural');
  });

  it('classifies compare/list/general as operational', () => {
    expect(classifyQuestionCategory('compare')).toBe('operational');
    expect(classifyQuestionCategory('list')).toBe('operational');
    expect(classifyQuestionCategory('general')).toBe('operational');
  });
});

// ─── KnowledgeStore.isJunkContent (Fix C regressions) ─────────────────────

describe('KnowledgeStore.isJunkContent (Fix C)', () => {
  it('flags raw "=== description ===" blob markers as junk', () => {
    const blob = 'Some paragraph before.\n=== description ===\nThis is the scraped channel description that should never leak as an answer.';
    expect(KnowledgeStore.isJunkContent(blob)).toBe(true);
  });

  it('flags "=== transcript ===" blob markers as junk', () => {
    const blob = 'Intro text.\n=== transcript ===\n00:00 Hello and welcome back to the channel today we are going to be learning about something.';
    expect(KnowledgeStore.isJunkContent(blob)).toBe(true);
  });

  it('flags "=== captions ===" and "=== metadata ===" markers as junk', () => {
    expect(KnowledgeStore.isJunkContent('something\n=== captions ===\nmore text here with enough words to exceed the short-text threshold test.')).toBe(true);
    expect(KnowledgeStore.isJunkContent('heading\n=== metadata ===\nfields and values that are structural not semantic content at all.')).toBe(true);
  });

  it('flags title-header + URL blobs as junk', () => {
    const blob = 'title: Some Scraped Video Title\nhttps://youtube.com/watch?v=abc123\nextra description text that follows the title marker.';
    expect(KnowledgeStore.isJunkContent(blob)).toBe(true);
  });

  it('flags link-dump content (many URLs, low prose) as junk', () => {
    const blob = 'See these links https://example.com https://foo.com https://bar.com https://baz.com for details.';
    expect(KnowledgeStore.isJunkContent(blob)).toBe(true);
  });

  it('flags transcript-style "click this link" + promo-code patterns as junk', () => {
    const blob = 'Click this link https://sponsor.com to get 20% off with promo code SAVE20 on your next purchase from our partner.';
    expect(KnowledgeStore.isJunkContent(blob)).toBe(true);
  });

  it('does not flag clean explanatory prose as junk', () => {
    const clean = 'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript. It adds static typing and improves tooling.';
    expect(KnowledgeStore.isJunkContent(clean)).toBe(false);
  });

  it('does not flag single-URL content with real prose as junk', () => {
    const withUrl = 'React is a JavaScript library for building user interfaces created by Meta. The documentation is available at https://react.dev for reference.';
    expect(KnowledgeStore.isJunkContent(withUrl)).toBe(false);
  });

  it('does not flag prose containing the word "title" as junk', () => {
    const clean = 'The title of the book was intriguing and drew many readers in with its bold cover design and evocative imagery.';
    expect(KnowledgeStore.isJunkContent(clean)).toBe(false);
  });
});
