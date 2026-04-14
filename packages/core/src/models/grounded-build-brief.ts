import type { GroundedBuildBrief } from './adapter.js';
import type { SearchResponse } from '../search/types.js';

const BUILD_ACTION_RE = /\b(?:build|create|make|start|launch|scaffold|generate|ship|prototype|remake|implement)\b/i;
const EDIT_ACTION_RE = /\b(?:edit|update|upgrade|improve|extend|fix|change|refactor|add|polish)\b/i;
const PRODUCT_TARGET_RE = /\b(?:app|project|site|website|dashboard|tool|workspace|builder|platform|flow|shell|feature|experience|preview)\b/i;
const GOAL_RE = /\b(?:want|trying|planning|plan|vision|direction|roadmap)\b/i;
const COMPARISON_RE = /\b(?:vs\.?|versus|compare|comparison|hybrid|blend|combine|combined|plus)\b/i;

const FOCUS_NOISE = new Set([
  'app',
  'project',
  'site',
  'website',
  'dashboard',
  'tool',
  'workspace',
  'builder',
  'platform',
  'flow',
  'shell',
  'feature',
  'experience',
  'preview',
  'product',
]);

const FOCUS_ENTITY_NOISE = new Set([
  'compare',
  'comparison',
  'current project',
  'current app',
  'current product',
  'existing project',
  'existing app',
  'product loop',
  'product loops',
  'research loop',
  'research loops',
  'chat-to-build loop',
  'grounded research loop',
]);

const FOCUS_TOKEN_NOISE = new Set([
  'compare',
  'comparison',
  'current',
  'existing',
  'project',
  'app',
  'product',
  'products',
  'loop',
  'loops',
  'strongest',
  'best',
  'first',
  'latest',
  'current',
  'grounded',
  'research',
  'chat-to-build',
  'chat',
  'build',
  'style',
]);

function uniqueDomains(searchResult: SearchResponse): string[] {
  return Array.from(new Set(
    searchResult.sources
      .map((source) => source.domain.replace(/^www\./, ''))
      .filter(Boolean),
  )).slice(0, 3);
}

function domainToFocusLabel(domain: string): string {
  return domain
    .replace(/^www\./, '')
    .split('.')[0]
    .replace(/[^a-z0-9.+#-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function joinNatural(values: readonly string[]): string {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function deriveIntent(input: string): GroundedBuildBrief['intent'] {
  return EDIT_ACTION_RE.test(input) && !BUILD_ACTION_RE.test(input) ? 'edit' : 'build';
}

function normalizeFocusEntity(entity: string, sourceLabels: readonly string[]): string | null {
  const normalized = entity
    .replace(/[’]/g, "'")
    .replace(/\b([a-z0-9.+#-]+)'s\b/gi, '$1')
    .replace(/[^a-z0-9.+#/\-\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return null;

  const lower = normalized.toLowerCase();
  if (FOCUS_NOISE.has(lower) || FOCUS_ENTITY_NOISE.has(lower)) {
    return null;
  }

  const sourceMatch = sourceLabels.find((label) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(normalized);
  });
  if (sourceMatch) {
    return sourceMatch;
  }

  const filteredTokens = normalized
    .split(/\s+/)
    .filter((token) => !FOCUS_TOKEN_NOISE.has(token.toLowerCase()));

  if (filteredTokens.length === 0) return null;

  const candidate = filteredTokens.join(' ').trim();
  if (!candidate) return null;

  const candidateLower = candidate.toLowerCase();
  if (FOCUS_NOISE.has(candidateLower) || FOCUS_ENTITY_NOISE.has(candidateLower)) {
    return null;
  }

  return candidateLower;
}

function looksLikeGroundedBuildRequest(input: string, activeMode: string): boolean {
  const hasAction = BUILD_ACTION_RE.test(input) || EDIT_ACTION_RE.test(input);
  const hasGoalFraming = GOAL_RE.test(input) && PRODUCT_TARGET_RE.test(input);
  const hasProductShape = PRODUCT_TARGET_RE.test(input) && COMPARISON_RE.test(input);

  if (activeMode === 'builder' || activeMode === 'agent') {
    return hasAction || hasGoalFraming || hasProductShape;
  }

  return hasAction && PRODUCT_TARGET_RE.test(input);
}

function deriveFocusLabel(searchResult: SearchResponse, input: string): string {
  const sourceLabels = uniqueDomains(searchResult)
    .map((domain) => domainToFocusLabel(domain))
    .filter((label) => label.length > 1);

  const meaningfulEntities = Array.from(new Set(
    searchResult.plan.entities
      .map((entity) => normalizeFocusEntity(entity, sourceLabels))
      .filter((entity): entity is string => Boolean(entity)),
  ));

  if (searchResult.plan.intent === 'comparison' && meaningfulEntities.length >= 2) {
    return truncate(`${meaningfulEntities[0]} + ${meaningfulEntities[1]}`, 56);
  }

  if (meaningfulEntities.length > 0) {
    return truncate(meaningfulEntities.slice(0, 2).join(' + '), 56);
  }

  if (searchResult.plan.intent === 'comparison' && sourceLabels.length >= 2) {
    return truncate(`${sourceLabels[0]} + ${sourceLabels[1]}`, 56);
  }

  return truncate(searchResult.plan.originalQuery || input, 56);
}

export function buildGroundedBuildBrief(
  input: string,
  activeMode: string,
  searchResult: SearchResponse,
): GroundedBuildBrief | null {
  if (searchResult.sources.length === 0) return null;

  const normalizedInput = input.trim();
  if (!looksLikeGroundedBuildRequest(normalizedInput, activeMode)) {
    return null;
  }

  const intent = deriveIntent(normalizedInput);
  const focusLabel = deriveFocusLabel(searchResult, normalizedInput);
  const sourceDomains = uniqueDomains(searchResult);
  const isComparison = searchResult.plan.intent === 'comparison' || COMPARISON_RE.test(normalizedInput);
  const roundedConfidence = Math.max(0, Math.min(1, searchResult.confidence));
  const confidenceLabel = `${Math.round(roundedConfidence * 100)}%`;

  const summary = intent === 'edit'
    ? `Use the research on ${focusLabel} to guide a narrow update to the current app instead of restarting the build.`
    : isComparison
      ? `Use the research on ${focusLabel} to choose one canonical product loop before expanding the surface area.`
      : `Use the research on ${focusLabel} to shape the next runnable slice before writing more code.`;

  const recommendation = intent === 'edit'
    ? 'Keep the current preview and apply a diff-first change that follows the cited constraints.'
    : isComparison
      ? 'Pick one core interaction to own first, then let the other ideas act as supporting features instead of parallel product branches.'
      : 'Start with one grounded MVP slice that matches the strongest sources, then layer complexity after the preview works.';

  const nextStep = intent === 'edit'
    ? 'Emit changed files for the current sandbox and keep the update reversible.'
    : activeMode === 'builder' || activeMode === 'agent'
      ? 'Emit runnable files or a starter action for the first grounded slice now.'
      : 'Switch into an execution turn and scaffold the first grounded slice instead of staying in advice mode.';

  const reasons: string[] = [];
  if (sourceDomains.length > 0) {
    reasons.push(`Most of the supporting evidence came from ${joinNatural(sourceDomains)}.`);
  }
  reasons.push(`The search plan concentrated on ${focusLabel}.`);
  if (isComparison) {
    reasons.push('The prompt mixes multiple product ideas, so the first build should choose one canonical loop.');
  }
  reasons.push(
    roundedConfidence >= 0.72
      ? `Confidence is ${confidenceLabel}, which is strong enough to move straight into a runnable slice.`
      : `Confidence is ${confidenceLabel}, so keep the first slice small, testable, and easy to revise.`,
  );

  return {
    intent,
    focusLabel,
    summary,
    recommendation,
    nextStep,
    reasons: reasons.slice(0, 3),
    sourceDomains,
    sourceCount: searchResult.sources.length,
    confidence: roundedConfidence,
  };
}