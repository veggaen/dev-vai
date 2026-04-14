import type { ConversationMode } from './modes.js';

/**
 * Extra system guidance when the user message likely needs a structured, scannable answer.
 * Improves multi-question, comparison, and long-context chat without affecting every turn.
 */
export const CHAT_STRUCTURE_SYSTEM_HINT = [
  'Response format hint: the user message likely benefits from a scannable answer (multiple questions, comparison, or long prompt).',
  'Put the direct takeaway in the first 1–2 sentences, then use short headings or numbered bullets.',
  'Avoid one wall of prose; keep each bullet one idea.',
].join(' ');

const MULTI_QUESTION_PATTERN = /\?[\s\S]{0,800}\?/;

const STRUCTURE_KEYWORDS_PATTERN =
  /\b(compare|versus|vs\.|\bvs\b|trade-?offs?|pros and cons|advantages and disadvantages|walk me through|step[s-]by|bullet points|checklist|enumerate|list out|break down)\b/i;

/** Drop-in retrieval threshold — slightly permissive so borderline-relevant snippets still help external models */
export const KNOWLEDGE_RETRIEVAL_SCORE_MIN = 0.04;

export function shouldInjectChatStructureHint(mode: ConversationMode, userContent: string): boolean {
  if (mode !== 'chat') return false;
  const trimmed = userContent.trim();
  if (trimmed.length < 24) return false;

  const questionMarks = (trimmed.match(/\?/g) ?? []).length;
  if (questionMarks >= 2 || MULTI_QUESTION_PATTERN.test(trimmed)) return true;

  if (STRUCTURE_KEYWORDS_PATTERN.test(trimmed)) return true;

  if (trimmed.length >= 280) return true;

  return false;
}
