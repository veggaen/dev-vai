/**
 * Kind-aware response shaper.
 *
 * Turns the passive `CognitiveFrame.kind` classification into _active_
 * routing: when the response shape doesn't match the question's kind,
 * apply a small, conservative transform so the answer reads the way the
 * user asked it.
 *
 * Design rules:
 *  - **Conservative.** Only fire when the transform is provably safe
 *    (high kindConfidence, no code fences, plausible length window,
 *    response doesn't already match the target shape).
 *  - **Idempotent.** Re-running on a shaped response is a no-op.
 *  - **No semantics.** We never invent content — we only restructure or
 *    prefix what the strategy already produced.
 *  - **Reportable.** Returns a `KindShape` so `ResponseMeta` can show
 *    exactly which transform fired.
 */
import type { CognitiveFrame } from './reasoner.js';

export type KindTransform = 'numbered-steps' | 'comparison-header' | 'causal-prefix';

export interface KindShape {
  readonly kind: CognitiveFrame['kind'];
  readonly transform: KindTransform;
  readonly changed: boolean;
}

export interface ShapeResult {
  readonly response: string;
  readonly shape: KindShape | null;
}

const ORDINAL_MARKERS = /\b(?:first|firstly|second|secondly|third|then|next|after\s+that|finally|lastly)\s*,/gi;
const ALREADY_NUMBERED = /^\s*(?:1[.)]|step\s*1\b)/im;
const CODE_FENCE = /```|~~~/;
const CAUSAL_CONNECTIVE = /\b(?:because|due\s+to|caused\s+by|the\s+reason|root\s+cause|stems\s+from|results?\s+from)\b/i;
const CAUSAL_PREFIX = /^\s*(?:likely\s+cause|root\s+cause|the\s+cause|cause)\s*[:—-]/i;
const COMPARISON_PREFIX = /^\s*comparing\s+/i;

const MIN_SHAPE_LEN = 40;
const MAX_SHAPE_LEN = 2000;

/**
 * Try to apply a kind-appropriate transform to the response.
 * Returns the original response and `shape: null` when no transform fires.
 */
export function shapeByKind(
  frame: CognitiveFrame | null | undefined,
  response: string,
  strategy: string,
  skipStrategies: ReadonlySet<string>,
): ShapeResult {
  if (!frame) return { response, shape: null };
  if (skipStrategies.has(strategy)) return { response, shape: null };
  const trimmed = response.trim();
  if (trimmed.length < MIN_SHAPE_LEN || trimmed.length > MAX_SHAPE_LEN) {
    return { response, shape: null };
  }
  if (CODE_FENCE.test(response)) return { response, shape: null };
  if (frame.kindConfidence < 0.7) return { response, shape: null };

  switch (frame.kind) {
    case 'procedural':
      return shapeProcedural(frame, response);
    case 'comparative':
      return shapeComparative(frame, response);
    case 'causal':
      return shapeCausal(frame, response);
    default:
      return { response, shape: null };
  }
}

/**
 * Procedural ("how do I X"): if the response uses ordinal prose markers
 * ("first, ... then, ... finally, ...") but is not already a numbered
 * list, convert the top-level ordinal sentences to a numbered list.
 */
function shapeProcedural(frame: CognitiveFrame, response: string): ShapeResult {
  if (ALREADY_NUMBERED.test(response)) {
    return { response, shape: { kind: frame.kind, transform: 'numbered-steps', changed: false } };
  }
  const ordinalCount = (response.match(ORDINAL_MARKERS) ?? []).length;
  if (ordinalCount < 3) return { response, shape: null };

  // Split the response into sentences and rebuild only the ordinal-led ones
  // as a numbered block. Non-ordinal sentences are preserved as a preamble.
  const sentences = response
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const preamble: string[] = [];
  const steps: string[] = [];
  for (const sentence of sentences) {
    if (/^(?:first|firstly|second|secondly|third|then|next|after\s+that|finally|lastly)\b/i.test(sentence)) {
      // Strip the leading ordinal word + optional comma so the step reads cleanly.
      const stripped = sentence.replace(/^(?:first(?:ly)?|second(?:ly)?|third|then|next|after\s+that|finally|lastly)\s*,?\s*/i, '');
      // Capitalize the first character if it's lowercase, leave punctuation intact.
      const cap = stripped.charAt(0).toUpperCase() + stripped.slice(1);
      steps.push(cap);
    } else if (steps.length === 0) {
      preamble.push(sentence);
    } else {
      // A non-ordinal sentence after steps started — append to last step.
      steps[steps.length - 1] = `${steps[steps.length - 1]} ${sentence}`;
    }
  }

  if (steps.length < 3) return { response, shape: null };
  const numbered = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const out = preamble.length > 0
    ? `${preamble.join(' ')}\n\n${numbered}`
    : numbered;
  return {
    response: out,
    shape: { kind: frame.kind, transform: 'numbered-steps', changed: true },
  };
}

/**
 * Comparative ("X vs Y"): prepend a "Comparing X and Y:" header when the
 * response doesn't already lead with one. Only fires when we extracted
 * at least two distinct entities from the prompt.
 */
function shapeComparative(frame: CognitiveFrame, response: string): ShapeResult {
  if (COMPARISON_PREFIX.test(response)) {
    return { response, shape: { kind: frame.kind, transform: 'comparison-header', changed: false } };
  }
  // Pick two distinct entities (case-insensitive de-dup).
  const seen = new Set<string>();
  const picks: string[] = [];
  for (const e of frame.entities) {
    const k = e.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    picks.push(e);
    if (picks.length === 2) break;
  }
  if (picks.length < 2) return { response, shape: null };

  const header = `Comparing ${picks[0]} and ${picks[1]}:`;
  return {
    response: `${header}\n\n${response.trim()}`,
    shape: { kind: frame.kind, transform: 'comparison-header', changed: true },
  };
}

/**
 * Causal ("why does X happen"): if the response never names a cause via a
 * causal connective ("because", "due to", "caused by", …) and isn't
 * already prefixed with one, prepend "Likely cause:" so the user gets the
 * thing they actually asked for at the top.
 */
function shapeCausal(frame: CognitiveFrame, response: string): ShapeResult {
  if (CAUSAL_PREFIX.test(response)) {
    return { response, shape: { kind: frame.kind, transform: 'causal-prefix', changed: false } };
  }
  if (CAUSAL_CONNECTIVE.test(response)) return { response, shape: null };
  // Only prefix shorter responses — long answers usually structure the
  // cause themselves and prefixing would feel patronizing.
  if (response.trim().length > 400) return { response, shape: null };
  return {
    response: `Likely cause: ${response.trim()}`,
    shape: { kind: frame.kind, transform: 'causal-prefix', changed: true },
  };
}
