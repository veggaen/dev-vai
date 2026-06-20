import { describe, expect, it } from 'vitest';
import { tryEmitFactShim } from './deterministic-facts-router.js';

describe('deterministic code snippets', () => {
  it('answers debounce utility requests with runnable TypeScript instead of falling back', () => {
    const result = tryEmitFactShim({ content: 'write a debounce function in typescript' });

    expect(result?.kind).toBe('code-snippet');
    expect(result?.reply).toMatch(/function debounce/i);
    expect(result?.reply).toMatch(/```typescript/);
    expect(result?.reply).toMatch(/clearTimeout/);
  });

  it('recognizes a janky search-input handler as a debounce request', () => {
    const result = tryEmitFactShim({ content: 'how do i make my search input handler less janky?' });

    expect(result?.kind).toBe('code-snippet');
    expect(result?.reply).toMatch(/function debounce/i);
    expect(result?.reply).toMatch(/clearTimeout/);
  });

  it('answers throttle and slugify utility requests', () => {
    expect(tryEmitFactShim({ content: 'show me throttle in ts' })?.reply).toMatch(/function throttle/i);
    expect(tryEmitFactShim({ content: 'slugify helper in typescript' })?.reply).toMatch(/function slugify/i);
  });
});

describe('single-concept snippets do not hijack comparison / multi-concept questions', () => {
  it('answers "difference between debounce and throttle" with a both-sided comparison', () => {
    const result = tryEmitFactShim({
      content: "What's the difference between a debounce and a throttle in JavaScript? Give a one-line use case for each.",
    });
    // Must not short-circuit to a one-concept snippet; it composes a grounded
    // comparison that actually covers BOTH sides.
    expect(result?.kind).toBe('compare-pair');
    expect(result?.reply).toMatch(/function debounce/i);
    expect(result?.reply).toMatch(/function throttle/i);
  });

  it('still answers a genuine single-concept request', () => {
    expect(tryEmitFactShim({ content: 'write a debounce function in typescript' })?.kind).toBe('code-snippet');
    expect(tryEmitFactShim({ content: 'how do I deep clone an object in javascript' })?.kind).toBe('code-snippet');
  });

  it('routes "X vs Y" / "difference between X and Y" to the curated comparison, not a snippet', () => {
    expect(tryEmitFactShim({ content: 'react vs vue, which should I use?' })?.kind).toBe('compare-pair');
    expect(tryEmitFactShim({ content: 'what is the difference between postgres and mysql?' })?.kind).toBe('compare-pair');
  });
});

describe('brand facts do not hijack action yes/no questions', () => {
  it('defers "does X make/sell Y?" instead of dumping a brand definition', () => {
    expect(tryEmitFactShim({ content: 'does starbucks make cappuccino?' })?.kind).not.toBe('fact-brand');
    expect(tryEmitFactShim({ content: 'does mcdonalds sell salads?' })?.kind).not.toBe('fact-brand');
    expect(tryEmitFactShim({ content: 'do they serve oat milk at starbucks?' })?.kind).not.toBe('fact-brand');
  });

  it('still answers a definitional brand question with the brand one-liner', () => {
    const result = tryEmitFactShim({ content: 'what is starbucks?' });
    expect(result?.kind).toBe('fact-brand');
    expect(result?.reply).toMatch(/coffeehouse/i);
  });
});

describe('entity facts do not hijack tasks that merely mention an entity', () => {
  // These are the exact failures captured live in the Grok↔Vai bridge
  // transcript: long task briefs mentioning GitHub/a company answered at 0.96
  // confidence with "GITHUB was founded in 2008" / "<company> was founded…".
  it('defers a project-review brief that mentions a github URL', () => {
    const result = tryEmitFactShim({
      content:
        "let's do a full review of the web app at https://github.com/veggaen/DEV-VEGGASTARE and find the project gaps and fill them so we get it to 100%.",
    });
    expect(result?.kind).not.toBe('fact-company');
    expect(result).toBeNull();
  });

  it('defers "I have a web app I started long ago" instead of a founded-date card', () => {
    const result = tryEmitFactShim({
      content:
        'I have a web app that I started to work on long time ago and never finished. I would like us to do a full review and understand the UI and find what features are not connected.',
    });
    expect(result?.kind).not.toBe('fact-company');
    expect(result).toBeNull();
  });

  it('defers a "tell me a story" creative request even if it names an entity', () => {
    const result = tryEmitFactShim({
      content: 'Tell me a short original story about an inventor at Tesla and a robot.',
    });
    expect(result?.kind).not.toBe('fact-company');
  });

  it('still answers a crisp definitional company question', () => {
    expect(tryEmitFactShim({ content: 'where is BMW headquartered?' })?.kind).toBe('fact-company');
    expect(tryEmitFactShim({ content: 'who is the CEO of Spotify?' })?.kind).toBe('fact-company');
  });
});

describe('conceptual primers', () => {
  it('answers a conversational CAP-theorem tradeoff prompt directly', () => {
    const result = tryEmitFactShim({ content: "i'm fuzzy on CAP theorem tradeoffs for a chat app. honest read?" });

    expect(result?.kind).toBe('concept-primer');
    expect(result?.reply).toMatch(/network partition/i);
    expect(result?.reply).toMatch(/chat app/i);
  });
});

describe('grounded Vai self-knowledge (meta-vai) — regression for n-gram-soup bug', () => {
  it('answers "tell me about your engine" with a grounded architecture answer, not corpus soup', () => {
    const r = tryEmitFactShim({ content: 'tell me about your engine' });
    expect(r?.kind).toBe('meta-vai');
    expect(r?.reply).toMatch(/local-first|council|deterministic/i);
    // The exact live failure: it must NOT return V8/Spark/dockerfile fragments.
    expect(r?.reply).not.toMatch(/v8 javascript|apache spark|dockerfile/i);
  });

  it('answers "what is Vai" / "what can you do" with identity + capabilities', () => {
    expect(tryEmitFactShim({ content: 'what is vai?' })?.kind).toBe('meta-vai');
    expect(tryEmitFactShim({ content: 'what can you do?' })?.kind).toBe('meta-vai');
    expect(tryEmitFactShim({ content: 'who are you?' })?.kind).toBe('meta-vai');
  });

  it('handles "how does Vai work" and "how are you built"', () => {
    expect(tryEmitFactShim({ content: 'how does vai work internally?' })?.kind).toBe('meta-vai');
    expect(tryEmitFactShim({ content: 'how are you built?' })?.kind).toBe('meta-vai');
  });

  it('still keeps the chat-vs-IDE-mode explainer working', () => {
    const r = tryEmitFactShim({ content: 'what is the difference between chat and IDE mode?' });
    expect(r?.kind).toBe('meta-vai');
    expect(r?.reply).toMatch(/chat mode/i);
  });

  it('does NOT hijack a real build/task that merely mentions "engine"', () => {
    // "build me a physics engine" is a task, not a question about Vai.
    const r = tryEmitFactShim({ content: 'build me a physics engine for my game' });
    expect(r?.kind).not.toBe('meta-vai');
  });
});

describe('grounded self-knowledge must NOT trip the decline-escalation guard', () => {
  it('no meta-vai answer contains a decline phrase that would escalate it to the engine', async () => {
    // Subtle live bug: the answers mentioned "I don't know", which looksLikeDecline matched,
    // so shouldEscalateDeterministicDecline discarded the grounded answer and the engine
    // produced "Best next task"/"engine, simpler" instead. Lock the wording.
    const { shouldEscalateDeterministicDecline } = await import('./vai-fallback.js');
    for (const q of ['tell me about your engine', 'what can you do?', 'who are you?', 'what is vai?']) {
      const r = tryEmitFactShim({ content: q });
      if (r?.kind === 'meta-vai') {
        expect(shouldEscalateDeterministicDecline(r.reply, true)).toBe(false);
      }
    }
  });
});
