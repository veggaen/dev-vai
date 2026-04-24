import type { ConversationGrounding } from './conversation-grounding.js';

export type ChatAnswerQualityVerdict = 'pass' | 'warn' | 'fail';

export interface ChatAnswerQualityInput {
  readonly prompt: string;
  readonly response: string;
  readonly grounding?: ConversationGrounding | null;
  readonly strategy?: string;
}

export interface ChatAnswerQualityRequirement {
  readonly kind: 'topic' | 'instruction' | 'actionability' | 'constraint' | 'drift';
  readonly label: string;
  readonly expected: string;
  readonly matched: boolean;
}

export interface ChatAnswerQualityReport {
  readonly verdict: ChatAnswerQualityVerdict;
  readonly score: number;
  readonly matched: readonly ChatAnswerQualityRequirement[];
  readonly missing: readonly ChatAnswerQualityRequirement[];
  readonly requirements: readonly ChatAnswerQualityRequirement[];
}

const KNOWN_DRIFT_SMELL_PATTERN = /\b(?:goroutines|slices|supergrok|swedish exam|mental health|hack the government|pathetic)\b/i;

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function topicTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9+#.-]+/i)
    .filter((token) => token.length >= 3);
}

function includesLoose(haystack: string, needle: string): boolean {
  return haystack.includes(needle.toLowerCase());
}

function hasTopicRetention(response: string, grounding: ConversationGrounding): boolean {
  const normalizedResponse = normalize(response);
  const directKeywords = [grounding.topic, ...grounding.keywords]
    .map((value) => value.trim())
    .filter((value) => value.length >= 3);
  if (directKeywords.some((keyword) => includesLoose(normalizedResponse, keyword))) {
    return true;
  }

  const matches = topicTokens(grounding.topic)
    .filter((token) => normalizedResponse.includes(token))
    .length;
  return matches >= 2;
}

function hasActionableStep(response: string): boolean {
  return /\b(?:implement|add|extract|build|gate|test|route|classif(?:y|ier)|regression|patch|bind|track|validate)\b/i.test(response);
}

function hasRequestedOutcomeCoverage(response: string, requestedOutcome: string, grounding: ConversationGrounding | null): boolean {
  const normalizedResponse = normalize(response);
  const tokens = topicTokens(requestedOutcome);
  if (tokens.length === 0) return true;
  const matchedTokens = tokens.filter((token) => normalizedResponse.includes(token)).length;
  if (matchedTokens >= Math.min(2, tokens.length)) return true;
  if (grounding === null) return false;
  return matchedTokens >= 1 && hasTopicRetention(response, grounding) && hasActionableStep(response);
}

function matchesConstraint(response: string, constraint: string): boolean {
  switch (constraint) {
    case 'Vai remains the primary answerer':
      return /\bVai\b/i.test(response) && /\b(?:primary|main)\b/i.test(response) && /\b(?:critic|verification|external LLM)\b/i.test(response);
    case 'local-first':
      return /\blocal-first\b|\boffline\b/i.test(response);
    case 'preserve current user context':
      return /\b(?:current user context|recent chat state|active topic|context brief|conversation)\b/i.test(response);
    default:
      return false;
  }
}

function buildRequirements(input: ChatAnswerQualityInput): ChatAnswerQualityRequirement[] {
  const requirements: ChatAnswerQualityRequirement[] = [];
  const prompt = normalize(input.prompt);
  const response = input.response;
  const grounding = input.grounding ?? null;

  if (grounding) {
    requirements.push({
      kind: 'topic',
      label: 'topic retention',
      expected: grounding.topic,
      matched: hasTopicRetention(response, grounding),
    });
  } else if (/\b(?:vai|chat)\b/.test(prompt) && /\b(?:relevance|accurate|accuracy|responsive|context|responses?)\b/.test(prompt)) {
    requirements.push({
      kind: 'topic',
      label: 'topic retention',
      expected: 'Vai chat response quality',
      matched: /\b(?:Vai|chat|context|relevance|accurate|responsive)\b/i.test(response),
    });
  }

  if (grounding?.requestedOutcome) {
    requirements.push({
      kind: 'instruction',
      label: 'requested outcome',
      expected: grounding.requestedOutcome,
      matched: hasRequestedOutcomeCoverage(response, grounding.requestedOutcome, grounding),
    });
  }

  if (/\b(?:best|next|implement|fix|patch|task|move|step|engineering)\b/.test(prompt)) {
    requirements.push({
      kind: 'actionability',
      label: 'actionable next move',
      expected: 'a concrete implementation step',
      matched: hasActionableStep(response),
    });
  }

  if (/\b(?:more simply|simpler|plain english|eli5|explain that)\b/.test(prompt)) {
    requirements.push({
      kind: 'instruction',
      label: 'simplification',
      expected: 'a simpler restatement',
      matched: /\b(?:simpler|plain version|plain english|hooks are how|the important context is)\b/i.test(response),
    });
  }

  for (const constraint of grounding?.constraints ?? []) {
    requirements.push({
      kind: 'constraint',
      label: 'constraint preserved',
      expected: constraint,
      matched: matchesConstraint(response, constraint),
    });
  }

  requirements.push({
    kind: 'drift',
    label: 'known drift smells',
    expected: 'no unrelated snippet leakage',
    matched: !KNOWN_DRIFT_SMELL_PATTERN.test(response),
  });

  return requirements;
}

export function evaluateChatAnswerQuality(input: ChatAnswerQualityInput): ChatAnswerQualityReport {
  const requirements = buildRequirements(input);
  const matched = requirements.filter((requirement) => requirement.matched);
  const missing = requirements.filter((requirement) => !requirement.matched);
  const score = requirements.length === 0 ? 1 : matched.length / requirements.length;
  const criticalFailure = missing.some((requirement) => requirement.kind === 'topic' || requirement.kind === 'drift');
  const verdict: ChatAnswerQualityVerdict = criticalFailure
    ? 'fail'
    : missing.length <= 1
      ? 'pass'
      : score >= 0.66
        ? 'warn'
        : 'fail';

  return {
    verdict,
    score,
    matched,
    missing,
    requirements,
  };
}