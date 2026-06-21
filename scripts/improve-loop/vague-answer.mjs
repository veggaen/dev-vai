/**
 * Vague / overconfident answer detector — a deterministic grader for the failure
 * class the user flagged: an answer that *sounds* authoritative but is generic and
 * ungrounded (no concrete specifics, no citations, no hedging where it should
 * hedge). The motivating example was Vai describing its own engine in confident,
 * abstract prose with nothing verifiable behind it.
 *
 * This is a HEURISTIC, not a truth oracle. It scores observable surface features
 * that correlate with "AI slop" so the loop can surface these turns as fix
 * candidates — exactly the kind of bad output the user wants the loop to catch.
 * Pure (no IO) so it's cheap and unit-testable.
 */

/** Confident framing with no epistemic humility — the "overconfident" signal. */
const CONFIDENT_MARKERS = [
  /\b(definitely|certainly|undoubtedly|without a doubt|guaranteed|always|never|the best way|the only way|simply|just)\b/i,
  /\b(everyone knows|it'?s clear that|obviously|of course)\b/i,
];

/** Hedging / uncertainty markers — their ABSENCE on an open question is a smell. */
const HEDGE_MARKERS = [
  /\b(might|may|could|likely|roughly|approximately|depends|in many cases|typically|often|i'?m not certain|i don'?t know|it varies)\b/i,
];

/** Concrete grounding: numbers, names, citations, code, units, dated facts. */
const GROUNDING_MARKERS = [
  /\d/,                                   // any digit (price, version, count, year)
  /https?:\/\//i,                         // a link / source
  /`[^`]+`|```/,                          // code or an identifier in backticks
  /\b[A-Z][a-zA-Z]+(?:\.[a-z]{2,})\b/,    // file.ext / Some.Module
  /\b(for example|e\.g\.|such as|specifically|namely)\b/i, // concretizing phrase
];

/** Empty-calorie filler that pads an answer without adding information. */
const FILLER_MARKERS = [
  /\b(at the end of the day|when it comes to|in today'?s world|powerful tool|cutting[- ]edge|seamlessly|leverage|robust solution|game[- ]changer|best practices)\b/i,
];

/**
 * Score an answer for vagueness/overconfidence.
 * @returns {{ vague: boolean, score: number, signals: string[] }}
 *   `vague` is true when the answer trips the threshold; `signals` explains why.
 */
export function scoreVagueOverconfident(answer, opts = {}) {
  const text = String(answer ?? '').trim();
  const signals = [];
  if (text.length === 0) return { vague: false, score: 0, signals: ['empty'] };

  const words = text.split(/\s+/).length;
  const confident = CONFIDENT_MARKERS.some((re) => re.test(text));
  const hedged = HEDGE_MARKERS.some((re) => re.test(text));
  const grounded = GROUNDING_MARKERS.some((re) => re.test(text));
  const filler = FILLER_MARKERS.filter((re) => re.test(text)).length;

  let score = 0;
  if (!grounded && words > 25) { score += 2; signals.push('no concrete grounding (no numbers/names/links/examples)'); }
  if (confident && !hedged) { score += 1; signals.push('confident framing without any hedging'); }
  if (confident && !grounded) { score += 1; signals.push('confident AND ungrounded'); }
  if (filler >= 1) { score += filler; signals.push(`${filler} empty-filler phrase(s)`); }
  // A long answer that is both ungrounded and unhedged is the worst slop shape.
  if (!grounded && !hedged && words > 40) { score += 1; signals.push('long, ungrounded, unhedged'); }

  const threshold = opts.threshold ?? 3;
  return { vague: score >= threshold, score, signals };
}
