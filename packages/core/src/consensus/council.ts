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
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_ESCALATE_BELOW = 0.5;
const DEFAULT_MAX_ITEMS = 5;
/** Off-specialty members still count, but less — the council's trust-weighting rule. */
const OFF_TOPIC_WEIGHT = 0.6;

const VERDICT_RANK: Record<CouncilVerdict, number> = { good: 0, 'needs-work': 1, bad: 2 };

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
    return await Promise.race([member.review(input), timeout]);
  } catch (error) {
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
    realIntent: intentSource?.realIntent.trim() ?? '',
    recommendedAction,
    searchQuery: searchSource?.searchQuery.trim() ?? '',
    missingCapabilities: rankUnique(usable.map((n) => n.missingCapability), maxItems),
    methodLessons: rankUnique(usable.map((n) => n.methodLesson), maxItems),
    summary: buildSummary(usable.length, outcome, modalVerdict, agreement, recommendedAction),
    notes,
    memberIds: usable.map((n) => n.memberId),
    factsQuarantined: true,
  };
}

/** Run a set of already-selected members against a draft. */
export async function runCouncil(
  members: readonly CouncilMember[],
  input: CouncilInput,
  options: RunCouncilOptions = {},
): Promise<CouncilConsensus> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const settled = await Promise.all(members.map((m) => runOneMember(m, input, timeoutMs, now)));
  const notes = settled.filter((n): n is CouncilMemberNote => n !== null);
  const consensus = reachConsensus(notes, { escalateBelow: options.escalateBelow, maxItems: options.maxItems, weightFor: options.weightFor });
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
  // Topic-fit trust weighting: a member reviewing in its own niche counts fully.
  const weightFor = (note: CouncilMemberNote) => (note.topic === topic ? 1 : OFF_TOPIC_WEIGHT);
  const raw = await runCouncil(members, input, { ...options, weightFor });
  const consensus = governConsensus(raw, plan.assessment);
  return { topic, assessment: plan.assessment, convened: true, consensus };
}

/** Project a consensus into the UI thinking block. Carries no member facts. */
export function toCouncilThinking(
  topic: CouncilTopic,
  consensus: CouncilConsensus,
  assessment?: SeriousnessAssessment,
): CouncilThinking {
  return {
    outcome: consensus.outcome,
    agreement: consensus.agreement,
    confidence: consensus.confidence,
    topic,
    summary: consensus.summary,
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
    const display = raw.trim();
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
