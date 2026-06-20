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
import type { CouncilContextTools } from './context-tools.js';
import { gatherMemberEvidence, type MemberEvidence } from './member-evidence.js';
import { buildMemberContextLedger } from './context-states.js';
import { gatherMemberProof, type ProofRunner } from './member-experiment.js';

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
// Thinking models burn most of their budget inside their reasoning channel; they need
// enough num_predict to FINISH thinking AND still emit the structured JSON note after it.
// Measured on deepseek-r1:8b for a council review: the think phase alone runs ~2k tokens
// (~8k chars). A 2k cap was cut off mid-think (done_reason=length, empty content → the
// member was dropped). 5k leaves clear headroom for the reasoning + the JSON note.
const THINKING_MODEL_MAX_TOKENS = 5_000;
// Generating ~5k tokens of reasoning + the note takes longer than a non-thinking member's
// terse reply, so a thinking model needs a higher timeout FLOOR or it aborts mid-think and
// is excluded — the exact failure that kept deepseek-r1 out of the panel.
const THINKING_MODEL_TIMEOUT_MS = 60_000;
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
  if (input.contextSummary) {
    base.push('', `contextSummary: ${JSON.stringify(input.contextSummary)}`);
  }
  if (input.relevantHistory?.length) {
    base.push('', 'relevantHistory (trimmed — only what Vai considered for this draft, not the full thread):');
    base.push(JSON.stringify(input.relevantHistory));
  }
  if (input.retrievedSnippets?.length) {
    base.push('', 'retrievedSnippets (only what Vai retrieved and used):');
    base.push(JSON.stringify(input.retrievedSnippets));
  }
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

/**
 * A review "lens" — an extra framing layered on the base/niche system prompt so the SAME local
 * model produces an independent angle on the draft. Running one local model through several
 * lenses gives the council genuine diversity with no extra models and no paid voices. Each lens
 * becomes its own council member (distinct id/displayName), so its note is mixed and re-judged
 * alongside the others. Temperature is nudged off 0 per-lens so the angles don't collapse onto
 * the same deterministic completion.
 */
export interface CouncilLens {
  /** Stable id suffix, e.g. 'skeptic'. */
  readonly id: string;
  /** Human label shown in the council/timeline UI, e.g. 'Skeptic'. */
  readonly label: string;
  /** Extra system-prompt framing appended after the niche addendum. */
  readonly framing: string;
  /** Sampling temperature for this angle (default 0 for the base lens, higher for variety). */
  readonly temperature?: number;
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
  /** Optional review lens (multi-angle local council). */
  readonly lens?: CouncilLens;
  /**
   * Optional read-only context tools (the "pull model"). When provided, the member runs one
   * evidence round before voting — fetching the files/greps its lens judges relevant and
   * grounding its note in what it verified. When absent, the member votes from the prompt
   * context alone (current behavior), so this is fully backward-compatible.
   */
  readonly contextTools?: CouncilContextTools;
  /**
   * Optional proof runner (the experiment loop). When provided, after drafting its note the
   * member may propose ONE allowlisted command to PROVE its claim; the verified result is
   * attached to the note and boosts/discounts the member's trust. Absent = no proof round
   * (current behavior). The runner is injected (matches runCommandEvidence) so it stays safe
   * and testable. Typically only seated for self-improvement / code turns.
   */
  readonly proofRunner?: ProofRunner;
  /** Working directory for proof commands (defaults to cwd in the runner). */
  readonly proofCwd?: string;
}

/** Turn a chat model into a topic-scoped council member. */
export function createCouncilMember(options: CouncilMemberOptions): CouncilMember {
  const { adapter, topic, lens, contextTools, proofRunner, proofCwd } = options;
  const id = options.id ?? adapter.id;
  const displayName = options.displayName ?? adapter.displayName;
  // Thinking models (DeepSeek-R1 et al.) emit a long <think> block before their answer
  // — and distilled-R1 does so even with think=false. With the normal 600-token budget
  // the entire allowance is spent inside <think>, leaving NOTHING after stripping → an
  // empty note → the member is silently excluded (the "deepseek seated but never
  // responds" bug). Give thinking-capable models room to think AND emit the JSON note,
  // plus more wall-clock (generating ~2k tokens of reasoning takes longer than a qwen's
  // terse note). Both are floors: an explicit option/env still wins when larger.
  const isThinkingModel = adapter.capabilities?.extendedThinking === true;
  const baseTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutMs = isThinkingModel ? Math.max(baseTimeoutMs, THINKING_MODEL_TIMEOUT_MS) : baseTimeoutMs;
  const baseMaxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxTokens = isThinkingModel ? Math.max(baseMaxTokens, THINKING_MODEL_MAX_TOKENS) : baseMaxTokens;
  const now = options.now ?? Date.now;
  const temperature = lens?.temperature ?? 0;

  return {
    id,
    displayName,
    topic,
    // Surfaced so the council's OUTER per-member timeout extends for this member too — the
    // internal review budget below is not enough on its own (a separate Promise.race in
    // runOneMember also bounds the call, and at 30s it aborted DeepSeek mid-think).
    slowThinking: isThinkingModel,
    async review(input: CouncilInput): Promise<CouncilMemberNote | null> {
      const startedAt = now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const hasSelf = !!(input as any).vaiProjectSelfContext;
      const baseSystem = buildSystemPrompt(topic, hasSelf);
      const system = lens
        ? `${baseSystem}\n\nREVIEW LENS — ${lens.label}: ${lens.framing}\nStay in this lens: it is WHY you are a distinct voice on this panel. Still return the same strict JSON note.`
        : baseSystem;
      try {
        let userPrompt = buildUserPrompt(input);
        let fetched: MemberEvidence['fetched'] = [];

        // Pull-model evidence round: when context tools are seated, the member fetches the
        // files/greps its lens needs and grounds its note in what it verified. Best-effort —
        // gatherMemberEvidence never throws, so a failed fetch just means voting without it.
        if (contextTools) {
          const evidence = await gatherMemberEvidence(adapter, input, contextTools, {
            system,
            question: input.prompt,
            signal: controller.signal,
          });
          fetched = evidence.fetched;
          if (evidence.block) userPrompt = `${userPrompt}\n\n${evidence.block}`;
        }

        const response = await adapter.chat({
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userPrompt },
          ],
          temperature,
          maxTokens,
          // Reasoning models review with thinking ON: their chain-of-thought goes to a
          // separate channel and `content` comes back as clean JSON. With it OFF a distilled
          // DeepSeek-R1 crams reasoning into content, burns the budget, and returns empty —
          // why it sat seated-but-silent. Non-thinking models ignore this.
          think: isThinkingModel ? true : undefined,
          signal: controller.signal,
          // Anti-crash: evict this council model promptly after its turn so the next
          // member's model can load without co-residing in VRAM. With the council running
          // sequentially, this keeps only ONE council model resident at a time on a single
          // consumer GPU — the "seat all models, take longer instead of crash" contract.
          // Override window via VAI_COUNCIL_KEEP_ALIVE (default 20s — long enough that a
          // member retried within the same turn reuses the resident model).
          keepAlive: process.env.VAI_COUNCIL_KEEP_ALIVE?.trim() || '20s',
        });
        const parsedNote = parseCouncilNote(response.message.content, {
          memberId: id, memberName: displayName, topic, durationMs: Math.max(0, now() - startedAt),
        });
        if (!parsedNote) return null;

        let note: CouncilMemberNote = parsedNote;

        // Attach the context-state ledger (the pull-model audit trail) when the member fetched
        // anything: classify each fetched item as used / unused / unavailable against the note.
        if (fetched.length > 0) {
          const ledger = buildMemberContextLedger(id, fetched, note.methodLesson + ' ' + note.concerns.join(' ') + ' ' + note.realIntent);
          note = {
            ...note,
            contextLedger: {
              used: ledger.summary.used,
              unused: ledger.summary.unused,
              unavailable: ledger.summary.unavailable,
              items: ledger.items.map((i) => ({ label: i.label, state: i.state, reason: i.reason })),
            },
          };
        }

        // Experiment loop: let the member PROVE its claim with one allowlisted command before
        // presenting. The verified result is attached and feeds the council's trust weighting.
        // Best-effort — gatherMemberProof never throws; no proposal = no proof round.
        if (proofRunner) {
          const proof = await gatherMemberProof(adapter, {
            system,
            note: note.methodLesson || note.concerns.join('; ') || note.realIntent,
            signal: controller.signal,
            runProofOptions: { runner: proofRunner, cwd: proofCwd },
          });
          if (proof) {
            note = { ...note, proof: { hypothesis: proof.hypothesis, command: proof.command, status: proof.status, detail: proof.detail } };
          }
        }

        return note;
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
