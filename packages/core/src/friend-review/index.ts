/**
 * Friend Review Panel — a panel of independent AIs ("friends and workers") that
 * review a Vai draft before it reaches the user, and return one consolidated
 * notice Vai can reason from.
 *
 * See docs/capabilities/friend-review-panel.md.
 */

export type {
  FriendVerdictKind,
  FriendReviewOutcome,
  FriendReviewInput,
  FriendVerdict,
  FriendReviewNotice,
  FriendReviewer,
} from './types.js';

export {
  runFriendReviewPanel,
  aggregateVerdicts,
  type RunFriendReviewPanelOptions,
} from './panel.js';

export {
  createModelReviewer,
  createGrokFriendReviewer,
  parseFriendVerdict,
  type ModelReviewerOptions,
  type GrokFriendReviewerOptions,
  type FriendChannelAsk,
} from './reviewers.js';

export {
  toResponseReviewer,
  type PanelResponseReviewerOptions,
} from './integration.js';
