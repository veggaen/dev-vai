import { describe, it, expect } from 'vitest';
import {
  classifyContextItem,
  buildMemberContextLedger,
  labelForRequest,
  distinctiveTokens,
  buildProvenanceSpine,
  type FetchedEvidence,
  type MemberContextLedger,
} from './context-states.js';

/**
 * context-states — the per-member "used / unused / considered / unavailable" classifier.
 * This is the auditable trail behind a vote: did the member actually lean on what it fetched?
 */

describe('labelForRequest', () => {
  it('labels each tool request readably', () => {
    expect(labelForRequest({ tool: 'grep', pattern: 'FOO' })).toBe('grep /FOO/');
    expect(labelForRequest({ tool: 'readFile', path: 'src/a.ts' })).toBe('readFile src/a.ts');
    expect(labelForRequest({ tool: 'listFiles', glob: '**/*.ts' })).toBe('listFiles **/*.ts');
  });
});

describe('distinctiveTokens', () => {
  it('pulls identifiers / paths / quoted strings, skips noise', () => {
    const toks = distinctiveTokens('export const SECRET_MARKER = "blueberry-42"; // src/target.ts');
    expect(toks).toContain('secret_marker');
    expect(toks).toContain('blueberry-42');
  });
});

describe('classifyContextItem', () => {
  const grepHit: FetchedEvidence = {
    request: { tool: 'grep', pattern: 'SECRET_MARKER' },
    resultText: 'grep /SECRET_MARKER/:\n  src/target.ts:1  export const SECRET_MARKER = "blueberry-42";',
  };

  it('marks USED when the note references a distinctive token from the result', () => {
    const r = classifyContextItem(grepHit, 'Grounded in src/target.ts — the value is blueberry-42, looks correct.');
    expect(r.state).toBe('used');
    expect(r.reason).toMatch(/references/);
  });

  it('marks UNUSED when the result had real signal the note never mentions', () => {
    const r = classifyContextItem(grepHit, 'The draft reads fine; no concerns.');
    expect(r.state).toBe('unused');
  });

  it('marks UNAVAILABLE when the fetch returned nothing', () => {
    const r = classifyContextItem(
      { request: { tool: 'grep', pattern: 'NOPE' }, resultText: 'grep /NOPE/ → no matches.' },
      'whatever',
    );
    expect(r.state).toBe('unavailable');
  });

  it('treats a rejected/sandbox-blocked fetch as unavailable', () => {
    const r = classifyContextItem(
      { request: { tool: 'readFile', path: '../secret' }, resultText: 'readFile ../secret → Rejected: path escapes the repo sandbox or is invalid.' },
      'note',
    );
    expect(r.state).toBe('unavailable');
  });
});

describe('buildMemberContextLedger', () => {
  it('rolls up used/unused/unavailable counts for a member', () => {
    const fetched: FetchedEvidence[] = [
      { request: { tool: 'grep', pattern: 'ALPHA' }, resultText: 'grep /ALPHA/:\n  a.ts:1  const ALPHA_TOKEN = 1;' },
      { request: { tool: 'grep', pattern: 'BETA' }, resultText: 'grep /BETA/:\n  b.ts:2  const BETA_THING = 2;' },
      { request: { tool: 'grep', pattern: 'GONE' }, resultText: 'grep /GONE/ → no matches.' },
    ];
    const note = 'I grounded on ALPHA_TOKEN; it confirms the draft.';
    const ledger = buildMemberContextLedger('qwen3', fetched, note);
    expect(ledger.memberId).toBe('qwen3');
    expect(ledger.summary.used).toBe(1);       // ALPHA_TOKEN referenced
    expect(ledger.summary.unused).toBe(1);     // BETA_THING fetched, ignored
    expect(ledger.summary.unavailable).toBe(1); // GONE found nothing
    expect(ledger.items).toHaveLength(3);
  });

  it('is empty-safe', () => {
    const ledger = buildMemberContextLedger('m', [], 'note');
    expect(ledger.items).toEqual([]);
    expect(ledger.summary).toEqual({ used: 0, unused: 0, unavailable: 0 });
  });
});

describe('buildProvenanceSpine — consensus-level verification spine (advisory)', () => {
  const ledger = (memberId: string, states: Array<{ label: string; state: any }>): MemberContextLedger => ({
    memberId,
    items: states.map((s) => ({ label: s.label, tool: 'readFile' as const, state: s.state, reason: '' })),
    summary: { used: 0, unused: 0, unavailable: 0 },
  });

  it('rolls up counts + groundedness across members', () => {
    const spine = buildProvenanceSpine([
      ledger('a', [{ label: 'f1', state: 'used' }, { label: 'f2', state: 'unused' }]),
      ledger('b', [{ label: 'f3', state: 'used' }, { label: 'f4', state: 'unavailable' }]),
    ]);
    expect(spine.total).toBe(4);
    expect(spine.counts.used).toBe(2);
    expect(spine.groundedness).toBeCloseTo(0.5, 2);
    expect(spine.verdict).toBe('grounded'); // >= 0.34 used, nothing disputed
  });

  it('marks a USED item disputed when a contradicting label is supplied → contested', () => {
    const spine = buildProvenanceSpine(
      [ledger('a', [{ label: 'price.ts', state: 'used' }, { label: 'g', state: 'used' }])],
      ['price.ts'],
    );
    expect(spine.counts.disputed).toBe(1);
    expect(spine.counts.used).toBe(1);
    expect(spine.hasDisputed).toBe(true);
    expect(spine.verdict).toBe('contested');
  });

  it('verdict "thin" when little fetched context actually grounded the answer', () => {
    const spine = buildProvenanceSpine([ledger('a', [
      { label: '1', state: 'unused' }, { label: '2', state: 'unused' }, { label: '3', state: 'used' },
      { label: '4', state: 'considered' }, { label: '5', state: 'unused' },
    ])]); // 1/5 used = 0.2 < 0.34
    expect(spine.verdict).toBe('thin');
  });

  it('verdict "none" + no NaN when the panel touched no context (prompt-only)', () => {
    const spine = buildProvenanceSpine([ledger('a', [])]);
    expect(spine.total).toBe(0);
    expect(spine.groundedness).toBe(0);
    expect(spine.verdict).toBe('none');
  });
});
