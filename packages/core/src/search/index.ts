/**
 * Search Module Barrel Export
 *
 * Perplexity-style structured search pipeline with embedded safety layers.
 */

// Pipeline
export { SearchPipeline, buildSearchPlan, generateFollowUps } from './pipeline.js';

// Safety & Trust
export {
  validateSearchUrl,
  scoreDomain,
  scanContentSafety,
  contentFingerprint,
  assessUrl,
} from './safety.js';
export type { UrlAssessment } from './safety.js';

// Types
export type {
  VaiSearchPlan,
  SearchConstraints,
  TrustTier,
  TrustSignal,
  SearchSnippet,
  SearchResponse,
  AuditEntry,
  SearchPipelineConfig,
  OnSearchLearn,
} from './types.js';
export { DEFAULT_SEARCH_CONFIG } from './types.js';
