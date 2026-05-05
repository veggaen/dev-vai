/**
 * AgenticOODA
 * ───────────
 * Lightweight, deterministic Observe → Orient → Decide → Act loop that
 * runs as **Strategy 0.0002** when a prompt is genuinely complex.
 *
 * The loop is split across two engine seams so it can both inform AND
 * post-process the answer:
 *
 *  - **Observe + Orient + Decide** run early in `generateResponse()` and
 *    produce an `OodaTrace` describing what the engine knows about the
 *    prompt before answering.
 *  - **Act** runs inside `tracked()` after a strategy has produced a
 *    candidate response. It applies the decision's hints (calibration
 *    prefix, hedge trim) and finalizes the trace.
 *
 * Design constraints:
 *  - Pure functions. No I/O. No globals. No timers.
 *  - Anchored to Master.md §7 (Timeless Foundations) and §8 (Anti-Patterns).
 *  - Activation is gated so we respect Master.md §3.3 ("efficiency math") —
 *    OODA only runs when the prompt actually warrants it.
 *  - Every claim made by Act() is grounded in something Observe() saw.
 *
 * What this is NOT:
 *  - It does not call other strategies. It is metadata + a small
 *    post-processor, not an agent loop in the multi-step tool-using sense.
 *  - It does not pretend to "reason"; it composes deterministic signals
 *    into a structured trace the UI can render and the engine can act on.
 */

import type { CognitiveFrame } from '../cognitive/index.js';

/** One of the ten Master.md §7 Timeless Foundations referenced in a step. */
export type Foundation =
  | 'first-principles'
  | 'calibrated-uncertainty'
  | 'meta-learning'
  | 'reading-between-lines'
  | 'precision-communication'
  | 'asking-right-question'
  | 'compression'
  | 'systems-thinking'
  | 'taste-judgment'
  | 'intellectual-honesty';

/** One of the six Master.md §8 Anti-Patterns guarded against. */
export type AntiPattern =
  | 'confident-bullshitter'
  | 'verbose-hedger'
  | 'template-matcher'
  | 'sycophant'
  | 'over-generator'
  | 'literal-interpreter';

export interface ObserveStep {
  /** Cognitive kind, replicated here for trace self-containment. */
  readonly kind: CognitiveFrame['kind'];
  /** True when the prompt is compound. */
  readonly isCompound: boolean;
  /** Approximate token count of the prompt. */
  readonly tokenCount: number;
  /** Topic resolved by the engine for this turn. */
  readonly topic: string;
  /** Confidence the engine has on this topic, in [0, 1]; null when unseen. */
  readonly topicConfidence: number | null;
  /** Detected entities, copied from the cognitive frame. */
  readonly entities: readonly string[];
  /** True when the prompt carries explicit format/length constraints. */
  readonly hasConstraints: boolean;
}

export interface OrientStep {
  /** Foundations we're choosing to apply for this prompt. */
  readonly foundations: readonly Foundation[];
  /**
   * Decomposition of the prompt into atomic sub-questions. Mirrors
   * `frame.subQuestions` for compound prompts; otherwise just the prompt.
   */
  readonly subProblems: readonly string[];
  /**
   * Assumptions the engine is making to answer at all. Surfaced honestly
   * so the user can correct them.
   */
  readonly assumptions: readonly string[];
}

export interface DecideStep {
  /** Anti-patterns we're actively guarding against on this turn. */
  readonly guardedAntiPatterns: readonly AntiPattern[];
  /** Recommended response shape. UI/engine may use it for formatting. */
  readonly responseShape: 'compressed' | 'structured' | 'calibrated' | 'normal';
  /** Whether Act() should prepend a calibration marker. */
  readonly applyCalibrationPrefix: boolean;
  /** Whether Act() should trim/flag excessive hedge language. */
  readonly trimHedges: boolean;
  /**
   * Soft routing hint for downstream strategies. Stored only; the engine
   * is free to ignore it. Useful for benchmarks and future StrategyRegistry.
   */
  readonly strategyHint: 'fast-path' | 'retrieval' | 'curated' | 'fallback' | 'unspecified';
}

export interface ActStep {
  /** True when Act() actually mutated the response. */
  readonly mutated: boolean;
  /** Number of hedge phrases removed. */
  readonly hedgesRemoved: number;
  /** Whether a calibration prefix was added. */
  readonly calibrationPrefixAdded: boolean;
  /** Final response length in characters, after Act(). */
  readonly finalLength: number;
}

export interface OodaTrace {
  readonly observe: ObserveStep;
  readonly orient: OrientStep;
  readonly decide: DecideStep;
  /** Filled in by Act(); undefined until then. */
  act?: ActStep;
}

export interface OodaActivationContext {
  readonly frame: CognitiveFrame;
  readonly topic: string;
  readonly topicConfidence: number | null;
}

/**
 * Decide whether OODA should run at all for this prompt. The gate is
 * deliberately tight so we honor the "Minimize Waste" principle.
 */
export function shouldActivate(ctx: OodaActivationContext): boolean {
  if (!ctx.frame) return false;
  if (ctx.frame.isCompound) return true;
  if (ctx.frame.hasConstraints) return true;
  if (ctx.frame.tokenCount >= 25) return true;
  if (ctx.topicConfidence !== null && ctx.topicConfidence < 0.4) return true;
  if (ctx.frame.kind === 'causal' || ctx.frame.kind === 'comparative') return true;
  return false;
}

/** Phase 1: snapshot what is known about the prompt. */
export function observe(ctx: OodaActivationContext): ObserveStep {
  return {
    kind: ctx.frame.kind,
    isCompound: ctx.frame.isCompound,
    tokenCount: ctx.frame.tokenCount,
    topic: ctx.topic,
    topicConfidence: ctx.topicConfidence,
    entities: ctx.frame.entities,
    hasConstraints: ctx.frame.hasConstraints,
  };
}

/**
 * Phase 2: choose which Foundations apply to this kind of prompt and
 * surface the assumptions we're making.
 */
export function orient(obs: ObserveStep, frame: CognitiveFrame): OrientStep {
  const foundations: Foundation[] = ['intellectual-honesty'];
  const assumptions: string[] = [];

  if (obs.isCompound) {
    foundations.push('compression', 'precision-communication');
  }
  if (obs.hasConstraints) {
    foundations.push('precision-communication', 'literal-interpreter-guard');
    // Strip the placeholder pseudo-foundation; we used it only as a comment
    // hook. Real Foundations are the ten in Master.md §7.
    foundations.pop();
  }
  if (obs.kind === 'causal') {
    foundations.push('first-principles', 'systems-thinking');
  }
  if (obs.kind === 'comparative') {
    foundations.push('systems-thinking', 'taste-judgment');
  }
  if (obs.kind === 'opinion') {
    foundations.push('calibrated-uncertainty', 'taste-judgment');
  }
  if (obs.kind === 'hypothetical') {
    foundations.push('first-principles', 'calibrated-uncertainty');
  }
  if (obs.topicConfidence !== null && obs.topicConfidence < 0.4) {
    foundations.push('calibrated-uncertainty', 'meta-learning');
  }

  if (obs.entities.length === 0 && obs.kind !== 'conversational' && obs.kind !== 'meta') {
    assumptions.push(
      'No specific entities were extracted from the prompt — answering against the most common interpretation.',
    );
  }
  if (obs.topicConfidence === null) {
    assumptions.push('This is a topic the engine has not seen before in this session.');
  }

  return {
    foundations: dedupe(foundations),
    subProblems: frame.subQuestions.length > 0 ? frame.subQuestions : [],
    assumptions,
  };
}

/**
 * Phase 3: pick response shape, anti-patterns to guard, and strategy hint.
 */
export function decide(obs: ObserveStep, ori: OrientStep): DecideStep {
  const guarded: AntiPattern[] = [];

  // Confident-Bullshitter: low topic confidence → demand calibration.
  const lowConfidence = obs.topicConfidence !== null && obs.topicConfidence < 0.5;
  if (lowConfidence) guarded.push('confident-bullshitter');

  // Verbose-Hedger: opinion/hypothetical prompts attract over-hedging.
  if (obs.kind === 'opinion' || obs.kind === 'hypothetical') {
    guarded.push('verbose-hedger');
  }

  // Over-Generator: compound + long prompt invites bloated answers.
  if (obs.isCompound || obs.tokenCount >= 40) {
    guarded.push('over-generator');
  }

  // Template-Matcher: comparative prompts often get pattern-matched answers.
  if (obs.kind === 'comparative') guarded.push('template-matcher');

  // Sycophant: opinion prompts.
  if (obs.kind === 'opinion') guarded.push('sycophant');

  // Literal-Interpreter: prompts with explicit constraints we MUST respect.
  if (obs.hasConstraints) guarded.push('literal-interpreter');

  let responseShape: DecideStep['responseShape'] = 'normal';
  if (obs.isCompound) responseShape = 'structured';
  else if (lowConfidence) responseShape = 'calibrated';
  else if (obs.tokenCount <= 6) responseShape = 'compressed';

  let strategyHint: DecideStep['strategyHint'] = 'unspecified';
  if (obs.kind === 'conversational') strategyHint = 'fast-path';
  else if (obs.kind === 'definitional' || obs.kind === 'factual') strategyHint = 'curated';
  else if (obs.kind === 'procedural' || obs.kind === 'causal') strategyHint = 'retrieval';

  return {
    guardedAntiPatterns: dedupe(guarded),
    responseShape,
    applyCalibrationPrefix: lowConfidence,
    trimHedges: guarded.includes('verbose-hedger'),
    strategyHint,
  };
}

/**
 * Run the full Observe→Orient→Decide preamble. Returns null when the
 * activation gate fails so callers can no-op cheaply.
 */
export function preAct(ctx: OodaActivationContext): OodaTrace | null {
  if (!shouldActivate(ctx)) return null;
  const observation = observe(ctx);
  const orientation = orient(observation, ctx.frame);
  const decision = decide(observation, orientation);
  return { observe: observation, orient: orientation, decide: decision };
}

/**
 * Phase 4: post-process the candidate response according to the decision.
 * Returns the (possibly mutated) response and an `ActStep` recording what
 * was changed so the trace stays honest.
 */
export function act(trace: OodaTrace, response: string): { response: string; act: ActStep } {
  let working = response;
  let hedgesRemoved = 0;
  let calibrationPrefixAdded = false;

  if (trace.decide.trimHedges) {
    const trimmed = trimExcessiveHedges(working);
    hedgesRemoved = trimmed.removed;
    working = trimmed.text;
  }

  if (trace.decide.applyCalibrationPrefix && !startsWithCalibration(working)) {
    working = `Calibrated take (lower confidence on this topic): ${working.trim()}`;
    calibrationPrefixAdded = true;
  }

  const mutated = working !== response;
  const actStep: ActStep = {
    mutated,
    hedgesRemoved,
    calibrationPrefixAdded,
    finalLength: working.length,
  };
  return { response: working, act: actStep };
}

// ── helpers ────────────────────────────────────────────────────────

const HEDGE_PHRASE_RE =
  /\b(?:i\s+(?:think|believe|suppose|guess)|perhaps|maybe|possibly|it\s+(?:might|may|could)\s+be|sort\s+of|kind\s+of|in\s+a\s+sense|to\s+some\s+extent)\s*,?\s*/gi;
const MAX_HEDGES_KEPT = 1;

function trimExcessiveHedges(text: string): { text: string; removed: number } {
  let kept = 0;
  let removed = 0;
  const result = text.replace(HEDGE_PHRASE_RE, () => {
    if (kept < MAX_HEDGES_KEPT) {
      kept += 1;
      return ''; // strip even the kept-budget — counting is for transparency
    }
    removed += 1;
    return '';
  });
  return { text: collapseWhitespace(result), removed: removed + kept };
}

function startsWithCalibration(text: string): boolean {
  return /^(?:calibrated\s+take|i['\u2019]m\s+not\s+certain|low\s+confidence|note:\s+lower\s+confidence)\b/i.test(
    text.trim(),
  );
}

function collapseWhitespace(text: string): string {
  return text.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
}

function dedupe<T>(arr: readonly T[]): T[] {
  return Array.from(new Set(arr));
}
