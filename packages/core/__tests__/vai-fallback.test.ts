import { describe, expect, it } from 'vitest';
import {
  VAI_FALLBACK_CONFIDENCE_THRESHOLD,
  decideVaiFallback,
  detectAnswerTopicMismatch,
  looksLikeDecline,
  pickFallbackModelId,
  shouldEscalateDeterministicDecline,
  shouldFlipPrimaryToGenerative,
  shouldPreferGroundedFallback,
} from '../src/chat/vai-fallback.js';

describe('vai-fallback', () => {
  it('falls back when confidence is below the threshold', () => {
    expect(decideVaiFallback({
      text: 'Tentative answer',
      confidence: VAI_FALLBACK_CONFIDENCE_THRESHOLD - 0.1,
    })).toEqual({
      shouldFallback: true,
      reason: 'low-confidence',
    });
  });

  it('falls back on canonical no-knowledge text even without a confidence score', () => {
    expect(decideVaiFallback({
      text: "I don't have a solid answer for that yet.",
    })).toEqual({
      shouldFallback: true,
      reason: 'no-knowledge',
    });
  });

  it('does not fall back for normal text when confidence is absent or high enough', () => {
    expect(decideVaiFallback({
      text: 'Here is a direct answer.',
    })).toEqual({
      shouldFallback: false,
      reason: null,
    });

    expect(decideVaiFallback({
      text: 'Here is a direct answer.',
      confidence: VAI_FALLBACK_CONFIDENCE_THRESHOLD,
    })).toEqual({
      shouldFallback: false,
      reason: null,
    });
  });

  it('picks the first available external model from the configured chain', () => {
    const available = new Set(['mock:test', 'openai:gpt-4o-mini']);
    expect(pickFallbackModelId(
      ['vai:v0', 'missing:model', 'mock:test', 'openai:gpt-4o-mini'],
      (modelId) => available.has(modelId),
    )).toBe('mock:test');
  });

  it('prefers a codex model for coding-heavy fallback turns when one is available', () => {
    const available = new Set(['anthropic:claude-sonnet-4-20250514', 'openai:gpt-5.3-codex']);
    expect(pickFallbackModelId(
      ['anthropic:claude-sonnet-4-20250514', 'openai:gpt-5.3-codex', 'vai:v0'],
      (modelId) => available.has(modelId),
      { content: 'Fix this TypeScript component and refactor the API handler', mode: 'chat' },
    )).toBe('openai:gpt-5.3-codex');
  });
});

/**
 * Decline-escalation guard at the deterministic-dispatch stage.
 *
 * A deterministic handler can WIN the dispatch with a non-answer ("X isn't in
 * my knowledge yet") above the confidence floor; emitting it short-circuits the
 * generative model path. `shouldEscalateDeterministicDecline` is the gate that
 * lets such a win yield to escalation — but only when a backend is reachable,
 * so the keyless/local-default safety net is preserved.
 */
describe('shouldEscalateDeterministicDecline', () => {
  const DECLINE = "That isn't in my knowledge yet.";
  const REAL_ANSWER = 'A shallow copy duplicates the top level; a deep copy clones nested values too.';

  it('escalates a decline-shaped win when a generative backend is reachable', () => {
    expect(shouldEscalateDeterministicDecline(DECLINE, true)).toBe(true);
  });

  it('keeps a decline-shaped win as the safety net when no backend is reachable', () => {
    // The keyless/local-only default: nothing better to escalate to, so the
    // deterministic non-answer is still the best available reply.
    expect(shouldEscalateDeterministicDecline(DECLINE, false)).toBe(false);
  });

  it('never escalates a genuine answer even when a backend exists', () => {
    expect(shouldEscalateDeterministicDecline(REAL_ANSWER, true)).toBe(false);
  });

  it('honors operator-supplied decline markers', () => {
    const localizedDecline = 'Beklager, det vet jeg ikke noe om.';
    expect(shouldEscalateDeterministicDecline(localizedDecline, true)).toBe(false);
    expect(
      shouldEscalateDeterministicDecline(localizedDecline, true, ['det vet jeg ikke']),
    ).toBe(true);
  });
});

/**
 * Decline-detection audit lane (Master.md §8 / §12.5.3).
 *
 * The escalation to a local generative module is only as good as the decline
 * detector that triggers it. A hard-coded string list silently misses novel
 * decline wording. These pools score the *structural* detector on two risks:
 *   - missed escalation (decline phrased in words we never hard-coded)
 *   - false escalation (a real answer that merely contains "know"/"answer")
 */
describe('decline-detection audit lane', () => {
  // Novel decline wording NOT present verbatim in NO_KNOWLEDGE_MARKERS.
  const SHOULD_DECLINE: readonly string[] = [
    "Honestly i don't know enough about that to give you a real answer.",
    'That sits outside my knowledge, so i would only be guessing.',
    "I'm not familiar with that framework yet.",
    "I can't answer that confidently — i don't have the details.",
    "I do not hold a solid answer on that one.",
    'This is beyond my expertise right now.',
    "i'm not aware of any reliable information on that.",
  ];

  // Genuine answers — several deliberately contain "know"/"answer"/"information".
  const SHOULD_ANSWER: readonly string[] = [
    'A `Set` keeps only distinct values; spreading it back gives an array.',
    'Use a debounce so the handler runs once after the burst settles.',
    'The answer is to cap the upload size at the proxy boundary.',
    'As far as i know, the capital of France is Paris.',
    'Good question — here is the information you asked for, step by step.',
    'You can know the array is sorted because we call `.sort()` first.',
  ];

  it('escalates on novel decline wording (recall) without escalating real answers (precision)', () => {
    const missed = SHOULD_DECLINE.filter((t) => !looksLikeDecline(t));
    const falsePos = SHOULD_ANSWER.filter((t) => looksLikeDecline(t));

    const recall = (SHOULD_DECLINE.length - missed.length) / SHOULD_DECLINE.length;
    const precision = (SHOULD_ANSWER.length - falsePos.length) / SHOULD_ANSWER.length;

    // Honest, traceable thresholds: catch the clear majority of novel declines,
    // never escalate a genuine answer.
    expect(recall).toBeGreaterThanOrEqual(0.85);
    expect(falsePos, `false escalations: ${JSON.stringify(falsePos)}`).toEqual([]);
    expect(precision).toBe(1);
  });

  it('honors operator-supplied extra decline markers (configurable)', () => {
    const localized = 'Beklager, det vet jeg ikke.';
    expect(looksLikeDecline(localized)).toBe(false);
    expect(looksLikeDecline(localized, ['det vet jeg ikke'])).toBe(true);
  });

  /**
   * No-overfitting probe (Thorsen: improvements must come from dynamic structural
   * patterns, not lexical coupling to the hard-coded marker strings). We mutate
   * the novel-decline pool — case flips, typos, filler openers, reordered clauses
   * — and require the structural detector to keep firing. If recall survives the
   * mutation wave, escalation generalizes; if it collapses, we were string-matching.
   */
  it('keeps decline recall under paraphrase / typo / reorder mutation (generalization)', () => {
    const mutate = (text: string): string[] => {
      const lower = text.toLowerCase();
      const upper = text.toUpperCase();
      const typo = text
        .replace(/\bthe\b/i, 'teh')
        .replace(/\bknow\b/i, 'knwo')
        .replace(/\babout\b/i, 'abuot');
      const filler = `hmm, ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
      // Reorder: move a trailing "so/because" clause to the front.
      const reordered = text.replace(/^(.*?),\s*(so|because|since)\s+(.*)$/i, '$2 $3, $1');
      return [lower, upper, typo, filler, reordered];
    };

    const mutated = SHOULD_DECLINE.flatMap(mutate);
    const missed = mutated.filter((t) => !looksLikeDecline(t));
    const recall = (mutated.length - missed.length) / mutated.length;

    // Structural detection should survive the clear majority of mutations.
    expect(recall, `missed under mutation: ${JSON.stringify(missed)}`).toBeGreaterThanOrEqual(0.85);
  });

  it('does not start escalating genuine answers under the same mutation wave (precision holds)', () => {
    const mutate = (text: string): string[] => [
      text.toLowerCase(),
      text.toUpperCase(),
      `hmm, ${text.charAt(0).toLowerCase()}${text.slice(1)}`,
    ];
    const mutated = SHOULD_ANSWER.flatMap(mutate);
    const falsePos = mutated.filter((t) => looksLikeDecline(t));
    expect(falsePos, `false escalations under mutation: ${JSON.stringify(falsePos)}`).toEqual([]);
  });

  // Real-engine decline idioms surfaced by the live escalation trace
  // (vai:v0 deflecting a chat question into a "not enough grounding" builder ask).
  it('catches real-engine "not enough grounding" / builder-deflection declines', () => {
    expect(looksLikeDecline("I can't build cleanly around that yet — not enough grounding. Give me a target stack.")).toBe(true);
    expect(looksLikeDecline('not enough context to go on here.')).toBe(true);
  });
});

/**
 * Article-hijack / Confident-Bullshitter escalation (Master.md §8).
 *
 * Surfaced by the live trace: asked about "Zorblax-7 in the Flimsy language",
 * vai:v0 confidently answered about Rust — a confident-wrong leak the entrance
 * gate missed because it reads like an answer. The topical-mismatch detector
 * escalates it; FP guards keep genuine answers from escalating.
 */
describe('topical-mismatch (confident-wrong) escalation', () => {
  const ZORBLAX_PROMPT = "what's your honest take on the Zorblax-7 concurrency model in the Flimsy programming language?";
  const RUST_ANSWER =
    'Rust is a systems programming language focused on safety, speed, and concurrency, created by Mozilla. Key features include the ownership system, zero-cost abstractions, and fearless concurrency across threads in production systems.';

  it('flags a long confident answer about a different named entity', () => {
    expect(detectAnswerTopicMismatch(ZORBLAX_PROMPT, RUST_ANSWER)).toBe(true);
    expect(decideVaiFallback({ text: RUST_ANSWER, confidence: 0.8, prompt: ZORBLAX_PROMPT })).toEqual({
      shouldFallback: true,
      reason: 'no-knowledge',
    });
  });

  it('does not flag a genuine answer that echoes the asked subject', () => {
    expect(detectAnswerTopicMismatch('What is the capital of France?', 'The capital of France is Paris.')).toBe(false);
  });

  it('catches the hijack even when the engine lowercases its output (live regression)', () => {
    // The real engine emits lowercase ("rust language rust is ... created by mozilla").
    const lowercaseRust =
      'rust language rust is a systems programming language focused on safety, speed, and concurrency, created by mozilla in 2010 with ownership, zero-cost abstractions, and fearless concurrency across threads.';
    expect(detectAnswerTopicMismatch(ZORBLAX_PROMPT, lowercaseRust)).toBe(true);
  });

  it('does not falsely flag lowercase reasoning answers with hyphenated common words', () => {
    // "half-remember" / "single-column" are not distinctive subjects → no mismatch.
    const prompt = 'i half-remember a rule about when to denormalize a database. honest read even if unsure?';
    const answer = 'denormalization is typically considered when read performance matters more than write consistency, for example precomputing joins or duplicating columns to avoid expensive lookups at query time in hot paths.';
    expect(detectAnswerTopicMismatch(prompt, answer)).toBe(false);
  });

  it('does not flag short pronoun answers even with no subject echo', () => {
    expect(detectAnswerTopicMismatch('Is Tokyo bigger than Osaka?', "Yes, it's larger by population.")).toBe(false);
  });

  it('does not flag when the prompt has no distinctive named subject', () => {
    const ans = 'You should add a debounce so the handler runs once after the burst settles, then memoize the derived value to avoid recompute on every keystroke render.';
    expect(detectAnswerTopicMismatch('how do i make my input handler faster?', ans)).toBe(false);
  });

  it('does not flag a long on-topic answer about the asked entity', () => {
    const ans =
      'Rust gives you fearless concurrency through its ownership and borrow checker, so data races are caught at compile time. For your use case, prefer channels or Arc<Mutex<T>> depending on contention and sharing needs.';
    expect(detectAnswerTopicMismatch('How does Rust handle concurrency safely?', ans)).toBe(false);
  });
});

describe('shouldPreferGroundedFallback', () => {
  const base = { hadWebEvidence: true, hasFallbackModel: true };

  it('prefers the grounded model when web evidence was retrieved and a fallback exists', () => {
    expect(shouldPreferGroundedFallback(base)).toBe(true);
  });

  it('does not prefer when no web evidence was retrieved', () => {
    expect(shouldPreferGroundedFallback({ ...base, hadWebEvidence: false })).toBe(false);
  });

  it('does not prefer when no capable fallback model is available', () => {
    expect(shouldPreferGroundedFallback({ ...base, hasFallbackModel: false })).toBe(false);
  });

  it('is a no-op when explicitly disabled (env flag off)', () => {
    expect(shouldPreferGroundedFallback({ ...base, enabled: false })).toBe(false);
  });

  it('does not override a friend-review guardrail replacement', () => {
    expect(shouldPreferGroundedFallback({ ...base, reviewReplacedPrimary: true })).toBe(false);
  });

  it('does not preempt a satisfied builder turn or builder file artifacts', () => {
    expect(shouldPreferGroundedFallback({ ...base, builderSatisfies: true })).toBe(false);
    expect(shouldPreferGroundedFallback({ ...base, builderFiles: true })).toBe(false);
  });
});

describe('shouldFlipPrimaryToGenerative', () => {
  const base = { turnKind: 'analysis', mode: 'chat', hasFallbackModel: true };

  it('flips substantive analysis and research turns to the generative model', () => {
    expect(shouldFlipPrimaryToGenerative(base)).toBe(true);
    expect(shouldFlipPrimaryToGenerative({ ...base, turnKind: 'research' })).toBe(true);
  });

  it('never flips conversational or builder turn kinds', () => {
    expect(shouldFlipPrimaryToGenerative({ ...base, turnKind: 'conversational' })).toBe(false);
    expect(shouldFlipPrimaryToGenerative({ ...base, turnKind: 'builder' })).toBe(false);
  });

  it('keeps the vai:v0-first contract in builder and agent modes', () => {
    expect(shouldFlipPrimaryToGenerative({ ...base, mode: 'builder' })).toBe(false);
    expect(shouldFlipPrimaryToGenerative({ ...base, mode: 'agent' })).toBe(false);
  });

  it('requires a reachable generative model', () => {
    expect(shouldFlipPrimaryToGenerative({ ...base, hasFallbackModel: false })).toBe(false);
  });

  it('is reversible via the master switch', () => {
    expect(shouldFlipPrimaryToGenerative({ ...base, enabled: false })).toBe(false);
  });
});
