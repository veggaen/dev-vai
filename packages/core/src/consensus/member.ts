/**
 * Model-backed council member. Any {@link ModelAdapter} — local Qwen via Ollama or
 * a hosted specialist — becomes a member for a given topic. The prompt asks the
 * model to read the TRUE intent and name the missing method, NOT to answer or to
 * assert facts (the fact-quarantine guardrail is enforced downstream by only
 * consuming routing/method fields).
 *
 * This is the prompt validated live against qwen2.5:7b on the pb-Hommersåk case.
 */

import { z } from 'zod';
import type { ModelAdapter } from '../models/adapter.js';
import type { CouncilAction, CouncilInput, CouncilMember, CouncilMemberNote, CouncilTopic } from './types.js';

const ACTION_VALUES = ['answer-directly', 'web-search', 'local-business-search', 'reread-intent', 'ask-one-question'] as const;

const councilNoteSchema = z.object({
  verdict: z.enum(['good', 'needs-work', 'bad']),
  confidence: z.coerce.number().catch(0.5),
  realIntent: z.string().catch(''),
  hiddenMeaning: z.string().catch(''),
  missingCapability: z.string().catch(''),
  suggestedAction: z.enum(ACTION_VALUES).catch('answer-directly'),
  searchQuery: z.string().catch(''),
  methodLesson: z.string().catch(''),
  concerns: z.array(z.string()).catch([]),
});

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_TOKENS = 600;
const MAX_DRAFT_CHARS = 6_000;

const SYSTEM_PROMPT = [
  "You are a member of Vai's friend council. Vai is a local AI assistant; you are one of its trusted colleagues.",
  'Vai prepared a draft answer but has NOT shown it to the user. You review only — do NOT answer the user and do NOT assert facts of your own.',
  'Read PAST the literal words: find the real intent, sarcasm, hidden or multiple meanings, and local abbreviations.',
  'Then name what CAPABILITY or METHOD Vai was missing, and teach Vai how to handle THIS CLASS of message next time (teach to fish — do not hand over the answer).',
  'Do NOT guess specific facts (numbers, names, spellings). If a fact is needed, say which TOOL/SEARCH Vai should run; Vai will fetch it.',
  'Return STRICT JSON ONLY (no markdown, no code fences, no prose) with keys:',
  '  verdict: "good" | "needs-work" | "bad"',
  '  confidence: number 0..1',
  '  realIntent: short string (what the user actually wants)',
  '  hiddenMeaning: short string (sarcasm / hidden / multiple meanings, or "")',
  '  missingCapability: short string (the method/tool Vai lacked, or "")',
  `  suggestedAction: one of ${ACTION_VALUES.map((a) => `"${a}"`).join(' | ')}`,
  '  searchQuery: short string (if a search is suggested, else "")',
  '  methodLesson: short string (how to handle this class next time)',
  '  concerns: array of short strings',
].join('\n');

function buildUserPrompt(input: CouncilInput): string {
  const draft = input.draft.length > MAX_DRAFT_CHARS ? `${input.draft.slice(0, MAX_DRAFT_CHARS)}…[truncated]` : input.draft;
  return [
    `userMessage: ${JSON.stringify(input.prompt)}`,
    `vaiDraft: ${JSON.stringify(draft)}`,
    `draftFromModel: ${JSON.stringify(input.modelId)}`,
    `turnKind: ${JSON.stringify(input.turnKind)}`,
    `draftClaimsEvidence: ${input.hasEvidence}`,
    `sources: ${JSON.stringify(input.sources)}`,
    '',
    'Return the strict JSON note now.',
  ].join('\n');
}

function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const body = fenced ? fenced[1].trim() : trimmed;
  if (body.startsWith('{') && body.endsWith('}')) return body;
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  return first !== -1 && last > first ? body.slice(first, last + 1) : null;
}

/** Parse raw model text into a council note. Exported for tests. Returns null on garbage. */
export function parseCouncilNote(
  raw: string,
  meta: { memberId: string; memberName: string; topic: CouncilTopic; durationMs: number },
): CouncilMemberNote | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return null; }
  const result = councilNoteSchema.safeParse(parsed);
  if (!result.success) return null;
  const d = result.data;
  return {
    memberId: meta.memberId,
    memberName: meta.memberName,
    topic: meta.topic,
    verdict: d.verdict,
    confidence: clamp01(d.confidence),
    realIntent: d.realIntent.trim(),
    hiddenMeaning: d.hiddenMeaning.trim(),
    missingCapability: d.missingCapability.trim(),
    suggestedAction: d.suggestedAction as CouncilAction,
    searchQuery: d.searchQuery.trim(),
    methodLesson: d.methodLesson.trim(),
    concerns: d.concerns.map((c) => c.trim()).filter(Boolean),
    durationMs: meta.durationMs,
  };
}

export interface CouncilMemberOptions {
  readonly adapter: ModelAdapter;
  /** The niche this member is trusted for. */
  readonly topic: CouncilTopic;
  readonly id?: string;
  readonly displayName?: string;
  readonly timeoutMs?: number;
  readonly maxTokens?: number;
  readonly now?: () => number;
}

/** Turn a chat model into a topic-scoped council member. */
export function createCouncilMember(options: CouncilMemberOptions): CouncilMember {
  const { adapter, topic } = options;
  const id = options.id ?? adapter.id;
  const displayName = options.displayName ?? adapter.displayName;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const now = options.now ?? Date.now;

  return {
    id,
    displayName,
    topic,
    async review(input: CouncilInput): Promise<CouncilMemberNote | null> {
      const startedAt = now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await adapter.chat({
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserPrompt(input) },
          ],
          temperature: 0,
          maxTokens,
          signal: controller.signal,
        });
        return parseCouncilNote(response.message.content, {
          memberId: id, memberName: displayName, topic, durationMs: Math.max(0, now() - startedAt),
        });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.min(1, Math.max(0, v));
}
