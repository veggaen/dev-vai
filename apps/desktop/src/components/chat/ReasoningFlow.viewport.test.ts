import { describe, it, expect } from 'vitest';
import {
  clampScale,
  zoomAbout,
  panBy,
  clampPan,
  zoomTier,
  fitScale,
  fitViewport,
  isAtFit,
  visibleWindow,
  baseContentWidth,
  nodeX,
  zoomToNode,
  panToFraction,
  IDENTITY_VIEWPORT,
  MIN_SCALE,
  MAX_SCALE,
  NODE_PAD,
  BASE_SPACING,
  TAIL_PAD,
  DETAIL_ZOOM_SCALE,
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

describe('position model (nodeX / baseContentWidth)', () => {
  it('pins the layout constants so the visual rhythm is a deliberate choice', () => {
    expect(NODE_PAD).toBe(56);
    expect(BASE_SPACING).toBe(96);
    expect(TAIL_PAD).toBe(76);
    expect(DETAIL_ZOOM_SCALE).toBeGreaterThan(1.5); // must land in the detail tier
  });
  it('spreads positions with scale — spacing doubles, offsets stay proportional', () => {
    expect(nodeX(0, 1)).toBe(NODE_PAD);
    expect(nodeX(3, 1)).toBe(NODE_PAD + 3 * BASE_SPACING);
    expect(nodeX(3, 2)).toBe(2 * (NODE_PAD + 3 * BASE_SPACING));
  });
  it('baseContentWidth covers first pad, spans, and label tail', () => {
    expect(baseContentWidth(0)).toBe(0);
    expect(baseContentWidth(1)).toBe(NODE_PAD + TAIL_PAD);
    expect(baseContentWidth(5)).toBe(NODE_PAD + 4 * BASE_SPACING + TAIL_PAD);
  });
  it('screen position = contentX * scale + panX (the invariant zoomAbout preserves)', () => {
    const vp = zoomAbout({ scale: 1, panX: 0 }, 1.5, nodeX(2, 1));
    // the node under the anchor must still be under the anchor after the zoom
    expect(nodeX(2, vp.scale) + vp.panX).toBeCloseTo(nodeX(2, 1), 5);
  });
});

describe('fitViewport / isAtFit', () => {
  it('never enlarges past the default scale for small turns', () => {
    const vp = fitViewport(3, 800); // 3 nodes fit easily at scale 1
    expect(vp.scale).toBe(1);
    expect(vp.panX).toBeGreaterThanOrEqual(0);
  });
  it('shrinks to show a long turn entirely (floored at MIN_SCALE for extreme turns)', () => {
    const count = 40;
    const vp = fitViewport(count, 800);
    expect(vp.scale).toBeLessThan(1);
    // a 40-step turn is wider than MIN_SCALE allows — fit shows as much as legal, no further
    const fits = baseContentWidth(count) * vp.scale <= 800 + 48;
    expect(fits || vp.scale === MIN_SCALE).toBe(true);
    // a moderate turn DOES fit fully
    const vp12 = fitViewport(12, 800);
    expect(baseContentWidth(12) * vp12.scale).toBeLessThanOrEqual(800 + 48);
  });
  it('isAtFit is true exactly at the fit viewport and false once zoomed or panned', () => {
    const vp = fitViewport(10, 800);
    expect(isAtFit(vp, 10, 800)).toBe(true);
    expect(isAtFit({ scale: vp.scale * 1.4, panX: vp.panX }, 10, 800)).toBe(false);
    expect(isAtFit({ scale: vp.scale, panX: vp.panX - 40 }, 10, 800)).toBe(false);
  });
});

describe('zoomToNode', () => {
  it('lands in the detail tier centered on a middle node', () => {
    const count = 20;
    const vp = zoomToNode(10, count, 800);
    expect(zoomTier(vp.scale)).toBe('detail');
    expect(nodeX(10, vp.scale) + vp.panX).toBeCloseTo(400, 5);
  });
  it('clamps at the edges — the LAST node cannot over-pan past the content end', () => {
    const count = 20;
    const vp = zoomToNode(count - 1, count, 800);
    // clamped, so the content's right edge stays within the frame + margin
    const scaledWidth = baseContentWidth(count) * vp.scale;
    expect(vp.panX).toBeGreaterThanOrEqual(800 - scaledWidth - 24);
    // and the node is still on screen
    const screenX = nodeX(count - 1, vp.scale) + vp.panX;
    expect(screenX).toBeGreaterThan(0);
    expect(screenX).toBeLessThan(800);
  });
  it('handles the FIRST node (index 0) without going positive past the margin', () => {
    const vp = zoomToNode(0, 20, 800);
    expect(vp.panX).toBeLessThanOrEqual(24);
  });
  it('single-node turn stays legal', () => {
    const vp = zoomToNode(0, 1, 800);
    expect(Number.isFinite(vp.panX)).toBe(true);
    expect(zoomTier(vp.scale)).toBe('detail');
  });
});

describe('panToFraction (minimap scrub)', () => {
  it('centers the window on the requested fraction of wide content', () => {
    const content = 2000;
    const vp = panToFraction({ scale: 1, panX: 0 }, 0.5, content, 800);
    const w = visibleWindow(vp, content, 800);
    expect((w.start + w.end) / 2).toBeCloseTo(0.5, 2);
  });
  it('clamps at both extremes and ignores nonsense fractions', () => {
    const content = 2000;
    expect(panToFraction({ scale: 1, panX: 0 }, -5, content, 800).panX).toBe(24);
    expect(panToFraction({ scale: 1, panX: 0 }, 99, content, 800).panX).toBe(800 - content - 24);
  });
  it('is a no-op on empty content', () => {
    const vp = { scale: 1, panX: 7 };
    expect(panToFraction(vp, 0.5, 0, 800)).toEqual(vp);
  });
});
