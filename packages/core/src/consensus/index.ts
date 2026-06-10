/**
 * SCIS Consensus Council — a topic-routed council of models reviews a Vai draft,
 * reads true intent, names the missing method, and reaches an ephemeral consensus
 * (ship / act / escalate). Facts stay with Vai's tools; friends only point.
 *
 * See docs/capabilities/scis-consensus-council.md.
 */

export type {
  CouncilTopic,
  CouncilAction,
  CouncilOutcome,
  CouncilVerdict,
  CouncilInput,
  CouncilMemberNote,
  CouncilConsensus,
  CouncilMember,
  CouncilThinking,
} from './types.js';

export { routeTopic, selectMembers, type CouncilRoster } from './topic-router.js';

export {
  reachConsensus,
  runCouncil,
  convene,
  toCouncilThinking,
  type RunCouncilOptions,
} from './council.js';

export {
  createCouncilMember,
  parseCouncilNote,
  type CouncilMemberOptions,
} from './member.js';
