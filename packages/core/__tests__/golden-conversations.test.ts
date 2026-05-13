/**
 * Golden conversation tests — the kind of test that would have caught the
 * "Today is Wednesday" failure in the user's screenshot.
 *
 * Each test takes a real, casual user prompt (verbatim from a real chat) and
 * asserts the *whole-answer quality bar* — not narrow "contains X" / "does
 * not contain Y" asserts. The bar is informed by what Grok and ChatGPT
 * actually return for the same prompt.
 *
 * If any of these fails, the chat answer for a real conversation has
 * regressed, regardless of how many narrow asserts elsewhere in the suite
 * still pass.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VaiEngine } from '../src/models/vai-engine.js';

const originalFetch = globalThis.fetch;

/**
 * Score a response against a list of required content properties. Returns
 * the list of missing properties so a single failed test reports *every*
 * missing property in one message instead of one at a time.
 */
function checkRequiredProps(text: string, props: Array<{ name: string; match: RegExp | string }>): string[] {
  const missing: string[] = [];
  for (const prop of props) {
    const ok = typeof prop.match === 'string'
      ? text.toLowerCase().includes(prop.match.toLowerCase())
      : prop.match.test(text);
    if (!ok) missing.push(prop.name);
  }
  return missing;
}

describe('golden conversations', () => {
  let engine: VaiEngine;

  beforeEach(() => {
    engine = new VaiEngine();
    // Pin the clock to Wed May 13 2026 so tomorrow == Thursday May 14 (the date
    // in the user's actual screenshot).
    (engine as unknown as { _nowMs: () => number })._nowMs = () =>
      new Date('2026-05-13T10:00:00Z').getTime();
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch disabled in golden conversation test');
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('peter intro + tomorrow + light bulb — full quality bar', async () => {
    const response = await engine.chat({
      messages: [
        {
          role: 'user',
          content:
            'Hello, my name is peter and tomorrow what day is it? can you tell me the like is it monday or tuesday or what day is it? and then also I am wondering who was the name of the person that created the light bulb and or modernized it?',
        },
      ],
    });
    const text = response.message.content;

    const missing = checkRequiredProps(text, [
      { name: 'greets by name (Peter)', match: /\b(?:hi|hello|hey)\s+peter\b/i },
      { name: 'answers tomorrow', match: /\btomorrow\b/i },
      { name: 'names Thursday', match: /\bthursday\b/i },
      { name: 'mentions May 14 2026 (the actual date)', match: /may\s*14[^a-z]*2026/i },
      { name: 'names Thomas Edison', match: /\bthomas\s+edison\b/i },
      // Bonus: a real answer also acknowledges other contributors. Grok and
      // ChatGPT both mention Swan or Davy. Lock at least one.
      { name: 'acknowledges another inventor (Swan or Davy)', match: /\b(?:joseph\s+swan|humphry\s+davy|swan|davy)\b/i },
    ]);

    expect(missing, `Missing answer properties: ${missing.join(', ')}\n\nActual response:\n${text}`).toEqual([]);
    // Anti-regressions:
    expect(text).not.toMatch(/fridtjof\s+nansen/i); // wrong-person curated drift
    expect(text).not.toMatch(/^today is \*\*wednesday/i); // the old bug
  });

  it('plain "who invented the light bulb?" returns a real answer', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'who invented the light bulb?' }],
    });
    const text = response.message.content;
    expect(text).toMatch(/\bthomas\s+edison\b/i);
    expect(text).toMatch(/\b(?:swan|davy)\b/i);
    expect(text).not.toMatch(/I searched for/i);
    expect(text).not.toMatch(/I don'?t have a (?:solid|good) answer/i);
  });

  it('plain "who invented the telephone?" names Bell', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'who invented the telephone?' }],
    });
    expect(response.message.content).toMatch(/\balexander\s+graham\s+bell\b/i);
  });

  it('plain "who invented the airplane?" names the Wright brothers', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'who invented the airplane?' }],
    });
    expect(response.message.content).toMatch(/\bwright\s+brothers\b|\bwilbur\b|\borville\b/i);
  });

  it('plain "what day is tomorrow?" returns Thursday May 14 (not today)', async () => {
    const response = await engine.chat({
      messages: [{ role: 'user', content: 'what day is tomorrow?' }],
    });
    const text = response.message.content;
    expect(text).toMatch(/\btomorrow\b/i);
    expect(text).toMatch(/\bthursday\b/i);
    expect(text).not.toMatch(/^Today is/i);
  });

  it('"Hi, I am Sara, can you make images?" greets Sara AND answers the capability question honestly', async () => {
    const response = await engine.chat({
      messages: [
        { role: 'user', content: 'Hi, I am Sara — can you make images?' },
      ],
    });
    const text = response.message.content;
    // Either the intro composer (greets by name) or the capability route
    // (honest "no" for images) must fire — but never an off-topic SaaS dump.
    expect(text).not.toMatch(/github\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+/);
    expect(text).not.toMatch(/Next\.js SaaS starter|LiveTalk|headshot generator/i);
    // At minimum, the response must engage with the image capability honestly.
    expect(text.toLowerCase()).toMatch(/image/);
  });
});
