import type { TurnClassification } from './turn-classifier.js';
import type { QuestionIntent } from './question-intent.js';
import type { GitEvidence } from '../tools/git-evidence.js';
import type { RunEvidence } from '../tools/run-evidence.js';

/**
 * Async-gathered evidence attached to a turn BEFORE dispatch. The dispatcher and
 * `resolve()` are synchronous and pure; anything that needs subprocess/network I/O
 * (git, fs, sandbox, web) is gathered ahead of time by the caller and dropped here,
 * so a capability's sync `resolve`/`verify` can read real evidence without doing I/O.
 * This mirrors how web/live-context evidence is already attached. Every field is
 * optional and additive — existing handlers that don't read it are unaffected.
 */
export interface TurnEvidence {
  /** Read-only git evidence (diff/blame/log/branch), when the turn looked git-shaped. */
  readonly git?: GitEvidence;
  /** Result of running a safe verification command (tests/build/typecheck), when the turn asked. */
  readonly run?: RunEvidence;
}

/**
 * Scored turn-dispatch core.
 *
 * This is the spine that replaces Vai's greedy keyword cascade. Today a chat
 * turn is answered by ~15 `tryEmitXXX()` routers run in a fixed order where the
 * FIRST non-null match short-circuits the turn. That has three structural
 * problems: single-keyword hijacks (a router keyed on one word grabs turns it
 * shouldn't), ~600 lines of copy-pasted emit/persist boilerplate, and two
 * divergent copies of the logic (ChatService vs VaiEngine).
 *
 * The pipeline fixes all three at the root:
 *
 *   understand once  →  build a `TurnContext` (text + intent + classification +
 *                       friend guidance) so handlers don't each re-sniff keywords
 *   score, don't grab →  every capability is a `TurnHandler` that reports HOW WELL
 *                        it fits (`score`), not merely WHETHER it matched first
 *   resolve once      →  the dispatcher picks the best handler above a confidence
 *                        floor, lets it decline (fall through), and the caller does
 *                        emit/persist exactly once
 *
 * It is intentionally pure — no I/O, no streaming, no DB — so it is trivially
 * testable and can be shared verbatim by both chat entry points. The streaming,
 * persistence, and model-fallback live in the caller; this module only decides
 * WHAT to say and records WHY (the `DispatchPlan`, which becomes the visible,
 * friend-readable "Thinking" plan).
 */

/**
 * A steering hint from a friend — human OR another AI — about how Vai should
 * route. This is the "guide message" channel: after seeing a turn's plan, a
 * friend can say "that process wasn't good" and bias future routing, making the
 * plan dynamic and adjustable rather than frozen.
 */
export interface TurnGuidance {
  /** Restrict the hint to one handler by name. Omit to steer ALL handlers. */
  readonly handler?: string;
  /** `avoid` down-weights the target; `prefer` boosts it. */
  readonly signal: 'avoid' | 'prefer';
  /** Optional free-text note from the friend, surfaced in the plan. */
  readonly note?: string;
  /** Who gave the hint — shown so friends can see who steered what. */
  readonly from?: 'human' | 'ai';
  /**
   * Only apply when the (lowercased) understood text contains this substring.
   * Lets a hint target a CLASS of turns ("for docker-vs-* questions, avoid the
   * gaming snippet handler") instead of every turn.
   */
  readonly matchHint?: string;
}

/**
 * Everything a handler needs to decide and answer, derived once per turn. No
 * handler should re-parse the raw text for routing — read these fields instead.
 */
export interface TurnContext {
  /** Raw user text, exactly as received. */
  readonly content: string;
  /** Normalized text for understanding (typo/casing/spacing folded). */
  readonly understood: string;
  /** Recent conversation, oldest-first. */
  readonly history: readonly { readonly role: string; readonly content: string }[];
  /** Top-level turn shape (standalone / follow-up / recommendation / …). */
  readonly classification: TurnClassification;
  /** Question intent (definition / action-yesno / build / …). */
  readonly intent: QuestionIntent;
  /** Friend steering hints in effect for this turn. */
  readonly guidance: readonly TurnGuidance[];
  /**
   * Evidence gathered asynchronously before dispatch (git/fs/sandbox/web). Optional
   * so existing callers and handlers that never set/read it are unaffected. A
   * capability reads from here instead of doing its own I/O at resolve time.
   */
  readonly evidence?: TurnEvidence;
}

/**
 * A produced answer plus the metadata the visible plan and the persisted
 * thinking-trace need. A handler returns this from `resolve`, or `null` to
 * decline (the dispatcher then falls through to the next candidate).
 */
export interface Resolution {
  readonly text: string;
  /** UI turn kind ('analysis' | 'answer' | 'builder' | …). Omit to emit none. */
  readonly turnKind?: string;
  /** 0..1 self-assessed confidence in THIS answer (may differ from fit score). */
  readonly confidence: number;
  readonly intent?: string;
  /** Ordered reasoning steps for the Thinking panel. */
  readonly strategyChain?: readonly string[];
  readonly trustBadge?: string;
  readonly topic?: string;
  readonly knowledgeDepth?: 'deep' | 'shallow' | 'none';
}

/**
 * One capability. `score` reports fit (null = not applicable); `resolve`
 * produces the answer and may decline. Splitting the two is what kills the
 * single-keyword-hijack class: the comparison handler can out-SCORE the bare
 * `docker` handler even though both would have "matched".
 */
/**
 * What a scorer may return. Backward-compatible: a bare `number` (fit) or `null`
 * (inapplicable) work exactly as before. The richer `{ score, reason }` form lets
 * a handler also report WHY it valued the turn the way it did — captured into the
 * plan so the decision trail can show "X over Y because…" for human/AI review.
 */
export type ScoreResult = number | null | { readonly score: number | null; readonly reason?: string };

export interface TurnHandler<R extends Resolution = Resolution> {
  readonly name: string;
  /** How well this handler fits the turn, 0..1 (null = inapplicable). May also report why. */
  score(ctx: TurnContext): ScoreResult;
  /** Produce the answer, or null to decline and fall through. */
  resolve(ctx: TurnContext): R | null;
}

/** A handler's fit after applying friend guidance — recorded in the plan. */
export interface ScoredCandidate {
  readonly name: string;
  /** Fit reported by the handler (clamped to 0..1). */
  readonly baseScore: number;
  /** Fit after guidance adjustment — what the dispatcher actually ranks on. */
  readonly score: number;
  /** Human-readable note of any guidance that moved the score. */
  readonly guidanceApplied?: string;
  /** Why this handler valued the turn as it did — the reviewable per-option rationale. */
  readonly reason?: string;
}

/** Normalize a {@link ScoreResult} into a `{ base, reason }` pair (base null = skip). */
function normalizeScore(raw: ScoreResult): { base: number | null; reason?: string } {
  if (raw === null || raw === undefined) return { base: null };
  if (typeof raw === 'number') return { base: raw };
  return { base: raw.score, reason: raw.reason };
}

/**
 * The visible, friend-readable record of how Vai chose its answer. This is the
 * "dynamic and adjustable plan that's understandable for all friends" — it
 * exposes what was understood, every candidate and its score, what was chosen
 * (or why nothing was), and which friend hints applied.
 */
export interface DispatchPlan {
  readonly understood: string;
  readonly intent: QuestionIntent;
  readonly turnClass: TurnClassification['kind'];
  /** All applicable candidates, highest score first. */
  readonly candidates: readonly ScoredCandidate[];
  /** Winning handler name, or null when nothing cleared the floor + resolved. */
  readonly chosen: string | null;
  /** Confidence of the chosen answer (or the top score on a miss). */
  readonly confidence: number;
  /** True when no candidate cleared the confidence floor. */
  readonly belowFloor: boolean;
  /** Handlers that scored high enough but declined (`resolve` → null). */
  readonly declined: readonly string[];
}

/**
 * Outcome of a dispatch. `resolution` is null on a miss — the caller then does
 * its honest fallback (model dispatch or "I don't have a grounded answer").
 * `plan` is ALWAYS present so the Thinking panel can show the reasoning even
 * when Vai chose to say it doesn't know.
 */
export interface DispatchOutcome<R extends Resolution = Resolution> {
  readonly resolution: R | null;
  readonly plan: DispatchPlan;
}

export interface DispatchOptions {
  /**
   * Minimum score a candidate must reach to be allowed to answer. Higher =
   * Vai answers fewer turns but is more trustworthy ("honesty over coverage");
   * lower = more coverage, more risk. Default 0.5.
   */
  readonly confidenceFloor?: number;
}

const DEFAULT_FLOOR = 0.5;
const AVOID_MULTIPLIER = 0.35;
const PREFER_BOOST = 0.25;

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Apply friend guidance to a handler's base score. `avoid` hints scale it down
 * so a flagged handler loses to its rivals; `prefer` hints nudge it up. A hint
 * with no `handler` applies to every handler (use with `matchHint` to steer a
 * class of turns).
 */
function applyGuidance(
  name: string,
  base: number,
  ctx: TurnContext,
): { score: number; applied?: string } {
  let score = base;
  const notes: string[] = [];
  const haystack = ctx.understood.toLowerCase();
  for (const g of ctx.guidance) {
    if (g.handler && g.handler !== name) continue;
    if (g.matchHint && !haystack.includes(g.matchHint.toLowerCase())) continue;
    if (g.signal === 'avoid') {
      score *= AVOID_MULTIPLIER;
      notes.push(g.note ? `avoid (${g.note})` : 'avoid');
    } else {
      score = Math.min(1, score + PREFER_BOOST);
      notes.push(g.note ? `prefer (${g.note})` : 'prefer');
    }
  }
  return { score: clamp01(score), applied: notes.length ? notes.join('; ') : undefined };
}

/**
 * Score every handler, rank by fit (after friend guidance), and let the best
 * candidate above the floor answer — falling through on a decline. Pure: it
 * neither streams nor persists; the caller does that once using the outcome.
 */
export function dispatchTurn<R extends Resolution = Resolution>(
  ctx: TurnContext,
  handlers: readonly TurnHandler<R>[],
  options: DispatchOptions = {},
): DispatchOutcome<R> {
  const floor = options.confidenceFloor ?? DEFAULT_FLOOR;

  const scored: ScoredCandidate[] = [];
  for (const handler of handlers) {
    let base: number | null;
    let reason: string | undefined;
    try {
      ({ base, reason } = normalizeScore(handler.score(ctx)));
    } catch {
      // A throwing scorer must never take down the whole turn — skip it.
      continue;
    }
    if (base === null || base === undefined || Number.isNaN(base)) continue;
    const clampedBase = clamp01(base);
    const { score, applied } = applyGuidance(handler.name, clampedBase, ctx);
    scored.push({ name: handler.name, baseScore: clampedBase, score, guidanceApplied: applied, reason });
  }
  scored.sort((a, b) => b.score - a.score);

  const byName = new Map(handlers.map((h) => [h.name, h]));
  const declined: string[] = [];

  for (const candidate of scored) {
    // Sorted descending: once we're under the floor, nothing remaining qualifies.
    if (candidate.score < floor) break;
    const handler = byName.get(candidate.name);
    if (!handler) continue;

    let resolution: Resolution | null;
    try {
      resolution = handler.resolve(ctx);
    } catch {
      declined.push(candidate.name);
      continue;
    }
    if (!resolution) {
      declined.push(candidate.name);
      continue;
    }

    const confidence = clamp01(
      typeof resolution.confidence === 'number' ? resolution.confidence : candidate.score,
    );
    return {
      resolution: { ...resolution, confidence } as R,
      plan: {
        understood: ctx.understood,
        intent: ctx.intent,
        turnClass: ctx.classification.kind,
        candidates: scored,
        chosen: candidate.name,
        confidence,
        belowFloor: false,
        declined: [...declined],
      },
    };
  }

  // No candidate cleared the floor and resolved. Caller falls back honestly.
  const topScore = scored.length > 0 ? scored[0].score : 0;
  return {
    resolution: null,
    plan: {
      understood: ctx.understood,
      intent: ctx.intent,
      turnClass: ctx.classification.kind,
      candidates: scored,
      chosen: null,
      confidence: topScore,
      belowFloor: topScore < floor,
      declined: [...declined],
    },
  };
}

/**
 * Render a plan as a compact, friend-readable trace. Used both for the Thinking
 * panel's strategy chain and for logging. Each line is one candidate with its
 * score and any guidance that moved it, marking the chosen one.
 */
export function describePlan(plan: DispatchPlan): string[] {
  const lines = plan.candidates.map((c) => {
    const mark = c.name === plan.chosen ? '→' : ' ';
    const guidance = c.guidanceApplied ? `  [${c.guidanceApplied}]` : '';
    const declined = plan.declined.includes(c.name) ? '  (declined)' : '';
    return `${mark} ${c.name} ${(c.score * 100).toFixed(0)}%${guidance}${declined}`;
  });
  if (plan.chosen === null) {
    lines.push(plan.belowFloor ? '✗ no candidate above confidence floor' : '✗ all candidates declined');
  }
  return lines;
}
