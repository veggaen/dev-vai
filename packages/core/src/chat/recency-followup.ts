import type { Message } from '../models/adapter.js';
import { isCapabilitiesFallbackResponse } from './capabilities-fallback.js';

function lastGoodAssistant(history: readonly Message[]): string {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i];
    if (m.role === 'assistant' && m.content.trim().length > 18 && !isCapabilitiesFallbackResponse(m.content)) {
      return m.content.trim();
    }
  }
  return '';
}

/**
 * "lol anyway is that still accurate in 2026?" — anchor to prior answer, hedge recency.
 */
export function tryRecencyFollowUp(input: string, history: readonly Message[]): string | null {
  if (history.length < 2) return null;
  if (!/\b(?:still\s+accurate|accurate\s+in\s+202\d|outdated|still\s+true)\b/i.test(input)) {
    return null;
  }

  const prior = lastGoodAssistant(history);
  if (!prior) {
    return 'I do not have a solid prior answer in this thread to check against — ask the factual question again and I will try to verify.';
  }

  const summary = prior
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);

  return [
    'From what I already said in this chat, the core claim still looks directionally right for 2026, but I have not re-checked live sources in this turn.',
    '',
    `Anchor: ${summary}${prior.length > 280 ? '…' : ''}`,
    '',
    'If you need a hard yes/no on currency, prices, or release status, say which detail to verify and I should look it up rather than guess.',
  ].join('\n');
}
