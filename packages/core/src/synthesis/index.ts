export { synthesizeFromEvidence } from './synthesize.js';
export type {
  EvidenceItem,
  SynthesizedClaim,
  SynthesizedContradiction,
  SynthesisResult,
  SynthesizeOptions,
} from './synthesize.js';
export { gitEvidenceToItems } from './git-adapter.js';
export {
  webEvidenceToItems,
  aiOverviewToItem,
  pageEvidenceToItems,
  notesToItems,
} from './source-adapters.js';
export type { WebSourceLike, NoteLike, CrossSourceInputs } from './source-adapters.js';
export {
  synthesizeAcrossSources,
  formatSummaryBrief,
  formatContradictions,
  formatDecisionRecord,
} from './synthesize-across.js';
export type { CrossSourceSynthesis } from './synthesize-across.js';
