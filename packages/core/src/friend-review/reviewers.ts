/**
 * Concrete {@link FriendReviewer} implementations.
 *
 *   - `createModelReviewer` — any {@link ModelAdapter} becomes a reviewer. This is
 *     the path for Qwen-via-Ollama (the `LocalOpenAICompatibleAdapter`) and for
 *     hosted models (Anthropic / OpenAI / Google) alike: "Qwen and other AIs".
 *   - `createGrokFriendReviewer` — wraps an external friend channel that takes a
 *     prompt string and returns a plain-text answer (e.g. the runtime's
 *     `GrokFriendClient.ask`). Kept as an injected callback so `@vai/core` stays
 *     decoupled from the runtime's CLI client.
 *
 * Both share one strict-JSON review contract so verdicts are comparable across
 * very different reviewers.
 */

import { z } from 'zod';
import type { ModelAdapter } from '../models/adapter.js';
import type { FriendReviewInput, FriendReviewer, FriendVerdict } from './types.js';

const friendVerdictSchema = z.object({
  verdict: z.enum(['good', 'needs-work', 'bad']),
  confidence: z.coerce.number().catch(0.5),
  summary: z.string().catch(''),
  concerns: z.array(z.string()).catch([]),
  suggestions: z.array(z.string()).catch([]),
  requiresFreshEvidence: z.coerce.boolean().catch(false),
});

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_TOKENS = 512;
const MAX_DRAFT_CHARS = 6_000;

const REVIEW_SYSTEM_PROMPT = [
  'You are a peer reviewer on Vai\'s friend panel. Vai is an AI assistant; you are one of its trusted friends.',
  'Vai has prepared a draft answer but has NOT shown it to the user yet. Your only job is to judge whether the draft is good.',
  'You review only. Do NOT answer the user yourself and do NOT rewrite the draft.',
  'Return STRICT JSON ONLY — no markdown, no code fences, no prose before or after — with exactly these keys:',
  '  verdict: "good" | "needs-work" | "bad"',
  '  confidence: a number from 0 to 1',
  '  summary: one short sentence explaining your verdict',
  '  concerns: array of short strings (specific problems; [] if none)',
  '  suggestions: array of short strings (concrete improvements Vai could apply; [] if none)',
  '  requiresFreshEvidence: boolean (true if the draft makes current/local claims that need fresh sources it does not have)',
  'Judge: does the draft actually answer the question, is it accurate and well-reasoned, is it appropriately grounded, and is the format/length sensible?',
  'When the draft contains code (fenced blocks or file artifacts), also judge whether the code meets the user\'s stated requirements, uses sound idioms, handles edge cases the prompt implies, and would compile or run as written. Flag missing error handling, wrong API usage, or code that ignores explicit constraints from the question.',
  'Use "bad" only for a draft that is off-topic, wrong, fabricated, or unsafe. Use "needs-work" for a releasable-but-improvable draft. Use "good" when it directly and soundly answers.',
].join('\n');

function buildReviewUserPrompt(input: FriendReviewInput): string {
  const draft = input.draft.length > MAX_DRAFT_CHARS
    ? `${input.draft.slice(0, MAX_DRAFT_CHARS)}…[truncated]`
    : input.draft;
  return [
    `userQuestion: ${JSON.stringify(input.prompt)}`,
    `candidateDraft: ${JSON.stringify(draft)}`,
    `draftFromModel: ${JSON.stringify(input.modelId)}`,
    `turnKind: ${JSON.stringify(input.turnKind)}`,
    `draftClaimsEvidence: ${input.hasEvidence}`,
    `sources: ${JSON.stringify(input.sources)}`,
    '',
    'Respond with the strict JSON verdict now.',
  ].join('\n');
}

/** Strip a leading/trailing ```json fence (and tolerate junk around the object). */
function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const body = fenced ? fenced[1].trim() : trimmed;
  if (body.startsWith('{') && body.endsWith('}')) return body;
  // Fall back to the first balanced-looking {...} span.
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  if (first !== -1 && last > first) return body.slice(first, last + 1);
  return null;
}

/**
 * Parse a reviewer's raw text into a {@link FriendVerdict}. Exported for tests
 * and for reviewers that obtain raw text by other transports. Returns `null`
 * when the output cannot be understood as a verdict.
 */
export function parseFriendVerdict(
  raw: string,
  meta: { reviewerId: string; reviewerName: string; durationMs: number },
): FriendVerdict | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const result = friendVerdictSchema.safeParse(parsed);
  if (!result.success) return null;

  const data = result.data;
  const confidence = clamp01(data.confidence);
  const summary = data.summary.trim() || defaultSummary(data.verdict);
  return {
    reviewerId: meta.reviewerId,
    reviewerName: meta.reviewerName,
    verdict: data.verdict,
    confidence,
    summary,
    concerns: data.concerns.map((c) => c.trim()).filter(Boolean),
    suggestions: data.suggestions.map((s) => s.trim()).filter(Boolean),
    requiresFreshEvidence: data.requiresFreshEvidence,
    durationMs: meta.durationMs,
  };
}

export interface ModelReviewerOptions {
  /** Any model adapter — local Qwen via Ollama, or a hosted provider. */
  readonly adapter: ModelAdapter;
  /** Override the reviewer id (defaults to the adapter id). */
  readonly id?: string;
  /** Override the display name (defaults to the adapter display name). */
  readonly displayName?: string;
  /** Hard timeout for the review call. Default 12_000ms. */
  readonly timeoutMs?: number;
  /** Max tokens for the verdict. Default 512. */
  readonly maxTokens?: number;
  /** Injectable clock for tests. Default `Date.now`. */
  readonly now?: () => number;
}

/** Turn any chat model into a friend reviewer. */
export function createModelReviewer(options: ModelReviewerOptions): FriendReviewer {
  const { adapter } = options;
  const id = options.id ?? adapter.id;
  const displayName = options.displayName ?? adapter.displayName;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const now = options.now ?? Date.now;

  return {
    id,
    displayName,
    async review(input: FriendReviewInput): Promise<FriendVerdict | null> {
      const startedAt = now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await adapter.chat({
          messages: [
            { role: 'system', content: REVIEW_SYSTEM_PROMPT },
            { role: 'user', content: buildReviewUserPrompt(input) },
          ],
          temperature: 0,
          maxTokens,
          signal: controller.signal,
        });
        return parseFriendVerdict(response.message.content, {
          reviewerId: id,
          reviewerName: displayName,
          durationMs: Math.max(0, now() - startedAt),
        });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Callback shaped like the runtime's `GrokFriendClient.ask`. */
export type FriendChannelAsk = (prompt: string) => Promise<{ response: string } | string>;

export interface GrokFriendReviewerOptions {
  /** The friend-channel call (e.g. `(p) => grokFriendClient.ask(p)`). */
  readonly ask: FriendChannelAsk;
  readonly id?: string;
  readonly displayName?: string;
  readonly now?: () => number;
}

/** Wrap an external friend channel (e.g. the Grok CLI) as a reviewer. */
export function createGrokFriendReviewer(options: GrokFriendReviewerOptions): FriendReviewer {
  const id = options.id ?? 'grok-friend-channel';
  const displayName = options.displayName ?? 'Grok (friend channel)';
  const now = options.now ?? Date.now;

  return {
    id,
    displayName,
    async review(input: FriendReviewInput): Promise<FriendVerdict | null> {
      const startedAt = now();
      const prompt = `${REVIEW_SYSTEM_PROMPT}\n\n${buildReviewUserPrompt(input)}`;
      const result = await options.ask(prompt);
      const raw = typeof result === 'string' ? result : result.response;
      return parseFriendVerdict(raw, {
        reviewerId: id,
        reviewerName: displayName,
        durationMs: Math.max(0, now() - startedAt),
      });
    },
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function defaultSummary(verdict: FriendVerdict['verdict']): string {
  switch (verdict) {
    case 'good':
      return 'The draft soundly answers the question.';
    case 'bad':
      return 'The draft has a serious problem and should not be shown as-is.';
    default:
      return 'The draft is releasable but could be improved.';
  }
}
