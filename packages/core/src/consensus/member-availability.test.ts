import { describe, it, expect } from 'vitest';
import {
  MemberAvailabilityStore,
  classifyUnavailability,
  fixHintFor,
  needsUserAction,
} from './member-availability.js';

describe('classifyUnavailability — know WHY a member is down', () => {
  it('classifies the exact Grok failures from the BTC trace', () => {
    expect(classifyUnavailability('out of credits — add credits at https://grok.com')).toBe('no-credits');
    expect(classifyUnavailability('responses API error status=403 Forbidden')).toBe('auth');
    expect(classifyUnavailability(new Error('upgrade at https://grok.com/supergrok'))).toBe('no-credits');
  });

  it('classifies transient failures', () => {
    expect(classifyUnavailability('council member timed out after 30000ms')).toBe('timeout');
    expect(classifyUnavailability('This operation was aborted')).toBe('timeout');
    expect(classifyUnavailability('429 Too Many Requests')).toBe('rate-limited');
    expect(classifyUnavailability('ECONNREFUSED')).toBe('network');
  });

  it('falls back to unknown for unrecognized errors', () => {
    expect(classifyUnavailability('some weird internal error')).toBe('unknown');
  });
});

describe('fixHintFor + needsUserAction — tell the user how to fix it', () => {
  it('gives an actionable credit fix for no-credits', () => {
    expect(fixHintFor('no-credits', 'Grok')).toMatch(/add credits|switch.*account/i);
    expect(needsUserAction('no-credits')).toBe(true);
  });
  it('gives an auth fix for forbidden', () => {
    expect(fixHintFor('auth', 'Grok')).toMatch(/api key|switch.*account/i);
    expect(needsUserAction('auth')).toBe(true);
  });
  it('transient reasons need no user action', () => {
    expect(needsUserAction('timeout')).toBe(false);
    expect(needsUserAction('rate-limited')).toBe(false);
  });
});

describe('MemberAvailabilityStore — stop wasting cycles on a dead member', () => {
  it('records a failure with reason + fix hint', () => {
    const store = new MemberAvailabilityStore();
    const state = store.recordFailure('grok', 'Grok', 'out of credits', 1000);
    expect(state.status).toBe('unavailable');
    expect(state.reason).toBe('no-credits');
    expect(state.fixHint).toMatch(/credits/i);
  });

  it('SKIPS a credit-exhausted member during its cooldown (stops retrying)', () => {
    const store = new MemberAvailabilityStore();
    const t0 = 1_000_000;
    store.recordFailure('grok', 'Grok', 'out of credits (403)', t0);
    // Immediately after: do NOT try again.
    expect(store.shouldTry('grok', t0 + 1000)).toBe(false);
    expect(store.shouldTry('grok', t0 + 60_000)).toBe(false); // still within 30-min cooldown
    // After the cooldown: re-check (in case the user added credits).
    expect(store.shouldTry('grok', t0 + 31 * 60_000)).toBe(true);
  });

  it('uses a short cooldown for transient reasons', () => {
    const store = new MemberAvailabilityStore();
    const t0 = 1_000_000;
    store.recordFailure('qwen', 'Qwen', 'timed out after 30000ms', t0);
    expect(store.shouldTry('qwen', t0 + 30_000)).toBe(false); // within 2-min timeout cooldown
    expect(store.shouldTry('qwen', t0 + 3 * 60_000)).toBe(true);
  });

  it('escalates the cooldown with consecutive failures (flapping member backs off)', () => {
    const store = new MemberAvailabilityStore();
    const t0 = 1_000_000;
    store.recordFailure('grok', 'Grok', 'out of credits', t0);
    store.recordFailure('grok', 'Grok', 'out of credits', t0 + 1000); // 2nd failure
    const state = store.get('grok')!;
    expect(state.failureCount).toBe(2);
    // 2 failures → 2× the 30-min base; still unavailable at 31 min.
    expect(store.shouldTry('grok', t0 + 31 * 60_000)).toBe(false);
    expect(store.shouldTry('grok', t0 + 61 * 60_000)).toBe(true);
  });

  it('CLEARS the state on a later success (member is back)', () => {
    const store = new MemberAvailabilityStore();
    store.recordFailure('grok', 'Grok', 'out of credits', 1000);
    expect(store.get('grok')).not.toBeNull();
    store.recordSuccess('grok');
    expect(store.get('grok')).toBeNull();
    expect(store.shouldTry('grok', 2000)).toBe(true);
  });

  it('always tries a member with no recorded failure', () => {
    const store = new MemberAvailabilityStore();
    expect(store.shouldTry('fresh', Date.now())).toBe(true);
  });

  it('surfaces user-action fix hints (and not transient ones)', () => {
    const store = new MemberAvailabilityStore();
    store.recordFailure('grok', 'Grok', 'out of credits', 1000);
    store.recordFailure('qwen', 'Qwen', 'timed out', 1000);
    const hints = store.userActionHints();
    expect(hints.some((h) => /credits/i.test(h))).toBe(true);
    expect(hints.some((h) => /Qwen/.test(h))).toBe(false); // transient → no user-action hint
  });
});

describe('MemberAvailabilityStore — persistence', () => {
  it('round-trips through serialize/restore', () => {
    const store = new MemberAvailabilityStore();
    store.recordFailure('grok', 'Grok', 'out of credits', 1000);
    const restored = new MemberAvailabilityStore();
    restored.restore(store.serialize());
    expect(restored.get('grok')?.reason).toBe('no-credits');
    expect(restored.shouldTry('grok', 2000)).toBe(false);
  });
});
