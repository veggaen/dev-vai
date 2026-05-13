/**
 * Paraphrase-resilience tests.
 *
 * The user keeps reporting that Vai answers the *exact* phrasing it has been
 * trained for and falls flat on natural rewording. These tests pin down the
 * intents that must keep working across many phrasings the user is actually
 * likely to type:
 *
 *   1. "who is the king of Norway" — must return Harald V across plain,
 *      bokmål, lowercase, "currently", "right now", "today" variations.
 *   2. "prime minister of Norway" — must return Jonas Gahr Støre across
 *      plain, "PM", "statsminister", capitalisation variations.
 *   3. "statsminister of Rogaland / every fylke" — must NOT make up a name;
 *      must explain that fylker have a fylkesordfører instead.
 *   4. "last 10 presidents in the US" — must return a real list, comma
 *      separated, ten names. Survives variations: "name the past 10
 *      presidents", "10 most recent US presidents", etc.
 *   5. Pushback detector — when the user pushes back ("that's not what
 *      I asked", "you're falling back to the same answer", "give me your
 *      opinion", "stop repeating yourself"), Vai must NOT return the
 *      identical paragraph it returned the previous turn.
 *   6. Missed-topic extractor — when the user types "And who are the last
 *      10 presidents?", the fallback must not say "for **And who are**" —
 *      leading conjunctions/question words must be stripped from the topic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VaiEngine } from '../src/models/vai-engine.js';

const originalFetch = globalThis.fetch;

describe('paraphrase resilience', () => {
  let engine: VaiEngine;

  beforeEach(() => {
    engine = new VaiEngine();
    (engine as unknown as { _nowMs: () => number })._nowMs = () =>
      new Date('2026-05-13T10:00:00Z').getTime();
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch disabled in paraphrase test');
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('king of Norway — many phrasings', () => {
    const phrasings = [
      'who is the king of Norway?',
      'who is the king in Norway?',
      'who is currently the king of Norway?',
      'who is the king of norway right now',
      'name the king of Norway',
      'tell me the king of Norway',
      'hvem er kongen i Norge?',
      'hvem er kongen av Norge?',
      "who's the Norwegian king?",
      'who is the current Norwegian king',
    ];
    for (const q of phrasings) {
      it(`"${q}" → mentions Harald V`, async () => {
        const r = await engine.chat({ messages: [{ role: 'user', content: q }] });
        const text = r.message.content;
        expect(text, `phrasing: ${q}`).toMatch(/Harald\s*V\b/i);
        expect(text, `phrasing: ${q}`).not.toMatch(/independence|1905|Karlstad/i);
      });
    }
  });

  describe('prime minister of Norway — many phrasings', () => {
    const phrasings = [
      'who is the prime minister of Norway?',
      'who is the PM of Norway?',
      'who is the statsminister in Norway?',
      'hvem er statsministeren i Norge?',
      'name the prime minister of Norway',
      'who is currently the prime minister of Norway',
      "who's the Norwegian PM?",
      'tell me the prime minister of Norway',
    ];
    for (const q of phrasings) {
      it(`"${q}" → mentions Jonas Gahr Støre`, async () => {
        const r = await engine.chat({ messages: [{ role: 'user', content: q }] });
        const text = r.message.content;
        expect(text, `phrasing: ${q}`).toMatch(/Jonas\s+Gahr\s+St[øo]re/i);
      });
    }
  });

  describe('statsminister of Rogaland — category error', () => {
    const phrasings = [
      'who is the statsminister of Rogaland?',
      'who is the prime minister of Rogaland?',
      'who is the statsminister of every fylke in Norway?',
      'who is the prime minister of Vestland?',
    ];
    for (const q of phrasings) {
      it(`"${q}" → explains category error, mentions fylkesordfører`, async () => {
        const r = await engine.chat({ messages: [{ role: 'user', content: q }] });
        const text = r.message.content;
        expect(text, `phrasing: ${q}`).toMatch(/fylkesordf[øo]rer/i);
        // Must NOT confidently assert a person.
        expect(text, `phrasing: ${q}`).not.toMatch(/^The (?:statsminister|prime minister) of \w+ is \*\*[A-Z]/);
      });
    }
  });

  describe('last 10 US presidents — many phrasings', () => {
    const phrasings = [
      'who are the last 10 presidents in the US?',
      'name the last 10 US presidents',
      'list the past 10 presidents of the United States',
      'the 10 most recent US presidents please',
      'And who are the last 10 presidents in the US? Reply with names separated by a comma.',
      'give me the last ten US presidents',
    ];
    for (const q of phrasings) {
      it(`"${q}" → returns a list mentioning Trump, Biden, Obama`, async () => {
        const r = await engine.chat({ messages: [{ role: 'user', content: q }] });
        const text = r.message.content;
        expect(text, `phrasing: ${q}`).toMatch(/Trump/i);
        expect(text, `phrasing: ${q}`).toMatch(/Biden/i);
        expect(text, `phrasing: ${q}`).toMatch(/Obama/i);
        // Must not be the "I don't have enough" fallback.
        expect(text, `phrasing: ${q}`).not.toMatch(/don['']t have enough to go on/i);
      });
    }
  });

  describe('pushback after a verbatim repeat', () => {
    const pushbackPhrasings = [
      "that's not really what I asked. give me your opinion.",
      "you're falling back to the same answer again. what do you think?",
      'stop repeating yourself, tell me your honest take',
      "you said the exact same thing. can you try a different angle?",
      'you keep giving me the same paragraph — what is your actual opinion?',
    ];
    for (const q of pushbackPhrasings) {
      it(`"${q.slice(0, 40)}…" → does NOT repeat the prior assistant message verbatim`, async () => {
        const priorAssistant = '**Thomas Edison** gets the popular credit for the light bulb. Humphry Davy and Joseph Swan also did real work. The honest line is Edison commercialised it.';
        const r = await engine.chat({
          messages: [
            { role: 'user', content: 'who invented the light bulb?' },
            { role: 'assistant', content: priorAssistant },
            { role: 'user', content: q },
          ],
        });
        const text = r.message.content;
        // Must not be a verbatim repeat.
        expect(text, `phrasing: ${q}`).not.toBe(priorAssistant);
        // Must acknowledge the pushback OR offer a clearly different take.
        const acknowledges = /you[' ]re right|fair point|fair enough|good push|let me try|different angle|different framing|honest take|my opinion|in my view|i think the most/i;
        expect(text, `phrasing: ${q}`).toMatch(acknowledges);
      });
    }
  });

  describe('missed-topic extractor strips leading conjunctions', () => {
    it('"And who are X?" — fallback topic must not start with "And who are"', async () => {
      const r = await engine.chat({
        messages: [
          { role: 'user', content: 'And who are the absolutely-fictional-zorglubs of the planet Quux?' },
        ],
      });
      const text = r.message.content;
      // We don't require a real answer here — only that the missed-topic
      // extractor doesn't echo the leading "And who are" garbage.
      if (/don['']t have enough to go on for/i.test(text)) {
        expect(text).not.toMatch(/for \*\*And\s+who\s+are/i);
        expect(text).not.toMatch(/for \*\*And\b/i);
      }
    });
  });
});
