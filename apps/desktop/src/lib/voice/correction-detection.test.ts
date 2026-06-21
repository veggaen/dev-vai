import { describe, it, expect } from 'vitest';
import { detectCorrections, mishearingPrompt } from './correction-detection.js';

describe('detectCorrections', () => {
  it('detects a single-word mishearing (replacement)', () => {
    const r = detectCorrections('send this to caltrane today', 'send this to Caltrain today');
    expect(r.hasCorrections).toBe(true);
    expect(r.mishearings).toEqual([{ heard: 'caltrane', corrected: 'Caltrain' }]);
  });

  it('does NOT flag pure additions as corrections', () => {
    const r = detectCorrections('book a meeting', 'book a meeting for tomorrow at noon');
    expect(r.hasCorrections).toBe(false);
    expect(r.mishearings).toHaveLength(0);
    expect(r.edits.some((e) => e.type === 'insert')).toBe(true);
  });

  it('does NOT flag pure deletions as corrections', () => {
    const r = detectCorrections('um so basically send the email', 'send the email');
    expect(r.hasCorrections).toBe(false);
    expect(r.edits.some((e) => e.type === 'delete')).toBe(true);
  });

  it('ignores trailing punctuation differences', () => {
    const r = detectCorrections('hello there', 'hello there.');
    expect(r.hasCorrections).toBe(false);
  });

  it('catches a mid-sentence replacement among unchanged words', () => {
    const r = detectCorrections('deploy to prod using docker', 'deploy to staging using docker');
    expect(r.mishearings).toEqual([{ heard: 'prod', corrected: 'staging' }]);
  });

  it('does not treat a wholesale rewrite as a single mishearing', () => {
    const r = detectCorrections('quick brown fox', 'a totally different sentence entirely here');
    // The big swap is too long to be a plausible word-level mishearing.
    expect(r.mishearings).toHaveLength(0);
  });

  it('returns empty for empty heard text', () => {
    const r = detectCorrections('', 'typed from scratch');
    expect(r.hasCorrections).toBe(false);
    expect(r.mishearings).toHaveLength(0);
  });

  it('builds a friendly mishearing prompt, or null when nothing to ask', () => {
    const r = detectCorrections('meet at the cafe', 'meet at the Caffe');
    expect(mishearingPrompt(r)).toContain('Caffe');
    expect(mishearingPrompt(detectCorrections('same text', 'same text'))).toBeNull();
  });
});
