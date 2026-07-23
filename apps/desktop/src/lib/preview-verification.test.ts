import { describe, expect, it } from 'vitest';
import {
  existingPreviewRemainedHealthy,
  parsePreviewRefreshRequest,
  previewUrlForRefresh,
} from './preview-verification.js';

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

describe('controlled preview refresh proof', () => {
  it('accepts only a concrete port-scoped refresh request', () => {
    expect(parsePreviewRefreshRequest({ port: 4100, requestId: 'turn-17' })).toEqual({
      port: 4100,
      requestId: 'turn-17',
    });
    expect(parsePreviewRefreshRequest({ port: 0, requestId: 'turn-17' })).toBeNull();
    expect(parsePreviewRefreshRequest({ port: 4100, requestId: '' })).toBeNull();
  });

  it('creates a cache-busted document URL for observable browser-load proof', () => {
    expect(previewUrlForRefresh('http://localhost:4100', 'turn-17'))
      .toBe('http://localhost:4100/?_vai_refresh=turn-17');
  });
});
