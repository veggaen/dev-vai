import { describe, expect, it } from 'vitest';
import { evidenceTierFromProof } from '../src/builder-loop/evidence-types.js';

describe('evidenceTierFromProof', () => {
  it('returns high when screenshot, build, and typecheck pass', () => {
    expect(evidenceTierFromProof({ screenshotOk: true, buildOk: true, typecheckOk: true })).toBe('high');
  });

  it('returns medium when build and typecheck pass without screenshot', () => {
    expect(evidenceTierFromProof({ buildOk: true, typecheckOk: true })).toBe('medium');
  });

  it('returns low for reasoning-only', () => {
    expect(evidenceTierFromProof({ reasoningOnly: true, buildOk: true })).toBe('low');
  });

  it('returns unverified explicit build failure', () => {
    expect(evidenceTierFromProof({ buildOk: false })).toBe('unverified');
  });
});
