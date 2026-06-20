import { describe, it, expect } from 'vitest';
import { presentStatus, rosterHasTrouble } from './StatusDot.logic';

describe('presentStatus — green/amber/red contract', () => {
  it('maps available → green tone, breathing, "Active"', () => {
    const p = presentStatus('available');
    expect(p.kind).toBe('available');
    expect(p.toneVar).toBe('--tone-good');
    expect(p.breathe).toBe(true);
    expect(p.label).toBe('Active');
  });

  it('maps cooldown → amber tone, not breathing', () => {
    const p = presentStatus('cooldown');
    expect(p.kind).toBe('cooldown');
    expect(p.toneVar).toBe('--tone-warn');
    expect(p.breathe).toBe(false);
  });

  it('maps down → red tone, not breathing', () => {
    const p = presentStatus('down');
    expect(p.kind).toBe('down');
    expect(p.toneVar).toBe('--tone-bad');
    expect(p.breathe).toBe(false);
  });

  it('degrades unknown/missing status to a neutral muted dot (never throws)', () => {
    expect(presentStatus(undefined).kind).toBe('unknown');
    expect(presentStatus(null).kind).toBe('unknown');
    expect(presentStatus('something-new-from-a-future-runtime').kind).toBe('unknown');
    expect(presentStatus(undefined).breathe).toBe(false);
  });
});

describe('rosterHasTrouble', () => {
  it('is false when every member is available', () => {
    expect(rosterHasTrouble(['available', 'available'])).toBe(false);
  });
  it('is true when any member is down or resting', () => {
    expect(rosterHasTrouble(['available', 'cooldown'])).toBe(true);
    expect(rosterHasTrouble(['down'])).toBe(true);
  });
  it('treats unknown as not-trouble (no false alarms)', () => {
    expect(rosterHasTrouble([undefined, 'available'])).toBe(false);
  });
});
