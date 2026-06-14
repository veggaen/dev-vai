/**
 * Tests for the council FACT CROSS-CHECK (cross-check.ts) — RE-ARCHITECTED to subject-anchored,
 * corroborated grounding (Stage B/D). All pure: no Ollama, no network. SearchResponse inline.
 *
 * Core regression target (the live failure): a fabricated "$3,200" ETH price must NOT confirm
 * just because one stray number in a forum snippet is within 5% — confirmation now requires a
 * cluster of subject-anchored, currency-bearing candidates whose MEDIAN matches the claim.
 */
import { describe, it, expect } from 'vitest';
import {
  extractCheckableClaim,
  assessClaimAgreement,
  applyCrossCheck,
  MIN_CORROBORATION,
  type ClaimAssessment,
  type CheckableClaim,
} from '../src/consensus/cross-check.js';
import type { CouncilConsensus } from '../src/consensus/types.js';
import type { SearchResponse } from '../src/search/types.js';

function makeConsensus(over: Partial<CouncilConsensus> = {}): CouncilConsensus {
  return {
    outcome: 'ship', agreement: 0.73, confidence: 0.7, realIntent: '', recommendedAction: 'answer-directly',
    searchQuery: '', missingCapabilities: [], methodLessons: [], summary: '3 members · 73% agree (good). Cleared.',
    notes: [], memberIds: [], factsQuarantined: true, ...over,
  };
}

function makeSearch(answer: string, snippets: string[] = [], confidence = 0.9): SearchResponse {
  return {
    answer,
    sources: snippets.map((text, i) => ({
      text, url: `https://ex${i}.com`, domain: `ex${i}.com`, title: `Source ${i}`,
      favicon: '', trust: { tier: 'reputable', score: 0.8, signals: [] } as any, rank: i,
    })),
    plan: { originalQuery: 'q', intent: '', entities: [], constraints: {} as any, fanOutQueries: [] },
    rawResultCount: snippets.length, confidence, durationMs: 100, sync: 'linear' as any, audit: [],
  };
}

describe('extractCheckableClaim', () => {
  it('extracts a price + subject aliases from a fact-shaped prompt', () => {
    const claim = extractCheckableClaim('whats the price of btc?', 'The price of BTC is $63,450.73 as of the latest data.');
    expect(claim?.kind).toBe('number');
    expect(claim?.value).toContain('63,450');
    expect(claim?.numeric).toBeCloseTo(63450.73, 1);
    expect(claim?.subjectAliases).toEqual(expect.arrayContaining(['btc', 'bitcoin']));
    expect(claim?.hasCurrencyUnit).toBe(true);
  });
  it('returns null for a purely explanatory draft', () => {
    expect(extractCheckableClaim('explain closures', 'A closure is a function with access to its outer scope.')).toBeNull();
  });
  it('does not chase incidental small numbers in a how-to answer', () => {
    expect(extractCheckableClaim('how do I optimize a react list', 'Step 1: use react-window. Step 2: memoize.')).toBeNull();
  });
  it('captures a fabricated temporal claim on the draft', () => {
    const claim = extractCheckableClaim('price of eth', '$3,200.00 USD (as of 10:00 AM UTC).');
    expect(claim?.temporalClaim).toMatch(/10:00/);
  });
});

describe('assessClaimAgreement — subject-anchored corroboration', () => {
  const ethClaim: CheckableClaim = {
    kind: 'number', value: '$3,200.00', numeric: 3200, subjectAliases: ['eth', 'ethereum', 'ether'],
    hasCurrencyUnit: true, temporalClaim: null,
  };

  it('does NOT confirm a fabricated price from a lone coincidental forum number (the live failure)', () => {
    // One reddit snippet happens to contain "$3,200" but the real ETH cluster is ~1,680.
    const search = makeSearch(
      'Ethereum is trading around $1,680 today.',
      ['CoinMarketCap: Ethereum price $1,674 USD', 'Binance ETH/USD $1,682', 'r/Flipping: I sold my couch for $3,200'],
    );
    const a = assessClaimAgreement(ethClaim, search, 'eth price');
    expect(a.verified).toBe(false);
    // the eth-anchored cluster (1680ish) disagrees with 3200 → contradiction
    expect(a.contradicted).toBe(true);
    expect(a.evidenceMedian).toBeGreaterThan(1500);
    expect(a.evidenceMedian).toBeLessThan(2000);
  });

  it('confirms when a corroborated cluster of subject-anchored prices matches', () => {
    const correct: CheckableClaim = { ...ethClaim, value: '$1,680', numeric: 1680 };
    const search = makeSearch(
      'Ethereum is trading around $1,680 today.',
      ['CoinMarketCap: Ethereum price $1,674 USD', 'Binance ETH/USD $1,682 USD', 'Coinbase ether $1,679'],
    );
    const a = assessClaimAgreement(correct, search, 'eth price');
    expect(a.verified).toBe(true);
    expect(a.corroboration).toBeGreaterThanOrEqual(MIN_CORROBORATION);
  });

  it('stays inconclusive when only ONE anchored candidate matches (no corroboration)', () => {
    const correct: CheckableClaim = { ...ethClaim, value: '$1,680', numeric: 1680 };
    const search = makeSearch('Some page.', ['CoinMarketCap: Ethereum price $1,674 USD', 'A blog about cooking pasta']);
    const a = assessClaimAgreement(correct, search, 'eth price');
    // answer is on-subject by construction but carries no number; only 1 source candidate
    expect(a.verified).toBe(false);
    expect(a.contradicted).toBe(false);
  });

  it('ignores numbers from snippets that do not mention the subject', () => {
    const correct: CheckableClaim = { ...ethClaim, value: '$1,680', numeric: 1680 };
    // Two $1,680 numbers but neither snippet mentions eth → not counted.
    const search = makeSearch('No price here.', ['Used car priced at $1,680', 'Laptop on sale $1,679']);
    const a = assessClaimAgreement(correct, search, 'eth price');
    expect(a.verified).toBe(false);
  });

  it('confirms an entity by case-insensitive presence', () => {
    const entityClaim: CheckableClaim = { kind: 'entity', value: 'PostgreSQL', numeric: null, subjectAliases: [], hasCurrencyUnit: false, temporalClaim: null };
    const a = assessClaimAgreement(entityClaim, makeSearch('The database is postgresql.', []), 'which db');
    expect(a.verified).toBe(true);
  });

  it('flags an ungrounded temporal claim', () => {
    const timed: CheckableClaim = { ...ethClaim, value: '$1,680', numeric: 1680, temporalClaim: 'as of 10:00 AM UTC' };
    const search = makeSearch('Ethereum $1,680.', ['CoinMarketCap Ethereum $1,674 USD', 'Binance ETH $1,682 USD']);
    const a = assessClaimAgreement(timed, search, 'eth price');
    expect(a.temporalUngrounded).toBe(true); // evidence never says 10:00 / UTC
  });
});

describe('applyCrossCheck', () => {
  const verified: ClaimAssessment = {
    verified: true, contradicted: false, confirmsValue: '$1,680', searchConfidence: 0.9,
    query: 'eth price', sources: [{ title: 'S', url: 'u', snippet: 'x' }], corroboration: 4, evidenceMedian: 1680, temporalUngrounded: false,
  };
  const contradicted: ClaimAssessment = { ...verified, verified: false, contradicted: true, confirmsValue: null, corroboration: 3, evidenceMedian: 1680 };
  const inconclusive: ClaimAssessment = { ...verified, verified: false, contradicted: false, confirmsValue: null, corroboration: 1, evidenceMedian: null };

  it('strongly boosts agreement and marks a pass on a corroborated confirmation', () => {
    const out = applyCrossCheck(makeConsensus({ agreement: 0.73 }), verified);
    expect(out.agreement).toBeGreaterThan(0.9);
    expect(out.agreement).toBeLessThan(1);
    expect(out.crossCheck?.verified).toBe(true);
    expect(out.crossCheck?.pass).toBe(true);
    expect(out.crossCheck?.boostedFrom).toBe(0.73);
  });
  it('does not mutate the input consensus', () => {
    const input = makeConsensus({ agreement: 0.73 });
    applyCrossCheck(input, verified);
    expect(input.agreement).toBe(0.73);
    expect(input.crossCheck).toBeUndefined();
  });
  it('downgrades and flips to reread-intent on contradiction', () => {
    const out = applyCrossCheck(makeConsensus({ confidence: 0.8, outcome: 'ship' }), contradicted);
    expect(out.recommendedAction).toBe('reread-intent');
    expect(out.confidence).toBeLessThan(0.8);
    expect(out.outcome).toBe('act');
    expect(out.crossCheck?.contradicted).toBe(true);
  });
  it('treats a confirmed value with a fabricated timestamp as a contradiction (must redraft)', () => {
    const out = applyCrossCheck(makeConsensus({ outcome: 'ship' }), { ...verified, temporalUngrounded: true });
    expect(out.recommendedAction).toBe('reread-intent');
    expect(out.crossCheck?.contradicted).toBe(true);
  });
  it('attaches advisory crossCheck and does NOT clear a web-search verdict when inconclusive (ship gate)', () => {
    const wantedSearch = makeConsensus({ outcome: 'act', recommendedAction: 'web-search', agreement: 1 });
    const out = applyCrossCheck(wantedSearch, inconclusive);
    expect(out.recommendedAction).toBe('web-search'); // STILL armed — a weak confirm must not ship
    expect(out.outcome).toBe('act');
    expect(out.crossCheck?.verified).toBe(false);
  });
  it('clears a web-search verdict for release ONLY on a corroborated confirm', () => {
    const wantedSearch = makeConsensus({ outcome: 'act', recommendedAction: 'web-search', agreement: 1 });
    const out = applyCrossCheck(wantedSearch, verified);
    expect(out.outcome).toBe('ship');
    expect(out.recommendedAction).toBe('answer-directly');
  });
  it('scales the boost down for fewer corroborating sources', () => {
    const weak = applyCrossCheck(makeConsensus({ agreement: 0.73 }), { ...verified, corroboration: 2 });
    const strong = applyCrossCheck(makeConsensus({ agreement: 0.73 }), { ...verified, corroboration: 5 });
    expect(weak.agreement).toBeLessThan(strong.agreement);
  });
});
