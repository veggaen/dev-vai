/**
 * Hybrid retrieval — deterministic lexical (BM25) + character-trigram blended
 * ranker. Tests cover:
 *   - empty index / empty query behaviour
 *   - exact-match wins over noise
 *   - paraphrase robustness (Jaccard trigram picks up morphology)
 *   - typo tolerance
 *   - deterministic tie-breaking by doc id
 *   - recall@5 on a paraphrased query set (> 85% target)
 */

import { describe, it, expect } from 'vitest';
import { HybridRetriever, scoreHybrid, type HybridDocument } from '../src/models/hybrid-retrieval.js';

describe('HybridRetriever', () => {
  it('returns [] for an empty index', () => {
    const r = new HybridRetriever();
    expect(r.retrieve('anything', 5)).toEqual([]);
  });

  it('returns [] for a blank query', () => {
    const r = new HybridRetriever();
    r.add({ id: 'a', text: 'hello world' });
    expect(r.retrieve('   ', 5)).toEqual([]);
  });

  it('ranks an exact keyword hit above unrelated docs', () => {
    const r = new HybridRetriever();
    r.addBatch([
      { id: 'docker', text: 'Docker containers package applications with their dependencies for portable deployment.' },
      { id: 'cooking', text: 'A recipe for chocolate chip cookies uses butter, flour, sugar and eggs.' },
      { id: 'networking', text: 'TCP provides reliable ordered byte streams over IP networks.' },
    ]);
    const results = r.retrieve('how do I package my app with docker', 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].doc.id).toBe('docker');
  });

  it('surfaces paraphrases with low token overlap via trigram signal', () => {
    const r = new HybridRetriever();
    r.addBatch([
      { id: 'containerize', text: 'Containerization packages an application and its runtime into a portable image.' },
      { id: 'gardening',    text: 'Prune rose bushes in early spring to encourage healthy blossoms.' },
      { id: 'finance',      text: 'Diversified index funds reduce idiosyncratic risk in a portfolio.' },
    ]);
    const results = r.retrieve('how do I containerize my service', 3);
    expect(results[0].doc.id).toBe('containerize');
  });

  it('is resilient to typos via character trigrams', () => {
    const r = new HybridRetriever();
    r.addBatch([
      { id: 'kubernetes', text: 'Kubernetes orchestrates containers across a cluster of nodes.' },
      { id: 'weather',    text: 'The forecast calls for rain on tuesday with a chance of thunderstorms.' },
    ]);
    const results = r.retrieve('kubrnetes orchestrtion', 2);
    expect(results[0].doc.id).toBe('kubernetes');
  });

  it('breaks ties deterministically by doc id', () => {
    const r = new HybridRetriever();
    r.addBatch([
      { id: 'b-doc', text: 'identical content here' },
      { id: 'a-doc', text: 'identical content here' },
    ]);
    const results = r.retrieve('identical content', 2);
    expect(results[0].doc.id).toBe('a-doc');
    expect(results[1].doc.id).toBe('b-doc');
  });

  it('clear() resets all internal state', () => {
    const r = new HybridRetriever();
    r.add({ id: 'x', text: 'something' });
    expect(r.stats().documents).toBe(1);
    r.clear();
    expect(r.stats().documents).toBe(0);
    expect(r.retrieve('something', 5)).toEqual([]);
  });

  it('scoreHybrid one-shot returns same ordering as a retained index', () => {
    const docs: HybridDocument[] = [
      { id: 'a', text: 'authentication tokens expire and must be refreshed' },
      { id: 'b', text: 'a recipe for sourdough bread needs a starter culture' },
    ];
    const r = new HybridRetriever();
    r.addBatch(docs);
    const a = r.retrieve('refresh auth token', 2).map((s) => s.doc.id);
    const b = scoreHybrid('refresh auth token', docs, 2).map((s) => s.doc.id);
    expect(a).toEqual(b);
    expect(a[0]).toBe('a');
  });

  it('recall@5 on paraphrased queries exceeds 85%', () => {
    // Small fixed benchmark: each query has one correct doc id whose text
    // shares limited surface tokens with the query.
    const corpus: HybridDocument[] = [
      { id: 'docker',       text: 'Docker containers package applications with their dependencies for portable deployment.' },
      { id: 'k8s',          text: 'Kubernetes orchestrates containers across a cluster of worker nodes.' },
      { id: 'tcp',          text: 'TCP provides reliable ordered byte streams over IP networks with flow control.' },
      { id: 'auth',         text: 'OAuth2 refresh tokens let a client obtain new access tokens without re-prompting.' },
      { id: 'bm25',         text: 'BM25 is a ranking function used by search engines to estimate document relevance.' },
      { id: 'bread',        text: 'Sourdough bread relies on wild yeast from a starter culture and long fermentation.' },
      { id: 'gardening',    text: 'Prune rose bushes in early spring to encourage healthy summer blossoms.' },
      { id: 'portfolio',    text: 'Diversified index funds reduce idiosyncratic risk in a long-term portfolio.' },
      { id: 'typescript',   text: 'TypeScript adds static type annotations on top of JavaScript to catch bugs early.' },
      { id: 'rust',         text: 'Rust ownership and borrowing rules prevent data races at compile time.' },
    ];
    const queries: Array<{ q: string; expected: string }> = [
      { q: 'how do I containerize my app',               expected: 'docker' },
      { q: 'cluster orchestration for pods',             expected: 'k8s' },
      { q: 'reliable byte transport protocol',           expected: 'tcp' },
      { q: 'renew my access credential silently',        expected: 'auth' },
      { q: 'lexical relevance scoring algorithm',        expected: 'bm25' },
      { q: 'fermented loaf with wild culture',           expected: 'bread' },
      { q: 'when to trim roses',                         expected: 'gardening' },
      { q: 'long-term index fund allocation',            expected: 'portfolio' },
      { q: 'statically typed javascript dialect',        expected: 'typescript' },
      { q: 'memory safe systems language without gc',    expected: 'rust' },
    ];
    const r = new HybridRetriever();
    r.addBatch(corpus);
    let hits = 0;
    for (const { q, expected } of queries) {
      const top5 = r.retrieve(q, 5).map((s) => s.doc.id);
      if (top5.includes(expected)) hits += 1;
    }
    const recall = hits / queries.length;
    expect(recall).toBeGreaterThanOrEqual(0.85);
  });
});
