import { describe, it, expect, beforeEach } from 'vitest';
import {
  ThorsenAdaptiveController,
  classifySyncState,
  THORSEN_CURVE,
} from '../src/thorsen/types.js';

// ─── classifySyncState ──────────────────────────────────────────

describe('classifySyncState', () => {
  it('returns wormhole below 100ms', () => {
    expect(classifySyncState(50)).toBe('wormhole');
    expect(classifySyncState(0)).toBe('wormhole');
    expect(classifySyncState(99)).toBe('wormhole');
  });

  it('returns parallel between 100-200ms', () => {
    expect(classifySyncState(100)).toBe('parallel');
    expect(classifySyncState(150)).toBe('parallel');
    expect(classifySyncState(200)).toBe('parallel');
  });

  it('returns linear above 200ms', () => {
    expect(classifySyncState(201)).toBe('linear');
    expect(classifySyncState(500)).toBe('linear');
    expect(classifySyncState(10000)).toBe('linear');
  });
});

// ─── ThorsenAdaptiveController ──────────────────────────────────

describe('ThorsenAdaptiveController', () => {
  let ctrl: ThorsenAdaptiveController;

  beforeEach(() => {
    ctrl = new ThorsenAdaptiveController();
  });

  // ── Defaults ──

  it('starts with concurrency=5 and parallel state', () => {
    expect(ctrl.concurrency).toBe(5);
    expect(ctrl.state).toBe('parallel');
  });

  it('returns 0 for median and p95 when empty', () => {
    expect(ctrl.medianLatency).toBe(0);
    expect(ctrl.p95Latency).toBe(0);
  });

  // ── Wormhole ramp-up ──

  it('ramps concurrency up for wormhole latencies', () => {
    // Feed 20 fast observations (<100ms)
    for (let i = 0; i < 20; i++) ctrl.observe(30);
    expect(ctrl.state).toBe('wormhole');
    // Target for wormhole = (10+50)/2 = 30
    // Starting at 5, stepping +1 or +2 each observation — should be well above 10
    expect(ctrl.concurrency).toBeGreaterThanOrEqual(THORSEN_CURVE.CONCURRENCY.wormhole.min);
    expect(ctrl.concurrency).toBeLessThanOrEqual(THORSEN_CURVE.CONCURRENCY.wormhole.max);
  });

  // ── Linear throttle-down ──

  it('throttles concurrency down for linear latencies', () => {
    // Feed 20 slow observations (>200ms)
    for (let i = 0; i < 20; i++) ctrl.observe(500);
    expect(ctrl.state).toBe('linear');
    // Target for linear = (1+3)/2 = 2
    expect(ctrl.concurrency).toBeGreaterThanOrEqual(THORSEN_CURVE.CONCURRENCY.linear.min);
    expect(ctrl.concurrency).toBeLessThanOrEqual(THORSEN_CURVE.CONCURRENCY.linear.max);
  });

  // ── Parallel stabilization ──

  it('stabilizes in parallel band for mid-range latencies', () => {
    for (let i = 0; i < 20; i++) ctrl.observe(150);
    expect(ctrl.state).toBe('parallel');
    // Target for parallel = (3+10)/2 = 6.5 → 7
    expect(ctrl.concurrency).toBeGreaterThanOrEqual(THORSEN_CURVE.CONCURRENCY.parallel.min);
    expect(ctrl.concurrency).toBeLessThanOrEqual(THORSEN_CURVE.CONCURRENCY.parallel.max);
  });

  // ── Smooth stepping ──

  it('never jumps concurrency by more than 2 per observation', () => {
    let prev = ctrl.concurrency;
    // Dramatic shift: feed wormhole latencies from parallel start
    for (let i = 0; i < 30; i++) {
      ctrl.observe(10);
      const curr = ctrl.concurrency;
      expect(Math.abs(curr - prev)).toBeLessThanOrEqual(2);
      prev = curr;
    }
  });

  it('never jumps concurrency by more than 2 when throttling down', () => {
    // First get to high concurrency
    for (let i = 0; i < 30; i++) ctrl.observe(10);
    let prev = ctrl.concurrency;
    // Now slam to linear
    for (let i = 0; i < 30; i++) {
      ctrl.observe(1000);
      const curr = ctrl.concurrency;
      expect(Math.abs(curr - prev)).toBeLessThanOrEqual(2);
      prev = curr;
    }
  });

  // ── Window overflow ──

  it('drops old observations when window overflows', () => {
    const small = new ThorsenAdaptiveController({ windowSize: 5 });
    // Fill with slow values
    for (let i = 0; i < 5; i++) small.observe(500);
    expect(small.state).toBe('linear');
    // Now push fast values — old slow ones get shifted out
    for (let i = 0; i < 5; i++) small.observe(30);
    expect(small.state).toBe('wormhole');
    expect(small.snapshot().observations).toBe(5);
  });

  // ── Custom window size ──

  it('respects custom windowSize', () => {
    const custom = new ThorsenAdaptiveController({ windowSize: 3 });
    custom.observe(10);
    custom.observe(20);
    custom.observe(30);
    custom.observe(40); // should drop the 10
    expect(custom.snapshot().observations).toBe(3);
  });

  // ── Median latency ──

  it('computes correct median for odd-length window', () => {
    ctrl.observe(100);
    ctrl.observe(200);
    ctrl.observe(300);
    // sorted: [100, 200, 300] → median = 200
    expect(ctrl.medianLatency).toBe(200);
  });

  it('computes correct median for even-length window', () => {
    ctrl.observe(100);
    ctrl.observe(200);
    ctrl.observe(300);
    ctrl.observe(400);
    // sorted: [100, 200, 300, 400] → median = (200+300)/2 = 250
    expect(ctrl.medianLatency).toBe(250);
  });

  // ── P95 latency ──

  it('returns the highest value as p95 for small windows', () => {
    ctrl.observe(50);
    ctrl.observe(100);
    ctrl.observe(150);
    // 3 values: index = floor(3*0.95) = floor(2.85) = 2 → last element
    expect(ctrl.p95Latency).toBe(150);
  });

  it('computes p95 correctly for a 20-element window', () => {
    // 1,2,3,...,20
    for (let i = 1; i <= 20; i++) ctrl.observe(i * 10);
    // sorted: [10,20,...,200], index = floor(20*0.95) = 19 → 200
    expect(ctrl.p95Latency).toBe(200);
  });

  // ── Reset ──

  it('resets to default state', () => {
    for (let i = 0; i < 10; i++) ctrl.observe(10);
    expect(ctrl.concurrency).not.toBe(5);
    ctrl.reset();
    expect(ctrl.concurrency).toBe(5);
    expect(ctrl.state).toBe('parallel');
    expect(ctrl.medianLatency).toBe(0);
    expect(ctrl.snapshot().observations).toBe(0);
  });

  // ── Snapshot ──

  it('returns all expected fields in snapshot', () => {
    ctrl.observe(80);
    ctrl.observe(120);
    const snap = ctrl.snapshot();
    expect(snap).toHaveProperty('state');
    expect(snap).toHaveProperty('concurrency');
    expect(snap).toHaveProperty('medianLatency');
    expect(snap).toHaveProperty('p95Latency');
    expect(snap).toHaveProperty('windowSize');
    expect(snap).toHaveProperty('observations');
    expect(snap.observations).toBe(2);
    expect(snap.windowSize).toBe(20);
  });

  // ── Custom initial concurrency ──

  it('respects custom initialConcurrency', () => {
    const custom = new ThorsenAdaptiveController({ initialConcurrency: 15 });
    expect(custom.concurrency).toBe(15);
  });

  // ── State transitions ──

  it('transitions from wormhole to linear on latency spike', () => {
    for (let i = 0; i < 20; i++) ctrl.observe(30);
    expect(ctrl.state).toBe('wormhole');
    // Replace window with slow observations
    for (let i = 0; i < 25; i++) ctrl.observe(500);
    expect(ctrl.state).toBe('linear');
  });
});
