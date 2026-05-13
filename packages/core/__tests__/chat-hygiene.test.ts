/**
 * Chat-hygiene tests.
 *
 * Pin down the failure modes the user just reported in real desktop chats:
 *   - Code/transcript snippets leaking into responses ("to be a string.").
 *   - YouTube transcript noise ("subscribe to my channel", "[Music]").
 *   - Date strings being used as the "we were discussing" anchor.
 *   - Identical bullet-block fallback repeating turn after turn.
 *   - Topic-echo fragments like "**Norway We have these**" or
 *     "**Ukrainian war started**" or "**developed the first pistol**".
 *   - The four knowledge gaps the user hit: Russia–Ukraine war, fylker
 *     list, pistol history, "top games on Steam".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VaiEngine } from '../src/models/vai-engine.js';

const originalFetch = globalThis.fetch;

describe('chat hygiene', () => {
  let engine: VaiEngine;

  beforeEach(() => {
    engine = new VaiEngine();
    (engine as unknown as { _nowMs: () => number })._nowMs = () =>
      new Date('2026-05-13T10:00:00Z').getTime();
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch disabled in chat-hygiene test');
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('transcript-noise guard', () => {
    it('engine.suppressTranscriptNoise drops obvious transcript junk', () => {
      const eng = engine as unknown as {
        suppressTranscriptNoise: (input: string, response: string) => string;
      };
      expect(eng.suppressTranscriptNoise('q', 'subscribe to my channel and hit the bell')).toBe('');
      expect(eng.suppressTranscriptNoise('q', '[Music] welcome back')).toBe('');
      expect(eng.suppressTranscriptNoise('q', 'check it out at youtu.be/abc')).toBe('');
      expect(eng.suppressTranscriptNoise('q', 'to be a string.')).toBe('');
      // Real structured curated answers must pass.
      const real = '**Harald V** is the king of Norway. He has reigned since 17 January 1991. The current heir apparent is Crown Prince Haakon.';
      expect(eng.suppressTranscriptNoise('who is the king of norway?', real)).toBe(real);
    });
  });

  describe('fallback never uses a date as the anchor', () => {
    it('"we were discussing **Friday, May 15, 2026**" must not appear', async () => {
      const r = await engine.chat({
        messages: [
          { role: 'user', content: 'what day is the day after tomorrow?' },
          { role: 'assistant', content: 'The day after tomorrow is **Friday, May 15, 2026**.' },
          { role: 'user', content: 'tell me about quantum chromodynamics in one paragraph' },
        ],
      });
      expect(r.message.content).not.toMatch(/\*\*Friday[^*]*\*\*/);
      expect(r.message.content).not.toMatch(/\*\*[A-Z][a-z]+,\s+[A-Z][a-z]+\s+\d/);
    });
  });

  describe('fallback varies between consecutive turns', () => {
    it('two unknown questions in a row produce different fallbacks', async () => {
      const r1 = await engine.chat({
        messages: [
          { role: 'user', content: 'tell me about the absolutely-fictional zorglubs of planet quux' },
        ],
      });
      const r2 = await engine.chat({
        messages: [
          { role: 'user', content: 'tell me about the absolutely-fictional zorglubs of planet quux' },
          { role: 'assistant', content: r1.message.content },
          { role: 'user', content: 'and what about the made-up bibblefrobs of nowhere-land?' },
        ],
      });
      expect(r2.message.content).not.toBe(r1.message.content);
    });
  });

  describe('topic echo is clean', () => {
    const cases = [
      'when did the Ukrainian war start?',
      'who developed the first pistol?',
      'what is the typescript file of an angular component?',
      'and tell me about the ingredients in tahini',
    ];
    for (const q of cases) {
      it(`"${q}" — fallback (if any) does not echo a broken fragment`, async () => {
        const r = await engine.chat({ messages: [{ role: 'user', content: q }] });
        const text = r.message.content;
        // Forbidden fragment patterns we actually saw in the user's screenshots.
        expect(text).not.toMatch(/\*\*And\s+who\s+are/i);
        expect(text).not.toMatch(/\*\*Norway\s+We\s+have/i);
        expect(text).not.toMatch(/\*\*about\s+the\s+ingredients\s+in\*\*/i);
        expect(text).not.toMatch(/\*\*Ukrainian\s+war\s+started\*\*/i);
        expect(text).not.toMatch(/\*\*developed\s+the\s+first\s+pistol\*\*/i);
        expect(text).not.toMatch(/\*\*typescript\s+file\s+of\s+an\*\*/i);
      });
    }
  });

  describe('Russia–Ukraine war — many phrasings', () => {
    const phrasings = [
      'when did the war in Ukraine start?',
      'when did the russia ukraine war start',
      'when did Russia invade Ukraine?',
      'when did the russo-ukrainian war begin?',
      'tell me when the Ukrainian war started',
      'what year did the war in ukraine begin',
    ];
    for (const q of phrasings) {
      it(`"${q}" → mentions Feb 2022 and 2014`, async () => {
        const r = await engine.chat({ messages: [{ role: 'user', content: q }] });
        const text = r.message.content;
        expect(text, q).toMatch(/2022/);
        expect(text, q).toMatch(/2014/);
      });
    }
  });

  describe('list of Norwegian fylker', () => {
    const phrasings = [
      'name every fylke in Norway',
      'list of fylker in Norway',
      'how many fylker are there in Norway',
      'hvilke fylker finnes i norge',
    ];
    for (const q of phrasings) {
      it(`"${q}" → returns a list with Oslo and Rogaland and notes statsforvalter`, async () => {
        const r = await engine.chat({ messages: [{ role: 'user', content: q }] });
        const text = r.message.content;
        expect(text, q).toMatch(/Oslo/);
        expect(text, q).toMatch(/Rogaland/);
        expect(text, q).toMatch(/15/);
        expect(text, q).toMatch(/fylkesordfører|statsforvalter/i);
      });
    }
  });

  describe('pistol — definition + history', () => {
    const phrasings = [
      'who invented the first pistol?',
      'what is a pistol?',
      'tell me the history of the pistol',
      'who developed the pistol',
    ];
    for (const q of phrasings) {
      it(`"${q}" → mentions handheld and Colt or Browning`, async () => {
        const r = await engine.chat({ messages: [{ role: 'user', content: q }] });
        const text = r.message.content;
        expect(text, q).toMatch(/handheld|hand[- ]?gun|one\s+hand/i);
        expect(text, q).toMatch(/Colt|Browning|Borchardt|matchlock|wheellock/i);
      });
    }
  });

  describe('top Steam games — honest no-live-data', () => {
    const phrasings = [
      'what are the top 10 games on steam right now?',
      'most popular games on steam currently',
      'top steam charts',
      'best selling games on steam',
    ];
    for (const q of phrasings) {
      it(`"${q}" → declines to fake live data and names known mainstays`, async () => {
        const r = await engine.chat({ messages: [{ role: 'user', content: q }] });
        const text = r.message.content;
        expect(text, q).toMatch(/can(?:'|no)?t (?:query|fetch|access).*real[\s-]?time|won't pretend|not live|store\.steampowered\.com\/charts/i);
        expect(text, q).toMatch(/Counter-Strike|Dota|PUBG|Apex|Baldur/i);
      });
    }
  });

  describe('common-knowledge coverage — no honest-gap fallback', () => {
    // These topics were curated after a coverage probe found Vai stalling on
    // them. Each row is [question, regex the answer MUST contain]. The test
    // also enforces that the answer does NOT use any of the honest-gap
    // fallback phrasings.
    const cases: Array<[string, RegExp]> = [
      ['what is the tallest mountain on Earth?', /\bMount Everest\b/i],
      ['what is the deepest ocean?', /\bMariana Trench|Challenger Deep|Pacific\b/i],
      ['what is a black hole?', /\bevent horizon\b/i],
      ['what was the Roman Empire?', /\b(?:27 BC|Augustus|476)\b/],
      ['who was Albert Einstein?', /\b(?:relativity|Nobel|E\s*=\s*mc)/i],
      ['what was the Industrial Revolution?', /\b(?:steam|factory|Britain)\b/i],
      ['who was Genghis Khan?', /\b(?:Mongol|Temüjin|1206)\b/i],
      ['how many chambers in the human heart?', /\bfour chambers?\b/i],
      ['what language do they speak in Norway?', /\bBokmål\b|\bNynorsk\b|\bNorwegian\b/i],
      ['who wrote Hamlet?', /\bShakespeare\b/i],
      ['who composed the 9th Symphony?', /\bBeethoven\b/i],
      ['who directed Star Wars?', /\bGeorge Lucas\b/i],
      ['what is the most populous country?', /\bIndia\b/i],
      ['what is a monad?', /\b(?:flatMap|bind|category theory|Maybe|Promise)\b/i],
      ['who was Cleopatra?', /\b(?:Ptolem|Egypt|Mark Antony|Caesar)\b/i],
      ['when did humans first land on the moon?', /\b(?:Apollo 11|Armstrong|1969)\b/i],
      ['what was the Renaissance?', /\b(?:Florence|humanism|Medici|Leonardo|Michelangelo)\b/i],
      ['who was Steve Jobs?', /\b(?:Apple|Macintosh|iPhone|Pixar)\b/i],
      ['who was Nikola Tesla?', /\b(?:alternating current|AC|tesla coil|Westinghouse)\b/i],
      ['who was Leonardo da Vinci?', /\b(?:Mona Lisa|Last Supper|Vinci|polymath)\b/i],
      ['what is a virus?', /\b(?:capsid|DNA|RNA|host cell|virion)\b/i],
      // Exponential expansion batch — geography, history, science, arts,
      // philosophy, finance, programming.
      ['what is the capital of Argentina?', /\bBuenos Aires\b/i],
      ['what is the capital of Egypt?', /\bCairo\b/i],
      ['what is the capital of Turkey?', /\bAnkara\b/i],
      ['what is the highest waterfall?', /\bAngel Falls\b/i],
      ['what is a comet?', /\b(?:Kuiper|Oort|coma|nucleus|Halley)\b/i],
      ['what is a galaxy?', /\b(?:spiral|elliptical|Milky Way|stars)\b/i],
      ['what is a supernova?', /\b(?:white dwarf|core[\s-]?collapse|Chandrasekhar|neutron star)\b/i],
      ['what is a neuron?', /\b(?:axon|dendrite|action potential|synapse)\b/i],
      ['what is oxidation?', /\b(?:electrons|redox|reduction)\b/i],
      ['what is a covalent bond?', /\b(?:shar(?:e|ing)|electron pair|polar)\b/i],
      ['what is a logarithm?', /\b(?:base|exponent|natural log|log_)/i],
      ['what was the Reformation?', /\b(?:Luther|1517|Ninety[\s-]?Five Theses|Protestant)\b/i],
      ['who was Julius Caesar?', /\b(?:Rubicon|Ides of March|44 BC|dictator)\b/i],
      ['who was Mahatma Gandhi?', /\b(?:satyagraha|Salt March|nonviolent|India)\b/i],
      ['who was Winston Churchill?', /\b(?:Prime Minister|1940|World War|Britain)\b/i],
      ['who was Joseph Stalin?', /\b(?:Soviet|USSR|Five[\s-]?Year|Gulag|Purge)\b/i],
      ['who was Alan Turing?', /\b(?:Turing machine|Enigma|Bletchley|computer science)\b/i],
      ['who was Ada Lovelace?', /\b(?:Babbage|Analytical Engine|first.*programmer|Bernoulli)\b/i],
      ['who was Bill Gates?', /\b(?:Microsoft|Allen|Windows|MS[\s-]?DOS)\b/i],
      ['who was Michelangelo?', /\b(?:David|Sistine|Pietà|Renaissance)\b/i],
      ['who was Vincent van Gogh?', /\b(?:Sunflowers|Starry Night|Post[\s-]?Impressionist|Arles)\b/i],
      ['who was Pablo Picasso?', /\b(?:Cubism|Guernica|Demoiselles|Braque)\b/i],
      ['who was Mozart?', /\b(?:Salzburg|Vienna|Magic Flute|Requiem|Köchel|K\.\s*\d)/i],
      ['who was Bach?', /\b(?:Leipzig|Brandenburg|fugue|Well-Tempered|BWV)\b/i],
      ['who was Frida Kahlo?', /\b(?:Mexican|Rivera|self[\s-]?portrait|Coyoacán|Casa Azul)\b/i],
      ['what is a deadlock?', /\b(?:Coffman|circular wait|mutual exclusion|lock)\b/i],
      ['who wrote Harry Potter?', /\b(?:J\.?\s*K\.?\s*Rowling|Rowling)\b/i],
      ['who wrote Lord of the Rings?', /\bTolkien\b/i],
      ['how many players on a soccer team?', /\b(?:11|eleven)\b/i],
      ['who was Plato?', /\b(?:Academy|Forms|Cave|Republic|Socrates)\b/i],
      ['who was Aristotle?', /\b(?:Lyceum|syllogis|virtue|Nicomachean|Alexander)\b/i],
      ['who was Socrates?', /\b(?:Athens|hemlock|Socratic method|Plato|elenchus)\b/i],
      ['what is a recession?', /\b(?:GDP|two consecutive quarters|NBER|economic)\b/i],
      ['what is a bond?', /\b(?:debt|coupon|maturity|yield|issuer)\b/i],
      ['what is a linked list?', /\b(?:node|pointer|singly|doubly|head)\b/i],
      ['who was Muhammad Ali?', /\b(?:boxing|heavyweight|Cassius Clay|Frazier|Foreman)\b/i],
    ];
    const fallbackPattern = /(?:i don['']t yet hold|isn['']t in my knowledge yet|isn['']t somewhere i can speak with confidence|real gap in what i hold|don['']t have \*\*[^*]+\*\* locally yet|empty pocket on)/i;
    for (const [q, expected] of cases) {
      it(`"${q}" → answers concretely`, async () => {
        const r = await engine.chat({ messages: [{ role: 'user', content: q }] });
        const text = r.message.content;
        expect(text, `${q} → should match ${expected}`).toMatch(expected);
        expect(text, `${q} → should not stall in honest-gap fallback`).not.toMatch(fallbackPattern);
      });
    }
  });
});
