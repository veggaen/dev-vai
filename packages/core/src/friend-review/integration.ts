/**
 * Bridge the friend-review panel onto the chat service's existing
 * `ResponseReviewer` seam.
 *
 * The chat service already knows how to consult `responseReviewers` before
 * releasing a draft and to withhold a `reject`ed one (it can veto, never silently
 * rewrite — see `Master.md` review doctrine). `toResponseReviewer` packages the
 * whole panel as one such reviewer: it runs every friend, folds their verdicts
 * into a {@link FriendReviewNotice}, and maps a `blocked` notice to a veto.
 *
 * The richer notice (per-friend verdicts + consolidated suggestions) is delivered
 * through the `onNotice` hook so the runtime can log it or surface it in the UI —
 * the "notice from his friends and workers" Vai can reason from on the next pass.
 */

import type { ResponseReviewer, ResponseReviewResult } from '../chat/service.js';
import { runFriendReviewPanel, type RunFriendReviewPanelOptions } from './panel.js';
import type { FriendReviewer } from './types.js';

export interface PanelResponseReviewerOptions extends RunFriendReviewPanelOptions {
  /** Id reported back to the chat service. Default `friend-review-panel`. */
  readonly id?: string;
}

/**
 * Adapt a friend-review panel into a single {@link ResponseReviewer} for the
 * chat service. A `blocked` consensus becomes a `reject`; everything else
 * `approve`s (the draft is still releasable). The full notice is emitted via
 * `onNotice`.
 */
export function toResponseReviewer(
  reviewers: readonly FriendReviewer[],
  options: PanelResponseReviewerOptions = {},
): ResponseReviewer {
  const id = options.id ?? 'friend-review-panel';
  return {
    id,
    async review(input): Promise<ResponseReviewResult | null> {
      if (reviewers.length === 0) return null;
      const notice = await runFriendReviewPanel(reviewers, input, options);

      if (notice.reviewerIds.length === 0) {
        // Nobody actually weighed in — abstain rather than rubber-stamp.
        return null;
      }

      const headlineConcern = notice.topConcerns[0];
      if (notice.rejected) {
      return {
        decision: 'reject',
        reason: headlineConcern
          ? `${notice.consensus} — ${headlineConcern}`
          : notice.consensus,
        requiresFreshEvidence: notice.requiresFreshEvidence,
        confidence: clamp01(1 - notice.score),
        concerns: notice.topConcerns,
        suggestions: notice.topSuggestions,
      };
    }

    return {
      decision: 'approve',
      reason: notice.consensus,
      requiresFreshEvidence: notice.requiresFreshEvidence,
      confidence: clamp01(notice.score),
      concerns: notice.topConcerns,
      suggestions: notice.topSuggestions,
    };
    },
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}
