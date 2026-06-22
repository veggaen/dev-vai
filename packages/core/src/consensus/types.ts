/**
 * SCIS Consensus Council — shared types.
 *
 * A council of independent models (and, later, humans) reviews a Vai draft. Each
 * member returns a {@link CouncilMemberNote}: not the answer, but a reading of the
 * true intent, the missing capability/method, and a recommended action. The
 * council folds these into a {@link CouncilConsensus} (ship / act / escalate) plus
 * a UI-facing {@link CouncilThinking} summary for "How this answer was made".
 *
 * Binding guardrail (see docs/capabilities/scis-consensus-council.md §2): members
 * POINT (intent / method / which tool); they never supply FACTS to the user. Only
 * `recommendedAction` / `searchQuery` / `methodLessons` / `realIntent` are consumed
 * downstream — never a member's claimed fact. Vai's own grounded tools supply every
 * number, name, and spelling.
 */

/** Subject niches used to route a turn to the right council members. */
export type CouncilTopic =
  | 'code'
  | 'factual'
  | 'local' // local businesses, places, "near me", contact details
  | 'reasoning'
  | 'creative'
  | 'chitchat'
  | 'other';

/** What a member thinks Vai should do next with the turn. */
export type CouncilAction =
  | 'answer-directly' // the draft is sound; ship it
  | 'web-search' // needs current web evidence
  | 'local-business-search' // needs a local listings / contact lookup
  | 'reread-intent' // Vai misread the ask; re-draft against the true intent
  | 'ask-one-question'; // genuinely ambiguous; ask one focused question

/** The panel's overall call for the turn. */
export type CouncilOutcome = 'ship' | 'act' | 'escalate';

/** How consequential a message is — drives council depth and caution. */
export type SeriousnessTier = 'trivial' | 'standard' | 'high';

/** The seriousness gate's reading of a turn. */
export interface SeriousnessAssessment {
  readonly tier: SeriousnessTier;
  /** Medical / legal / financial / personal-safety domain — handle with extra care. */
  readonly sensitive: boolean;
  readonly reasons: readonly string[];
}

/** Whether and how deeply to convene the council for a turn. */
export interface CouncilPlan {
  readonly convene: boolean;
  readonly depth: 'skip' | 'light' | 'full';
  readonly assessment: SeriousnessAssessment;
  readonly reason: string;
}

/** Three-step quality scale shared with the friend-review panel. */
export type CouncilVerdict = 'good' | 'needs-work' | 'bad';

/** The draft plus the context a member needs to judge it (structurally compatible
 * with the chat service's review input). */
export interface CouncilInput {
  readonly prompt: string;
  readonly draft: string;
  readonly modelId: string;
  readonly turnKind: string;
  readonly hasEvidence: boolean;
  readonly sources: readonly { readonly title?: string; readonly url?: string; readonly snippet?: string }[];
  /** Vai's own confidence in the draft (0..1), if known — feeds the seriousness gate. */
  readonly draftConfidence?: number;
  /**
   * Shared web evidence Vai gathered for this turn (the "web witness" / RAG step). Every
   * member reads the SAME block before voting — informs reasoning, never overrides the
   * fact-quarantine (members still emit only intent/method/action, never user-facing facts).
   */
  readonly webEvidence?: {
    /** Google's AI Overview synthesized summary, when present (treat as one source, verify). */
    readonly aiOverview?: string | null;
    /** ISO timestamp the evidence was gathered (freshness). */
    readonly gatheredAt?: string;
  };
  /** What Vai considered important when drafting — not the full thread dump. */
  readonly contextSummary?: string;
  /** Snippets Vai actually retrieved and used for this draft. */
  readonly retrievedSnippets?: readonly { readonly title?: string; readonly url?: string; readonly snippet?: string }[];
  /** Trimmed chat history relevant to this turn. */
  readonly relevantHistory?: readonly { readonly role: 'user' | 'assistant' | 'system' | 'tool'; readonly content: string }[];
}

/** One council member's structured note. Advisory only — facts are quarantined. */
export interface CouncilMemberNote {
  readonly memberId: string;
  readonly memberName: string;
  /** The niche this member was convened for. */
  readonly topic: CouncilTopic;
  readonly verdict: CouncilVerdict;
  readonly confidence: number;
  /** What the user actually wants — read past the literal words. */
  readonly realIntent: string;
  /** Sarcasm / hidden / multiple meanings detected, or empty. */
  readonly hiddenMeaning: string;
  /** The capability or method Vai was missing (advisory). */
  readonly missingCapability: string;
  /** What the member thinks Vai should do next. */
  readonly suggestedAction: CouncilAction;
  /** A search query Vai could run, if a search is suggested (advisory — Vai owns the fetch). */
  readonly searchQuery: string;
  /** How to handle this CLASS of message next time (teach-to-fish). */
  readonly methodLesson: string;
  readonly concerns: readonly string[];
  readonly durationMs: number;
  /** Set when the member could not produce a usable note (timeout / parse fail). Never blocks. */
  readonly error?: string;
  /**
   * Per-member context-state ledger (the pull-model audit trail): which fetched context the
   * member actually grounded on (used) vs looked at and discarded (unused) vs found nothing
   * for (unavailable). Present only when the member ran an evidence round. Advisory/UI only.
   */
  readonly contextLedger?: {
    readonly used: number;
    readonly unused: number;
    readonly unavailable: number;
    readonly items: readonly { readonly label: string; readonly state: string; readonly reason: string }[];
  };
  /**
   * Verified proof the member ran on its own claim before presenting (the experiment loop):
   * an allowlisted command + its outcome. `proved` boosts the member's vote weight; `disproved`
   * discounts it. Present only when the member proposed and ran a proof. Advisory/UI.
   */
  readonly proof?: {
    readonly hypothesis: string;
    readonly command: string;
    readonly status: string;
    readonly detail: string;
  };
}

/**
 * Result of the optional fact cross-check (see `cross-check.ts`). When a turn carries a
 * checkable claim, ChatService runs ONE web search and folds the outcome in here. A
 * confirmation strongly boosts {@link CouncilConsensus.agreement}; a contradiction flips the
 * action to `reread-intent`. The `sources` are the exact snippets the boost was calibrated on,
 * surfaced so a human can opt in to double-check what the verification relied on.
 */
export interface CouncilCrossCheck {
  /** The search ran and the evidence confirms the draft's claim. */
  readonly verified: boolean;
  /** A high-confidence confirmation — treated as a verified pass in the UI. */
  readonly pass: boolean;
  /** The evidence actively contradicts the draft's claim. */
  readonly contradicted: boolean;
  /** The specific value the evidence confirmed (e.g. "$63,450"), or null. */
  readonly confirmsValue: string | null;
  /** The query that was searched. */
  readonly query: string;
  /** Agreement BEFORE the boost — so the UI can show "73% → 96%". */
  readonly boostedFrom: number;
  /** The search engine's own confidence in its answer, 0..1. */
  readonly searchConfidence: number;
  /** The exact sources the boost was calibrated on — powers the human double-check UI. */
  readonly sources: ReadonlyArray<{ readonly title?: string; readonly url?: string; readonly snippet?: string }>;
}

/** The ephemeral consensus the council reached — attached to the turn, never stored. */
export interface CouncilConsensus {
  readonly outcome: CouncilOutcome;
  /** Inter-member agreement on the modal verdict, 0..1. */
  readonly agreement: number;
  /** Confidence-weighted council confidence in its call, 0..1. */
  readonly confidence: number;
  /** Consensus reading of the user's true intent (from the most confident member). */
  readonly realIntent: string;
  /** What Vai should do next. */
  readonly recommendedAction: CouncilAction;
  /** Search query Vai should run when the action is a search (advisory). */
  readonly searchQuery: string;
  /** Deduped capabilities the council judged missing. */
  readonly missingCapabilities: readonly string[];
  /** Deduped method lessons (what the friends taught). */
  readonly methodLessons: readonly string[];
  /** One-line human consensus headline. */
  readonly summary: string;
  /** Every member note, in completion order (failures included for the record). */
  readonly notes: readonly CouncilMemberNote[];
  /** Ids of members that returned a usable note. */
  readonly memberIds: readonly string[];
  /**
   * Structural invariant, always `true`: no member-authored fact was consumed —
   * only intent / method / action / search-query. Vai's own tools supply every
   * fact. Surfaced so the guardrail is visible, not just assumed.
   */
  readonly factsQuarantined: true;
  /** Set when a fact cross-check ran for this turn (confirmation / contradiction). */
  readonly crossCheck?: CouncilCrossCheck;
  /**
   * Surfaced minority objection (Council Excellence + transparency): present when one or
   * more members returned `verdict: 'bad'` with non-trivial weight, EVEN IF the modal
   * verdict shipped. The outcome logic is intentionally unchanged — this only makes a
   * serious dissent auditable so it's never silently buried in `notes[]`. Absent when no
   * meaningful dissent exists.
   */
  readonly dissent?: CouncilDissent;
}

/** A surfaced minority objection within the council — auditable, does not (yet) alter outcome. */
export interface CouncilDissent {
  /** True when a non-trivial-weight minority returned `verdict: 'bad'`. */
  readonly hasDissent: true;
  /** Fraction of total panel weight that dissented (0..1). */
  readonly dissentStrength: number;
  /** The dissenting members and what they objected with. */
  readonly dissentingMembers: readonly {
    readonly memberId: string;
    readonly memberName: string;
    /** This member's share of total panel weight (0..1). */
    readonly weight: number;
    readonly confidence: number;
    /** The member's flagged concerns (may be empty if it gave none). */
    readonly concerns: readonly string[];
  }[];
}

/** A council member. Implementations live in `member.ts` or are injected in tests. */
export interface CouncilMember {
  readonly id: string;
  readonly displayName: string;
  /** The niche this member is trusted for. */
  readonly topic: CouncilTopic;
  /**
   * Review a draft. The optional `opts.onReasoningDelta(textSoFar)` fires as the model
   * streams its own reasoning ("thinking out loud") so the UI can show live presence per
   * member instead of a bare "working…". It's advisory/observability only — the structured
   * note is still the source of truth and the fact-quarantine holds. A member that doesn't
   * stream simply never calls it. Pure stubs in tests can ignore the arg entirely.
   */
  readonly review: (
    input: CouncilInput,
    opts?: { readonly onReasoningDelta?: (textSoFar: string) => void },
  ) => Promise<CouncilMemberNote | null>;
  /**
   * True for a reasoning model (DeepSeek-R1 et al.) that emits a long chain-of-thought
   * before answering. The council's OUTER per-member timeout (`runOneMember`) extends
   * for these so they aren't aborted mid-think — the internal review budget alone is not
   * enough because a separate Promise.race cap also bounds the call.
   */
  readonly slowThinking?: boolean;
}

/**
 * UI-facing summary attached to `TurnThinking.council` and rendered in the thinking
 * panel. A compact projection of {@link CouncilConsensus} — no member "facts".
 */
export interface CouncilThinking {
  readonly outcome: CouncilOutcome;
  readonly agreement: number;
  readonly confidence: number;
  readonly topic: CouncilTopic;
  readonly summary: string;
  readonly realIntent: string;
  readonly recommendedAction: CouncilAction;
  readonly missingCapabilities: readonly string[];
  readonly methodLessons: readonly string[];
  /** Always true — friends' facts were not used (the visible guardrail). */
  readonly factsQuarantined: true;
  /** Stakes tier the seriousness gate assigned, if assessed. */
  readonly tier?: SeriousnessTier;
  /** Sensitive domain (medical/legal/financial/safety) — handled with caution. */
  readonly sensitive?: boolean;
  /** Per-member one-liners for the panel ("Qwen 7B · needs-work · local-business-search"). */
  readonly members: readonly {
    readonly name: string;
    readonly topic: CouncilTopic;
    readonly verdict: CouncilVerdict;
    readonly confidence: number;
    readonly action: CouncilAction;
    readonly note: string;
    readonly failed?: boolean;
  }[];
  /** Fact cross-check outcome, when one ran — drives the "web-confirmed" badge + human review. */
  readonly crossCheck?: CouncilCrossCheck;
}
