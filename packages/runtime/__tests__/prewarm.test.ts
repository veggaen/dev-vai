import { describe, expect, it } from 'vitest';
import { resolveRuntimePrewarmPlan } from '../src/prewarm.js';

describe('runtime prewarm plan', () => {
  it('uses a cheap deterministic turn by default', () => {
    const plan = resolveRuntimePrewarmPlan({});

    expect(plan).toEqual({ kind: 'light', prompt: 'hello' });
    expect(plan?.prompt).not.toMatch(/\bbuild\b|\bapp\b|\bcode\b/i);
  });

  it('keeps builder prewarm explicit and opt-in', () => {
    expect(resolveRuntimePrewarmPlan({ VAI_HEAVY_PREWARM: '1' })).toEqual({
      kind: 'heavy',
      prompt: 'build a simple counter in pure HTML and CSS',
    });
  });

  it('can disable prewarm entirely', () => {
    expect(resolveRuntimePrewarmPlan({ VAI_DISABLE_PREWARM: '1' })).toBeNull();
  });
});
