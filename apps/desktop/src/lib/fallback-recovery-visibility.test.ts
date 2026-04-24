import { describe, expect, it } from 'vitest';
import { shouldShowFallbackRecoveryChrome } from './fallback-recovery-visibility.js';

describe('shouldShowFallbackRecoveryChrome', () => {
  it('hides generic recovery chrome on project update messages', () => {
    expect(shouldShowFallbackRecoveryChrome({
      isUser: false,
      isProjectUpdate: true,
      hasAppliedFileBlocks: false,
    })).toBe(false);
  });

  it('hides generic recovery chrome when the assistant already shipped file blocks', () => {
    expect(shouldShowFallbackRecoveryChrome({
      isUser: false,
      isProjectUpdate: false,
      hasAppliedFileBlocks: true,
    })).toBe(false);
  });

  it('keeps recovery chrome available for plain assistant guidance turns', () => {
    expect(shouldShowFallbackRecoveryChrome({
      isUser: false,
      isProjectUpdate: false,
      hasAppliedFileBlocks: false,
    })).toBe(true);
  });
});