import { describe, expect, it } from 'vitest';
import {
  isBuildExecutionMode,
  isExplicitBuildExecutionRequest,
} from './build-execution-intent.js';

describe('build-execution-intent', () => {
  it('treats agent and builder as build execution modes', () => {
    expect(isBuildExecutionMode('agent')).toBe(true);
    expect(isBuildExecutionMode('builder')).toBe(true);
    expect(isBuildExecutionMode('chat')).toBe(false);
  });

  it('detects explicit ship-now build requests like the Tinder clone prompt', () => {
    const prompt = 'Build a 100% accurate Tinder clone — card stack swipe UI. React + Vite. Ship complete runnable files.';
    expect(isExplicitBuildExecutionRequest(prompt)).toBe(true);
  });

  it('does not treat planning-only hardware prompts as build execution', () => {
    const prompt = 'Design a wall-mounted humidity sensor product with enclosure, BOM, and certification path.';
    expect(isExplicitBuildExecutionRequest(prompt)).toBe(false);
  });
});
