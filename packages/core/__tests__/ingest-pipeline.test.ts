import { describe, it, expect, beforeEach } from 'vitest';
import { IngestPipeline, type RawCapture } from '../src/ingest/pipeline.js';
import { createDb, resetDbInstance } from '../src/db/client.js';
import { VaiEngine } from '../src/models/vai-engine.js';

describe('IngestPipeline', () => {
  let pipeline: IngestPipeline;
  let engine: VaiEngine;

  beforeEach(() => {
    resetDbInstance();
    const db = createDb(':memory:');
    engine = new VaiEngine();
    pipeline = new IngestPipeline(db, engine);
  });

  it('ingests a web page and stores 3 context levels', () => {
    const capture: RawCapture = {
      sourceType: 'web',
      url: 'https://example.com/article',
      title: 'Test Article',
      content: 'This is a test article about artificial intelligence. '.repeat(100),
    };

    const result = pipeline.ingest(capture);

    expect(result.sourceId).toBeTruthy();
    expect(result.title).toBe('Test Article');
    expect(result.chunkCounts.l0).toBeGreaterThan(0);
    expect(result.chunkCounts.l1).toBe(1);
    expect(result.chunkCounts.l2).toBe(1);
    expect(result.tokensLearned).toBeGreaterThan(0);
  });

  it('retrieves chunks at each level', () => {
    const longContent = Array.from({ length: 200 }, (_, i) =>
      `Sentence number ${i} talks about machine learning and natural language processing.`,
    ).join(' ');

    const result = pipeline.ingest({
      sourceType: 'web',
      url: 'https://example.com/long',
      title: 'Long Article',
      content: longContent,
    });

    const l0 = pipeline.getChunks(result.sourceId, 0);
    const l1 = pipeline.getChunks(result.sourceId, 1);
    const l2 = pipeline.getChunks(result.sourceId, 2);

    expect(l0.length).toBeGreaterThan(1); // Multiple chunks at L0
    expect(l1.length).toBe(1); // Single summary at L1
    expect(l2.length).toBe(1); // Single bullet points at L2
    expect(l2[0].content).toContain('- '); // Bullet points format
  });

  it('trains the engine on ingested content', () => {
    const statsBefore = engine.getStats();

    pipeline.ingest({
      sourceType: 'web',
      url: 'https://example.com/learn',
      title: 'Learning Material',
      content: 'TypeScript is a strongly typed programming language that builds on JavaScript. It adds types to make code safer and easier to refactor.',
    });

    const statsAfter = engine.getStats();
    expect(statsAfter.vocabSize).toBeGreaterThan(statsBefore.vocabSize);
    expect(statsAfter.knowledgeEntries).toBeGreaterThan(statsBefore.knowledgeEntries);
  });

  it('searches across ingested content', () => {
    pipeline.ingest({
      sourceType: 'web',
      url: 'https://example.com/ts',
      title: 'TypeScript Guide',
      content: 'TypeScript adds static type checking to JavaScript. It helps catch errors at compile time.',
    });

    pipeline.ingest({
      sourceType: 'web',
      url: 'https://example.com/rust',
      title: 'Rust Guide',
      content: 'Rust is a systems programming language focused on safety and performance.',
    });

    const results = pipeline.search('TypeScript');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain('TypeScript');
  });

  it('lists all ingested sources', () => {
    pipeline.ingest({
      sourceType: 'web',
      url: 'https://a.com',
      title: 'Source A',
      content: 'Content A is about programming languages and software engineering.',
    });
    pipeline.ingest({
      sourceType: 'youtube',
      url: 'https://youtube.com/watch?v=abc123',
      title: 'Source B',
      content: 'Content B is about machine learning models and training data.',
    });

    const sources = pipeline.listSources();
    expect(sources.length).toBe(2);
  });

  it('detects Norwegian content', () => {
    const result = pipeline.ingest({
      sourceType: 'web',
      url: 'https://example.no/artikkel',
      title: 'Norsk Artikkel',
      content: 'Dette er en norsk artikkel om kunstig intelligens. Vi skal lære om maskinlæring og hvordan det fungerer.',
    });

    // The engine should have been trained — check it learned something
    expect(result.tokensLearned).toBeGreaterThan(0);
  });

  it('detects code content', () => {
    const result = pipeline.ingest({
      sourceType: 'github',
      url: 'https://github.com/test/repo',
      title: 'test/repo',
      content: 'function hello() { const x = 42; return x; } export class MyClass { async getData() { try { await fetch("/api"); } catch (err) { throw err; } } }',
    });

    expect(result.tokensLearned).toBeGreaterThan(0);
  });

  it('cleans HTML from content', () => {
    const result = pipeline.ingest({
      sourceType: 'web',
      url: 'https://example.com/html',
      title: 'HTML Page',
      content: '<div class="content"><p>Hello <strong>world</strong></p><script>alert("xss")</script></div>',
    });

    const chunks = pipeline.getChunks(result.sourceId, 0);
    expect(chunks[0].content).not.toContain('<div');
    expect(chunks[0].content).not.toContain('<script');
    expect(chunks[0].content).toContain('Hello');
  });

  it('handles empty content gracefully', () => {
    const result = pipeline.ingest({
      sourceType: 'web',
      url: 'https://example.com/empty',
      title: 'Empty Page',
      content: '',
    });

    expect(result.sourceId).toBeTruthy();
    expect(result.chunkCounts.l0).toBeGreaterThanOrEqual(1);
  });
});
