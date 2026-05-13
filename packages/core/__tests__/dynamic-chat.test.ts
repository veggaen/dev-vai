/**
 * Dynamic behaviour tests — these protect the second wave of fixes that make
 * the chat answers feel composed rather than hardcoded.
 *
 * Three behaviours under test:
 *   1. Relative-date parsing — "in a week", "in three days", "next week",
 *      "a week from now", "two weeks ago" all answer correctly without a
 *      name introduction. These are the prompts the user tried that hit
 *      garbage retrieval before.
 *   2. Inventor menu — when the user asks for "another / someone else /
 *      a different person who invented something else" without naming an
 *      invention, the engine returns a menu of curated topics instead of
 *      falling through to unrelated retrieval.
 *   3. Self-reflection — "what do you think is your own best upgrade",
 *      "what would you improve about yourself" return a candid honest
 *      answer drawn from real engine limitations, not the topical
 *      "I don't have enough on **What you think**" fallback.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VaiEngine } from '../src/models/vai-engine.js';

const originalFetch = globalThis.fetch;

describe('dynamic chat behaviour', () => {
  let engine: VaiEngine;

  beforeEach(() => {
    engine = new VaiEngine();
    // Wed May 13 2026 → tomorrow=Thu May 14, week-from-now=Wed May 20.
    (engine as unknown as { _nowMs: () => number })._nowMs = () =>
      new Date('2026-05-13T10:00:00Z').getTime();
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch disabled in dynamic behaviour test');
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('relative date parsing', () => {
    it('"what day is it in a week?" → Wed May 20 2026', async () => {
      const r = await engine.chat({
        messages: [{ role: 'user', content: 'what day is it in a week?' }],
      });
      const text = r.message.content;
      expect(text.toLowerCase()).toContain('wednesday');
      expect(text).toMatch(/may\s*20[^a-z]*2026/i);
      expect(text).not.toMatch(/^Today is/i);
    });

    it('"what will the date be in three days?" → Sat May 16 2026', async () => {
      const r = await engine.chat({
        messages: [{ role: 'user', content: 'what will the date be in three days?' }],
      });
      const text = r.message.content;
      expect(text.toLowerCase()).toContain('saturday');
      expect(text).toMatch(/may\s*16[^a-z]*2026/i);
    });

    it('"a week from now what day is it?" → Wed May 20 2026', async () => {
      const r = await engine.chat({
        messages: [{ role: 'user', content: 'a week from now what day is it?' }],
      });
      const text = r.message.content;
      expect(text.toLowerCase()).toContain('wednesday');
      expect(text).toMatch(/may\s*20[^a-z]*2026/i);
    });

    it('"what day was it two weeks ago?" → Wed April 29 2026', async () => {
      const r = await engine.chat({
        messages: [{ role: 'user', content: 'what day was it two weeks ago?' }],
      });
      const text = r.message.content;
      expect(text.toLowerCase()).toContain('wednesday');
      expect(text).toMatch(/april\s*29[^a-z]*2026/i);
    });

    it('"what day is the day after tomorrow?" → Fri May 15 2026', async () => {
      const r = await engine.chat({
        messages: [{ role: 'user', content: 'what day is the day after tomorrow?' }],
      });
      const text = r.message.content;
      expect(text.toLowerCase()).toContain('friday');
      expect(text).toMatch(/may\s*15[^a-z]*2026/i);
      expect(text).not.toMatch(/^Tomorrow is/i);
    });

    it('"not tomorrow but the day after, what day is it?" → Fri May 15 2026', async () => {
      const r = await engine.chat({
        messages: [{ role: 'user', content: 'not tomorrow but the day after, what day is it?' }],
      });
      const text = r.message.content;
      expect(text.toLowerCase()).toContain('friday');
      expect(text).toMatch(/may\s*15[^a-z]*2026/i);
    });

    it('"day before yesterday what day was it?" → Mon May 11 2026', async () => {
      const r = await engine.chat({
        messages: [{ role: 'user', content: 'day before yesterday what day was it?' }],
      });
      const text = r.message.content;
      expect(text.toLowerCase()).toContain('monday');
      expect(text).toMatch(/may\s*11[^a-z]*2026/i);
    });

    it('intro + "not tomorrow but the day after" → greets + Fri May 15', async () => {
      const r = await engine.chat({
        messages: [{
          role: 'user',
          content: 'Hello, my name is Olaf and not tomorrow but the day after, what day is it?',
        }],
      });
      const text = r.message.content;
      expect(text).toMatch(/Olaf/);
      expect(text.toLowerCase()).toContain('friday');
      expect(text).toMatch(/may\s*15[^a-z]*2026/i);
      expect(text).not.toMatch(/Tomorrow is \*\*Thursday/i);
    });
  });

  describe('inventor menu for vague follow-ups', () => {
    it('"can you tell me about someone else who invented something else?" → returns a menu', async () => {
      const r = await engine.chat({
        messages: [
          { role: 'user', content: 'can you tell me about someone else who invented something else?' },
        ],
      });
      const text = r.message.content;
      // Menu must list at least 5 of the curated topics.
      const lower = text.toLowerCase();
      const expectedTopics = ['telephone', 'airplane', 'light bulb', 'printing press', 'computer'];
      const found = expectedTopics.filter((t) => lower.includes(t));
      expect(found.length, `Menu should list known inventions. Got: ${text}`).toBeGreaterThanOrEqual(4);
      // Must invite a choice.
      expect(text).toMatch(/which one|pick one/i);
    });

    it('"who invented something else?" still returns the menu', async () => {
      const r = await engine.chat({
        messages: [{ role: 'user', content: 'who invented something else?' }],
      });
      expect(r.message.content.toLowerCase()).toMatch(/telephone|airplane|light bulb/);
    });

    it('does NOT trigger the menu for a specific topic like "who invented the telephone?"', async () => {
      const r = await engine.chat({
        messages: [{ role: 'user', content: 'who invented the telephone?' }],
      });
      expect(r.message.content).toMatch(/\bbell\b/i);
      // Should not list the menu when a topic was specified.
      expect(r.message.content).not.toMatch(/which one do you want/i);
    });
  });

  describe('self-reflection / meta questions about Vai', () => {
    it('"what do you think is your own best upgrade to make yourself better?" → candid honest answer', async () => {
      const r = await engine.chat({
        messages: [
          {
            role: 'user',
            content: 'What do you think is your own best upgrade to make yourself better?',
          },
        ],
      });
      const text = r.message.content;
      // Must be self-reflective, not a topical retrieval miss.
      expect(text).not.toMatch(/I don'?t have enough to go on/i);
      expect(text).not.toMatch(/We were discussing/i);
      // Must mention at least two real limitations from the curated answer.
      const lower = text.toLowerCase();
      const realLimits = ['follow-up', 'date math', 'self-reflection', "don't know", 'continuity', 'in a week'];
      const found = realLimits.filter((k) => lower.includes(k.toLowerCase()));
      expect(found.length, `Self-reflection should list real engine limits. Got: ${text}`).toBeGreaterThanOrEqual(2);
    });

    it('"what would you improve about yourself?" hits self-reflection', async () => {
      const r = await engine.chat({
        messages: [{ role: 'user', content: 'what would you improve about yourself?' }],
      });
      expect(r.message.content).not.toMatch(/I don'?t have enough to go on/i);
      expect(r.message.content.toLowerCase()).toMatch(/follow-up|date math|self-reflection|continuity/);
    });

    it('"what are your weaknesses?" hits self-reflection', async () => {
      const r = await engine.chat({
        messages: [{ role: 'user', content: 'what are your weaknesses?' }],
      });
      expect(r.message.content).not.toMatch(/I don'?t have enough to go on/i);
    });

    it('does NOT trigger self-reflection for unrelated improvement questions', async () => {
      const r = await engine.chat({
        messages: [{ role: 'user', content: 'how can I improve my code review process?' }],
      });
      // The self-reflection answer should not fire here.
      expect(r.message.content).not.toMatch(/Honest answer — here'?s where I notice/i);
    });
  });

  describe('combined intro + new date phrasings', () => {
    it('"Hi I am Peter, what day is it in a week and who invented the airplane?" composes correctly', async () => {
      const r = await engine.chat({
        messages: [
          {
            role: 'user',
            content:
              "Hi, my name is Peter and what day is it in a week and who invented the airplane?",
          },
        ],
      });
      const text = r.message.content;
      expect(text).toMatch(/\b(?:hi|hello)\s+peter\b/i);
      expect(text.toLowerCase()).toContain('wednesday');
      expect(text).toMatch(/may\s*20[^a-z]*2026/i);
      expect(text).toMatch(/\bwright\s+brothers\b|\bwilbur\b|\borville\b/i);
    });
  });
});
