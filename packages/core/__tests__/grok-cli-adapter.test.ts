/**
 * Tests for the Grok-CLI council adapter. The pure surface (availability gating, null when
 * absent) is always tested. The LIVE shell-out is only exercised when grok is installed AND
 * VAI_TEST_GROK_LIVE=1 is set — so CI without grok stays green and we don't spend tokens.
 */
import { describe, it, expect } from 'vitest';
import { createGrokCliAdapter, isGrokCliAvailable, isCreditsBlocked, GrokCreditsError } from '../src/models/grok-cli-adapter.js';

describe('grok-cli adapter — credits detection', () => {
  it('detects the real 403 spending-limit message grok prints', () => {
    const real =
      'ERROR responses API error status=403 Forbidden error_message=personal-team-blocked:spending-limit: ' +
      'You have run out of credits or need a Grok subscription. Add credits at https://grok.com/?_s=usage';
    expect(isCreditsBlocked(real)).toBe(true);
  });

  it('matches each credits signal independently and is case-insensitive', () => {
    expect(isCreditsBlocked('SPENDING-LIMIT')).toBe(true);
    expect(isCreditsBlocked('personal-team-blocked')).toBe(true);
    expect(isCreditsBlocked('you have run out of credits')).toBe(true);
    expect(isCreditsBlocked('need a Grok subscription')).toBe(true);
  });

  it('does not false-positive on a normal answer or unrelated error', () => {
    expect(isCreditsBlocked('{"text":"the limit of this function is 5"}')).toBe(false);
    expect(isCreditsBlocked('grok exited 1: connection refused')).toBe(false);
    expect(isCreditsBlocked('')).toBe(false);
  });

  it('GrokCreditsError carries an actionable, panel-ready message', () => {
    const err = new GrokCreditsError();
    expect(err.name).toBe('GrokCreditsError');
    expect(err.message).toMatch(/out of credits/i);
    expect(err.message).toMatch(/grok\.com/);
  });
});

describe('grok-cli adapter — gating', () => {
  it('isGrokCliAvailable returns a boolean and is stable across calls', () => {
    const a = isGrokCliAvailable();
    const b = isGrokCliAvailable();
    expect(typeof a).toBe('boolean');
    expect(a).toBe(b); // cached
  });

  it('createGrokCliAdapter returns null when grok is unavailable, else a ModelAdapter', () => {
    const adapter = createGrokCliAdapter();
    if (isGrokCliAvailable()) {
      expect(adapter).not.toBeNull();
      expect(adapter!.id).toBe('grok-cli');
      expect(adapter!.supportsStreaming).toBe(false);
      expect(typeof adapter!.chat).toBe('function');
    } else {
      expect(adapter).toBeNull();
    }
  });
});

const LIVE = process.env.VAI_TEST_GROK_LIVE === '1' && isGrokCliAvailable();
describe.runIf(LIVE)('grok-cli adapter — live shell-out', () => {
  it('returns the model text for a strict-JSON prompt', async () => {
    const adapter = createGrokCliAdapter({ timeoutMs: 30_000 })!;
    const res = await adapter.chat({
      messages: [
        { role: 'system', content: 'Return STRICT JSON only, no prose.' },
        { role: 'user', content: 'Return exactly: {"verdict":"good","confidence":0.9}' },
      ],
      temperature: 0,
    });
    expect(res.message.content).toMatch(/verdict/);
    expect(res.modelId).toBe('grok-cli');
  }, 35_000);
});
