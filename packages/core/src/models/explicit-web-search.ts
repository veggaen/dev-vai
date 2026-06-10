import {
  isExplicitResearchRequest,
  isExplicitWebSearchRequest as isExplicitWebSearchRequestCore,
  shouldConcludeWithWebSearch,
  shouldSkipWebConclusion,
  type WebConclusionContext,
} from './web-conclude-policy.js';

export function isExplicitWebSearchRequest(input: string): boolean {
  const normalized = input.toLowerCase().trim();

  return isExplicitWebSearchRequestCore(normalized) || [
    /\b(?:do|please)\s+research(?:\s+(?:on|into|about|this|that|it))?\b/i,
    /\b(?:look|find)\s+(?:it|that|this)\s+up\b/i,
    /\bcheck\s+(?:online|the\s+web|sources?)\b/i,
    /\bverify\s+(?:online|with\s+sources?)\b/i,
  ].some((pattern) => pattern.test(normalized));
}

export {
  isExplicitResearchRequest,
  shouldConcludeWithWebSearch,
  shouldSkipWebConclusion,
  type WebConclusionContext,
};
