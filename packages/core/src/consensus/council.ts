/**
 * Council runner + consensus aggregation.
 *
 * `reachConsensus` is the pure policy core (unit-tested). `runCouncil` fans a draft
 * to chosen members in parallel with a timeout. `convene` is the full path: assess
 * seriousness (skip trivia), route the topic, select members, run them with
 * topic-fit trust weighting, reach consensus, then apply the council's governance
 * rules. `toCouncilThinking` projects the consensus into the UI block — dropping
 * every member "fact" by construction (the visible fact-quarantine guardrail).
 */

import { councilPlan, governConsensus } from './seriousness.js';
import { routeTopic, selectMembers, type CouncilRoster } from './topic-router.js';
import { MemberAvailabilityStore, type MemberAvailability } from './member-availability.js';
import { proofTrustWeight, type ProofStatus } from './member-experiment.js';
import type {
  CouncilAction,
  CouncilConsensus,
  CouncilInput,
  CouncilMember,
  CouncilMemberNote,
  CouncilOutcome,
  CouncilThinking,
  CouncilTopic,
  CouncilVerdict,
  SeriousnessAssessment,
} from './types.js';

export interface RunCouncilOptions {
  /** Per-member timeout in ms; an overrun is a non-blocking failure. Default 15_000. */
  readonly timeoutMs?: number;
  /** Agreement below this → `escalate` (genuinely split). Default 0.5. */
  readonly escalateBelow?: number;
  /** Max method lessons / missing capabilities carried. Default 5. */
  readonly maxItems?: number;
  /** Per-note vote weight (e.g. topic-fit trust). Default 1 for every note. */
  readonly weightFor?: (note: CouncilMemberNote) => number;
  /** Observability hook with the finished consensus. Never throws into the turn. */
  readonly onConsensus?: (consensus: CouncilConsensus) => void;
  /** Injectable clock for tests. Default `Date.now`. */
  readonly now?: () => number;
  /**
   * How many members may run at once. Local council models share ONE GPU; running
   * them in parallel thrashes VRAM and big models never load (diagnosed: a 12GB GPU
   * can't co-resident qwen3:8b + qwen2.5:7b + qwen2.5:3b, so the 7b always timed
   * out). Default 1 (sequential) so each member gets the GPU in turn and actually
   * participates. The council runs after the primary draft, so the added latency
   * doesn't delay the user. Set higher only when members are on independent
   * backends. Override via VAI_COUNCIL_CONCURRENCY at the call site.
   */
  readonly concurrency?: number;
  /**
   * Overall WALL-CLOCK budget (ms) for the whole streaming convene, across all members.
   * Once spent, no further members are asked and consensus is built from the notes
   * already collected. This is what stops a panel of slow cold models (e.g. all installed
   * models incl. a thinking model) from holding the user's buffered answer hostage for
   * minutes — the council is advisory, so it must yield the floor when its time is up.
   * Undefined = no overall cap (only per-member `timeoutMs` applies). Used by the chat
   * loop's VAI_COUNCIL_LOOP_BUDGET_MS.
   */
  readonly overallDeadlineMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_ESCALATE_BELOW = 0.5;
const DEFAULT_MAX_ITEMS = 5;
/** Off-specialty members still count, but less — the council's trust-weighting rule. */
const OFF_TOPIC_WEIGHT = 0.6;

const VERDICT_RANK: Record<CouncilVerdict, number> = { good: 0, 'needs-work': 1, bad: 2 };

/**
 * Live, process-wide record of which council members are currently healthy vs. down and
 * why. Updated as a side effect of every member run (success clears, failure classifies +
 * records). The runtime reads this to give the desktop a truthful "green when active"
 * status — no extra calls, no added turn latency: the status is a by-product of work the
 * council already does. Pure data; safe to read at any time.
 */
const liveAvailability = new MemberAvailabilityStore();

/** A member's live status for the UI: seated & healthy, on cooldown, or down. */
export type MemberLiveStatus = 'available' | 'cooldown' | 'down';

export interface MemberStatusSnapshot {
  readonly memberId: string;
  readonly status: MemberLiveStatus;
  /** Present only when not `available`. */
  readonly reason?: MemberAvailability['reason'];
  readonly detail?: string;
  readonly fixHint?: string;
  /** True while a down member is still within its retry cooldown. */
  readonly onCooldown?: boolean;
}

/**
 * Live status for a set of member ids — what the council-config API hands the UI.
 * A member with no recorded failure is `available` (green). A failed member is `down`
 * (red); if it's still inside its retry cooldown it's reported as `cooldown` (amber)
 * since the council is intentionally resting it rather than it being hard-failed.
 */
export function memberStatuses(
  memberIds: readonly string[],
  now: number = Date.now(),
): MemberStatusSnapshot[] {
  return memberIds.map((memberId) => {
    const state = liveAvailability.get(memberId);
    if (!state || state.status === 'available') return { memberId, status: 'available' };
    const onCooldown = !liveAvailability.shouldTry(memberId, now);
    return {
      memberId,
      status: onCooldown ? 'cooldown' : 'down',
      reason: state.reason,
      detail: state.detail,
      fixHint: state.fixHint,
      onCooldown,
    };
  });
}

/** User-facing fix hints for any seated member that needs the user to act (credits/auth). */
export function councilUserActionHints(): string[] {
  return liveAvailability.userActionHints();
}

/** Test/maintenance hook: clear all recorded availability state. */
export function resetCouncilAvailability(): void {
  liveAvailability.clear();
}

async function runOneMember(
  member: CouncilMember,
  input: CouncilInput,
  timeoutMs: number,
  now: () => number,
): Promise<CouncilMemberNote | null> {
  const startedAt = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`council member timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    const note = await Promise.race([member.review(input), timeout]);
    // A returned note clears any prior down-state — the member is healthy again (green).
    liveAvailability.recordSuccess(member.id);
    return note;
  } catch (error) {
    // Classify + record WHY this member is down so the council can rest it and the UI can
    // show a truthful status with a concrete fix. By-product of the run — no extra work.
    liveAvailability.recordFailure(member.id, member.displayName, error, now());
    return {
      memberId: member.id,
      memberName: member.displayName,
      topic: member.topic,
      verdict: 'needs-work',
      confidence: 0,
      realIntent: '',
      hiddenMeaning: '',
      missingCapability: '',
      suggestedAction: 'answer-directly',
      searchQuery: '',
      methodLesson: '',
      concerns: [],
      durationMs: Math.max(0, now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Fold member notes into a consensus. Pure. Failed notes are kept on `notes` for the
 * record but excluded from voting/scoring. Votes are weight-aware (`weightFor`), so a
 * topic specialist can count more than a generalist. No member "fact" is read here.
 */
export function reachConsensus(
  notes: readonly CouncilMemberNote[],
  options: { readonly escalateBelow?: number; readonly maxItems?: number; readonly weightFor?: (note: CouncilMemberNote) => number } = {},
): CouncilConsensus {
  const escalateBelow = options.escalateBelow ?? DEFAULT_ESCALATE_BELOW;
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
  const usable = notes.filter((n) => !n.error);

  if (usable.length === 0) {
    return {
      outcome: 'ship',
      agreement: 1,
      confidence: 0.5,
      realIntent: '',
      recommendedAction: 'answer-directly',
      searchQuery: '',
      missingCapabilities: [],
      methodLessons: [],
      summary: notes.length === 0
        ? 'No council convened; releasing Vai’s draft as-is.'
        : 'No council member returned a usable view; releasing Vai’s draft as-is.',
      notes,
      memberIds: [],
      factsQuarantined: true,
    };
  }

  // Per-note weight (default 1). If every weight collapses to 0, fall back to equal.
  const rawWeights = usable.map((n) => Math.max(0, options.weightFor ? options.weightFor(n) : 1));
  const totalRaw = rawWeights.reduce((s, w) => s + w, 0);
  const weights = totalRaw > 0 ? rawWeights : usable.map(() => 1);
  const weightOf = new Map(usable.map((n, i) => [n, weights[i]] as const));
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  // Weighted modal verdict (ties broken toward the more severe verdict).
  const verdictWeight = new Map<CouncilVerdict, number>();
  for (const n of usable) verdictWeight.set(n.verdict, (verdictWeight.get(n.verdict) ?? 0) + weightOf.get(n)!);
  const modalVerdict = pickModal(verdictWeight, (a, b) => VERDICT_RANK[b] - VERDICT_RANK[a]);
  const agreement = (verdictWeight.get(modalVerdict)! / totalWeight) || 0;

  // Weighted recommended action.
  const actionWeight = new Map<CouncilAction, number>();
  for (const n of usable) {
    actionWeight.set(n.suggestedAction, (actionWeight.get(n.suggestedAction) ?? 0) + weightOf.get(n)! * Math.max(0.01, n.confidence));
  }
  const recommendedAction = [...actionWeight.entries()].sort((a, b) => b[1] - a[1])[0][0];

  let outcome: CouncilOutcome;
  if (agreement < escalateBelow) outcome = 'escalate';
  else if (modalVerdict === 'good' && recommendedAction === 'answer-directly') outcome = 'ship';
  else if (recommendedAction === 'answer-directly') outcome = 'escalate';
  else outcome = 'act';

  // Weighted confidence over the modal-side members.
  const modalMembers = usable.filter((n) => n.verdict === modalVerdict);
  const modalWeight = modalMembers.reduce((s, n) => s + weightOf.get(n)!, 0);
  const confidence = clamp01(modalWeight > 0 ? modalMembers.reduce((s, n) => s + weightOf.get(n)! * n.confidence, 0) / modalWeight : 0);

  const intentSource = [...usable]
    .filter((n) => n.realIntent.trim())
    .sort((a, b) => weightOf.get(b)! * b.confidence - weightOf.get(a)! * a.confidence)[0];
  const searchSource = [...usable]
    .filter((n) => (n.suggestedAction === 'web-search' || n.suggestedAction === 'local-business-search') && n.searchQuery.trim())
    .sort((a, b) => weightOf.get(b)! * b.confidence - weightOf.get(a)! * a.confidence)[0];

  return {
    outcome,
    agreement,
    confidence,
    realIntent: (intentSource?.realIntent ?? '').trim(),
    recommendedAction,
    searchQuery: (searchSource?.searchQuery ?? '').trim(),
    missingCapabilities: rankUnique(usable.map((n) => n.missingCapability), maxItems),
    methodLessons: rankUnique(usable.map((n) => n.methodLesson), maxItems),
    summary: buildSummary(usable.length, outcome, modalVerdict, agreement, recommendedAction),
    notes,
    memberIds: usable.map((n) => n.memberId),
    factsQuarantined: true,
  };
}

/**
 * Map over items with at most `limit` running at once, preserving result order.
 * A pool, not batches: as soon as one slot frees, the next item starts — so a slow
 * member never holds up the others beyond the concurrency bound.
 */
async function runWithConcurrency<T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R>,
  limit: number,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** Run a set of already-selected members against a draft. */
export async function runCouncil(
  members: readonly CouncilMember[],
  input: CouncilInput,
  options: RunCouncilOptions = {},
): Promise<CouncilConsensus> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const concurrency = Math.max(1, options.concurrency ?? 1);
  const settled = await runWithConcurrency(
    members,
    (m) => runOneMember(m, input, timeoutMs, now),
    concurrency,
  );
  const notes = settled.filter((n): n is CouncilMemberNote => n !== null);
  const consensus = reachConsensus(notes, {
    escalateBelow: options.escalateBelow,
    maxItems: options.maxItems,
    weightFor: options.weightFor,
  });
  if (options.onConsensus) {
    try { options.onConsensus(consensus); } catch { /* observability must not break the turn */ }
  }
  return consensus;
}

export interface CouncilMemberProgress {
  readonly note?: CouncilMemberNote;
  /** Emitted immediately before a member starts reviewing — UI shows who's being asked. */
  readonly pendingMember?: { readonly name: string; readonly id: string };
  readonly partialNotes: readonly CouncilMemberNote[];
  readonly index: number;
  readonly total: number;
}

/**
 * Run council members one at a time, yielding after each response so the UI can
 * show deliberation depth instead of a static "members deliberating…" placeholder.
 */
export async function* runCouncilStreaming(
  members: readonly CouncilMember[],
  input: CouncilInput,
  options: RunCouncilOptions = {},
): AsyncGenerator<CouncilMemberProgress, CouncilConsensus> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const partialNotes: CouncilMemberNote[] = [];
  // Overall wall-clock budget: once spent, stop asking new members and finalize from the
  // notes we have. The first member is ALWAYS asked (so a single voice is always heard);
  // the deadline only gates whether to start the NEXT one.
  const deadline = options.overallDeadlineMs !== undefined ? now() + options.overallDeadlineMs : undefined;

  for (let index = 0; index < members.length; index++) {
    if (deadline !== undefined && index > 0 && now() >= deadline) break;
    const member = members[index];
    yield {
      pendingMember: { name: member.displayName, id: member.id },
      partialNotes: [...partialNotes],
      index,
      total: members.length,
    };

    const note = await runOneMember(member, input, timeoutMs, now);
    if (note) {
      partialNotes.push(note);
      yield {
        note,
        partialNotes: [...partialNotes],
        index,
        total: members.length,
      };
    }
  }

  const consensus = reachConsensus(partialNotes, {
    escalateBelow: options.escalateBelow,
    maxItems: options.maxItems,
    weightFor: options.weightFor,
  });
  if (options.onConsensus) {
    try { options.onConsensus(consensus); } catch { /* observability must not break the turn */ }
  }
  return consensus;
}

export interface ConveneResult {
  readonly topic: CouncilTopic;
  readonly assessment: SeriousnessAssessment;
  readonly convened: boolean;
  readonly consensus: CouncilConsensus;
}

/**
 * Full path: assess seriousness (skip trivia Vai is confident about) → route topic →
 * select members → run with topic-fit weighting → reach consensus → govern by stakes.
 */
export async function convene(
  input: CouncilInput,
  roster: CouncilRoster,
  options: RunCouncilOptions = {},
): Promise<ConveneResult> {
  const topic = routeTopic(input.prompt);
  const plan = councilPlan(input.prompt, input.draftConfidence);

  if (!plan.convene) {
    return {
      topic,
      assessment: plan.assessment,
      convened: false,
      consensus: {
        outcome: 'ship', agreement: 1, confidence: clamp01(input.draftConfidence ?? 0.9),
        realIntent: '', recommendedAction: 'answer-directly', searchQuery: '',
        missingCapabilities: [], methodLessons: [],
        summary: `Trivial turn — no council needed (${plan.reason}).`,
        notes: [], memberIds: [], factsQuarantined: true,
      },
    };
  }

  const members = selectMembers(topic, roster);
  // Trust weighting combines TWO signals: topic-fit (a member in its own niche counts fully) and
  // PROOF (the experiment loop) — a member that ran a test and PROVED its claim counts more; one
  // whose proof FAILED counts less. So the council leans toward verified voices over speculation.
  const weightFor = (note: CouncilMemberNote) =>
    (note.topic === topic ? 1 : OFF_TOPIC_WEIGHT) * proofTrustWeight(note.proof?.status as ProofStatus | undefined);
  const raw = await runCouncil(members, input, { ...options, weightFor });
  const consensus = governConsensus(raw, plan.assessment);
  return { topic, assessment: plan.assessment, convened: true, consensus };
}

export interface ConveneStreamingProgress extends CouncilMemberProgress {
  readonly topic: CouncilTopic;
  readonly assessment: SeriousnessAssessment;
}

/**
 * Like `convene`, but yields after each member responds so callers can stream
 * partial deliberation to the desktop ProcessTree.
 */
export async function* conveneStreaming(
  input: CouncilInput,
  roster: CouncilRoster,
  options: RunCouncilOptions = {},
): AsyncGenerator<ConveneStreamingProgress, ConveneResult> {
  const topic = routeTopic(input.prompt);
  const plan = councilPlan(input.prompt, input.draftConfidence);

  if (!plan.convene) {
    return {
      topic,
      assessment: plan.assessment,
      convened: false,
      consensus: {
        outcome: 'ship', agreement: 1, confidence: clamp01(input.draftConfidence ?? 0.9),
        realIntent: '', recommendedAction: 'answer-directly', searchQuery: '',
        missingCapabilities: [], methodLessons: [],
        summary: `Trivial turn — no council needed (${plan.reason}).`,
        notes: [], memberIds: [], factsQuarantined: true,
      },
    };
  }

  const members = selectMembers(topic, roster);
  const weightFor = (note: CouncilMemberNote) => (note.topic === topic ? 1 : OFF_TOPIC_WEIGHT);
  const stream = runCouncilStreaming(members, input, { ...options, weightFor });
  let iter = await stream.next();
  while (!iter.done) {
    yield { ...iter.value, topic, assessment: plan.assessment };
    iter = await stream.next();
  }
  const raw = iter.value;
  const consensus = governConsensus(raw, plan.assessment);
  return { topic, assessment: plan.assessment, convened: true, consensus };
}

/** Project a consensus into the UI thinking block. Carries no member facts. */
export function toCouncilThinking(
  topic: CouncilTopic,
  consensus: CouncilConsensus,
  assessment?: SeriousnessAssessment,
): CouncilThinking {
  const cc = consensus.crossCheck;
  const summary = cc?.verified
    ? `${consensus.summary} · web-confirmed${cc.confirmsValue ? ` (${cc.confirmsValue})` : ''}`
    : cc?.contradicted
      ? `${consensus.summary} · web search disagreed — redrafting`
      : consensus.summary;
  return {
    outcome: consensus.outcome,
    agreement: consensus.agreement,
    confidence: consensus.confidence,
    topic,
    summary,
    realIntent: consensus.realIntent,
    recommendedAction: consensus.recommendedAction,
    missingCapabilities: consensus.missingCapabilities,
    methodLessons: consensus.methodLessons,
    factsQuarantined: true,
    tier: assessment?.tier,
    sensitive: assessment?.sensitive,
    members: consensus.notes.map((n) => ({
      name: n.memberName,
      topic: n.topic,
      verdict: n.verdict,
      confidence: n.confidence,
      action: n.suggestedAction,
      note: n.error ? `did not respond (${n.error})` : n.realIntent || n.missingCapability || n.methodLesson || '—',
      failed: Boolean(n.error),
    })),
    crossCheck: cc,
  };
}

// ── helpers ──

function pickModal<T>(counts: Map<T, number>, tieBreak: (a: T, b: T) => number): T {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || tieBreak(a[0], b[0]))[0][0];
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.min(1, Math.max(0, v));
}

function rankUnique(items: readonly string[], cap: number): string[] {
  const order: string[] = [];
  const counts = new Map<string, { display: string; count: number; at: number }>();
  for (const raw of items) {
    // A member's parsed note can carry null/undefined/non-string entries in its
    // methodLessons / missingCapabilities arrays (model output is not guaranteed
    // clean). A bare `raw.trim()` then throws and — because conveneOnce swallows
    // errors — the ENTIRE council silently fails to attach. Coerce defensively so
    // one malformed entry can never sink the whole consensus.
    const display = typeof raw === 'string' ? raw.trim() : '';
    if (!display) continue;
    const key = display.toLowerCase();
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else { counts.set(key, { display, count: 1, at: order.length }); order.push(key); }
  }
  return order.map((k) => counts.get(k)!).sort((a, b) => b.count - a.count || a.at - b.at).slice(0, cap).map((e) => e.display);
}

function buildSummary(
  count: number,
  outcome: CouncilOutcome,
  modalVerdict: CouncilVerdict,
  agreement: number,
  action: CouncilAction,
): string {
  const who = count === 1 ? '1 member' : `${count} members`;
  const head = `${who} · ${Math.round(agreement * 100)}% agree (${modalVerdict})`;
  if (outcome === 'ship') return `${head}. Cleared Vai’s draft for release.`;
  if (outcome === 'escalate') return `${head}. No clear fix — escalating for stronger help.`;
  return `${head}. Vai should ${humanizeAction(action)} before answering.`;
}

function humanizeAction(action: CouncilAction): string {
  switch (action) {
    case 'web-search': return 'run a web search';
    case 'local-business-search': return 'look up the local listing';
    case 'reread-intent': return 're-read the real intent and redraft';
    case 'ask-one-question': return 'ask one focused question';
    default: return 'answer directly';
  }
}
