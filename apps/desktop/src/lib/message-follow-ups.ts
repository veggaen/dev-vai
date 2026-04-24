const FOLLOW_UP_STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'into', 'what', 'when', 'where', 'which',
  'should', 'would', 'could', 'there', 'their', 'about', 'after', 'before', 'while', 'have',
  'your', 'you', 'more', 'next', 'then', 'they', 'them', 'just', 'than', 'been', 'make',
  'like', 'want', 'need', 'show', 'build', 'change', 'same', 'does', 'is', 'are', 'was',
]);

function tokenizeFollowUpSeed(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[`*_[\](){}:;,.!?/\\|-]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !FOLLOW_UP_STOPWORDS.has(token));
}

function isReasonableFollowUp(question: string, content: string): boolean {
  const normalized = question.trim();
  if (normalized.length < 12 || normalized.length > 120) return false;
  if (!/[?a-z]/i.test(normalized)) return false;

  const prompty = /^(?:what|how|why|which|can|could|would|should|is|are|do|does|make|add|change|turn|show|explain)\b/i.test(normalized);
  if (!prompty) return false;

  const questionTokens = tokenizeFollowUpSeed(normalized);
  if (questionTokens.length === 0) return false;

  const contentTokens = new Set(tokenizeFollowUpSeed(content).slice(0, 80));
  const overlap = questionTokens.filter((token) => contentTokens.has(token)).length;

  if (/^(?:make|add|change|turn|show|explain)\b/i.test(normalized)) {
    return overlap >= 1 || questionTokens.length <= 5;
  }

  return overlap >= 2;
}

export interface FilterStructuredFollowUpsInput {
  readonly followUps?: readonly string[];
  readonly content: string;
  readonly isUser: boolean;
  readonly isProjectUpdate: boolean;
  readonly hasAppliedFileBlocks: boolean;
}

export function filterStructuredFollowUps(input: FilterStructuredFollowUpsInput): string[] {
  if (input.isUser) return [];

  const followUps = [...(input.followUps ?? [])];
  if (input.isProjectUpdate || input.hasAppliedFileBlocks) {
    return followUps;
  }

  return followUps.filter((question) => isReasonableFollowUp(question, input.content));
}