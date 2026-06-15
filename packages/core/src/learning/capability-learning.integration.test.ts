import { describe, it, expect } from 'vitest';
import { CapabilityOutcomeLedger } from './capability-ledger.js';
import { scoreWithHistory, withLearnedHistory, type ScoreBreakdown } from '../chat/capability-kernel.js';

/**
 * INTEGRATION — prove the learning loop changes routing. Two capabilities produce the SAME
 * raw breakdown for a turn (so without learning they tie). One reliably verify-passes, the
 * other reliably verify-fails. After feeding outcomes to the ledger, the learned `history`
 * term must make the reliable one out-SCORE the flaky one — measured before/after.
 */

const RAW: ScoreBreakdown = {
  intentFit: 0.8,
  evidence: 0.6,
  history: 0.5, // hardcoded neutral — what every capability ships
  latency: 0.05,
  cost: 0.05,
  risk: 0.1,
};

describe('capability learning loop — routing improves with outcomes', () => {
  it('two identical-breakdown capabilities tie WITHOUT learning', () => {
    const a = scoreWithHistory(RAW, 'reliable');
    const b = scoreWithHistory(RAW, 'flaky');
    expect(a).toBe(b); // no ledger → both use the hardcoded 0.5
  });

  it('the reliable capability out-scores the flaky one AFTER learning', () => {
    const led = new CapabilityOutcomeLedger();
    // 20 turns each: 'reliable' always passes verify; 'flaky' fails 70% of the time.
    for (let i = 0; i < 20; i++) {
      led.record('reliable', 'verifyPassed');
      led.record('flaky', i % 10 < 7 ? 'verifyFailed' : 'verifyPassed');
    }

    const reliableScore = scoreWithHistory(RAW, 'reliable', led);
    const flakyScore = scoreWithHistory(RAW, 'flaky', led);

    expect(reliableScore).toBeGreaterThan(flakyScore);
    // And the reliable one beats its own pre-learning baseline; the flaky one drops below it.
    const baseline = scoreWithHistory(RAW, 'x');
    expect(reliableScore).toBeGreaterThan(baseline);
    expect(flakyScore).toBeLessThan(baseline);
  });

  it('learning is turn-class aware: a capability reliable on class A but not B is ranked accordingly', () => {
    const led = new CapabilityOutcomeLedger();
    for (let i = 0; i < 15; i++) {
      led.record('git', 'verifyPassed', 'standalone-question');
      led.record('git', 'verifyFailed', 'contextual-followup');
    }
    const onA = scoreWithHistory(RAW, 'git', led, 'standalone-question');
    const onB = scoreWithHistory(RAW, 'git', led, 'contextual-followup');
    expect(onA).toBeGreaterThan(onB);
  });

  it('withLearnedHistory only overrides the history term, leaving the rest intact', () => {
    const led = new CapabilityOutcomeLedger();
    for (let i = 0; i < 20; i++) led.record('git', 'verifyPassed');
    const adjusted = withLearnedHistory(RAW, 'git', led);
    expect(adjusted.history).toBeGreaterThan(0.5);
    expect(adjusted.intentFit).toBe(RAW.intentFit);
    expect(adjusted.evidence).toBe(RAW.evidence);
    expect(adjusted.risk).toBe(RAW.risk);
  });

  it('a cold capability is unaffected (history stays 0.5) — no penalty for being new', () => {
    const led = new CapabilityOutcomeLedger();
    led.record('other', 'verifyPassed'); // unrelated activity
    const adjusted = withLearnedHistory(RAW, 'brand-new', led);
    expect(adjusted.history).toBe(0.5);
  });
});
