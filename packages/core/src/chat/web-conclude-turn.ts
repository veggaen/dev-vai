/**
 * Policy-driven web conclusion for chat turns — no per-topic hardcoding.
 * Uses shouldConcludeWithWebSearch + SearchPipeline (duckduckgo/brave/searx).
 */

import type { Message } from '../models/adapter.js';
import { SearchPipeline } from '../search/pipeline.js';
import type { SearchResponse } from '../search/types.js';
import {
  isConversationalWebFollowUpCue,
  isFreshLocalRecommendationRequest,
  normalizeWebConclusionInput,
  shouldConcludeWithWebSearch,
  shouldDeferWebConclusionToLocalRoutes,
  shouldSkipWebConclusion,
  type WebConclusionContext,
} from '../models/web-conclude-policy.js';
import { isCapabilitiesFallbackResponse } from './capabilities-fallback.js';

export type WebConcludeDependencies = {
  readonly testMode: boolean;
  readonly search: (query: string, budgetMs: number) => Promise<SearchResponse | null>;
  readonly synthesize: (query: string, result: SearchResponse) => Promise<string>;
  readonly searchBudgetMs: number;
};

export function shouldAttemptWebConclusion(
  input: string,
  context: WebConclusionContext = {},
): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (shouldSkipWebConclusion(trimmed, context)) return false;
  return shouldConcludeWithWebSearch(trimmed, context);
}

function isContextualFollowUpFragment(input: string): boolean {
  const normalized = normalizeWebConclusionInput(input);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 14) return false;

  const cue = normalized.replace(/[.?!]+$/g, '').trim();
  return /^(?:why(?:\s+though)?|how(?:\s+so)?|go\s+(?:on|deeper)|more|shorter(?:\s+(?:pls|please))?|explain\s+(?:that\s+)?more\s+simply|ok\s+but\s+go\s+deeper\s+on\s+that|what\s+about\b.+|no\s+i\s+meant\b.+|\S.*\b(?:that|it|still\s+accurate|accurate\s+in\s+202\d|stay\s+on\s+that)\b.*)$/i.test(cue);
}

function isLocalRewriteFollowUp(input: string): boolean {
  return /^(?:(?:can|could|would)\s+you\s+)?(?:shorter(?:\s+(?:pls|please))?|explain\s+(?:that\s+)?more\s+simply|(?:show|give)\s+me\s+(?:an?\s+)?example|tell\s+me\s+more\s+about\s+that)[.?!]*$/i.test(
    normalizeWebConclusionInput(input),
  );
}

function isTerseFactRewrite(input: string): boolean {
  const normalized = normalizeWebConclusionInput(input);
  return /\b(?:only|just)\s+(?:the\s+)?(?:name|number|word|answer|year|date|symbol|city|code)\b/i.test(normalized)
    || /\b(?:name|number|word|answer|year|date|symbol|city|code)\s+only\b/i.test(normalized);
}

/** Lightweight detector for queries that benefit from community/reddit/recency bias in search. */
function isRecommendationQuery(input: string): boolean {
  const n = normalizeWebConclusionInput(input).toLowerCase();
  if (isFreshLocalRecommendationRequest(n)) return true;
  if (/\b(best|recommend|top rated|favorite|worth it|should i (?:get|buy|use)|what.*(use|buy|get))\b/.test(n)) return true;
  if (/\breview\b/.test(n) && /\b(202[5-9]|current|latest|now)\b/.test(n)) return true;
  return false;
}

function hasSubstantiveAssistantAnswer(history: readonly Message[]): boolean {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message.role !== 'assistant') continue;
    const content = message.content.trim();
    if (content.length < 12) continue;
    return !isCapabilitiesFallbackResponse(content);
  }
  return false;
}

function hasLocalOnlyDirective(history: readonly Message[]): boolean {
  return history.some((message) =>
    message.role === 'system'
    && /\b(?:from\s+(?:learned\s+)?(?:browsing\s+)?memory\s+only|only\s+(?:your\s+)?(?:learned\s+)?browsing\s+memory|no\s+web(?:\s+search)?|do\s+not\s+(?:search|google|look\s+up))\b/i.test(message.content),
  );
}

function findPriorSubstantiveUserTopic(input: string, history: readonly Message[]): string {
  const current = normalizeWebConclusionInput(input).toLowerCase();

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message.role !== 'user') continue;

    const candidate = normalizeWebConclusionInput(message.content);
    if (candidate.length <= 8 || candidate.toLowerCase() === current) continue;
    if (isContextualFollowUpFragment(candidate)) continue;
    if (isTerseFactRewrite(candidate)) continue;
    return candidate;
  }

  return '';
}

/** Expand short follow-ups using prior user context (no fixed topic list). */
export function expandQueryWithHistory(input: string, history: readonly Message[]): string {
  const current = normalizeWebConclusionInput(input);
  if (!isContextualFollowUpFragment(current)) return current;

  const prior = findPriorSubstantiveUserTopic(current, history);
  if (!prior) return current;

  if (isConversationalWebFollowUpCue(current)) return prior.slice(0, 160);

  const correction = current.match(/^no\s+i\s+meant\s+(.+?)\s+not\s+general\s+stuff[.?!]*$/i);
  if (correction) return `${prior.slice(0, 160)} ${correction[1]}`;

  return `${prior.slice(0, 160)} ${current}`;
}

/**
 * Run search pipeline + synthesis when policy says the turn should be web-grounded.
 */
export async function tryWebConcludeTurn(
  input: string,
  history: readonly Message[],
  deps: WebConcludeDependencies,
  context: WebConclusionContext = {},
): Promise<{ text: string; sources: number; searchResult: SearchResponse } | null> {
  if (deps.testMode) return null;
  if (hasLocalOnlyDirective(history)) return null;
  if (isLocalRewriteFollowUp(input)) return null;
  if (isContextualFollowUpFragment(input) && hasSubstantiveAssistantAnswer(history)) return null;
  if (shouldDeferWebConclusionToLocalRoutes(input)) return null;

  const query = expandQueryWithHistory(input, history);
  if (!shouldAttemptWebConclusion(query, context)) return null;

  // Voice/writing research augmentation: for "best/recommend" style queries
  // (very common spoken), bias the search toward community sources and
  // recent discussion so synthesis has higher-signal real-user intel rather
  // than thin wiki/generic pages. The gate + risk review still protects.
  const searchQuery = isRecommendationQuery(query)
    ? `${query} (reddit OR review OR "2025" OR "2026" OR recommendation)`
    : query;

  const result = await deps.search(searchQuery, deps.searchBudgetMs);
  if (!result || result.sources.length === 0) return null;

  let text = (await deps.synthesize(query, result)).trim();
  if (!text && result.answer.trim()) {
    text = result.answer.trim();
  }
  if (!text || isCapabilitiesFallbackResponse(text)) return null;

  return { text, sources: result.sources.length, searchResult: result };
}

export function createDefaultSearchPipeline(): SearchPipeline {
  return new SearchPipeline({
    braveApiKey: process.env.BRAVE_SEARCH_API_KEY || undefined,
    searxngUrl: process.env.VAI_SEARXNG_URL || undefined,
    fetchTimeoutMs: Number(process.env.VAI_SEARCH_FETCH_TIMEOUT_MS) || 8000,
  });
}
