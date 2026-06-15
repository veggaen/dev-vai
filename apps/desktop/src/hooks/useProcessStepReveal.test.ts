import { describe, expect, it } from 'vitest';
import type { ChatProgressStep } from '../stores/chatStore.js';
import { computeProcessRevealFloor } from './useProcessStepReveal.js';

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
