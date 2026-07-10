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

export {
  routeTopic,
  selectMembers,
  selectDelegatedMembers,
  explainDelegatedSelection,
  type CouncilRoster,
  type DelegatedCouncilSelectionOptions,
  type DelegatedCouncilSelection,
} from './topic-router.js';

export {
  runDraftRace,
  VAI_AUTHOR_ID,
  type RaceCandidate,
  type RaceVote,
  type DraftRaceSnapshot,
  type DraftRaceResult,
  type RunDraftRaceOptions,
} from './draft-race.js';

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
  THORSEN_TIER_RANK,
  type CouncilMemberOptions,
  type CouncilLens,
  type ThorsenTier,
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
  LOCAL_COUNCIL_ROLES,
  isRole,
  buildLocalLensMembers,
  buildRoleMembers,
  type LocalLensMembersOptions,
  type RoleSeat,
  type RoleMembersOptions,
} from './council-lenses.js';

export {
  assignModelsToRoles,
  type RoleAssignment,
} from './role-assignment.js';

export {
  deliberate,
  isDeliberationEnabled,
  buildPeerNotes,
  type DeliberationResult,
} from './deliberate.js';

export {
  MemberAvailabilityStore,
  classifyUnavailability,
  fixHintFor,
  needsUserAction,
  type MemberAvailability,
  type UnavailabilityReason,
  type MemberAvailabilitySnapshot,
} from './member-availability.js';
