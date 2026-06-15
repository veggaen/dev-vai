import { describe, it, expect } from 'vitest';
import { synthesizeFromEvidence, type EvidenceItem } from './synthesize.js';

function item(sourceId: string, subject: string, attribute: string, value: string, span?: string): EvidenceItem {
  return { sourceId, subject, attribute, value, span };
}

describe('synthesizeFromEvidence — binding discipline', () => {
  it('drops items with no sourceId (unbound claims never asserted)', () => {
    const items = [
      item('src-a', 'react', 'version', '19'),
      item('', 'react', 'version', '18'), // unbound — must be dropped
    ];
    const res = synthesizeFromEvidence(items, 'react version', { filterByQuery: false });
    expect(res.droppedUnbound).toBe(1);
    expect(res.claims).toHaveLength(1);
    expect(res.claims[0].value).toBe('19');
  });

  it('every emitted claim carries at least one source', () => {
    const items = [item('src-a', 'node', 'runtime', '22'), item('src-b', 'node', 'runtime', '22')];
    const res = synthesizeFromEvidence(items, 'node', { filterByQuery: false });
    for (const c of res.claims) expect(c.sources.length).toBeGreaterThanOrEqual(1);
  });
});

describe('synthesizeFromEvidence — clustering + corroboration confidence', () => {
  it('merges identical (subject,attribute,value) across sources and raises confidence', () => {
    const items = [
      item('src-a', 'db', 'engine', 'sqlite'),
      item('src-b', 'db', 'engine', 'sqlite'),
      item('src-c', 'db', 'engine', 'sqlite'),
    ];
    const res = synthesizeFromEvidence(items, 'db engine', { filterByQuery: false });
    expect(res.claims).toHaveLength(1);
    expect(res.claims[0].sources).toHaveLength(3);
    // 3 corroborating sources → higher confidence than a single-source claim.
    expect(res.claims[0].confidence).toBeGreaterThan(0.85);
  });

  it('de-dupes the same source asserting the same value twice', () => {
    const items = [
      item('src-a', 'db', 'engine', 'sqlite', 'line 1'),
      item('src-a', 'db', 'engine', 'sqlite', 'line 1'), // exact dup
    ];
    const res = synthesizeFromEvidence(items, 'db', { filterByQuery: false });
    expect(res.claims[0].sources).toHaveLength(1);
    expect(res.claims[0].confidence).toBeCloseTo(0.6, 5); // single distinct source
  });

  it('a single-source claim is lower confidence than a corroborated one', () => {
    const items = [
      item('s1', 'x', 'k', 'v1'),
      item('s2', 'y', 'k', 'v2'),
      item('s3', 'y', 'k', 'v2'),
    ];
    const res = synthesizeFromEvidence(items, '', { filterByQuery: false });
    const x = res.claims.find((c) => c.subject === 'x')!;
    const y = res.claims.find((c) => c.subject === 'y')!;
    expect(y.confidence).toBeGreaterThan(x.confidence);
  });
});

describe('synthesizeFromEvidence — contradiction detection', () => {
  it('flags two sources giving different values for the same subject+attribute', () => {
    const items = [
      item('docs', 'primeMinister', 'name', 'Alice'),
      item('news', 'primeMinister', 'name', 'Bob'),
    ];
    const res = synthesizeFromEvidence(items, 'prime minister', { filterByQuery: false });
    expect(res.contradictions).toHaveLength(1);
    const c = res.contradictions[0];
    expect(c.subject).toBe('primeMinister');
    expect(c.sides).toHaveLength(2);
    expect(c.sides.map((s) => s.value).sort()).toEqual(['Alice', 'Bob']);
    // Both sides are cited.
    expect(c.sides.every((s) => s.sources.length >= 1)).toBe(true);
  });

  it('does NOT flag a contradiction when sources agree', () => {
    const items = [
      item('a', 'capital', 'of-france', 'Paris'),
      item('b', 'capital', 'of-france', 'Paris'),
    ];
    const res = synthesizeFromEvidence(items, 'capital', { filterByQuery: false });
    expect(res.contradictions).toHaveLength(0);
    expect(res.summary).toMatch(/no contradictions/i);
  });

  it('summary names the contradicting subject.attribute', () => {
    const items = [
      item('a', 'release', 'date', '2026-01'),
      item('b', 'release', 'date', '2026-03'),
    ];
    const res = synthesizeFromEvidence(items, 'release', { filterByQuery: false });
    expect(res.summary).toContain('release.date');
  });
});

describe('synthesizeFromEvidence — query focus', () => {
  it('filters claims to subjects matching the query token by default', () => {
    const items = [
      item('a', 'typescript', 'version', '5.6'),
      item('b', 'python', 'version', '3.12'),
    ];
    const res = synthesizeFromEvidence(items, 'what do I know about typescript');
    expect(res.claims).toHaveLength(1);
    expect(res.claims[0].subject).toBe('typescript');
  });

  it('falls back to all bound items when the focus matches nothing', () => {
    const items = [item('a', 'rust', 'edition', '2021')];
    const res = synthesizeFromEvidence(items, 'tell me about haskell');
    // No subject matched 'haskell' → fall back rather than emit nothing.
    expect(res.claims).toHaveLength(1);
  });

  it('produces an honest empty summary when there is no evidence at all', () => {
    const res = synthesizeFromEvidence([], 'anything');
    expect(res.claims).toHaveLength(0);
    expect(res.summary).toMatch(/no evidence-bound claims/i);
  });
});
