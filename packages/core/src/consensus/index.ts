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
  memberStatuses,
  councilUserActionHints,
  resetCouncilAvailability,
  type RunCouncilOptions,
  type MemberLiveStatus,
  type MemberStatusSnapshot,
} from './council.js';

export {
  createCouncilMember,
  parseCouncilNote,
  type CouncilMemberOptions,
  type CouncilLens,
} from './member.js';

export {
  createCouncilContextTools,
  resolveSandboxed,
  type CouncilContextTools,
  type ContextToolLimits,
  type ReadFileResult,
  type GrepResult,
  type GrepHit,
  type ListFilesResult,
} from './context-tools.js';

export {
  gatherMemberEvidence,
  parseToolRequests,
  runToolRequest,
  EVIDENCE_TOOL_INSTRUCTIONS,
  type ToolRequest,
  type MemberEvidence,
} from './member-evidence.js';

export {
  buildMemberContextLedger,
  classifyContextItem,
  labelForRequest,
  distinctiveTokens,
  type ContextStateKind,
  type ContextItemState,
  type MemberContextLedger,
  type FetchedEvidence,
} from './context-states.js';

export {
  parseProofProposal,
  runProof,
  gatherMemberProof,
  proofTrustWeight,
  PROOF_INSTRUCTIONS,
  type ProofProposal,
  type ProofResult,
  type ProofStatus,
  type ProofRunner,
} from './member-experiment.js';

export {
  LOCAL_COUNCIL_LENSES,
  buildLocalLensMembers,
  type LocalLensMembersOptions,
} from './council-lenses.js';

export {
  MemberAvailabilityStore,
  classifyUnavailability,
  fixHintFor,
  needsUserAction,
  type MemberAvailability,
  type UnavailabilityReason,
  type MemberAvailabilitySnapshot,
} from './member-availability.js';
