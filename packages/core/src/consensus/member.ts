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
import type { ChatRequest, ModelAdapter } from '../models/adapter.js';
import { stripThinkingBlocks } from '../models/provider-adapters.js';
import type { CouncilAction, CouncilInput, CouncilMember, CouncilMemberNote, CouncilTopic } from './types.js';
import type { CouncilContextTools } from './context-tools.js';
import { gatherMemberEvidence, type MemberEvidence } from './member-evidence.js';
import { buildMemberContextLedger } from './context-states.js';
import { gatherMemberProof, type ProofRunner } from './member-experiment.js';

const ACTION_VALUES = ['answer-directly', 'web-search', 'local-business-search', 'reread-intent', 'ask-one-question'] as const;

/** Normalise a model's free-form verdict to the enum. Different models phrase it differently
 *  ("ok"/"pass"/"approve" → good; "reject"/"poor"/"fail" → bad; anything else → needs-work). The
 *  verdict was the ONLY non-tolerant field — a variant phrasing made safeParse discard the WHOLE
 *  note, so members that DID answer counted as "no usable view" and the council rubber-stamped the
 *  draft. Tolerating it is the difference between a working council and a silent one. */
function normalizeVerdict(v: unknown): 'good' | 'needs-work' | 'bad' {
  const s = String(v ?? '').toLowerCase().trim();
  if (/\b(good|ok|okay|pass|approve|approved|accept|ship|fine|solid|correct)\b/.test(s)) return 'good';
  if (/\b(bad|reject|rejected|poor|fail|wrong|incorrect|unusable)\b/.test(s)) return 'bad';
  return 'needs-work';
}

const councilNoteSchema = z.object({
  verdict: z.preprocess(normalizeVerdict, z.enum(['good', 'needs-work', 'bad'])).catch('needs-work'),
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

/** Cap the live reasoning preview so a runaway <think> can't flood the WS / UI. */
const MAX_REASONING_PREVIEW_CHARS = 2_400;
/** Throttle delta emission so we update the UI a few times/sec, not per token. */
const REASONING_DELTA_THROTTLE_MS = 150;

/**
 * Stream a member's review and accumulate the model's CONTENT (the JSON note) exactly as the
 * buffered `chat()` path would, while surfacing its REASONING channel (and, for models that
 * cram thinking into content, a tail of content) to `onDelta` as a rolling, capped preview.
 * Throttled so the UI updates a few times a second. Returns the full content string for the
 * existing parser. Any stream error propagates to the caller, which already falls back / fails
 * the member safely.
 */
/**
 * Build a readable preview from a member's PARTIAL JSON note (mid-stream, possibly truncated).
 * Tolerant by design — it scans for known keys with a regex rather than JSON.parse, so it works
 * on incomplete output and never throws. Surfaces the member's emerging conclusion (verdict /
 * what they think the user wants / what they'd do) as it forms. Returns '' if nothing useful yet.
 */
export function previewFromPartialJson(partial: string): string {
  if (!partial) return '';
  // Match `"key": "value..."` where value may be unterminated (stream cut mid-string).
  const grab = (key: string): string | null => {
    const m = partial.match(new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)`, 'i'));
    const v = m?.[1]?.trim();
    return v ? v.replace(/\\"/g, '"') : null;
  };
  const grabBare = (key: string): string | null => {
    const m = partial.match(new RegExp(`"${key}"\\s*:\\s*([0-9.]+|true|false)`, 'i'));
    return m?.[1] ?? null;
  };
  const parts: string[] = [];
  const verdict = grab('verdict');
  if (verdict) parts.push(`leaning "${verdict}"`);
  const intent = grab('realIntent');
  if (intent) parts.push(`reads the ask as: ${intent}`);
  const action = grab('suggestedAction');
  if (action) parts.push(`would ${action}`);
  const missing = grab('missingCapability');
  if (missing) parts.push(`gap: ${missing}`);
  const confidence = grabBare('confidence');
  if (confidence && parts.length) parts.push(`(~${Math.round(Number(confidence) * 100)}% sure)`);
  if (parts.length) return parts.join(' · ');
  // Nothing structured yet but bytes ARE arriving — say so honestly instead of "Waiting…".
  return partial.length > 8 ? 'drafting its review…' : '';
}

async function streamMemberContent(
  adapter: ModelAdapter,
  request: ChatRequest,
  onDelta: (textSoFar: string) => void,
): Promise<string> {
  let content = '';
  let reasoning = '';
  let lastEmit = 0;
  const emit = (force: boolean) => {
    const now = Date.now();
    if (!force && now - lastEmit < REASONING_DELTA_THROTTLE_MS) return;
    // The dedicated REASONING channel is human-readable "thinking out loud" (a distilled-R1
    // that put its think into content also reads as prose). For a terse generalist that streams
    // ONLY its JSON note into `content`, we used to suppress it entirely — which left qwen-class
    // members showing a bare "Waiting…" the whole time (the exact complaint). Instead, derive a
    // readable WORK-PRODUCT preview from the partial JSON as keys appear. Never raw JSON noise,
    // never hidden reasoning — just "what the member is concluding so far".
    let source = reasoning.trim();
    if (!source) {
      const c = content.trim();
      if (c && !c.startsWith('{') && !c.startsWith('[')) source = c;
      else if (c) source = previewFromPartialJson(c);
    }
    if (!source) return;
    lastEmit = now;
    const preview = source.length > MAX_REASONING_PREVIEW_CHARS
      ? source.slice(source.length - MAX_REASONING_PREVIEW_CHARS)
      : source;
    try { onDelta(preview); } catch { /* observability must never break the review */ }
  };
  for await (const chunk of adapter.chatStream!(request)) {
    if (chunk.type === 'reasoning_delta' && chunk.reasoningDelta) {
      reasoning += chunk.reasoningDelta;
      emit(false);
    } else if (chunk.type === 'text_delta' && chunk.textDelta) {
      content += chunk.textDelta;
      emit(false);
    }
  }
  emit(true);
  // Match the buffered path: a non-thinking model may have crammed <think> into content;
  // strip it so the council-note parser sees clean JSON (thinking-channel deltas already
  // went to the live preview, not here).
  return stripThinkingBlocks(content);
}

const BASE_SYSTEM = [
  "You are a 0.1%-level world-class engineer on Vai's SCIS consensus council (Vai is the deterministic engine/institution; models including you are staff).",
  'Vai prepared a draft answer but has NOT shown it to the user. You review only — do NOT answer the user and do NOT assert facts of your own (fact-quarantine is absolute).',
  'Read PAST the literal words: find the real intent, sarcasm, hidden or multiple meanings, and local abbreviations.',
  'Name precisely what CAPABILITY or METHOD Vai was missing for THIS CLASS of turn, and teach a concrete, minimal, testable way to handle it next time (teach-to-fish, never hand the answer).',
  'Ground every observation in the provided context only. Explicitly name file:line or architecture when relevant. Flag uncertainty. Never overclaim.',
  'If the turn involves UI/UX, judge it against EXTERNAL references (proven Fable-5 design patterns + Vai\'s own design tokens/components) and the design rubric (states, a11y, mobile, animate transform+opacity only) — not unanchored taste — and require rendered-visual proof, not "looks good".',
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
    code: ' You are the code specialist: principal deterministic systems + TS/React engineer. You prize inspectable gates (tsc, CSS coverage, rendered-page proof), small high-leverage patches, no external URLs, Windows-first Node, anti-slop (measure before claiming PASS). Visual richness and human-visible process (panels) matter because humans steer with their eyes. For any UI judgment, anchor on REFERENCES not taste: Vai\'s existing design tokens/components and proven Fable-5 design patterns (study how Fable-5 apps handle layout, timing, micro-interactions) — animate transform+opacity only, demand states/a11y/mobile, and require rendered-visual proof, never "looks good" by assertion.',
    reasoning: ' You are the reasoning specialist: first-principles + edge-case hunter. You rotate around blocks by trying alternative framings (Thorsen perspective). Demand explicit proof or "unproven"; call out when small models cannot be true 0.1% experts and what deterministic compensations (structure, quarantine, human steer, direct high-intel) are needed.',
    factual: ' You are the factual specialist: precision analyst and vision verifier. Never assert un-sourced numbers/names. Always specify the exact verification method (search query, file:line to inspect, image gate). You are the council\'s vision member when screenshots or UI proof are present.',
    local: ' You are the local/on-device specialist: latency, VRAM, offline robustness, and practical small-model constraints expert. You surface what actually works on free local stacks vs what requires the direct high-intel channel or synthetic reliable notes.',
    other: ' You are the generalist collaborator: elite across the board but defer to topic specialists. Focus on cross-cutting concerns (visibility for humans, preservation of prior good work, loop closure via visible panels + backlog).',
    creative: ' You are the creative/generative specialist: high-craft output with strong taste, but still bound by Vai\'s gates (no slop, visual proof, deterministic where it counts). Help the council judge "humans like it visually" without sacrificing correctness. Ground visual taste in EXTERNAL references — proven Fable-5 design patterns and Vai\'s own design system — rather than unanchored opinion; think in second-order UX (the banner/highlight/animation that fires on an action, perfect easings, micro-interactions), but verify by rendered proof.',
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
  // Multi-turn deliberation (round 2+): the other roles' round-1 reviews. THINK FIRST about
  // where you agree/disagree with them, THEN return your (possibly revised) note. You may hold
  // your ground or change your mind — but engage with the strongest opposing concern. This is
  // how a panel becomes a deliberation. Fact-quarantine unchanged: peers share intent/method/
  // verdict only, never user-facing facts.
  if (input.peerNotes?.length) {
    base.push(
      '',
      'PEER REVIEWS from round 1 (the other roles on this panel) — reconsider in light of these:',
      JSON.stringify(input.peerNotes),
      'First think briefly about the strongest disagreement, then return your final note (revised if they changed your mind, or held with a reason if not).',
    );
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
  // Strip reasoning blocks first (deepseek-r1 et al. wrap output in <think>…</think> with their own
  // braces) so we don't grab JSON-looking content out of the reasoning instead of the answer.
  let trimmed = String(raw ?? '').replace(/<think>[\s\S]*?<\/think>/gi, ' ').replace(/<\/?think>/gi, ' ').trim();
  // A fenced ```json … ``` block ANYWHERE (not only when it's the whole message).
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
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
/**
 * Thorsen-inspired seniority ladder (from MDS/Thorsen.md, the sacred doctrine). A council
 * ROLE is a lens promoted to a seat on this ladder — it tells us the ALTITUDE the voice
 * reviews from, which (later) drives vote weight and which deliberation rounds it joins.
 * Ordered low→high; `THORSEN_TIER_RANK` gives the numeric altitude.
 */
export type ThorsenTier = 'senior' | 'staff' | 'principal' | 'distinguished';

/** Numeric altitude per tier (higher = more architectural authority). Low→high, stable. */
export const THORSEN_TIER_RANK: Record<ThorsenTier, number> = {
  senior: 1,
  staff: 2,
  principal: 3,
  distinguished: 4,
};

export interface CouncilLens {
  /** Stable id suffix, e.g. 'skeptic'. */
  readonly id: string;
  /** Human label shown in the council/timeline UI, e.g. 'Skeptic'. */
  readonly label: string;
  /** Extra system-prompt framing appended after the niche addendum. */
  readonly framing: string;
  /** Sampling temperature for this angle (default 0 for the base lens, higher for variety). */
  readonly temperature?: number;
  /**
   * ROLE fields (Thorsen-inspired role-based deliberation, Milestone 1). All OPTIONAL so the
   * pre-existing plain lenses keep working unchanged. When present, this lens is a ROLE:
   * a seat on the Thorsen seniority ladder with an explicit mandate and a base vote weight.
   */
  /** Seniority altitude this voice reviews from. */
  readonly tier?: ThorsenTier;
  /** One-line charter: what this role is accountable for on the panel. */
  readonly mandate?: string;
  /**
   * Base vote weight multiplier for this role (default 1). Surfaced/recorded now; it does NOT
   * change consensus math yet — outcome logic stays as-is until we deliberately evolve it.
   */
  readonly weight?: number;
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
    async review(
      input: CouncilInput,
      opts?: { readonly onReasoningDelta?: (textSoFar: string) => void },
    ): Promise<CouncilMemberNote | null> {
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

        const request = {
          messages: [
            { role: 'system' as const, content: system },
            { role: 'user' as const, content: userPrompt },
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
        };

        // Live reasoning presence: when a delta sink is provided AND the adapter can stream,
        // surface the model's reasoning ("thinking out loud") as it generates so the UI shows
        // what each member is actually working through. The model's REASONING channel feeds
        // the preview; its CONTENT (the JSON note) is what we parse — identical to the
        // non-streaming path, so the fact-quarantine and parsing are unchanged. The stream
        // failing/being unavailable falls straight back to the buffered chat() call.
        const content = (opts?.onReasoningDelta && typeof adapter.chatStream === 'function')
          ? await streamMemberContent(adapter, request, opts.onReasoningDelta)
          : (await adapter.chat(request)).message.content;

        const parsedNote = parseCouncilNote(content, {
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
