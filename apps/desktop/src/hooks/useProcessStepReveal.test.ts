import { describe, expect, it } from 'vitest';
import type { ChatProgressStep } from '../stores/chatStore.js';
import { computeProcessRevealFloor, shouldDrainAfterStream } from './useProcessStepReveal.js';

describe('shouldDrainAfterStream — keep dripping after a fast turn ends', () => {
  it('drains when rows remain hidden and a runway is configured', () => {
    expect(shouldDrainAfterStream({ revealed: 2, total: 6, runwayMs: 1600 })).toBe(true);
  });
  it('does not drain once every row is shown', () => {
    expect(shouldDrainAfterStream({ revealed: 6, total: 6, runwayMs: 1600 })).toBe(false);
  });
  it('snaps (no drain) when runway is disabled', () => {
    expect(shouldDrainAfterStream({ revealed: 0, total: 6, runwayMs: 0 })).toBe(false);
  });
});

describe('computeProcessRevealFloor', () => {
  it('includes all done steps plus the running tail', () => {
    const steps: ChatProgressStep[] = [
      { stage: 'reason', label: 'Reason', status: 'done' },
      { stage: 'vai-draft', label: 'Draft', status: 'done' },
      { stage: 'council', label: 'Council', status: 'running' },
    ];
    expect(computeProcessRevealFloor(steps)).toBe(3);
  });

  it('returns 0 for empty steps', () => {
    expect(computeProcessRevealFloor([])).toBe(0);
  });

  it('shows a single running step immediately', () => {
    expect(computeProcessRevealFloor([{ stage: 'reason', label: 'Reason', status: 'running' }])).toBe(1);
  });
});
