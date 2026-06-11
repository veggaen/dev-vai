import { describe, expect, it } from 'vitest';
import { resolveBuilderIntent } from './resolve-builder-intent.js';

describe('resolveBuilderIntent', () => {
  it('prefers pomodoro when a focus planner also asks for a task list', () => {
    const prompt = 'Build a focus planner with pomodoro sessions, a task list, and a streak counter.';

    expect(
      resolveBuilderIntent({
        input: prompt,
        cleanedProjectDesc: prompt,
        fullDesc: prompt,
      })?.archetype,
    ).toBe('pomodoro');
  });
});
