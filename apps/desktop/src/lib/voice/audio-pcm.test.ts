import { describe, expect, it } from 'vitest';
import { trimPcmSilence } from './audio-pcm.js';

describe('trimPcmSilence', () => {
  it('removes leading and trailing silence while preserving padding around speech', () => {
    const pcm = new Float32Array([
      ...Array.from({ length: 300 }, () => 0),
      ...Array.from({ length: 200 }, () => 0.04),
      ...Array.from({ length: 300 }, () => 0),
    ]);

    const trimmed = trimPcmSilence(pcm, 1000, { threshold: 0.01, padMs: 100 });

    expect(trimmed.length).toBeLessThan(pcm.length);
    expect(trimmed.length).toBeGreaterThanOrEqual(380);
    expect(trimmed.some((sample) => sample > 0.03)).toBe(true);
  });

  it('keeps all-silence audio untouched so downstream no-speech handling owns it', () => {
    const pcm = new Float32Array(500);
    expect(trimPcmSilence(pcm, 1000)).toBe(pcm);
  });
});
