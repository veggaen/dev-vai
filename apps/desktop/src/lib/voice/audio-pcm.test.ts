import { describe, expect, it } from 'vitest';
import { conditionPcm, hasSpeechEnergy, trimPcmSilence } from './audio-pcm.js';

describe('conditionPcm', () => {
  it('boosts quiet speech toward the target level without clipping', () => {
    // Quiet sine-ish signal peaking at 0.02 — a too-far-from-the-mic capture.
    const pcm = new Float32Array(1600);
    for (let i = 0; i < pcm.length; i += 1) pcm[i] = 0.02 * Math.sin(i / 5);

    const out = conditionPcm(pcm);
    let peak = 0;
    for (const v of out) peak = Math.max(peak, Math.abs(v));

    expect(peak).toBeGreaterThan(0.05); // audibly boosted
    expect(peak).toBeLessThanOrEqual(0.95); // never clipped
  });

  it('caps gain so near-silence is not amplified into fake speech', () => {
    const pcm = new Float32Array(1600);
    for (let i = 0; i < pcm.length; i += 1) pcm[i] = 0.0005 * Math.sin(i / 5);

    const out = conditionPcm(pcm);
    let peak = 0;
    for (const v of out) peak = Math.max(peak, Math.abs(v));

    // Max 8× gain: 0.0005 → at most 0.004.
    expect(peak).toBeLessThanOrEqual(0.0041);
  });

  it('removes DC offset', () => {
    const pcm = new Float32Array(1600);
    for (let i = 0; i < pcm.length; i += 1) pcm[i] = 0.3 + 0.1 * Math.sin(i / 5);

    const out = conditionPcm(pcm);
    let mean = 0;
    for (const v of out) mean += v;
    mean /= out.length;

    expect(Math.abs(mean)).toBeLessThan(0.01);
  });

  it('returns already-healthy audio untouched', () => {
    // Alternating ±0.3: exactly zero mean, RMS 0.3 (above target), peak well below ceiling.
    const pcm = new Float32Array(1600);
    for (let i = 0; i < pcm.length; i += 1) pcm[i] = i % 2 === 0 ? 0.3 : -0.3;

    expect(conditionPcm(pcm)).toBe(pcm);
  });
});

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

describe('hasSpeechEnergy', () => {
  it('rejects silence and a low electrical noise floor', () => {
    expect(hasSpeechEnergy(new Float32Array(16_000))).toBe(false);
    const noise = Float32Array.from({ length: 16_000 }, (_, i) => (i % 2 ? 1 : -1) * 0.001);
    expect(hasSpeechEnergy(noise)).toBe(false);
  });

  it('accepts a short speech-like signal with multiple active frames', () => {
    const speech = Float32Array.from(
      { length: 16_000 },
      (_, i) => i > 1_600 && i < 8_000 ? Math.sin(i / 7) * 0.08 : 0,
    );
    expect(hasSpeechEnergy(speech)).toBe(true);
  });

  it('rejects an isolated click even when its peak is high', () => {
    const click = new Float32Array(16_000);
    click[4_000] = 0.9;
    expect(hasSpeechEnergy(click)).toBe(false);
  });
});
