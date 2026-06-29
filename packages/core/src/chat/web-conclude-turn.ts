/**
 * Policy-driven web conclusion for chat turns — no per-topic hardcoding.
 * Uses shouldConcludeWithWebSearch + SearchPipeline (duckduckgo/brave/searx).
 */

import type { ChatChunk, Message, ResearchTrace } from '../models/adapter.js';
import type { ChatTurnKind } from './turn-kind.js';
import { SearchPipeline, generateFollowUps } from '../search/pipeline.js';
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
import { resolveContextualFollowUp } from './contextual-resolver.js';
import { wantsExplicitSourceReferences } from './intent-lexicon.js';

export { wantsExplicitSourceReferences } from './intent-lexicon.js';

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
  return /^(?:why(?:\s+though)?|how(?:\s+so)?|go\s+(?:on|deeper)|more|shorter(?:\s+(?:pls|please))?|explain\s+(?:that\s+)?more\s+simply|ok\s+but\s+go\s+deeper\s+on\s+that|what\s+about\b.+|no\s+i\s+meant\b.+|\S.*\b(?:that|it|his|her|their|still\s+accurate|accurate\s+in\s+202\d|stay\s+on\s+that)\b.*)$/i.test(cue);
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
    const content = (typeof message.content === 'string' ? message.content : '').trim();
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
  const contextual = resolveContextualFollowUp(input, history);
  if (contextual) return normalizeWebConclusionInput(contextual);

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

/** Search-only path — attach sources to a model answer without replacing it. */
export type FetchTurnEvidenceOptions = {
  /** When true, still search for stable list/explain prompts so the Sources tab can populate. */
  ignoreLocalDefer?: boolean;
};

export async function fetchTurnWebEvidence(
  input: string,
  history: readonly Message[],
  deps: Pick<WebConcludeDependencies, 'testMode' | 'search' | 'searchBudgetMs'>,
  context: WebConclusionContext = {},
  options: FetchTurnEvidenceOptions = {},
): Promise<SearchResponse | null> {
  if (deps.testMode) return null;
  if (hasLocalOnlyDirective(history)) return null;
  if (isLocalRewriteFollowUp(input)) return null;
  if (isContextualFollowUpFragment(input) && hasSubstantiveAssistantAnswer(history)) return null;
  if (!options.ignoreLocalDefer && shouldDeferWebConclusionToLocalRoutes(input)) return null;

  const query = expandQueryWithHistory(input, history);
  if (!shouldAttemptWebConclusion(query, context)) return null;

  const searchQuery = isRecommendationQuery(query)
    ? `${query} (reddit OR review OR "2025" OR "2026" OR recommendation)`
    : query;

  const result = await deps.search(searchQuery, deps.searchBudgetMs);
  if (!result || result.sources.length === 0) return null;
  return result;
}

function buildSourceReferenceContract(query: string, result: SearchResponse): string {
  const sourceCount = Math.min(result.sources.length, 5);
  const sourceRange = sourceCount <= 1 ? '[1]' : `[1] through [${sourceCount}]`;
  const explicit = wantsExplicitSourceReferences(query);

  return [
    'Evidence contract:',
    `- The only citeable source numbers are ${sourceRange}.`,
    '- Use [n] markers only for claims directly supported by that numbered source; never invent source numbers, URLs, or source titles.',
    '- If the retrieved sources are thin, stale, off-topic, or disagree, say that plainly and separate evidence from inference.',
    "- Keep the answer in the user's requested style; do not turn casual prompts into a research report.",
    explicit
      ? '- The user asked for sources/citations/references, so include concise [n] markers on the key factual claims.'
      : '- Source markers are optional for casual framing, but factual/current claims from the web should carry a nearby [n].',
  ].join('\n');
}

/** Give the answering model (e.g. Qwen fallback) the retrieved web snippets. */
export function buildEvidenceContextSystemHint(query: string, result: SearchResponse): string {
  const snippets = result.sources.slice(0, 5).map((source, index) => {
    const excerpt = source.text.trim().slice(0, 320);
    return `[${index + 1}] ${source.title || source.domain} (${source.domain})\n${excerpt}\nURL: ${source.url}`;
  }).join('\n\n');

  return [
    'Web sources were retrieved for this turn.',
    'Ground factual claims in these sources when they apply.',
    buildSourceReferenceContract(query, result),
    `User question: ${query.trim()}`,
    'Sources:',
    snippets,
  ].join('\n\n');
}

function buildResearchTraceFromSearch(result: SearchResponse, sourceCount: number): ResearchTrace {
  return {
    mode: result.sync.state,
    latencyMs: result.sync.latencyMs,
    recommendedConcurrency: result.sync.recommendedConcurrency,
    rawResultCount: result.rawResultCount,
    sourceCount,
    intent: result.plan.intent,
    entities: [...result.plan.entities],
    fanOutQueries: [...result.plan.fanOutQueries],
    stages: result.audit.map((entry) => ({
      step: entry.step,
      label: entry.step,
      detail: entry.detail,
      durationMs: entry.durationMs,
    })),
  };
}

export function buildSourcesChunkFromSearch(
  query: string,
  result: SearchResponse,
  turnKind: ChatTurnKind,
): ChatChunk {
  const presented = result.sources.slice(0, 6);
  return {
    type: 'sources',
    sources: presented.map((s) => ({
      url: s.url,
      title: s.title || s.domain,
      domain: s.domain,
      snippet: s.text.slice(0, 200),
      favicon: s.favicon,
      trustTier: s.trust.tier,
      trustScore: s.trust.score,
    })),
    sourcePresentation: turnKind === 'research' ? 'research' : 'supporting',
    followUps: generateFollowUps(query, result),
    confidence: result.confidence,
    researchTrace: buildResearchTraceFromSearch(result, presented.length),
  };
}

export function createDefaultSearchPipeline(): SearchPipeline {
  return new SearchPipeline({
    braveApiKey: process.env.BRAVE_SEARCH_API_KEY || undefined,
    searxngUrl: process.env.VAI_SEARXNG_URL || undefined,
    fetchTimeoutMs: Number(process.env.VAI_SEARCH_FETCH_TIMEOUT_MS) || 8000,
  });
}
