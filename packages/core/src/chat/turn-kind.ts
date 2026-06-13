import type { ConversationMode } from './modes.js';
import { detectInstructionConstraint, isGenerationIntent } from './chat-quality.js';
import { hasExplicitSoftwareBuildRequest, isProductEngineeringPlanningPrompt } from './product-engineering-intent.js';
import { isExplicitResearchRequest, isExplicitWebSearchRequest } from '../models/explicit-web-search.js';
import {
  isFreshLocalBusinessContactRequest,
  isFreshLocalRecommendationRequest,
  isPureConversationalTurn,
} from '../models/web-conclude-policy.js';

export type ChatTurnKind = 'conversational' | 'research' | 'builder' | 'analysis';

const LITERAL_ECHO_PATTERN =
  /^(?:say|write|send|reply|respond)\s+back\s+to\s+me\b/i;

const CREATIVE_WRITING_PATTERN =
  /\b(haiku|poem|poetry|story|short story|limerick|verse|song|rap|fiction|creative (writing|text|prompt|piece)|write (a|an|me a|me an) (haiku|poem|story|limerick|song|tale|fiction))\b/i;

const DEV_PROJECT_REVIEW_PATTERN =
  /\b( (review|audit|analyze|fix|debug|improve|refactor|make work|make (it |this |the )?(real|better|ship|finish)) (the |my |this |your )?(project|repo|code(base)?|contract|frontend|app|ui|ux|logic|staking|phase(s)?|mint(ing)?|contribution) | (hex|evm-contract|mmm| mrmanman) (but )?better | solidity (bug|issue|review) | evm (frontend|contract) (not |never )?(working|finished) | unfinished (crypto|evm|staking) )\b/i;

const SANDBOX_EDIT_PATTERN =
  /\b(?:change|edit|update|fix|polish|improve|refactor|restyle|tweak|make|apply|adjust)\b[\s\S]{0,80}\b(?:button|color|background|spacing|layout|text|font|image|animation|motion|hero|section|card|nav|page|app|ui|ux|preview|current)\b/i;

const RESEARCH_DISCOVERY_PATTERN =
  /\b(?:latest|current|today|right now|as of|recent|newest|up[-\s]?to[-\s]?date|who is top|who's top|most follow(?:ers?|ed)|most starred|highest starred|best .* github|top \d+|rank(?:ed|ing)?|on github)\b/i;

export interface ClassifyChatTurnInput {
  readonly userContent: string;
  readonly mode: ConversationMode;
  readonly hasActiveSandbox: boolean;
  readonly hasImage?: boolean;
}

export function classifyChatTurn(input: ClassifyChatTurnInput): ChatTurnKind {
  const trimmed = input.userContent.trim();
  if (!trimmed) return 'conversational';

  const turnContext = { activeMode: input.mode, hasActiveSandbox: input.hasActiveSandbox };

  // Fresh local recommendations must win before the loose gamer-slang matcher:
  // Unicode place names such as "Hommersåk" can otherwise expose a trailing
  // ASCII "k" as a standalone regex word and look like a casual-chat token.
  if (
    isFreshLocalRecommendationRequest(trimmed)
    || isFreshLocalBusinessContactRequest(trimmed)
    || isExplicitWebSearchRequest(trimmed)
    || isExplicitResearchRequest(trimmed)
  ) {
    return 'research';
  }

  if (
    !input.hasImage
    && (
      LITERAL_ECHO_PATTERN.test(trimmed)
      || isPureConversationalTurn(trimmed, turnContext)
    )
  ) {
    return 'conversational';
  }

  if (CREATIVE_WRITING_PATTERN.test(trimmed)) {
    // Creative text requests (haiku, poem, story, etc.) should be natural conversational,
    // not builder (even if "typescript" or other stack words appear in context).
    return 'conversational';
  }

  if (DEV_PROJECT_REVIEW_PATTERN.test(trimmed)) {
    // Project review, codebase audit, "fix my unfinished EVM/HEX/staking contract or frontend",
    // "make HEX but better", solidity review, etc. must go to analysis (or builder if edits)
    // so they do not get hijacked by fact-shim or url-request.
    return 'analysis';
  }

  if (isProductEngineeringPlanningPrompt(trimmed)) {
    return 'analysis';
  }

  if (
    isGenerationIntent(trimmed)
    || hasExplicitSoftwareBuildRequest(trimmed)
    || ((input.mode === 'builder' || input.mode === 'agent') && SANDBOX_EDIT_PATTERN.test(trimmed))
    || (input.hasActiveSandbox && SANDBOX_EDIT_PATTERN.test(trimmed))
  ) {
    return 'builder';
  }

  if (
    isExplicitWebSearchRequest(trimmed)
    || isExplicitResearchRequest(trimmed)
    || isFreshLocalRecommendationRequest(trimmed)
    || RESEARCH_DISCOVERY_PATTERN.test(trimmed)
  ) {
    return 'research';
  }

  if (
    !input.hasImage
    && detectInstructionConstraint(trimmed)
    && trimmed.split(/\s+/).filter(Boolean).length <= 16
  ) {
    return 'conversational';
  }

  return 'analysis';
}

export function buildTurnKindSystemHint(kind: ChatTurnKind): string | null {
  switch (kind) {
    case 'conversational':
      return [
        'This is a plain conversational turn.',
        'Answer directly, naturally, and briefly.',
        'Do not add citations, source trails, headings, or over-analysis unless the user explicitly asks for them.',
        'If the user asked for a literal echo or minimal reply, obey that exactly.',
      ].join(' ');
    case 'research':
      return [
        'This is a research or discovery turn.',
        'Prefer a grounded answer with explicit evidence, currentness awareness, and uncertainty when needed.',
        'When sources are available, let them support the answer instead of free-associating.',
      ].join(' ');
    case 'builder':
      return [
        'This is a build or edit turn.',
        'Prefer concrete changes, code, files, or next actions over citations or generic product commentary.',
      ].join(' ');
    case 'analysis':
      return [
        'This is an ordinary reasoning or factual turn.',
        "Answer the user's actual question directly before adding extra context.",
        'When web sources are available, let them support the answer instead of free-associating.',
        'If the context is ambiguous, state the narrow assumption or ask one tight clarifying question instead of guessing.',
      ].join(' ');
    default:
      return null;
  }
}
