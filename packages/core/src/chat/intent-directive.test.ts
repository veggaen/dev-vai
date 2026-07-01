import { describe, it, expect } from 'vitest';
import { composeIntentDirective, belowFloorReason } from './intent-directive.js';

describe('composeIntentDirective — intent-shaped escalation guidance', () => {
  it('produces a recommendation-shaped directive that bans generic prose', () => {
    const d = composeIntentDirective('recommendation');
    expect(d).not.toBeNull();
    expect(d).toContain('recommendation');
    expect(d!.toLowerCase()).toContain('do not');
  });

  it('shapes each concrete intent distinctly', () => {
    const intents = ['recommendation', 'factual-lookup', 'definition', 'build', 'action-yesno'] as const;
    const directives = intents.map((i) => composeIntentDirective(i));
    // All present…
    expect(directives.every((d) => typeof d === 'string' && d.length > 0)).toBe(true);
    // …and all distinct (no copy-paste shape).
    expect(new Set(directives).size).toBe(intents.length);
  });

  it('returns null for `other` — no shape is fabricated', () => {
    expect(composeIntentDirective('other')).toBeNull();
  });

  it('returns null for `meta`', () => {
    expect(composeIntentDirective('meta')).toBeNull();
  });
});

describe('belowFloorReason — auditable escalation trail', () => {
  it('names the intent and that a directive was applied', () => {
    const r = belowFloorReason('recommendation', true);
    expect(r).toContain('recommendation');
    expect(r).toContain('intent-shaped directive');
  });

  it('records when no shape was forced (other-intent escalation)', () => {
    const r = belowFloorReason('other', false);
    expect(r).toContain('other');
    expect(r).toContain('no shape forced');
  });
});
