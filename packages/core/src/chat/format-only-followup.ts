import type { Message } from '../models/adapter.js';
import { isCapabilitiesFallbackResponse } from './capabilities-fallback.js';

function stripDecorations(input: string): string {
  return input
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lastSubstantiveAssistant(history: readonly Message[]): string {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i];
    if (m.role !== 'assistant' || typeof m.content !== 'string') continue;
    const t = m.content.trim();
    if (
      !t
      || isCapabilitiesFallbackResponse(t)
      || /\bsearched the open web\b[\s\S]*\bdidn'?t get back anything solid\b/i.test(t)
      || /\b(?:do not have|there is no single) (?:a )?grounded name or number\b/i.test(t)
    ) continue;
    return t;
  }
  return '';
}

function lastUserTopic(history: readonly Message[]): string {
  const users = history.filter((m) => m.role === 'user' && m.content.trim().length > 8);
  if (users.length < 2) return users[0]?.content.trim() ?? '';
  return users[users.length - 2]!.content.trim();
}

const UNIT_ALIASES = [
  { key: 'm/s', pattern: /(?:m\/s|met(?:er|re)s?\s+per\s+second)/i },
  { key: 'km/h', pattern: /(?:km\/h|kilomet(?:er|re)s?\s+per\s+hour)/i },
  { key: 'mph', pattern: /(?:mph|miles?\s+per\s+hour)/i },
  { key: 'kg', pattern: /(?:kg|kilograms?)/i },
  { key: '%', pattern: /(?:%|percent)/i },
] as const;

function extractUnitAnchoredNumber(input: string, text: string): string | null {
  const requestedUnit = UNIT_ALIASES.find((unit) => unit.pattern.test(input));
  if (!requestedUnit) return null;

  const numberWithUnit = new RegExp(
    `\\b(\\d[\\d,.]*)\\s*(?:${requestedUnit.pattern.source})\\b`,
    'gi',
  );
  const matches = [...text.matchAll(numberWithUnit)]
    .map((match) => match[1].replace(/,/g, ''))
    .filter(Boolean);
  const values = [...new Set(matches)];
  return values.length === 1 ? values[0] : null;
}

function extractTerseFact(text: string, input: string): string | null {
  const compact = text.trim().replace(/[.!]+$/g, '').trim();
  if (
    compact.length > 0
    && compact.length <= 60
    && compact.split(/\s+/).length <= 3
    && !/[*`\n]/.test(compact)
    && !/\b(?:do not have|don't have|not sure|cannot|can't|unable|no single)\b/i.test(compact)
  ) {
    return compact;
  }

  const unitAnchoredNumber = extractUnitAnchoredNumber(input, text);
  if (unitAnchoredNumber) return unitAnchoredNumber;

  const wantsNumber = /\b(?:only|just)\s+(?:the\s+)?number\b|\bnumber\s+only\b/i.test(input);
  const wantsYear = /\b(?:only|just)\s+(?:the\s+)?(?:year|date)\b|\b(?:year|date)\s+only\b/i.test(input);
  const numbers = [...text.matchAll(/\b\d[\d,.]*\b/g)]
    .map((match) => match[0].replace(/,/g, ''));
  const uniqueNumbers = [...new Set(numbers)];

  if (wantsYear) {
    const years = uniqueNumbers.filter((number) => /^\d{4}$/.test(number));
    return years.length === 1 ? years[0] : null;
  }
  if (wantsNumber) {
    return uniqueNumbers.length === 1 ? uniqueNumbers[0] : null;
  }

  const bold = [...text.matchAll(/\*\*([^*]{1,60})\*\*/g)]
    .map((m) => m[1].trim())
    .filter((b) => !/^(?:what i can do|executive takeaway|practical move|grounded|continuing from|more detail|sources?|confidence|key points?|in simple words|what it does)/i.test(b));
  if (bold.length > 0) {
    const head = bold[0].replace(/[:.]+$/g, '').trim();
    if (head.split(/\s+/).length <= 8) return head;
  }

  const capital = text.match(/\bthe capital of [^.\n]+ is \*\*([^*]+)\*\*/i);
  if (capital) return capital[1].trim();

  return null;
}

function isShortVersionFollowUp(input: string): boolean {
  return /^(?:shorter(?:\s+(?:please|pls))?|short(?:est)?\s+version|brief\s+version|quick\s+version|one[- ]liner|one\s+sentence|tl;?dr|summary)[.?!]*$/i.test(
    stripDecorations(input),
  );
}

function extractShortVersion(text: string): string | null {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\n+\*\*Sources\*\*[\s\S]*$/i, '')
    .replace(/\[[^\]]+\]\([^)]+\)/g, ' ')
    .replace(/\s*\[\d+\]/g, '')
    .replace(/\*\*/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^(?:cross-checked across\b|in simple words:?$|what it does:?$|sources?:?$|confidence:?\b)/i.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;

  const sentence = cleaned.match(/^(.{12,280}?[.!?])(?:\s|$)/)?.[1] ?? cleaned.slice(0, 280);
  return sentence.trim() || null;
}

export function isFormatOnlyFollowUp(input: string): boolean {
  const cleaned = stripDecorations(input);
  return isShortVersionFollowUp(cleaned)
    || /\b(?:only|just)\s+(?:the\s+)?(?:name|number|word|answer|year|date|symbol|city|code)\b/i.test(cleaned)
    || /\b(?:name|number|word|answer|year|date|symbol|city|code)\s+only\b/i.test(cleaned);
}

function asksNewSubstantiveQuestion(input: string): boolean {
  const cleaned = stripDecorations(input);
  if (!/(?:^|\band\s+|[.!?]\s+)(?:what|who|which|where|when|why|how|does|do|did|is|are|can|could|would|should)\b/i.test(cleaned)) {
    return false;
  }
  if (/\b(?:again|previous|prior|earlier|same|repeat|restate|that\s+answer|it)\b/i.test(cleaned)) {
    return false;
  }
  return true;
}

/**
 * Honor "only the name/number" follow-ups using the prior assistant answer.
 */
export function tryFormatOnlyFollowUp(
  input: string,
  history: readonly Message[],
): string | null {
  if (!isFormatOnlyFollowUp(input)) return null;
  if (asksNewSubstantiveQuestion(input)) return null;
  if (history.length < 2) return null;
  if (!history.some((message) => message.role === 'assistant' && message.content.trim().length > 0)) return null;

  const prior = lastSubstantiveAssistant(history);
  if (!prior) {
    return isShortVersionFollowUp(input)
      ? 'I do not have a grounded answer to shorten yet. Ask the question again and I will answer it first.'
      : 'I do not have a grounded name or number to shorten yet. Ask the factual question again and I will verify it first.';
  }

  if (isShortVersionFollowUp(input)) {
    const short = extractShortVersion(prior);
    return short ? `**Short version**\n${short}` : null;
  }

  const terse = extractTerseFact(prior, input);
  if (terse) return terse;

  return 'There is no single grounded name or number in the prior answer to shorten.';
}
