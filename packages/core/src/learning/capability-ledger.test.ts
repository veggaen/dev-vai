import { describe, it, expect } from 'vitest';
import { CapabilityOutcomeLedger } from './capability-ledger.js';

describe('CapabilityOutcomeLedger — learned history signal', () => {
  it('returns exactly 0.5 for an unknown capability (kernel cold-start)', () => {
    const led = new CapabilityOutcomeLedger();
    expect(led.history('git')).toBe(0.5);
  });

  it('rises above 0.5 as a capability accumulates verify-passes', () => {
    const led = new CapabilityOutcomeLedger();
    const before = led.history('git');
    for (let i = 0; i < 20; i++) led.record('git', 'verifyPassed');
    const after = led.history('git');
    expect(before).toBe(0.5);
    expect(after).toBeGreaterThan(0.8);
  });

  it('falls below 0.5 as a capability accumulates verify-fails', () => {
    const led = new CapabilityOutcomeLedger();
    for (let i = 0; i < 20; i++) led.record('flaky', 'verifyFailed');
    expect(led.history('flaky')).toBeLessThan(0.2);
  });

  it('a reliable capability outranks a flaky one after equal exposure', () => {
    const led = new CapabilityOutcomeLedger();
    for (let i = 0; i < 15; i++) {
      led.record('git', 'verifyPassed');
      led.record('flaky', i % 3 === 0 ? 'verifyPassed' : 'verifyFailed'); // ~33% success
    }
    expect(led.history('git')).toBeGreaterThan(led.history('flaky'));
  });

  it('shrinks toward 0.5 with little data (no overconfident swing from one outcome)', () => {
    const led = new CapabilityOutcomeLedger({ priorStrength: 4 });
    led.record('x', 'verifyPassed'); // a single pass
    // One success with prior 4 → (1 + 2)/(1 + 4) = 0.6, NOT 1.0.
    expect(led.history('x')).toBeCloseTo(0.6, 2);
  });

  it('negative user feedback pulls history down; positive lifts it', () => {
    const led = new CapabilityOutcomeLedger();
    for (let i = 0; i < 10; i++) led.record('git', 'verifyPassed');
    const baseline = led.history('git');
    for (let i = 0; i < 10; i++) led.record('git', 'userNegative');
    expect(led.history('git')).toBeLessThan(baseline);
  });

  it('does not count declines against history (benign fall-through)', () => {
    const led = new CapabilityOutcomeLedger();
    for (let i = 0; i < 20; i++) led.record('git', 'declined');
    // Declines alone → no success/failure signal → stays neutral.
    expect(led.history('git')).toBe(0.5);
    expect(led.get('git')!.declines).toBe(20);
  });
});

describe('CapabilityOutcomeLedger — turn-class scoping', () => {
  it('learns per turn-class: reliable on one class, flaky on another', () => {
    const led = new CapabilityOutcomeLedger();
    for (let i = 0; i < 12; i++) {
      led.record('git', 'verifyPassed', 'standalone-question');
      led.record('git', 'verifyFailed', 'contextual-followup');
    }
    expect(led.history('git', 'standalone-question')).toBeGreaterThan(0.7);
    expect(led.history('git', 'contextual-followup')).toBeLessThan(0.3);
  });

  it('falls back to the global stat when the scoped class has no data', () => {
    const led = new CapabilityOutcomeLedger();
    for (let i = 0; i < 12; i++) led.record('git', 'verifyPassed', 'standalone-question');
    // A class we never saw → uses the global (which is strong here).
    expect(led.history('git', 'never-seen-class')).toBeGreaterThan(0.7);
  });
});

describe('CapabilityOutcomeLedger — persistence', () => {
  it('round-trips through serialize/restore', () => {
    const led = new CapabilityOutcomeLedger();
    for (let i = 0; i < 8; i++) led.record('git', 'verifyPassed');
    led.record('flaky', 'verifyFailed', 'standalone-question');
    const snap = led.serialize();

    const restored = new CapabilityOutcomeLedger();
    restored.restore(snap);
    expect(restored.history('git')).toBeCloseTo(led.history('git'), 6);
    expect(restored.size()).toBe(led.size());
  });
});
