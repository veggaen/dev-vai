import { describe, it, expect, vi } from 'vitest';
import { gatherPageEvidence, pageEvidenceIds, hasPageEvidence, type PageObserver } from './page-evidence.js';
import type { PageObservation } from '../search/browser-search.js';

function observation(partial: Partial<PageObservation> = {}): PageObservation {
  return {
    ok: true,
    url: 'https://example.com/',
    finalUrl: 'https://example.com/',
    status: 200,
    title: 'Example Domain',
    selectors: [
      { selector: 'h1', exists: true, text: 'Example Domain' },
      { selector: '.missing', exists: false, text: '' },
    ],
    observedAt: '2026-06-14T00:00:00Z',
    durationMs: 420,
    ...partial,
  };
}

describe('gatherPageEvidence — SSRF guard (before any browser work)', () => {
  it('rejects localhost without observing', async () => {
    const observer = vi.fn();
    const ev = await gatherPageEvidence('http://localhost:3000/admin', { observer: observer as unknown as PageObserver });
    expect(ev.ok).toBe(false);
    expect(ev.error).toMatch(/unsafe url|private or local/i);
    expect(observer).not.toHaveBeenCalled();
  });

  it('rejects private network addresses', async () => {
    const observer = vi.fn();
    for (const url of ['http://127.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.1/']) {
      const ev = await gatherPageEvidence(url, { observer: observer as unknown as PageObserver });
      expect(ev.ok).toBe(false);
    }
    expect(observer).not.toHaveBeenCalled();
  });

  it('rejects non-http(s) and credentialed URLs', async () => {
    const observer = vi.fn();
    expect((await gatherPageEvidence('file:///etc/passwd', { observer: observer as unknown as PageObserver })).ok).toBe(false);
    expect((await gatherPageEvidence('https://user:pass@example.com/', { observer: observer as unknown as PageObserver })).ok).toBe(false);
    expect(observer).not.toHaveBeenCalled();
  });
});

describe('gatherPageEvidence — observation shaping', () => {
  it('shapes a successful observation into bindable evidence with ids', async () => {
    const observer: PageObserver = async () => observation();
    const ev = await gatherPageEvidence('https://example.com/', { selectors: ['h1', '.missing'], observer });
    expect(ev.ok).toBe(true);
    expect(ev.title).toBe('Example Domain');
    expect(ev.status).toBe(200);
    expect(ev.titleId).toBe('page:title:https://example.com/');
    const h1 = ev.selectors.find((s) => s.selector === 'h1')!;
    expect(h1).toMatchObject({ exists: true, text: 'Example Domain', id: 'page:selector:https://example.com/#h1' });
    expect(ev.selectors.find((s) => s.selector === '.missing')!.exists).toBe(false);
  });

  it('passes the requested selectors through to the observer', async () => {
    const observer = vi.fn(async () => observation());
    await gatherPageEvidence('https://example.com/', { selectors: ['title', '#main'], observer: observer as unknown as PageObserver });
    expect(observer).toHaveBeenCalledWith('https://example.com/', ['title', '#main'], expect.any(Number));
  });

  it('returns ok:false (not throw) when the observation itself failed', async () => {
    const observer: PageObserver = async () => observation({ ok: false, error: 'no browser available', title: '', selectors: [] });
    const ev = await gatherPageEvidence('https://example.com/', { observer });
    expect(ev.ok).toBe(false);
    expect(ev.error).toMatch(/no browser/i);
  });

  it('returns ok:false when the observer throws', async () => {
    const observer: PageObserver = async () => { throw new Error('navigation timeout'); };
    const ev = await gatherPageEvidence('https://example.com/', { observer });
    expect(ev.ok).toBe(false);
    expect(ev.error).toMatch(/observation failed|navigation timeout/i);
  });
});

describe('pageEvidenceIds + hasPageEvidence', () => {
  it('collects title + selector ids', async () => {
    const ev = await gatherPageEvidence('https://example.com/', {
      selectors: ['h1'],
      observer: async () => observation({ selectors: [{ selector: 'h1', exists: true, text: 'X' }] }),
    });
    const ids = pageEvidenceIds(ev);
    expect(ids.has('page:title:https://example.com/')).toBe(true);
    expect(ids.has('page:selector:https://example.com/#h1')).toBe(true);
    expect(hasPageEvidence(ev)).toBe(true);
  });

  it('hasPageEvidence is false for a failed observation', async () => {
    const ev = await gatherPageEvidence('http://localhost/', {});
    expect(hasPageEvidence(ev)).toBe(false);
  });
});
