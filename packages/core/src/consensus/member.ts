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

const BASE_SYSTEM = [
  "You are a 0.1%-level world-class engineer on Vai's SCIS consensus council (Vai is the deterministic engine/institution; models including you are staff).",
  'Vai prepared a draft answer but has NOT shown it to the user. You review only — do NOT answer the user and do NOT assert facts of your own (fact-quarantine is absolute).',
  'Read PAST the literal words: find the real intent, sarcasm, hidden or multiple meanings, and local abbreviations.',
  'Name precisely what CAPABILITY or METHOD Vai was missing for THIS CLASS of turn, and teach a concrete, minimal, testable way to handle it next time (teach-to-fish, never hand the answer).',
  'Ground every observation in the provided context only. Explicitly name file:line or architecture when relevant. Flag uncertainty. Never overclaim.',
  'When the turn feels stuck or the model is weak, rotate (Thorsen): suggest fast-ack paths, direct high-intel voice (pipe), human steer via visible panels, or reliable synthetic notes instead of forcing weak output.',
  'Every methodLesson must include: (a) the exact handle-next-time rule, (b) one concrete proof method (tsc, rendered visual, unit, introspect, live panel), (c) at least one named edge case.',
  'Return STRICT JSON ONLY (no markdown, no code fences, no prose) with keys:',
  '  verdict: "good" | "needs-work" | "bad"',
  '  confidence: number 0..1',
  '  realIntent: short string (what the user actually wants)',
  '  hiddenMeaning: short string (sarcasm / hidden / multiple meanings, or "")',
  '  missingCapability: short string (the method/tool Vai lacked, or "")',
  `  suggestedAction: one of ${ACTION_VALUES.map((a) => `"${a}"`).join(' | ')}`,
  '  searchQuery: short string (if a search is suggested, else "")',
  '  methodLesson: short string (how to handle this class next time + proof method + 1 edge case)',
  '  concerns: array of short strings',
].join('\n');

function buildSystemPrompt(topic: CouncilTopic, hasSelfContext: boolean): string {
  const niche: Partial<Record<CouncilTopic, string>> & { other: string } = {
    code: ' You are the code specialist: principal deterministic systems + TS/React engineer. You prize inspectable gates (tsc, CSS coverage, rendered-page proof), small high-leverage patches, no external URLs, Windows-first Node, anti-slop (measure before claiming PASS). Visual richness and human-visible process (panels) matter because humans steer with their eyes.',
    reasoning: ' You are the reasoning specialist: first-principles + edge-case hunter. You rotate around blocks by trying alternative framings (Thorsen perspective). Demand explicit proof or "unproven"; call out when small models cannot be true 0.1% experts and what deterministic compensations (structure, quarantine, human steer, direct high-intel) are needed.',
    factual: ' You are the factual specialist: precision analyst and vision verifier. Never assert un-sourced numbers/names. Always specify the exact verification method (search query, file:line to inspect, image gate). You are the council\'s vision member when screenshots or UI proof are present.',
    local: ' You are the local/on-device specialist: latency, VRAM, offline robustness, and practical small-model constraints expert. You surface what actually works on free local stacks vs what requires the direct high-intel channel or synthetic reliable notes.',
    other: ' You are the generalist collaborator: elite across the board but defer to topic specialists. Focus on cross-cutting concerns (visibility for humans, preservation of prior good work, loop closure via visible panels + backlog).',
    creative: ' You are the creative/generative specialist: high-craft output with strong taste, but still bound by Vai\'s gates (no slop, visual proof, deterministic where it counts). Help the council judge "humans like it visually" without sacrificing correctness.',
    chitchat: ' You are the conversational / presence specialist: warm, low-friction, honest about limits. You flag when a turn should stay pure conversational and bypass heavy council so the experience feels alive rather than over-engineered.',
  };
  const selfAddendum = hasSelfContext
    ? '\n\nSPECIAL MODE — Vai project self-improvement / growth turn: You are acting as a 0.1% world-class engineer + Thorsen collaborator helping grow Vai itself. The vaiProjectSelfContext below gives you real codebase pointers and the current pain. Ground every lesson in specific keyAreas or architecture. Propose only minimal, shippable, testable changes that increase Vai\'s ability to do more on its own (tool use, self-orchestration, honest diagnosis) while preserving all prior good work. Your output directly feeds human-visible panels (CouncilProgress, ThinkingPanel, LiveProcessTrace) and the improvement backlog — write so V3gga can see the debate and steer. When the pipe/bridge times out on complex self, explicitly rotate to fastSelfPrimary + direct Grok voice + synthetic reliable notes + shorter contexts.'
    : '';
  return BASE_SYSTEM + '\n\nNiche for this seat: ' + (niche[topic] || niche.other) + selfAddendum;
}

function buildUserPrompt(input: CouncilInput): string {
  const draft = input.draft.length > MAX_DRAFT_CHARS ? `${input.draft.slice(0, MAX_DRAFT_CHARS)}…[truncated]` : input.draft;
  const base = [
    `userMessage: ${JSON.stringify(input.prompt)}`,
    `vaiDraft: ${JSON.stringify(draft)}`,
    `draftFromModel: ${JSON.stringify(input.modelId)}`,
    `turnKind: ${JSON.stringify(input.turnKind)}`,
    `draftClaimsEvidence: ${input.hasEvidence}`,
    `sources: ${JSON.stringify(input.sources)}`,
  ];
  // Shared web evidence (the "web witness" / RAG step): every member reads the SAME block.
  // It informs reasoning, but fact-quarantine still holds — do NOT echo these claims to the
  // user as fact; Vai's own grounded tools own every surfaced number/name. Treat the AI
  // Overview as ONE synthesized source to corroborate or challenge, never as ground truth.
  if (input.webEvidence?.aiOverview) {
    base.push(
      '',
      'WEB EVIDENCE — Google AI Overview (synthesized summary Vai retrieved; treat as one source to verify, NOT ground truth; fact-quarantine still applies):',
      JSON.stringify(input.webEvidence.aiOverview),
      input.webEvidence.gatheredAt ? `(gathered: ${input.webEvidence.gatheredAt})` : '',
    );
  }
  const self = (input as any).vaiProjectSelfContext;
  if (self) {
    const compact = {
      goal: self.goal,
      roster: self.currentRosterSummary,
      keyAreas: self.keyAreasToInvestigateForGrowth,
      primaryAsDataPoint: self.primaryAsDataPoint,
      humanCanSeeSteer: self.humanCanSeeSteer,
      fastSelfPrimary: !!self.fastSelfPrimary,
    };
    base.push('', 'VaiProjectSelfContext (ground your methodLesson + concerns here as a 0.1% engineer growing Vai; cite specific areas):');
    base.push(JSON.stringify(compact));
    base.push('Remember: propose minimal testable improvements that increase Vai\'s own capabilities (self-debug, self-grow, better channels, richer visible process). Name proof method + edge case in every lesson. Use Thorsen rotate on stuck (fast ack, direct voice, synthetic reliable note, human steer in panels).');
  }
  base.push('', 'Return the strict JSON note now.');
  return base.join('\n');
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
      const hasSelf = !!(input as any).vaiProjectSelfContext;
      const system = buildSystemPrompt(topic, hasSelf);
      try {
        const response = await adapter.chat({
          messages: [
            { role: 'system', content: system },
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
