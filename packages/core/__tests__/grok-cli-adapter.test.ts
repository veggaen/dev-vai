/**
 * Tests for the Grok-CLI council adapter. The pure surface (availability gating, null when
 * absent) is always tested. The LIVE shell-out is only exercised when grok is installed AND
 * VAI_TEST_GROK_LIVE=1 is set — so CI without grok stays green and we don't spend tokens.
 */
import { describe, it, expect } from 'vitest';
import { createGrokCliAdapter, isGrokCliAvailable } from '../src/models/grok-cli-adapter.js';

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
