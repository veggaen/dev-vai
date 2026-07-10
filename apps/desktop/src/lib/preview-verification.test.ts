import { describe, expect, it } from 'vitest';
import { existingPreviewRemainedHealthy } from './preview-verification.js';

describe('existingPreviewRemainedHealthy', () => {
  it('accepts healthy HMR without a second iframe load event', () => {
    expect(existingPreviewRemainedHealthy({
      port: 4100,
      baselineLoadCount: 3,
      devPort: 4100,
      lastPreviewPort: 4100,
      previewLoadCount: 3,
      previewReady: true,
      status: 'running',
    })).toBe(true);
  });

  it('does not trust a failed, missing, or never-loaded preview', () => {
    const base = {
      port: 4100,
      baselineLoadCount: 2,
      devPort: 4100,
      lastPreviewPort: 4100,
      previewLoadCount: 2,
      previewReady: true,
      status: 'running',
    };
    expect(existingPreviewRemainedHealthy({ ...base, status: 'failed' })).toBe(false);
    expect(existingPreviewRemainedHealthy({ ...base, devPort: 4101 })).toBe(false);
    expect(existingPreviewRemainedHealthy({ ...base, baselineLoadCount: 0, previewLoadCount: 0 })).toBe(false);
  });
});
