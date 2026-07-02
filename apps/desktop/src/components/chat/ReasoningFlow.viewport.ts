/**
 * Viewport math for the ReasoningFlow spine — pan + semantic zoom on a 2D infinite canvas.
 *
 * Pure and dependency-free so it unit-tests without a DOM (desktop tests run in node). The component
 * owns the wheel/drag event plumbing; this module owns the *rules*: clamping, zoom-about-a-point, and
 * — the interesting part — SEMANTIC ZOOM: the detail a node reveals is a function of scale, not a
 * separate toggle. Zoomed out, nodes are bare hued dots (the turn's fingerprint); at rest, labels
 * appear; zoomed in, inline metadata fades in. Reveal-on-intent applied to the spatial axis.
 */

export const MIN_SCALE = 0.45;
export const MAX_SCALE = 2.6;
export const DEFAULT_SCALE = 1;

/** How much one wheel/pinch notch multiplies scale. Kept gentle so zoom feels continuous. */
export const ZOOM_STEP = 1.0015;

export interface Viewport {
  /** Current zoom factor, clamped to [MIN_SCALE, MAX_SCALE]. */
  readonly scale: number;
  /** Horizontal pan offset in *screen* px applied to the transformed canvas. */
  readonly panX: number;
}

export const IDENTITY_VIEWPORT: Viewport = { scale: DEFAULT_SCALE, panX: 0 };

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return DEFAULT_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Zoom about a fixed screen anchor (the cursor), so the content under the cursor stays put — the
 * behaviour every good map/canvas has. Given the current viewport, a raw scale delta, and the anchor
 * x (screen px, relative to the canvas origin), returns the next viewport with panX corrected so the
 * anchor's content coordinate is preserved.
 */
export function zoomAbout(vp: Viewport, factor: number, anchorX: number): Viewport {
  const nextScale = clampScale(vp.scale * factor);
  if (nextScale === vp.scale) return vp;
  // content coord under the anchor: (anchorX - panX) / scale. Keep it fixed after rescale.
  const contentX = (anchorX - vp.panX) / vp.scale;
  const panX = anchorX - contentX * nextScale;
  return { scale: nextScale, panX };
}

/** Apply a pan delta (screen px). Clamped later against content width by {@link clampPan}. */
export function panBy(vp: Viewport, dx: number): Viewport {
  return { scale: vp.scale, panX: vp.panX + dx };
}

/**
 * Clamp panX so the content can't be dragged entirely off-screen. Given the scaled content width and
 * the viewport (container) width, allow a small overscroll margin on each side so edge nodes aren't
 * flush against the frame. When content is narrower than the viewport, it stays left-aligned.
 */
export function clampPan(vp: Viewport, contentWidth: number, viewportWidth: number, margin = 24): Viewport {
  const scaledWidth = contentWidth * vp.scale;
  if (scaledWidth <= viewportWidth) {
    return { scale: vp.scale, panX: Math.min(margin, Math.max(vp.panX, 0)) };
  }
  const minPan = viewportWidth - scaledWidth - margin; // most negative (panned far right)
  const maxPan = margin; // panned to the start
  return { scale: vp.scale, panX: Math.min(maxPan, Math.max(minPan, vp.panX)) };
}

export type ZoomTier = 'overview' | 'rest' | 'detail';

/**
 * Semantic zoom tier from scale. The whole point of zoom here: WHAT you see is a function of HOW
 * close you are, so the same surface serves "shape of the whole turn" and "read one region".
 *  - overview (< 0.72): bare hued dots, no labels — the turn's fingerprint.
 *  - rest    (0.72–1.5): labels + duration, the default reading zoom.
 *  - detail  (> 1.5): inline metadata (confidence, token peek) fades onto the nodes.
 */
export function zoomTier(scale: number): ZoomTier {
  if (scale < 0.72) return 'overview';
  if (scale > 1.5) return 'detail';
  return 'rest';
}

/**
 * A "fit" scale that shows the whole content in the viewport, so a "reset/fit" control can frame the
 * entire turn regardless of step count. Clamped to the legal range.
 */
export function fitScale(contentWidth: number, viewportWidth: number, margin = 24): number {
  if (contentWidth <= 0) return DEFAULT_SCALE;
  return clampScale((viewportWidth - margin * 2) / contentWidth);
}

/**
 * Minimap geometry: given the viewport and content/viewport widths, return the [start, end] fraction
 * (0..1) of content currently visible, for drawing the overview window. Robust to zero widths.
 */
export function visibleWindow(vp: Viewport, contentWidth: number, viewportWidth: number): { start: number; end: number } {
  const scaledWidth = contentWidth * vp.scale;
  if (scaledWidth <= 0) return { start: 0, end: 1 };
  const start = Math.min(1, Math.max(0, -vp.panX / scaledWidth));
  const end = Math.min(1, Math.max(0, (-vp.panX + viewportWidth) / scaledWidth));
  return { start, end: Math.max(end, start) };
}
