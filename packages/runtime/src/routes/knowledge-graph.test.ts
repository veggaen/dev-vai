import { describe, expect, it } from 'vitest';
import { buildKnowledgeGraph, cosine, tfidfVectors, tokenize } from './knowledge-graph.js';

describe('knowledge graph core', () => {
  it('tokenizes with stopwords and short tokens removed', () => {
    expect(tokenize('The Vai engine is a deterministic router!')).toEqual(['vai', 'engine', 'deterministic', 'router']);
  });

  it('cosine is 1 for identical docs and 0 for disjoint docs', () => {
    const [a, b, c] = tfidfVectors(['react sandbox preview', 'react sandbox preview', 'tauri window chrome']);
    expect(cosine(a, b)).toBeCloseTo(1, 5);
    expect(cosine(a, c)).toBe(0);
  });

  it('links related docs, separates unrelated clusters, and is deterministic', () => {
    const docs = [
      { id: 'a', label: 'Spotify clone', kind: 'project' as const, text: 'music playlist player albums spotify audio tracks' },
      { id: 'b', label: 'Music app ideas', kind: 'chat' as const, text: 'playlist audio music tracks albums streaming' },
      { id: 'c', label: 'Tax notes', kind: 'chat' as const, text: 'deduction income filing revenue receipts' },
    ];
    const one = buildKnowledgeGraph(docs);
    const two = buildKnowledgeGraph(docs);
    expect(one).toEqual(two); // deterministic core — same corpus, same graph
    expect(one.edges.some((e) => (e.source === 'a' && e.target === 'b'))).toBe(true);
    expect(one.edges.some((e) => e.source === 'c' || e.target === 'c')).toBe(false);
    const byId = new Map(one.nodes.map((n) => [n.id, n]));
    expect(byId.get('a')!.cluster).toBe(byId.get('b')!.cluster);
    expect(byId.get('c')!.cluster).not.toBe(byId.get('a')!.cluster);
  });

  it('caps edges per node so hubs stay readable', () => {
    const docs = Array.from({ length: 10 }, (_, i) => ({
      id: `d${i}`,
      label: `Doc ${i}`,
      kind: 'chat' as const,
      text: 'shared common corpus words music playlist audio tracks',
    }));
    const { edges } = buildKnowledgeGraph(docs, { maxEdgesPerNode: 3 });
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    for (const d of degree.values()) expect(d).toBeLessThanOrEqual(3);
  });
});
