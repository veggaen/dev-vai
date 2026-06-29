import { describe, it, expect } from 'vitest';
import { previewFromPartialJson } from './member.js';

describe('previewFromPartialJson — real council reasoning from partial JSON', () => {
  it('surfaces a verdict as soon as it appears, even mid-stream (unterminated string)', () => {
    expect(previewFromPartialJson('{"verdict": "needs-work')).toBe('leaning "needs-work"');
  });

  it('builds a readable line from several keys as they arrive', () => {
    const partial = '{"verdict":"good","confidence":0.8,"realIntent":"wants a clear decision walkthrough","suggestedAction":"answer"';
    const out = previewFromPartialJson(partial);
    expect(out).toContain('leaning "good"');
    expect(out).toContain('reads the ask as: wants a clear decision walkthrough');
    expect(out).toContain('would answer');
    expect(out).toContain('80% sure');
  });

  it('surfaces a missing-capability gap', () => {
    expect(previewFromPartialJson('{"missingCapability":"live draft streaming"}')).toContain('gap: live draft streaming');
  });

  it('never returns raw JSON noise — says it is drafting when bytes arrived but no key yet', () => {
    expect(previewFromPartialJson('{"thinking really hard')).toBe('drafting its review…');
  });

  it('returns empty for trivially short fragments (nothing to show yet)', () => {
    expect(previewFromPartialJson('{"conf')).toBe('');
    expect(previewFromPartialJson('{')).toBe('');
    expect(previewFromPartialJson('')).toBe('');
  });

  it('does not throw on malformed / truncated escapes', () => {
    expect(() => previewFromPartialJson('{"realIntent":"he said \\"')).not.toThrow();
  });
});
