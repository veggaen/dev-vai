import type { QuestionIntent } from './question-intent.js';
import type { TurnGuidance } from './turn-pipeline.js';

/**
 * Persistent friend-steering for Vai's routing — the durable layer behind the
 * dispatcher's in-memory {@link TurnGuidance}.
 *
 * A friend (human OR AI) reacts to a turn's Routing plan and records a
 * `RouteGuidance`: "for turns like this, avoid/prefer handler X." Stored hints
 * are loaded each turn, the applicable ones selected (by scope + salient-token
 * overlap + intent), projected to the dispatcher's `TurnGuidance`, and applied
 * — closing the capture → persist → load → apply loop. This is Stage 1 of the
 * multi-actor steering design: humans first, trust implicit (owner), the
 * council machinery (invitations, shadow contributions) defined below but not
 * yet wired.
 */
export interface RouteGuidance {
  readonly id: string;
  /** Bound to one chat when `scope === 'conversation'`; null for global. */
  readonly conversationId?: string | null;
  /** Friend identity class. */
  readonly from: 'human' | 'ai';
  /** Display name of the friend who steered (shown in the plan). */
  readonly author?: string;
  /** `avoid` down-weights the handler; `prefer` boosts it. */
  readonly signal: 'avoid' | 'prefer';
  /** Target handler name (e.g. `chat-fact-shim`). */
  readonly handler: string;
  /** Optional free-text guide message ("this process wasn't good"). */
  readonly note?: string;
  /**
   * Reach of the hint:
   * - `class`        — turns like this one (salient-token overlap and/or intent)
   * - `conversation` — the rest of this chat
   * - `global`       — everywhere, from now on
   */
  readonly scope: 'class' | 'conversation' | 'global';
  /** Salient tokens of the originating turn, for `class`-scope matching. */
  readonly matchTokens?: readonly string[];
  /** Optional intent match for `class` scope ("for comparison questions…"). */
  readonly intent?: QuestionIntent;
  /**
   * Reserved for the dynamic-strength phase. Stored now but the dispatcher
   * applies a FIXED nudge for Stage 1 — the variable, context/trust-weighted
   * strength is intentionally deferred (see project_multi_actor_deliberation).
   */
  readonly weight: number;
  /** Soft-delete / reverse — inactive hints never apply. */
  readonly active: boolean;
  readonly createdAt: Date;
  /** Decay: hints past this instant never apply. Null = no expiry. */
  readonly expiresAt?: Date | null;

  // Optional efficacy tracking (populated by GuidanceStore implementations when writing reference data)
  readonly appliedCount?: number;
  readonly lastAppliedAt?: Date | null;
}

/** The per-turn signals the matcher needs to decide which hints apply. */
export interface TurnSignals {
  readonly conversationId?: string;
  /** Salient tokens of the current turn (see {@link salientTokens}). */
  readonly tokens: readonly string[];
  readonly intent?: QuestionIntent;
}

export interface SelectGuidanceOptions {
  /** Fraction of a hint's `matchTokens` that must appear in the turn for a
   * `class`-scope match. Default 0.5. */
  readonly classOverlapThreshold?: number;
}

const DEFAULT_CLASS_OVERLAP = 0.5;

// Common words that carry no routing signal — excluded from salient tokens.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'you', 'your', 'this', 'that',
  'with', 'what', 'when', 'where', 'which', 'who', 'how', 'why', 'does', 'did',
  'can', 'could', 'will', 'would', 'should', 'have', 'has', 'had', 'about',
  'from', 'into', 'over', 'than', 'then', 'them', 'they', 'a', 'an',
  'is', 'it', 'its', 'of', 'to', 'in', 'on', 'or', 'be', 'as', 'at', 'by',
  'me', 'my', 'we', 'do', 'so', 'if', 'vs', 'between',
]);

/**
 * Extract distinctive tokens from a turn for class-scope matching. Lowercased,
 * de-duplicated, ≥3 chars, stopwords removed. Keeps `+`, `#`, `.` so tokens
 * like `c++`, `c#`, `node.js` survive. Pure.
 */
export function salientTokens(text: string): string[] {
  const raw = (text || '').toLowerCase().match(/[a-z0-9][a-z0-9+#.]{2,}/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw) {
    const t = token.replace(/[.]+$/, '');
    if (t.length < 3 || STOPWORDS.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Choose which active, unexpired hints apply to this turn. Pure — no I/O. The
 * caller loads all active hints (from the store), passes them here, then
 * projects the survivors with {@link toTurnGuidance} for the dispatcher.
 *
 * Scope rules: `global` always applies; `conversation` matches the same chat;
 * `class` matches on intent equality OR sufficient salient-token overlap.
 */
export function selectApplicableGuidance(
  signals: TurnSignals,
  active: readonly RouteGuidance[],
  now: Date = new Date(),
  options: SelectGuidanceOptions = {},
): RouteGuidance[] {
  const threshold = options.classOverlapThreshold ?? DEFAULT_CLASS_OVERLAP;
  const turnTokens = new Set(signals.tokens.map((t) => t.toLowerCase()));

  return active.filter((g) => {
    if (!g.active) return false;
    if (g.expiresAt && g.expiresAt.getTime() <= now.getTime()) return false;

    switch (g.scope) {
      case 'global':
        return true;
      case 'conversation':
        return Boolean(signals.conversationId) && g.conversationId === signals.conversationId;
      case 'class': {
        if (g.intent && signals.intent && g.intent === signals.intent) return true;
        if (!g.matchTokens || g.matchTokens.length === 0) return false;
        const overlap = g.matchTokens.reduce(
          (n, t) => (turnTokens.has(t.toLowerCase()) ? n + 1 : n),
          0,
        );
        return overlap / g.matchTokens.length >= threshold;
      }
      default:
        return false;
    }
  });
}

/**
 * Project a persisted hint into the dispatcher's in-memory {@link TurnGuidance}.
 * Applicability is already decided upstream, so no `matchHint` is emitted — the
 * dispatcher applies the hint to its target handler directly. `weight` is
 * intentionally NOT forwarded yet (fixed-nudge Stage 1).
 */
export function toTurnGuidance(g: RouteGuidance): TurnGuidance {
  return {
    handler: g.handler,
    signal: g.signal,
    note: g.note,
    from: g.from,
  };
}

// ── Council data model (LOCKED now, machinery NOT yet wired) ────────────────
// Defined so Stage 1's storage doesn't paint us into a corner. Adapted from
// the Grok-contributed draft. In Stage 1 these are inert types; invitations,
// shadow sessions, and synthesis land in Stage 3.

/** Who is allowed into the shadow layer, with what permissions, and how scoped. */
export interface ActorInvitation {
  readonly id: string;
  readonly conversationId: string;
  /** e.g. "claude-opus-4-8", "grok", "vai:peer-1". */
  readonly actorId: string;
  readonly actorType: 'llm' | 'model' | 'agent' | 'neural-net';
  readonly invitedBy: 'vai' | 'human' | 'system';
  /** Populated when `invitedBy === 'human'`. */
  readonly invitedByUserId?: string;
  readonly status: 'pending' | 'active' | 'revoked' | 'expired';
  readonly scope: 'conversation' | 'class';
  /** Class-scope targeting — reuses the same salient-token matching. */
  readonly matchTokens?: readonly string[];
  readonly permissions: ActorPermissions;
  readonly createdAt: Date;
  readonly expiresAt?: Date | null;
  readonly revokedAt?: Date | null;
  readonly revokedBy?: string;
  readonly note?: string;
}

export interface ActorPermissions {
  /** May create RouteGuidance records (steer routing). */
  readonly canPostGuidance: boolean;
  /** May post richer ActorContribution records into the shadow layer. */
  readonly canPostContributions: boolean;
  readonly canSeeRoutingPlan: boolean;
  readonly canSeeFullContext: boolean;
}

/** A live shadow channel instance for one invited actor. */
export interface ActorSession {
  readonly id: string;
  readonly invitationId: string;
  readonly conversationId: string;
  readonly actorId: string;
  readonly status: 'listening' | 'contributed' | 'idle' | 'revoked';
  readonly lastContributionAt?: Date | null;
  readonly contributionCount: number;
  readonly createdAt: Date;
}

/** What an invited actor posts into the shadow layer. Never hits the main
 * thread directly; only promoted ones become {@link RouteGuidance}. */
export interface ActorContribution {
  readonly id: string;
  readonly sessionId: string;
  readonly conversationId: string;
  readonly actorId: string;
  readonly type:
    | 'route-guidance'
    | 'alternative-plan'
    | 'critique'
    | 'high-confidence-answer'
    | 'supporting-evidence';
  /** When `type === 'route-guidance'`, the proposed hint (promotable). */
  readonly guidance?: Pick<RouteGuidance, 'signal' | 'handler' | 'note' | 'scope' | 'matchTokens' | 'intent'>;
  readonly payload?: ActorContributionPayload;
  readonly triggeredBy: 'explicit-invitation' | 'vai-auto' | 'human-invitation';
  readonly createdAt: Date;
  /** Has synthesis/review looked at it yet? */
  readonly processed: boolean;
  /** Set when this contribution was promoted to a RouteGuidance record. */
  readonly promotedToGuidanceId?: string;
}

export interface ActorContributionPayload {
  readonly reasoning?: string;
  /**
   * Actor-provided 0..1 self-confidence. MEASURED-ONLY in this phase — never
   * drives auto-gating or promotion until calibrated against outcomes (see the
   * self-competence risk in project_multi_actor_deliberation).
   */
  readonly confidence?: number;
  readonly alternatives?: readonly string[];
  readonly risks?: readonly string[];
  readonly evidence?: readonly string[];
}

/* ── Guidance persistence contract (for writing reference data) ───────────── */

/**
 * Store abstraction for RouteGuidance (the durable "steers" from humans, AI agents,
 * and robots). The caller (runtime) owns the actual DB. Core only depends on the
 * interface so the steering loop can both LOAD (to affect routing) and WRITE
 * (so we accumulate reference points for later benefit analysis / re-calibration
 * decisions).
 *
 * Writing the guidance + the per-turn DispatchPlan (with baseline) gives us the
 * raw material to answer: "Did applying this steer from X actually improve the
 * outcome on turns like Y, or do we need to re-calibrate weights/matching/scope?"
 */
export interface GuidanceStore {
  /** Load currently active, unexpired guidance for a conversation (or global if null). */
  loadActive(conversationId?: string | null): readonly RouteGuidance[];

  /**
   * Persist a new (or replacement) guidance record.
   * Implementations should assign id/createdAt if not provided and handle
   * serialization (matchTokens as JSON etc).
   */
  save(
    input: Omit<
      RouteGuidance,
      'id' | 'createdAt' | 'active' | 'appliedCount' | 'lastAppliedAt'
    > & {
      id?: string;
      createdAt?: Date;
    },
  ): RouteGuidance;

  /** Increment usage counters on a guidance (called when it actually affected a turn). */
  recordApplication(id: string, appliedAt?: Date): void;
}

/** Minimal in-memory impl (useful for tests / local dev without full DB). */
export class InMemoryGuidanceStore implements GuidanceStore {
  private readonly records: RouteGuidance[] = [];

  loadActive(conversationId?: string | null): readonly RouteGuidance[] {
    const now = new Date();
    return this.records.filter((g) => {
      if (!g.active) return false;
      if (g.expiresAt && g.expiresAt.getTime() <= now.getTime()) return false;
      if (g.scope === 'global') return true;
      if (g.scope === 'conversation') return g.conversationId === conversationId;
      return true; // class-scope are filtered later by selectApplicableGuidance
    });
  }

  save(
    input: Omit<
      RouteGuidance,
      'id' | 'createdAt' | 'active' | 'appliedCount' | 'lastAppliedAt'
    > & { id?: string; createdAt?: Date },
  ): RouteGuidance {
    const now = new Date();
    const record: RouteGuidance = {
      ...input,
      id: input.id ?? `guid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: input.createdAt ?? now,
      active: true,
      appliedCount: 0,
      lastAppliedAt: undefined,
    } as RouteGuidance;
    // replace if same id
    const idx = this.records.findIndex((r) => r.id === record.id);
    if (idx >= 0) this.records[idx] = record;
    else this.records.push(record);
    return record;
  }

  recordApplication(id: string, appliedAt: Date = new Date()): void {
    const g = this.records.find((r) => r.id === id);
    if (g) {
      (g as any).appliedCount = ((g as any).appliedCount ?? 0) + 1;
      (g as any).lastAppliedAt = appliedAt;
    }
  }
}

/**
 * Per-lesson efficacy signal — how a persisted AI council lesson has fared once it
 * actually started firing on later turns. `helpfulTurns` / `unhelpfulTurns` come
 * from the existing outcome data (positive vs negative/neutral lift on turns where
 * the lesson applied).
 */
export interface LessonEfficacy {
  readonly guidanceId: string;
  readonly appliedCount: number;
  readonly helpfulTurns: number;
  readonly unhelpfulTurns: number;
}

export interface LessonEfficacyVerdict {
  readonly guidanceId: string;
  /** keep = earning its place; watch = too few samples; decay = applied enough, no benefit. */
  readonly verdict: 'keep' | 'watch' | 'decay';
  readonly reason: string;
}

/**
 * The measurement half of "apply council lessons intelligently" (council self-eval
 * recommendation, 2026-06-14): a persisted lesson that has fired several times and
 * never improved an outcome is noise — it should DECAY rather than keep nudging the
 * router. This is the honest version of the council's `applyCouncilLessons` ask:
 * you apply lessons better by pruning the ones the data shows don't help, instead
 * of letting every stored lesson live forever.
 *
 * Pure + deterministic so it is unit-testable without the DB. The caller
 * (GuidanceStore-backed) decays a `decay` verdict by deactivating / shortening
 * expiry on the matching RouteGuidance.
 */
export function evaluateLessonEfficacy(
  efficacy: LessonEfficacy,
  opts: { minSamples?: number } = {},
): LessonEfficacyVerdict {
  const minSamples = opts.minSamples ?? 3;
  const { guidanceId, appliedCount, helpfulTurns, unhelpfulTurns } = efficacy;
  const judged = helpfulTurns + unhelpfulTurns;

  // Not enough evidence yet — let it keep working and gather data.
  if (appliedCount < minSamples || judged < minSamples) {
    return { guidanceId, verdict: 'watch', reason: `only ${judged} judged of ${appliedCount} applications (need ${minSamples})` };
  }
  // Any real, repeated benefit → keep it.
  if (helpfulTurns > 0 && helpfulTurns >= unhelpfulTurns) {
    return { guidanceId, verdict: 'keep', reason: `${helpfulTurns} helpful vs ${unhelpfulTurns} unhelpful` };
  }
  // Applied enough, judged enough, and it never (net) helped → decay.
  return { guidanceId, verdict: 'decay', reason: `${helpfulTurns} helpful vs ${unhelpfulTurns} unhelpful over ${appliedCount} applications — not earning its place` };
}
