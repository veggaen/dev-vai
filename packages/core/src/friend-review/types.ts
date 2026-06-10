/**
 * Friend Review Panel — shared types.
 *
 * The idea (owner's words): "when I input messages into the chat, the response
 * is going to be good, and I want Qwen and other AIs to always review the
 * messages that Vai is giving back to the user. That way, Vai can get a notice
 * from his friends and workers and other AIs or systems to know if the response
 * even is good, so that Vai can provide some better reasoning."
 *
 * So a *panel* of independent reviewers (each a friend / worker / other AI) looks
 * at one prepared draft and each returns a {@link FriendVerdict}. The panel folds
 * those into a single {@link FriendReviewNotice} — the consolidated "notice" Vai
 * receives back from its friends.
 *
 * This module is deliberately decoupled from the chat service:
 *   - {@link FriendReviewInput} is structurally identical to the chat service's
 *     `ResponseReviewInput`, so the two are interchangeable without an import
 *     cycle. `integration.ts` provides the thin adapter onto the existing
 *     `ResponseReviewer` seam.
 *   - Aggregation is pure (no I/O); only the concrete reviewers touch the network.
 */

/** What one reviewer thinks of the draft, on a three-step quality scale. */
export type FriendVerdictKind = 'good' | 'needs-work' | 'bad';

/** The panel's consolidated decision, derived from every reviewer's verdict. */
export type FriendReviewOutcome = 'approved' | 'revise' | 'blocked';

/**
 * The draft, plus the context a reviewer needs to judge it. Field-for-field
 * compatible with the chat service's `ResponseReviewInput` so a panel can be
 * dropped straight onto the existing review seam.
 */
export interface FriendReviewInput {
  /** The user's message that Vai is answering. */
  readonly prompt: string;
  /** The candidate answer Vai prepared but has not shown the user yet. */
  readonly draft: string;
  /** Which model/engine produced the draft (e.g. `vai:v0`). */
  readonly modelId: string;
  /** High-level routing classification for the turn (e.g. `factual`, `build`). */
  readonly turnKind: string;
  /** Whether the draft is backed by fetched evidence/sources. */
  readonly hasEvidence: boolean;
  /** Evidence the draft leaned on, for the reviewer to cross-check against. */
  readonly sources: readonly {
    readonly title?: string;
    readonly url?: string;
    readonly snippet?: string;
  }[];
}

/** One reviewer's structured opinion of the draft. */
export interface FriendVerdict {
  /** Stable id of the reviewer that produced this verdict (e.g. `local:qwen2.5:7b`). */
  readonly reviewerId: string;
  /** Friendly name for surfacing in a notice (e.g. `Qwen 2.5 7B`). */
  readonly reviewerName: string;
  /** The reviewer's quality call. */
  readonly verdict: FriendVerdictKind;
  /** How sure the reviewer is, 0..1. */
  readonly confidence: number;
  /** One-line human summary of the verdict. */
  readonly summary: string;
  /** Concrete problems the reviewer found (empty when none). */
  readonly concerns: readonly string[];
  /** Concrete, actionable improvements Vai could apply (empty when none). */
  readonly suggestions: readonly string[];
  /** The reviewer believes the draft needs fresh/current evidence before release. */
  readonly requiresFreshEvidence: boolean;
  /** Wall-clock time this reviewer took, in ms. */
  readonly durationMs: number;
  /**
   * Set when the reviewer could not produce a usable verdict (timeout, network
   * error, unparseable output). A `failed` verdict never blocks a draft — a
   * friend who didn't answer can't veto — but it is recorded for observability.
   */
  readonly error?: string;
}

/**
 * The consolidated "notice" Vai receives back from the whole panel — the
 * friend-readable record of what its friends and workers thought of the draft.
 */
export interface FriendReviewNotice {
  /** The panel's overall call. */
  readonly outcome: FriendReviewOutcome;
  /** Aggregate quality score 0..1 (good=1, needs-work=0.5, bad=0, by reviewer). */
  readonly score: number;
  /** One-line consensus headline (e.g. "2 friends reviewed · 1 wants changes"). */
  readonly consensus: string;
  /** Every reviewer's verdict, in completion order. */
  readonly verdicts: readonly FriendVerdict[];
  /** Deduped, most-cited concerns across reviewers (capped). */
  readonly topConcerns: readonly string[];
  /** Deduped, most-cited improvement suggestions across reviewers (capped). */
  readonly topSuggestions: readonly string[];
  /** Ids of reviewers that returned a usable verdict (excludes failures). */
  readonly reviewerIds: readonly string[];
  /** True when at least one reviewer wants fresh evidence before release. */
  readonly requiresFreshEvidence: boolean;
  /**
   * Back-compat veto flag for the chat service's `ResponseReviewer` seam:
   * `true` iff `outcome === 'blocked'`. The service withholds rejected drafts.
   */
  readonly rejected: boolean;
}

/**
 * A single friend on the panel. Implementations live in `reviewers.ts`
 * (model-backed, friend-channel-backed, etc.) or can be injected in tests.
 *
 * A reviewer returns `null` when it has nothing to say (e.g. disabled, or the
 * draft is out of its remit). Returning `null` is treated as an abstention,
 * not a failure.
 */
export interface FriendReviewer {
  /** Stable id (e.g. `local:qwen2.5:7b`, `grok-friend-channel`). */
  readonly id: string;
  /** Friendly display name. */
  readonly displayName: string;
  /** Inspect a draft and return a verdict, an abstention (`null`), or throw. */
  readonly review: (input: FriendReviewInput) => Promise<FriendVerdict | null>;
}
