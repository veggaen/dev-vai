/**
 * RAVEL — Relational Adaptive Visual Evidence Loop.
 *
 * Audits relationships instead of isolated CSS declarations: autonomous
 * surfaces, inferred spacing rhythm, responsive clipping, and semantic media
 * crop targets. Geometry stays deterministic; meaning is delegated to vision.
 */
export interface VisualRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface VisualLayoutNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly selector: string;
  readonly tag: string;
  readonly role?: string;
  readonly accessibleName?: string;
  readonly repeatKey?: string;
  readonly rect: VisualRect;
  readonly visible: boolean;
  readonly backgroundColor: string;
  readonly backgroundImage?: string;
  readonly boxShadow?: string;
  readonly borderWidth?: number;
  readonly borderRadii: {
    readonly topLeft: number;
    readonly topRight: number;
    readonly bottomRight: number;
    readonly bottomLeft: number;
  };
  readonly position?: string;
  readonly overflowX?: string;
  readonly overflowY?: string;
  readonly clientWidth?: number;
  readonly clientHeight?: number;
  readonly scrollWidth?: number;
  readonly scrollHeight?: number;
}

export type VisualLayoutRule =
  | 'touching-autonomous-surfaces'
  | 'spacing-rhythm-outlier'
  | 'clipped-content';

export interface VisualLayoutIssue {
  readonly rule: VisualLayoutRule;
  readonly severity: 'warning' | 'error';
  readonly message: string;
  readonly nodeIds: readonly string[];
  readonly selectors: readonly string[];
  readonly measuredPx: number;
  readonly expectedPx?: number;
}

export interface VisualSemanticTarget {
  readonly nodeId: string;
  readonly selector: string;
  readonly accessibleName: string;
  readonly rect: VisualRect;
  readonly prompt: string;
}

export interface VisualLayoutAuditReport {
  readonly verdict: 'pass' | 'warn' | 'fail';
  readonly score: number;
  readonly spacingRhythmPx: number;
  readonly issues: readonly VisualLayoutIssue[];
  readonly semanticTargets: readonly VisualSemanticTarget[];
}

export interface VisualLayoutAuditOptions {
  readonly minimumAutonomousSurfaceGapPx?: number;
  readonly maximumNeighbourGapPx?: number;
}

const DEFAULT_MINIMUM_SURFACE_GAP = 8;
const DEFAULT_MAXIMUM_NEIGHBOUR_GAP = 96;

function right(rect: VisualRect): number {
  return rect.x + rect.width;
}

function bottom(rect: VisualRect): number {
  return rect.y + rect.height;
}

function overlap(startA: number, endA: number, startB: number, endB: number): number {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function horizontalOverlapRatio(a: VisualRect, b: VisualRect): number {
  return overlap(a.x, right(a), b.x, right(b)) / Math.max(1, Math.min(a.width, b.width));
}

function verticalOverlapRatio(a: VisualRect, b: VisualRect): number {
  return overlap(a.y, bottom(a), b.y, bottom(b)) / Math.max(1, Math.min(a.height, b.height));
}

function contains(outer: VisualRect, inner: VisualRect): boolean {
  return outer.x <= inner.x
    && outer.y <= inner.y
    && right(outer) >= right(inner)
    && bottom(outer) >= bottom(inner);
}

function colorAlpha(value: string): number {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'transparent') return 0;
  const rgba = normalized.match(/^rgba?\([^,]+,[^,]+,[^,]+(?:,\s*([0-9.]+))?\)$/);
  if (rgba) return rgba[1] === undefined ? 1 : Number.parseFloat(rgba[1]);
  const modernRgb = normalized.match(/^rgb\([^/]+\/\s*([0-9.]+)%?\)$/);
  if (modernRgb) {
    const alpha = Number.parseFloat(modernRgb[1] ?? '0');
    return normalized.includes('%') ? alpha / 100 : alpha;
  }
  return 1;
}

function isSurface(node: VisualLayoutNode): boolean {
  return node.visible
    && node.rect.width >= 24
    && node.rect.height >= 20
    && (
      colorAlpha(node.backgroundColor) >= 0.08
      || Boolean(node.backgroundImage && node.backgroundImage !== 'none')
      || Boolean(node.boxShadow && node.boxShadow !== 'none')
      || (node.borderWidth ?? 0) > 0
    );
}

function hasRoundedBottom(node: VisualLayoutNode): boolean {
  return Math.max(node.borderRadii.bottomLeft, node.borderRadii.bottomRight) >= 3;
}

function hasRoundedTop(node: VisualLayoutNode): boolean {
  return Math.max(node.borderRadii.topLeft, node.borderRadii.topRight) >= 3;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 16;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 16);
}

function quantizeSpacing(value: number): number {
  return Math.max(1, Math.round(value / 4) * 4);
}

function nearestVerticalPairs(
  surfaces: readonly VisualLayoutNode[],
  maximumGap: number,
): Array<{ above: VisualLayoutNode; below: VisualLayoutNode; gap: number }> {
  const pairs: Array<{ above: VisualLayoutNode; below: VisualLayoutNode; gap: number }> = [];
  for (const above of surfaces) {
    const candidates = surfaces
      .filter((below) => below.id !== above.id
        && below.rect.y >= bottom(above.rect) - 1
        && !contains(above.rect, below.rect)
        && !contains(below.rect, above.rect)
        && horizontalOverlapRatio(above.rect, below.rect) >= 0.72
        && Math.min(above.rect.width, below.rect.width) / Math.max(above.rect.width, below.rect.width) >= 0.72)
      .map((below) => ({ below, gap: below.rect.y - bottom(above.rect) }))
      .filter(({ gap }) => gap >= -1 && gap <= maximumGap)
      .sort((a, b) => a.gap - b.gap);
    const nearest = candidates[0];
    if (nearest) pairs.push({ above, below: nearest.below, gap: nearest.gap });
  }
  return pairs;
}

function repeatedSiblingGaps(nodes: readonly VisualLayoutNode[]): number[] {
  const groups = new Map<string, VisualLayoutNode[]>();
  for (const node of nodes) {
    if (!node.visible || !node.parentId || !node.repeatKey) continue;
    const key = `${node.parentId}\u0000${node.repeatKey}`;
    const group = groups.get(key) ?? [];
    group.push(node);
    groups.set(key, group);
  }

  const gaps: number[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const horizontal = [...group].sort((a, b) => a.rect.x - b.rect.x);
    for (let index = 1; index < horizontal.length; index += 1) {
      const previous = horizontal[index - 1];
      const current = horizontal[index];
      if (!previous || !current || verticalOverlapRatio(previous.rect, current.rect) < 0.55) continue;
      const gap = current.rect.x - right(previous.rect);
      if (gap > 0 && gap <= 96) gaps.push(gap);
    }
  }
  return gaps;
}

function semanticTargets(nodes: readonly VisualLayoutNode[]): VisualSemanticTarget[] {
  return nodes
    .filter((node) => node.visible
      && Boolean(node.accessibleName?.trim())
      && (node.tag === 'img' || node.tag === 'svg' || node.role === 'img'))
    .map((node) => ({
      nodeId: node.id,
      selector: node.selector,
      accessibleName: node.accessibleName!.trim(),
      rect: node.rect,
      prompt: `Does this cropped visual clearly represent "${node.accessibleName!.trim()}" without relying on nearby text? Report concrete visible evidence.`,
    }));
}

export function auditVisualLayout(
  nodes: readonly VisualLayoutNode[],
  options: VisualLayoutAuditOptions = {},
): VisualLayoutAuditReport {
  const minimumGap = options.minimumAutonomousSurfaceGapPx ?? DEFAULT_MINIMUM_SURFACE_GAP;
  const maximumGap = options.maximumNeighbourGapPx ?? DEFAULT_MAXIMUM_NEIGHBOUR_GAP;
  const visible = nodes.filter((node) => node.visible && node.rect.width > 0 && node.rect.height > 0);
  const surfaces = visible.filter(isSurface);
  const verticalPairs = nearestVerticalPairs(surfaces, maximumGap);
  const rhythmSamples = [
    ...repeatedSiblingGaps(visible),
    ...verticalPairs.map((pair) => pair.gap).filter((gap) => gap >= minimumGap),
  ];
  const spacingRhythmPx = quantizeSpacing(median(rhythmSamples));
  const issues: VisualLayoutIssue[] = [];

  for (const pair of verticalPairs) {
    const autonomousCorners = hasRoundedBottom(pair.above) && hasRoundedTop(pair.below);
    if (autonomousCorners && pair.gap < minimumGap) {
      issues.push({
        rule: 'touching-autonomous-surfaces',
        severity: 'error',
        message: `${pair.above.selector} and ${pair.below.selector} render as separate rounded surfaces but are only ${Math.max(0, pair.gap).toFixed(1)}px apart; the inferred page rhythm is ${spacingRhythmPx}px.`,
        nodeIds: [pair.above.id, pair.below.id],
        selectors: [pair.above.selector, pair.below.selector],
        measuredPx: Math.max(0, pair.gap),
        expectedPx: Math.max(minimumGap, spacingRhythmPx),
      });
    } else if (pair.gap > 0 && pair.gap < Math.max(4, spacingRhythmPx * 0.4)) {
      issues.push({
        rule: 'spacing-rhythm-outlier',
        severity: 'warning',
        message: `${pair.above.selector} and ${pair.below.selector} use a ${pair.gap.toFixed(1)}px gap, far below the inferred ${spacingRhythmPx}px spacing rhythm.`,
        nodeIds: [pair.above.id, pair.below.id],
        selectors: [pair.above.selector, pair.below.selector],
        measuredPx: pair.gap,
        expectedPx: spacingRhythmPx,
      });
    }
  }

  for (const node of visible) {
    const clippedWidth = (node.scrollWidth ?? node.clientWidth ?? 0) - (node.clientWidth ?? 0);
    const clippedHeight = (node.scrollHeight ?? node.clientHeight ?? 0) - (node.clientHeight ?? 0);
    const clipsX = /hidden|clip/.test(node.overflowX ?? '') && clippedWidth > 2;
    const clipsY = /hidden|clip/.test(node.overflowY ?? '') && clippedHeight > 2;
    if (!clipsX && !clipsY) continue;
    issues.push({
      rule: 'clipped-content',
      severity: 'warning',
      message: `${node.selector} clips ${Math.max(clippedWidth, clippedHeight).toFixed(1)}px of rendered content.`,
      nodeIds: [node.id],
      selectors: [node.selector],
      measuredPx: Math.max(clippedWidth, clippedHeight),
    });
  }

  const uniqueIssues = [...new Map(issues.map((issue) => [`${issue.rule}:${issue.nodeIds.join(':')}`, issue])).values()];
  const errorCount = uniqueIssues.filter((issue) => issue.severity === 'error').length;
  const warningCount = uniqueIssues.length - errorCount;
  const score = Math.max(0, 1 - (errorCount * 0.25) - (warningCount * 0.08));
  return {
    verdict: errorCount > 0 ? 'fail' : warningCount > 0 ? 'warn' : 'pass',
    score,
    spacingRhythmPx,
    issues: uniqueIssues,
    semanticTargets: semanticTargets(visible),
  };
}
