/**
 * Detect when a turn should go through the friend-review panel for code quality.
 * Used before release so peers can judge whether generated code meets the ask.
 */

const CODE_FENCE = /```[\s\S]+?```/;

const CODE_PROMPT_PATTERN = /\b(?:write|implement|create|build|fix|refactor|debug|show|generate|add|update|convert|port|migrate)\b[\s\S]{0,80}\b(?:code|function|component|class|script|api|hook|module|endpoint|handler|service|test|tests|sql|query|regex|algorithm)\b/i;

const CODE_LANG_PROMPT = /\b(?:typescript|javascript|python|rust|go|java|tsx?|jsx?|css|html|sql|lua|kotlin|swift)\b/i;

const CODE_ASK_PATTERN = /\b(?:how do i|how to|can you|please|need you to)\b/i;

/** User message looks like a code-generation or code-review request. */
export function isCodeGenerationPrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) return false;
  if (CODE_FENCE.test(trimmed)) return true;
  if (CODE_PROMPT_PATTERN.test(trimmed)) return true;
  if (CODE_LANG_PROMPT.test(trimmed) && CODE_ASK_PATTERN.test(trimmed)) return true;
  return false;
}

/** Draft contains a substantive code artifact (fenced block or builder file block). */
export function draftContainsCode(draft: string): boolean {
  if (!draft.trim()) return false;
  if (CODE_FENCE.test(draft)) return true;
  if (/\bfile:\s*[^\n]+\.(?:tsx?|jsx?|py|rs|go|java|css|html|sql|lua|swift|kt)\b/i.test(draft)) return true;
  return false;
}

/** Both prompt and draft warrant a peer code review before release. */
export function shouldPeerReviewCode(prompt: string, draft: string): boolean {
  return isCodeGenerationPrompt(prompt) && draftContainsCode(draft);
}
