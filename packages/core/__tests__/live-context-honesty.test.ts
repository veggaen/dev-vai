import { afterEach, describe, expect, it, vi } from 'vitest';
import { VaiEngine } from '../src/models/vai-engine.js';

const originalFetch = globalThis.fetch;

describe('live context honesty', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('does not invent a filename when no editor capture result is attached', async () => {
    const engine = new VaiEngine({ testMode: true });
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'what file do I have open right now?' }],
      noLearn: true,
    });

    expect(response.message.content).toMatch(/live capture result|unavailable/i);
    expect(response.message.content).not.toMatch(/apps\/desktop\/src\/App\.tsx/i);
    expect(response.message.content).not.toMatch(/adapter called|actual context fetch|executed the adapter call/i);
    expect(response.message.content).not.toMatch(/Robots out of scope|Per V3gga|Claude/i);
  });

  it('does not search the open web for private live editor state', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError('fetch should not be called');
    });
    globalThis.fetch = fetchSpy as typeof fetch;

    const engine = new VaiEngine();
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'what file do I have open right now?' }],
      noLearn: true,
    });

    expect(response.message.content).toMatch(/live capture result|unavailable/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
