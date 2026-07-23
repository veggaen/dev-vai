import { describe, expect, it } from 'vitest';
import { auditVisualLayout, type VisualLayoutNode } from './visual-layout-audit.js';

function node(overrides: Partial<VisualLayoutNode> & Pick<VisualLayoutNode, 'id' | 'rect'>): VisualLayoutNode {
  return {
    parentId: null,
    selector: `#${overrides.id}`,
    tag: 'section',
    visible: true,
    backgroundColor: 'rgb(35, 39, 48)',
    borderRadii: { topLeft: 8, topRight: 8, bottomRight: 8, bottomLeft: 8 },
    ...overrides,
  };
}

describe('auditVisualLayout', () => {
  it('detects two autonomous rounded surfaces touching despite healthy card rhythm', () => {
    const report = auditVisualLayout([
      node({ id: 'header', selector: '.stats-header', rect: { x: 20, y: 20, width: 992, height: 167 } }),
      node({ id: 'search', selector: '.search-bar', rect: { x: 20, y: 187, width: 992, height: 52 } }),
      node({ id: 'card-1', parentId: 'grid', repeatKey: '.book-card', rect: { x: 20, y: 255, width: 320, height: 480 } }),
      node({ id: 'card-2', parentId: 'grid', repeatKey: '.book-card', rect: { x: 356, y: 255, width: 320, height: 480 } }),
      node({ id: 'card-3', parentId: 'grid', repeatKey: '.book-card', rect: { x: 692, y: 255, width: 320, height: 480 } }),
    ]);

    expect(report.verdict).toBe('fail');
    expect(report.spacingRhythmPx).toBe(16);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: 'touching-autonomous-surfaces',
        selectors: ['.stats-header', '.search-bar'],
        measuredPx: 0,
        expectedPx: 16,
      }),
    ]));
  });

  it('passes the same composition when the header and search follow the inferred rhythm', () => {
    const report = auditVisualLayout([
      node({ id: 'header', selector: '.stats-header', rect: { x: 20, y: 20, width: 992, height: 167 } }),
      node({ id: 'search', selector: '.search-bar', rect: { x: 20, y: 203, width: 992, height: 52 } }),
      node({ id: 'card-1', parentId: 'grid', repeatKey: '.book-card', rect: { x: 20, y: 271, width: 320, height: 480 } }),
      node({ id: 'card-2', parentId: 'grid', repeatKey: '.book-card', rect: { x: 356, y: 271, width: 320, height: 480 } }),
      node({ id: 'card-3', parentId: 'grid', repeatKey: '.book-card', rect: { x: 692, y: 271, width: 320, height: 480 } }),
    ]);

    expect(report.verdict).toBe('pass');
    expect(report.issues).toHaveLength(0);
  });

  it('emits isolated semantic crop tasks for title-to-image verification', () => {
    const report = auditVisualLayout([
      node({
        id: 'gatsby-cover',
        selector: '[aria-label="The Great Gatsby cover"]',
        tag: 'svg',
        role: 'img',
        accessibleName: 'The Great Gatsby cover with an art-deco skyline and green beacon',
        rect: { x: 692, y: 271, width: 320, height: 426 },
      }),
    ]);

    expect(report.semanticTargets).toEqual([
      expect.objectContaining({
        nodeId: 'gatsby-cover',
        prompt: expect.stringContaining('clearly represent "The Great Gatsby cover'),
      }),
    ]);
  });
});
