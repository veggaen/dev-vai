import type { ConversationMode } from './modes.js';
import { detectInstructionConstraint, isGenerationIntent } from './chat-quality.js';
import { isExplicitWebSearchRequest } from '../models/explicit-web-search.js';

export type ChatTurnKind = 'conversational' | 'research' | 'builder' | 'analysis';

const GREETING_PATTERN =
  /^(?:hi|hello|hey|heya|yo|sup|what'?s up|good\s+(?:morning|afternoon|evening)|thanks?|thank you|thx|nice|cool|great|sounds good|got it|understood|ok(?:ay)?)\b[!. ]*$/i;

const LITERAL_ECHO_PATTERN =
  /^(?:say|write|send|reply|respond)\s+back\s+to\s+me\b/i;

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

  if (!input.hasImage && (GREETING_PATTERN.test(trimmed) || LITERAL_ECHO_PATTERN.test(trimmed))) {
    return 'conversational';
  }

  if (
    isGenerationIntent(trimmed)
    || ((input.mode === 'builder' || input.mode === 'agent') && SANDBOX_EDIT_PATTERN.test(trimmed))
    || (input.hasActiveSandbox && SANDBOX_EDIT_PATTERN.test(trimmed))
  ) {
    return 'builder';
  }

  if (
    isExplicitWebSearchRequest(trimmed)
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
        'Do not force research/source-trail chrome; use sources only when they genuinely support the answer.',
        'If the context is ambiguous, state the narrow assumption or ask one tight clarifying question instead of guessing.',
      ].join(' ');
    default:
      return null;
  }
}
