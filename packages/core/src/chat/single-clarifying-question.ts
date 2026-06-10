/**
 * Honor an explicit request for one uncertainty-reducing question before
 * proposing or building. Returning one question is the full response contract.
 */
export function tryEmitSingleClarifyingQuestion(input: string): string | null {
  const lower = input.toLowerCase();
  const asksForOneQuestion = /\bask(?:\s+me)?\b[\s\S]{0,120}\b(?:single|one)\b[\s\S]{0,40}\bquestion\b/i.test(lower)
    || /\b(?:single|one)\b[\s\S]{0,40}\bquestion\b[\s\S]{0,140}\b(?:before|clarif|reduce[\s\S]{0,24}\buncertainty)\b/i.test(lower);
  if (!asksForOneQuestion) return null;

  if (/\b(bridge|humans?|ai|tools?|robots?|endpoints?|adapters?)\b/i.test(lower)) {
    return 'Which exact two endpoints should Vai connect first, and what concrete message must travel between them end to end?';
  }

  if (/\b(build|create|implement|ship|scaffold|app|feature)\b/i.test(lower)) {
    return 'What is the smallest runnable outcome the first implementation must let a user complete end to end?';
  }

  return 'What concrete outcome should work end to end first?';
}
