/**
 * Focused council review packet — the minimal high-signal payload Vai sends to
 * the SCIS council before release. Not the full chat log: only what Vai actually
 * retrieved and considered when drafting.
 */

import type { CouncilInput } from './types.js';

export type CouncilHistoryMessage = {
  readonly role: 'user' | 'assistant' | 'system' | 'tool';
  readonly content: string;
};

export type CouncilRetrievedSnippet = {
  readonly title?: string;
  readonly url?: string;
  readonly snippet?: string;
};

export interface CouncilReviewPacketDraft {
  readonly prompt: string;
  readonly draftText: string;
  readonly modelId: string;
  readonly turnKind?: string;
  readonly confidence?: number;
  readonly hasEvidence?: boolean;
  readonly sources?: readonly CouncilRetrievedSnippet[];
  readonly history?: readonly CouncilHistoryMessage[];
}

const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_CHARS = 2_400;
const MAX_MESSAGE_CHARS = 900;
const MAX_SNIPPETS = 5;
const MAX_SNIPPET_CHARS = 280;

function trimText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function salientTokens(text: string): string[] {
  return [...new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 4),
  )];
}

/** Trim chat history to recent, relevant turns — never the full thread. */
export function trimRelevantHistory(
  history: readonly CouncilHistoryMessage[] | undefined,
  prompt: string,
): readonly CouncilHistoryMessage[] {
  if (!history?.length) return [];

  const promptTokens = new Set(salientTokens(prompt));
  const scored = history.map((message, index) => {
    const overlap = salientTokens(message.content).filter((token) => promptTokens.has(token)).length;
    const recency = index / Math.max(history.length - 1, 1);
    return { message, score: overlap * 2 + recency };
  });

  const chosen = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_HISTORY_MESSAGES)
    .sort((a, b) => history.indexOf(a.message) - history.indexOf(b.message))
    .map(({ message }) => ({
      role: message.role,
      content: trimText(message.content, MAX_MESSAGE_CHARS),
    }));

  let total = 0;
  const bounded: CouncilHistoryMessage[] = [];
  for (const message of chosen) {
    if (total + message.content.length > MAX_HISTORY_CHARS) break;
    bounded.push(message);
    total += message.content.length;
  }
  return bounded;
}

/** Keep only the retrieval snippets Vai attached to this draft. */
export function trimRetrievedSnippets(
  sources: readonly CouncilRetrievedSnippet[] | undefined,
): readonly CouncilRetrievedSnippet[] {
  if (!sources?.length) return [];
  return sources.slice(0, MAX_SNIPPETS).map((source) => ({
    title: source.title?.trim() || undefined,
    url: source.url?.trim() || undefined,
    snippet: source.snippet ? trimText(source.snippet, MAX_SNIPPET_CHARS) : undefined,
  }));
}

/** One-line summary of what Vai considered important for this draft. */
export function buildContextSummary(
  draft: CouncilReviewPacketDraft,
  relevantHistory: readonly CouncilHistoryMessage[],
  retrievedSnippets: readonly CouncilRetrievedSnippet[],
): string {
  const parts: string[] = [];
  parts.push(`turn=${draft.turnKind ?? 'chat'}`);
  parts.push(`model=${draft.modelId}`);
  if (draft.confidence !== undefined) {
    parts.push(`draftConfidence=${Math.round(Math.max(0, Math.min(1, draft.confidence)) * 100)}%`);
  }
  parts.push(draft.hasEvidence ? 'evidence=attached' : 'evidence=none');
  if (relevantHistory.length) parts.push(`history=${relevantHistory.length} msg`);
  if (retrievedSnippets.length) parts.push(`snippets=${retrievedSnippets.length}`);
  if (draft.prompt.trim()) {
    parts.push(`focus=${trimText(draft.prompt.replace(/\s+/g, ' '), 120)}`);
  }
  return parts.join(' · ');
}

/** Build the focused council packet fields for {@link CouncilInput}. Pure + testable. */
export function buildCouncilReviewPacket(
  draft: CouncilReviewPacketDraft,
): Pick<CouncilInput, 'contextSummary' | 'retrievedSnippets' | 'relevantHistory'> {
  const relevantHistory = trimRelevantHistory(draft.history, draft.prompt);
  const retrievedSnippets = trimRetrievedSnippets(draft.sources);
  return {
    contextSummary: buildContextSummary(draft, relevantHistory, retrievedSnippets),
    retrievedSnippets,
    relevantHistory,
  };
}
