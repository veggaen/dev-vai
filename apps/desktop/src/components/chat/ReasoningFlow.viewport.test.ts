import { describe, it, expect } from 'vitest';
import {
  clampScale,
  zoomAbout,
  panBy,
  clampPan,
  zoomTier,
  fitScale,
  visibleWindow,
  IDENTITY_VIEWPORT,
  MIN_SCALE,
  MAX_SCALE,
} from './ReasoningFlow.viewport.js';

describe('clampScale', () => {
  it('clamps to the legal range', () => {
    expect(clampScale(0.1)).toBe(MIN_SCALE);
    expect(clampScale(9)).toBe(MAX_SCALE);
    expect(clampScale(1)).toBe(1);
  });
  it('falls back to the safe default on any non-finite input', () => {
    expect(clampScale(NaN)).toBe(1);
    expect(clampScale(Infinity)).toBe(1);
    expect(clampScale(-Infinity)).toBe(1);
  });
});

describe('zoomAbout', () => {
  it('keeps the content under the anchor fixed', () => {
    const vp = { scale: 1, panX: 0 };
    const anchor = 300;
    const contentBefore = (anchor - vp.panX) / vp.scale;
    const next = zoomAbout(vp, 1.5, anchor);
    const contentAfter = (anchor - next.panX) / next.scale;
    expect(next.scale).toBeCloseTo(1.5, 5);
    expect(contentAfter).toBeCloseTo(contentBefore, 5);
  });
  it('is a no-op at the scale ceiling', () => {
    const vp = { scale: MAX_SCALE, panX: 10 };
    expect(zoomAbout(vp, 2, 100)).toEqual(vp);
  });
});

describe('panBy', () => {
  it('shifts panX and leaves scale', () => {
    expect(panBy({ scale: 1.3, panX: 5 }, -20)).toEqual({ scale: 1.3, panX: -15 });
  });
});

describe('clampPan', () => {
  it('left-aligns content narrower than the viewport', () => {
    const vp = clampPan({ scale: 1, panX: -500 }, 200, 800);
    expect(vp.panX).toBeGreaterThanOrEqual(0);
  });
  it('prevents dragging wide content fully off-screen', () => {
    // content 2000 * scale 1 = 2000 wide in a 800 viewport
    const tooFarRight = clampPan({ scale: 1, panX: -99999 }, 2000, 800, 24);
    expect(tooFarRight.panX).toBe(800 - 2000 - 24);
    const tooFarLeft = clampPan({ scale: 1, panX: 99999 }, 2000, 800, 24);
    expect(tooFarLeft.panX).toBe(24);
  });
});

describe('zoomTier (semantic zoom)', () => {
  it('maps scale to overview / rest / detail', () => {
    expect(zoomTier(0.5)).toBe('overview');
    expect(zoomTier(0.72)).toBe('rest');
    expect(zoomTier(1)).toBe('rest');
    expect(zoomTier(1.5)).toBe('rest');
    expect(zoomTier(2)).toBe('detail');
  });
});

describe('fitScale', () => {
  it('fits content into the viewport within legal bounds', () => {
    expect(fitScale(400, 848, 24)).toBeCloseTo(2, 1); // (848-48)/400 = 2
    expect(fitScale(4000, 848, 24)).toBe(MIN_SCALE); // clamps down
    expect(fitScale(0, 800)).toBe(1);
  });
});

describe('visibleWindow', () => {
  it('reports the full range at identity when content fits', () => {
    const w = visibleWindow(IDENTITY_VIEWPORT, 800, 800);
    expect(w.start).toBe(0);
    expect(w.end).toBe(1);
  });
  it('reports a sub-window when zoomed/panned into wide content', () => {
    const w = visibleWindow({ scale: 2, panX: -800 }, 800, 800); // scaled width 1600
    expect(w.start).toBeCloseTo(0.5, 5);
    expect(w.end).toBeCloseTo(1, 5);
  });
});
