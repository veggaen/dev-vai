import { describe, it, expect } from 'vitest';
import { pageCapability, isPageQuery } from './page-capability.js';
import type { TurnContext } from '../turn-pipeline.js';
import type { PageEvidence } from '../../tools/page-evidence.js';

function ctx(text: string, page?: PageEvidence): TurnContext {
  return {
    content: text,
    understood: text,
    history: [],
    classification: {
      kind: 'standalone-question',
      confidence: 1,
      signals: [],
      referencesPriorTurn: false,
      isShortAnaphoric: false,
      wordCount: text.split(/\s+/).length,
    },
    intent: 'action-yesno',
    guidance: [],
    evidence: page ? { page } : undefined,
  };
}

function page(partial: Partial<PageEvidence> = {}): PageEvidence {
  return {
    ok: true,
    url: 'https://example.com/',
    finalUrl: 'https://example.com/',
    status: 200,
    title: 'Example Domain',
    titleId: 'page:title:https://example.com/',
    selectors: [
      { id: 'page:selector:https://example.com/#h1', selector: 'h1', exists: true, text: 'Example Domain' },
      { id: 'page:selector:https://example.com/#form.login', selector: 'form.login', exists: false, text: '' },
    ],
    observedAt: '2026-06-14T00:00:00Z',
    durationMs: 420,
    ...partial,
  };
}

describe('isPageQuery', () => {
  it('detects URL + inspect verb', () => {
    expect(isPageQuery('what is the title of https://example.com?')).toBe(true);
    expect(isPageQuery('does https://example.com have a login form?')).toBe(true);
    expect(isPageQuery('inspect https://example.com')).toBe(true);
  });
  it('ignores a bare URL with no inspect intent and inspect intent with no URL', () => {
    expect(isPageQuery('https://example.com')).toBe(false);
    expect(isPageQuery('what is the capital of France?')).toBe(false);
  });

  it('does not steal a source-file repair prompt just because the error contains a URL and fetch/reachable words', () => {
    expect(isPageQuery([
      'Repair the runtime issue in lib/AppKitProvider.tsx and lib/appkit.ts.',
      'The overlay reports Failed to fetch and https://mainnet.infura.io/v3/undefined.',
      'Refactor these files so wallet connect still works when the network is reachable.',
    ].join(' '))).toBe(false);
  });
});

describe('pageCapability.estimate', () => {
  it('is inapplicable for non-page turns', () => {
    expect(pageCapability.estimate(ctx('tell me a joke'))).toBeNull();
  });
  it('scores higher with an attached observation', () => {
    const withEv = pageCapability.estimate(ctx('what is the title of https://example.com?', page()))!;
    const without = pageCapability.estimate(ctx('what is the title of https://example.com?'))!;
    expect(withEv.evidence).toBeGreaterThan(without.evidence);
  });
});

describe('pageCapability.resolve', () => {
  it('composes a grounded answer from the observation', () => {
    const r = pageCapability.resolve(ctx('what is the title of https://example.com?', page()))!;
    expect(r.text).toContain('Page evidence');
    expect(r.text).toContain('Example Domain');
    expect(r.text).toContain('Status:** 200');
    expect(r.text).toContain('`h1` — present');
    expect(r.text).toContain('`form.login` — not found');
  });
  it('honestly declines with no observation', () => {
    const r = pageCapability.resolve(ctx('inspect https://example.com'))!;
    expect(r.text).toContain('no page was observed');
  });
});

describe('pageCapability.verify — bind page claims to the observation', () => {
  it('passes a grounded answer and cites observed ids', () => {
    const c = ctx('what is the title of https://example.com?', page());
    const r = pageCapability.resolve(c)!;
    const v = pageCapability.verify(r, c);
    expect(v.ok).toBe(true);
    expect(v.boundEvidence).toContain('page:title:https://example.com/');
  });

  it('REFUSES a fabricated title that differs from what was observed', () => {
    const c = ctx('what is the title?', page());
    const tampered = { text: '**Page evidence (observed now, 1ms):**\n\n- **URL:** https://example.com/\n- **Status:** 200\n- **Title:** Totally Fake Title', confidence: 0.9 } as never;
    const v = pageCapability.verify(tampered, c);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/title/i);
  });

  it('REFUSES an answer citing a selector that was never observed', () => {
    const c = ctx('inspect the page', page());
    const tampered = { text: '**Page evidence (observed now, 1ms):**\n\n- **Title:** Example Domain\n  - `.never-observed` — present', confidence: 0.9 } as never;
    const v = pageCapability.verify(tampered, c);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/not observed/i);
  });

  it('REFUSES a flipped existence claim (says present when it was not found)', () => {
    const c = ctx('does it have a login form?', page());
    const tampered = { text: '**Page evidence (observed now, 1ms):**\n\n- **Title:** Example Domain\n  - `form.login` — present', confidence: 0.9 } as never;
    const v = pageCapability.verify(tampered, c);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/present but it was not found/i);
  });

  it('treats selector names with regex metacharacters as literal evidence labels', () => {
    const tricky = 'button[data-action="save?"]';
    const c = ctx('does it have the save button?', page({
      selectors: [
        { id: 'page:selector:https://example.com/#save', selector: tricky, exists: false, text: '' },
      ],
    }));
    const tampered = { text: `**Page evidence (observed now, 1ms):**\n\n- **Title:** Example Domain\n  - \`${tricky}\` — present`, confidence: 0.9 } as never;
    const v = pageCapability.verify(tampered, c);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/present but it was not found/i);
  });

  it('REFUSES page-authoritative text with no evidence header', () => {
    const c = ctx('inspect https://example.com', page());
    const v = pageCapability.verify({ text: 'The page looks great, trust me.', confidence: 0.9 } as never, c);
    expect(v.ok).toBe(false);
  });

  it('always releases the honest no-observation decline', () => {
    const c = ctx('inspect https://example.com');
    const r = pageCapability.resolve(c)!;
    expect(pageCapability.verify(r, c).ok).toBe(true);
  });
});
