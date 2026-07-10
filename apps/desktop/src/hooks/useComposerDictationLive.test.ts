import { describe, expect, it } from 'vitest';
import { groomDictationDisplay } from './useComposerDictationLive.js';

describe('groomDictationDisplay', () => {
  it('prettifies raw interim text synchronously', () => {
    expect(groomDictationDisplay('um hello there')).toBe('Hello there');
  });

  it('returns empty for blank input', () => {
    expect(groomDictationDisplay('   ')).toBe('');
  });
});