import { describe, it, expect } from 'vitest';
import { PROCESS_DEPTHS, type ProcessDepth } from './ProcessDepthControl.js';

/**
 * Locks the depth control's contract: the three depths exist in fast→thorough order with
 * the exact `processDepth` values the server understands, and each carries a user-facing
 * label + hint (rubric: every control state is explained). The cycle order is what the
 * arrow-key navigation in the component relies on.
 */

describe('PROCESS_DEPTHS', () => {
  it('exposes quick → balanced → deep in order with server-matching values', () => {
    expect(PROCESS_DEPTHS.map((d) => d.value)).toEqual<ProcessDepth[]>(['quick', 'balanced', 'deep']);
  });

  it('every depth has a label and a non-empty hint (no unexplained control state)', () => {
    for (const d of PROCESS_DEPTHS) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.hint.length).toBeGreaterThan(8);
    }
  });

  it('balanced is the middle/default option', () => {
    expect(PROCESS_DEPTHS[1].value).toBe('balanced');
  });
});
