/**
 * Friend Review Panel — runner + aggregation.
 *
 * `runFriendReviewPanel` fans a draft out to every reviewer in parallel, bounds
 * each by a timeout, tolerates individual failures (a friend who didn't answer
 * can't veto), and folds the results into one {@link FriendReviewNotice}.
 *
 * `aggregateVerdicts` is the pure policy core and is unit-tested directly.
 */

import type {
  FriendReviewInput,
  FriendReviewNotice,
  FriendReviewOutcome,
  FriendReviewer,
  FriendVerdict,
} from './types.js';

export interface RunFriendReviewPanelOptions {
  /** Per-reviewer timeout in ms. A reviewer that exceeds it is recorded as a failure. Default 12_000. */
  readonly timeoutMs?: number;
  /**
   * Minimum confidence a `bad` verdict needs to *block* the draft. Below this,
   * a `bad` verdict only pushes the panel to `revise`. Default 0.5.
   */
  readonly blockConfidence?: number;
  /** Max concerns/suggestions carried on the notice. Default 5. */
  readonly maxItems?: number;
  /**
   * Observability hook — called once with the finished notice. The runtime can
   * log it or surface the friends' suggestions in the UI. Never throws into the
   * panel (errors are swallowed).
   */
  readonly onNotice?: (notice: FriendReviewNotice) => void;
  /** Injectable clock for deterministic tests. Default `Date.now`. */
  readonly now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_BLOCK_CONFIDENCE = 0.5;
const DEFAULT_MAX_ITEMS = 5;

const VERDICT_SCORE: Record<FriendVerdict['verdict'], number> = {
  good: 1,
  'needs-work': 0.5,
  bad: 0,
};

/** Run a reviewer with a timeout, normalizing every outcome into a verdict-or-null. */
async function runOneReviewer(
  reviewer: FriendReviewer,
  input: FriendReviewInput,
  timeoutMs: number,
  now: () => number,
): Promise<FriendVerdict | null> {
  const startedAt = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`reviewer timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    const verdict = await Promise.race([reviewer.review(input), timeout]);
    return verdict;
  } catch (error) {
    // A reviewer that errored or timed out is recorded as a non-blocking failure.
    return {
      reviewerId: reviewer.id,
      reviewerName: reviewer.displayName,
      verdict: 'needs-work',
      confidence: 0,
      summary: 'Reviewer did not return a usable verdict.',
      concerns: [],
      suggestions: [],
      requiresFreshEvidence: false,
      durationMs: Math.max(0, now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Fold a set of completed verdicts into the consolidated notice. Pure: no I/O,
 * no clock. Failed verdicts (those carrying `error`) are kept for the record but
 * excluded from scoring, blocking, and the reviewer roll-call.
 */
export function aggregateVerdicts(
  verdicts: readonly FriendVerdict[],
  options: { readonly blockConfidence?: number; readonly maxItems?: number } = {},
): FriendReviewNotice {
  const blockConfidence = options.blockConfidence ?? DEFAULT_BLOCK_CONFIDENCE;
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;

  const usable = verdicts.filter((v) => !v.error);

  // No friend actually weighed in → approve by default, but say so plainly.
  if (usable.length === 0) {
    return {
      outcome: 'approved',
      score: 1,
      consensus:
        verdicts.length === 0
          ? 'No reviewers were available; releasing the draft as-is.'
          : 'No reviewer returned a usable verdict; releasing the draft as-is.',
      verdicts,
      topConcerns: [],
      topSuggestions: [],
      reviewerIds: [],
      requiresFreshEvidence: false,
      rejected: false,
    };
  }

  const blocking = usable.find((v) => v.verdict === 'bad' && v.confidence >= blockConfidence);
  const anyNegative = usable.some((v) => v.verdict !== 'good');

  let outcome: FriendReviewOutcome;
  if (blocking) outcome = 'blocked';
  else if (anyNegative) outcome = 'revise';
  else outcome = 'approved';

  const score =
    usable.reduce((sum, v) => sum + VERDICT_SCORE[v.verdict], 0) / usable.length;

  const topConcerns = rankItems(usable.flatMap((v) => v.concerns), maxItems);
  const topSuggestions = rankItems(usable.flatMap((v) => v.suggestions), maxItems);
  const requiresFreshEvidence = usable.some((v) => v.requiresFreshEvidence);

  return {
    outcome,
    score,
    consensus: buildConsensus(usable, outcome, blocking ?? null),
    verdicts,
    topConcerns,
    topSuggestions,
    reviewerIds: usable.map((v) => v.reviewerId),
    requiresFreshEvidence,
    rejected: outcome === 'blocked',
  };
}

/** Run the whole panel against one draft and return the consolidated notice. */
export async function runFriendReviewPanel(
  reviewers: readonly FriendReviewer[],
  input: FriendReviewInput,
  options: RunFriendReviewPanelOptions = {},
): Promise<FriendReviewNotice> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? Date.now;

  const settled = await Promise.all(
    reviewers.map((reviewer) => runOneReviewer(reviewer, input, timeoutMs, now)),
  );
  const verdicts = settled.filter((v): v is FriendVerdict => v !== null);

  const notice = aggregateVerdicts(verdicts, {
    blockConfidence: options.blockConfidence,
    maxItems: options.maxItems,
  });

  if (options.onNotice) {
    try {
      options.onNotice(notice);
    } catch {
      // Observability must never break the turn.
    }
  }

  return notice;
}

/** Count-then-first-seen ranking with case-insensitive dedup; trims and caps. */
function rankItems(items: readonly string[], cap: number): string[] {
  const order: string[] = [];
  const counts = new Map<string, { display: string; count: number; firstSeen: number }>();
  for (const raw of items) {
    const display = raw.trim();
    if (!display) continue;
    const key = display.toLowerCase();
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { display, count: 1, firstSeen: order.length });
      order.push(key);
    }
  }
  return order
    .map((key) => counts.get(key)!)
    .sort((a, b) => b.count - a.count || a.firstSeen - b.firstSeen)
    .slice(0, cap)
    .map((entry) => entry.display);
}

function buildConsensus(
  usable: readonly FriendVerdict[],
  outcome: FriendReviewOutcome,
  blocking: FriendVerdict | null,
): string {
  const n = usable.length;
  const friends = n === 1 ? '1 friend' : `${n} friends`;
  const good = usable.filter((v) => v.verdict === 'good').length;
  const wantsChanges = usable.filter((v) => v.verdict === 'needs-work').length;
  const rejected = usable.filter((v) => v.verdict === 'bad').length;

  const tally: string[] = [];
  if (good) tally.push(`${good} approved`);
  if (wantsChanges) tally.push(`${wantsChanges} want changes`);
  if (rejected) tally.push(`${rejected} flagged it`);

  const head = `${friends} reviewed · ${tally.join(', ')}`;
  if (outcome === 'blocked' && blocking) {
    return `${head}. Blocked: ${blocking.summary}`;
  }
  if (outcome === 'revise') {
    return `${head}. Draft is releasable but could be stronger.`;
  }
  return `${head}. Cleared for release.`;
}
