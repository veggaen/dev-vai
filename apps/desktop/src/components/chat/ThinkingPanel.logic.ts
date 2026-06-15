import type { TurnThinkingUI } from '../../stores/chatStore.js';
import type { AdvisorTrace } from '@vai/api-types/chat-ws';

/** View model for the Thinking panel — pure, derived from a turn's trace. */
export interface ThinkingPanelModel {
  readonly intent: string;
  readonly intentLabel: string;
  readonly strategy: string;
  readonly steps: readonly { readonly label: string; readonly raw: string }[];
  readonly trustBadge?: string;
  readonly trustLabel?: string;
  readonly confidencePct?: number;
  readonly topic?: string;
  readonly knowledgeDepth?: string;
  readonly durationMs?: number;
  /** Compact one-line header summary. */
  readonly headerLabel: string;
  /** Detected intent disagrees with the answering strategy → likely misroute. */
  readonly misrouteSuspected: boolean;
  readonly misrouteHint?: string;
  /** Misroutes start expanded; clean turns start collapsed (VS Code style). */
  readonly defaultExpanded: boolean;
}

const INTENT_LABELS: Record<string, string> = {
  'action-yesno': 'Yes/No',
  definition: 'Definition',
  'factual-lookup': 'Fact lookup',
  build: 'Build',
  meta: 'Conversation',
  other: 'Open-ended',
};

const TRUST_LABELS: Record<string, string> = {
  'local-curated': 'Knowledge base',
  'official-docs': 'Official docs',
  'web-mixed': 'Mixed web',
  'web-untrusted': 'Untrusted web',
  fallback: 'No grounded answer',
  computed: 'Computed',
};

/**
 * Past-tense outcome verb per intent — the headline of the collapsed one-liner.
 * "other" (open-ended) is intentionally absent: it falls through to a strategy
 * check so a casual chat turn reads "Answered conversationally", not "Answered".
 */
const INTENT_OUTCOME: Record<string, string> = {
  meta: 'Answered conversationally',
  definition: 'Explained',
  'factual-lookup': 'Recalled a fact',
  'action-yesno': 'Answered yes/no',
  build: 'Worked on a build',
};

/** How Vai read the message — the opening line of the expanded explanation. */
const INTENT_READING: Record<string, string> = {
  meta: 'a casual, conversational message',
  other: 'an open-ended message',
  definition: 'a request to define something',
  'factual-lookup': 'a factual question',
  'action-yesno': 'a yes/no question',
  build: 'a request to build something',
  analysis: 'a diagnostic or reasoning request',
};

/**
 * Plain-language label for one internal process checkpoint. The trace stores
 * developer-facing names like "tracked:conversational"; this turns each into a
 * line a human can read. The raw name is kept in a title attribute for debugging.
 */
const STAGE_LABELS: Record<string, string> = {
  'chat:start': 'Read your message',
  'chat:preflight-complete': 'Picked an approach',
  'chat:single-clarifying-question-preflight': 'Weighed asking a clarifying question',
  'chat:bridge-evidence-discipline-preflight': 'Checked what it could verify',
  'chat:smart-bridge-route-preflight': 'Checked the IDE bridge',
  'chat:tech-synth-preflight': 'Considered a technical synthesis',
  'stream:start': 'Started responding',
  'generate:start': 'Began composing the answer',
  'generate:compound-complete': 'Checked for multiple questions',
  'generate:short-topic-start': 'Recognized a short topic',
  'generate:short-topic-complete': 'Handled the short topic',
  'generate:research-routing-start': 'Decided whether to search the web',
  'generate:research-routing-complete': 'Settled the search decision',
  'generate:creative-code-start': 'Started generating code',
  'generate:creative-code-complete': 'Finished generating code',
  'generate:pre-taught-complete': 'Checked what it has been taught',
  'generate:taught-match-start': 'Looked for a taught match',
  'generate:taught-match-complete': 'Finished the taught lookup',
  'generate:taught-doc-start': 'Pulled up a taught doc',
  'generate:taught-doc-complete': 'Read the taught doc',
  'generate:intelligence-start': 'Reasoned about the question',
  'generate:intelligence-complete': 'Finished reasoning',
  'generate:synthesis-start': 'Wrote the answer',
  'generate:synthesis-complete': 'Finished the answer',
  'tracked:start': 'Finalizing the turn',
  'tracked:conversational': 'Answered conversationally',
};

export function humanizeStage(raw: string): string {
  const known = STAGE_LABELS[raw];
  if (known) return known;

  const [phase, ...rest] = raw.split(':');
  if (phase === 'tracked') {
    if (rest[0] === 'fallback') return 'Verified the fallback answer';
    return rest.length ? `Answered with ${humanizeStrategy(rest.join(' ')).toLowerCase()}` : 'Tracked the turn';
  }

  const detail = rest.join(' ').replace(/\b(?:start|complete|preflight)\b/gi, '').trim();
  return detail ? humanizeStrategy(detail) : humanizeStrategy(raw);
}

/**
 * Plain-English "what this checkpoint actually is" for a newcomer — the missing
 * context that makes a label like "Started responding" stop being jargon. Says
 * outright when a step is just an internal marker rather than real reasoning.
 */
const STAGE_EXPLANATIONS: Record<string, string> = {
  'chat:start': 'Internal marker — Vai received your message and started working on it.',
  'chat:preflight-complete': 'Vai finished sizing up the request and picked an approach before answering.',
  'stream:start': 'Internal marker — Vai opened the reply channel (the instant it can start sending text back to your screen).',
  'generate:start': 'Internal marker — Vai entered its answer-building routine. The time here is setup: loading recent context, classifying your message, and choosing how to respond.',
  'generate:compound-complete': 'Vai scanned your message for several questions bundled into one (like "A and B?") so each part can be answered separately.',
  'generate:short-topic-start': 'Vai recognized a short, terse prompt (just a few words) and routed it to the brief-topic handler.',
  'generate:short-topic-complete': 'Vai finished the short-topic handling.',
  'generate:research-routing-start': 'Vai weighed whether this needs a live web search or can be answered from what it already knows.',
  'generate:research-routing-complete': 'Vai settled the search question — searched, or skipped it because it had a local answer.',
  'generate:creative-code-start': 'Vai checked whether the answer needs generated code.',
  'generate:creative-code-complete': 'Vai finished the code-generation check.',
  'generate:pre-taught-complete': 'Vai checked its taught knowledge — things it has been explicitly shown before.',
  'generate:taught-match-start': 'Vai searched its taught examples for one that matches your question.',
  'generate:taught-match-complete': 'Vai finished looking through its taught examples.',
  'generate:taught-doc-start': 'Vai pulled up a stored reference document related to your question.',
  'generate:taught-doc-complete': 'Vai finished reading the stored reference.',
  'generate:intelligence-start': 'Vai reasoned about the question — connecting what it knows to what you asked.',
  'generate:intelligence-complete': 'Vai finished its reasoning pass.',
  'generate:synthesis-start': 'Vai began writing the final answer from everything it gathered.',
  'generate:synthesis-complete': 'Vai finished writing the answer.',
  'tracked:start': 'Internal marker — Vai finished generating and began recording the turn (saving which approach answered, for this trace and for learning).',
  'tracked:conversational': 'Vai answered conversationally and logged the turn.',
};

/** A one-line, newcomer-friendly explanation of what a checkpoint actually does. */
export function explainStage(raw: string): string | undefined {
  const known = STAGE_EXPLANATIONS[raw];
  if (known) return known;

  const [phase, ...rest] = raw.split(':');
  if (phase === 'tracked') {
    if (rest[0] === 'fallback') return 'Vai double-checked the backup model’s answer against what it knows before showing it.';
    const strategy = humanizeStrategy(rest.join(' ')).toLowerCase();
    const curated = /curated|fact/.test(strategy) ? ' — curated means Vai’s trusted built-in facts, used for established knowledge' : '';
    return `Vai answered using its ${strategy} approach${curated}, and recorded the turn.`;
  }
  return undefined;
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function isConversational(strategy?: string, chosen?: string): boolean {
  return /conversation|conversational|chat-meta|greeting|continuation/i.test(`${strategy ?? ''} ${chosen ?? ''}`);
}

export interface ProcessTimingRow {
  readonly stage: string;
  /** Plain-language label for the checkpoint. */
  readonly label: string;
  /** Authentic per-step fact emitted by the engine (e.g. "single question"). */
  readonly detail?: string;
  /** Newcomer-friendly "what this step actually is" (jargon-free). */
  readonly explanation?: string;
  /** True when this is just an internal lifecycle marker, not real reasoning. */
  readonly isMarker: boolean;
  /** Elapsed time from the start of the turn to this checkpoint. */
  readonly elapsedMs: number;
  /** Time spent in this step alone (delta from the previous checkpoint). */
  readonly stepMs: number;
}

export interface ProcessTimingView {
  readonly rows: readonly ProcessTimingRow[];
  /** Real turn time = the last checkpoint's elapsed value. */
  readonly totalMs: number;
}

/**
 * Turn the raw process trace into correct timing rows. The engine stores each
 * checkpoint's `durationMs` as *elapsed-from-turn-start*, not per-step — so the
 * total is the last checkpoint's value (NOT the sum, which double-counted and
 * produced the bogus "total 494ms" on a ~176ms turn) and each step's own cost
 * is the delta from the previous checkpoint.
 */
export function summarizeProcessTrace(
  trace: ReadonlyArray<{ stage: string; durationMs: number; detail?: string }>,
): ProcessTimingView {
  let prevElapsed = 0;
  const rows = trace.map((cp) => {
    const elapsedMs = Math.max(0, cp.durationMs || 0);
    const stepMs = Math.max(0, elapsedMs - prevElapsed);
    prevElapsed = elapsedMs;
    const explanation = explainStage(cp.stage);
    return {
      stage: cp.stage,
      label: humanizeStage(cp.stage),
      detail: cp.detail?.trim() || undefined,
      explanation,
      isMarker: Boolean(explanation && explanation.startsWith('Internal marker')),
      elapsedMs,
      stepMs,
    };
  });
  const totalMs = rows.length > 0 ? rows[rows.length - 1].elapsedMs : 0;
  return { rows, totalMs };
}

/** One macro-phase of the answer pipeline — the spine of the process hero. */
export interface PipelinePhaseUI {
  readonly id: 'read' | 'route' | 'evidence' | 'compose' | 'verify';
  readonly label: string;
  /** Time spent inside this phase (sum of its checkpoints' step deltas). */
  readonly ms: number;
  /** 0..1 share of the turn — drives the segmented track widths. */
  readonly share: number;
  /** Number of underlying checkpoints folded into this phase. */
  readonly count: number;
}

const PHASE_ORDER: readonly PipelinePhaseUI['id'][] = ['read', 'route', 'evidence', 'compose', 'verify'];

const PHASE_LABELS: Record<PipelinePhaseUI['id'], string> = {
  read: 'Read',
  route: 'Route',
  evidence: 'Evidence',
  compose: 'Compose',
  verify: 'Verify',
};

function classifyPhase(stage: string): PipelinePhaseUI['id'] {
  const s = stage.toLowerCase();
  if (/verif|sanitiz|guard|tracked|honest|trust/.test(s)) return 'verify';
  if (/synth|assemble|compose|stream|answer|writ/.test(s)) return 'compose';
  if (/search|retriev|research|ingest|source|file|read|attach|context|tool|exec|terminal|bridge|taught|doc/.test(s)) return 'evidence';
  if (/preflight|route|routing|intent|candidate|classif|match|short-topic|compound|creative|intelligence/.test(s)) return 'route';
  return 'read';
}

/**
 * Fold the checkpoint rows into a fixed Read → Route → Evidence → Compose →
 * Verify pipeline. Phases that never ran are dropped, so a pure-conversation
 * turn renders a short spine, and a research turn renders the full one.
 */
export function buildPipelinePhases(view: ProcessTimingView): PipelinePhaseUI[] {
  const totals = new Map<PipelinePhaseUI['id'], { ms: number; count: number }>();
  for (const row of view.rows) {
    const id = classifyPhase(row.stage);
    const entry = totals.get(id) ?? { ms: 0, count: 0 };
    entry.ms += row.stepMs;
    entry.count += 1;
    totals.set(id, entry);
  }
  const denom = view.totalMs > 0 ? view.totalMs : [...totals.values()].reduce((sum, e) => sum + e.ms, 0) || 1;
  return PHASE_ORDER
    .filter((id) => totals.has(id))
    .map((id) => {
      const entry = totals.get(id)!;
      return {
        id,
        label: PHASE_LABELS[id],
        ms: entry.ms,
        share: Math.max(0.02, Math.min(1, entry.ms / denom)),
        count: entry.count,
      };
    });
}

/**
 * Typed evidence log for a turn — the "what I actually did" record, Codex-style.
 * A discriminated union so each action renders with the right chrome: a search
 * shows its queries + results, a file shows its diff/content, a command shows
 * its output, a note carries the engine's own step narration. The backend will
 * emit these explicitly (incl. real diffs + tool output); for now the frontend
 * derives what it can from data already on the message.
 */
export type TurnEvidenceUI =
  | { readonly kind: 'note'; readonly label: string; readonly detail?: string; readonly stage?: string }
  | {
      readonly kind: 'steering';
      readonly label: string;
      readonly detail?: string;
      readonly status?: string;
      readonly advisor?: AdvisorTrace;
    }
  | {
      readonly kind: 'file';
      readonly path: string;
      readonly language?: string;
      readonly content?: string;
      readonly added?: number;
      readonly removed?: number;
      readonly diff?: string;
    }
  | {
      readonly kind: 'search';
      readonly queries: readonly string[];
      readonly results: readonly { readonly title: string; readonly domain?: string; readonly snippet?: string; readonly url?: string }[];
      readonly fetched?: number;
      readonly selected?: number;
    }
  | { readonly kind: 'command'; readonly command: string; readonly output?: string; readonly exitCode?: number };

export interface TurnEvidenceInput {
  /** Engine-narrated progress steps (carry rich `detail`; dropped after streaming today). */
  readonly progressSteps?: ReadonlyArray<{
    stage: string;
    label: string;
    detail?: string;
    status?: string;
    advisor?: AdvisorTrace;
  }>;
  /** Code blocks Vai produced this turn (extracted from the answer markdown). */
  readonly fileChanges?: ReadonlyArray<{ path: string; content?: string; language?: string }>;
}

/**
 * Derive the evidence log from data already present on a settled message. This
 * is the frontend half of the contract; once the engine emits explicit evidence
 * (with real diffs / search results / command output) it supersedes this.
 */
export function buildTurnEvidence(input: TurnEvidenceInput = {}): TurnEvidenceUI[] {
  const items: TurnEvidenceUI[] = [];

  // The engine's own step narration — preserved so the rich "what I'm doing"
  // detail survives after the live indicator clears. Dedupe repeats and skip
  // empty labels.
  const seen = new Set<string>();
  for (const step of input.progressSteps ?? []) {
    const label = (step.label ?? '').trim();
    if (!label) continue;
    const detail = step.detail?.trim() || undefined;
    const key = `${label}::${detail ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (step.stage === 'local-steering') {
      items.push({
        kind: 'steering',
        label,
        detail,
        status: step.status,
        advisor: step.advisor,
      });
      continue;
    }
    items.push({ kind: 'note', label, detail, stage: step.stage });
  }

  // Files Vai wrote/changed this turn (content now; diffs arrive with the
  // backend evidence slice).
  for (const file of input.fileChanges ?? []) {
    if (!file.path) continue;
    items.push({ kind: 'file', path: file.path, language: file.language, content: file.content });
  }

  return items;
}

// Strategy families used only to flag intent/strategy mismatches.
const DEFINITIONAL_STRATEGY = /\b(?:brand|definition|company|person|country|acronym|canonical|extended[- ]?fact|topic[- ]?lookup|disambiguat)\b/i;
const BUILD_STRATEGY = /\b(?:build|creative[- ]?code|scaffold|builder|compose)\b/i;

export function humanizeStrategy(raw: string): string {
  return raw
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Friendly, plain-language names for the deterministic handlers / models. */
const HANDLER_LABELS: Record<string, string> = {
  'single-clarifying-question': 'asking a clarifying question',
  'bridge-evidence-discipline': 'a capability check',
  'conversation-reasoning': 'reasoning it out',
  'chat-meta': 'a conversation reply',
  'chat-facts': 'fact recall',
  'chat-product-engineering': 'a product-engineering memo',
  'chat-boundary-response': 'a boundary response',
  'chat-format-strict': 'a formatted answer',
  'chat-fact-shim': 'a quick fact answer',
  'chat-constrained-code': 'a code answer',
  'chat-continuation': 'continuing the thread',
};

function friendlyHandler(raw: string): string {
  const base = raw.split(':')[0];
  return HANDLER_LABELS[base] ?? humanizeStrategy(raw).toLowerCase();
}

/** Human model name: drops provider prefixes; vai:v0 → "Vai". */
export function prettyModelName(id?: string): string {
  if (!id) return 'Vai';
  if (id === 'vai:v0' || id === 'vai') return 'Vai';
  return id.replace(/^(?:local|openai|anthropic|google):/, '');
}

function normalizeModelKey(id?: string): string {
  return prettyModelName(id).toLowerCase();
}

/**
 * What the advisor ACTUALLY returned, in plain language. Never a canned
 * "reviewed the route and quality risks" line: if it raised nothing, say so;
 * if it was unavailable or ran in the background, say that. Honesty here is
 * the product — the panel must describe the processes that really happened.
 */
function describeAdvisorFindings(advisor: AdvisorTrace): string {
  if (advisor.state === 'unavailable') {
    return 'was unavailable this turn, so no shadow review happened';
  }
  if (advisor.state === 'background') {
    return 'finished after the answer was already written — its advice was recorded for evaluation but did not shape this turn';
  }
  if (advisor.state === 'invalid') {
    return 'returned advice Vai could not parse, so it was discarded';
  }
  if (advisor.state === 'running') {
    return 'is still reviewing in the background';
  }

  const parts: string[] = [];
  if (advisor.routeGuidance.length > 0) {
    const first = advisor.routeGuidance[0];
    parts.push(`${advisor.routeGuidance.length} route hint${advisor.routeGuidance.length === 1 ? '' : 's'} (${first.signal} ${friendlyHandler(first.handler)})`);
  }
  if (advisor.riskFlags.length > 0) {
    parts.push(`${advisor.riskFlags.length} risk flag${advisor.riskFlags.length === 1 ? '' : 's'}: ${advisor.riskFlags.slice(0, 2).join('; ')}`);
  }
  if (advisor.retrievalHints.length > 0) {
    parts.push(`${advisor.retrievalHints.length} retrieval hint${advisor.retrievalHints.length === 1 ? '' : 's'}`);
  }
  const timing = advisor.durationMs !== undefined ? ` in ${(advisor.durationMs / 1000).toFixed(1)}s` : '';
  if (parts.length === 0) {
    return `reviewed the turn${timing} and raised no concerns`;
  }
  return `returned ${parts.join(', ')}${timing}`;
}

/** Plain-language advisor row — matches header attribution when a model also answered. */
export function describeAdvisorContribution(
  advisor: AdvisorTrace | undefined,
  fallback?: ReasoningExtras['fallback'],
): { title: string; detail: string } {
  const advisorName = prettyModelName(advisor?.modelId);

  if (fallback) {
    const answerName = prettyModelName(fallback.toModelId);
    const reason = fallback.reason === 'low-confidence'
      ? 'was not confident in its own draft'
      : 'had no grounded match in memory';
    const sameVoice = normalizeModelKey(advisor?.modelId) === normalizeModelKey(fallback.toModelId);

    if (sameVoice || !advisor) {
      return {
        title: 'Answer handoff',
        detail: `${answerName} drafted the answer after Vai ${reason}. Vai verified it before showing you.`,
      };
    }

    return {
      title: 'Advisor + answer handoff',
      detail: `${advisorName} (shadow advisor) ${describeAdvisorFindings(advisor)}. ${answerName} drafted the answer after Vai ${reason}.`,
    };
  }

  if (!advisor) {
    return {
      title: 'Advisor contribution',
      detail: 'No shadow advisor ran this turn. Vai wrote the final answer.',
    };
  }

  return {
    title: 'Advisor contribution',
    detail: `${advisorName} (shadow advisor) ${describeAdvisorFindings(advisor)}. Vai stayed responsible for the final answer.`,
  };
}

export interface ReasoningExtras {
  readonly respondingModelId?: string;
  readonly fallback?: { readonly fromModelId: string; readonly toModelId: string; readonly reason: 'low-confidence' | 'no-knowledge' };
  readonly candidateCount?: number;
  readonly belowFloor?: boolean;
  readonly chosenCandidate?: string;
  /** Fit 0..1 of the winning approach — surfaced as a real number in the recipe. */
  readonly chosenScore?: number;
  /** Number of web sources actually used — promotes the headline to "Researched N sources". */
  readonly researchSourceCount?: number;
}

export interface ReasoningNarrative {
  /** Collapsed one-line summary. */
  readonly summary: string;
  /** One-paragraph "why this answer" — the reason, framed around the question. */
  readonly why: string;
  /** Numbered, plain-language recipe of what happened this turn. */
  readonly steps: readonly string[];
}

export interface AdvisorLessonUI {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly signal?: 'prefer' | 'avoid';
  readonly handler?: string;
  readonly matchTokens: readonly string[];
}

/**
 * Convert the advisor's machine-facing contract into a few bounded lessons.
 * These are routing and verification principles, not copied answer text.
 */
export function buildAdvisorLessons(advisor?: AdvisorTrace): AdvisorLessonUI[] {
  if (!advisor || advisor.state !== 'ready') return [];

  const lessons: AdvisorLessonUI[] = [];
  const matchTokens = [...new Set(
    advisor.retrievalHints.flatMap(
      (hint) => hint.toLowerCase().match(/[a-z0-9][a-z0-9+#.]{2,}/g) ?? [],
    ),
  )].slice(0, 8);

  if (advisor.qualityContract?.mustBeCurrent || advisor.riskFlags.includes('freshness-needed')) {
    lessons.push({
      id: 'fresh-evidence',
      title: 'Use fresh evidence for changing facts',
      detail: 'Roster, release, price, policy, and other time-sensitive questions should be retrieved and checked before answering.',
      matchTokens,
    });
  }

  if (advisor.qualityContract?.mustBeGuiding) {
    lessons.push({
      id: 'guiding-answer',
      title: 'Give the user a usable next step',
      detail: 'Prefer a short decision path or concrete action over a generic explanation.',
      matchTokens,
    });
  }

  for (const [index, guidance] of advisor.routeGuidance.entries()) {
    const action = guidance.signal === 'prefer' ? 'Prefer' : 'Avoid';
    lessons.push({
      id: `${guidance.signal}-${guidance.handler}-${index}`,
      title: `${action} ${humanizeStrategy(guidance.handler).toLowerCase()} for similar questions`,
      detail: guidance.reason,
      signal: guidance.signal,
      handler: guidance.handler,
      matchTokens,
    });
  }

  return lessons;
}

function describeIntentReading(model: ThinkingPanelModel): string {
  const base = INTENT_READING[model.intent] ?? 'a message';
  if (!model.topic) return base;
  const topic = model.topic.trim();
  if (topic.length > 48 || /[?.!]$/.test(topic)) {
    return `${base}: "${topic}"`;
  }
  return `${base} about ${topic}`;
}

/**
 * Codex-style reasoning narrative — a short, readable account of how the turn
 * was answered, derived purely from the trace. Reads like a colleague who had
 * the best take speaking up, not a mechanical model-switch log.
 */
export function buildReasoningNarrative(model: ThinkingPanelModel, extras: ReasoningExtras = {}): ReasoningNarrative {
  const { respondingModelId, fallback, candidateCount, belowFloor, chosenCandidate, researchSourceCount } = extras;
  const handedOff = Boolean(fallback);
  const responder = prettyModelName(fallback?.toModelId ?? respondingModelId);
  const qualityProtected =
    respondingModelId === 'vai:quality-guard'
    || /\bquality-fallback-pass\b/i.test(model.strategy);
  const steps: string[] = [];

  // 1 — how Vai read the message (the missing context that made the timeline
  // feel like plumbing: this is the "what did you understand me to mean" line).
  steps.push(`Read it as ${describeIntentReading(model)}.`);

  // 2 — what Vai grounded the answer in.
  if (belowFloor || fallback?.reason === 'no-knowledge') {
    steps.push('Checked memory — no confident match.');
  } else if (model.trustBadge === 'local-curated') {
    steps.push('Found a match in the knowledge base.');
  } else if (model.trustBadge === 'official-docs') {
    steps.push('Grounded the answer in official docs.');
  } else if (typeof researchSourceCount === 'number' && researchSourceCount > 0) {
    steps.push(`Pulled in ${researchSourceCount} web source${researchSourceCount === 1 ? '' : 's'}.`);
  } else {
    steps.push('Checked memory and the conversation so far.');
  }

  // 3 — how the candidate approaches were weighed.
  if (typeof candidateCount === 'number' && candidateCount > 0) {
    const word = candidateCount === 1 ? 'approach' : 'approaches';
    if (qualityProtected) {
      steps.push(`Weighed ${candidateCount} ${word} - the generated drafts failed the answer-quality contract.`);
    } else if (belowFloor) {
      steps.push(`Weighed ${candidateCount} ${word} — none cleared the confidence bar.`);
    } else if (chosenCandidate) {
      steps.push(`Weighed ${candidateCount} ${word} — ${friendlyHandler(chosenCandidate)} won.`);
    }
  }

  // 4 — the decision Vai landed on.
  if (qualityProtected) {
    steps.push('Vai rejected two weak drafts and supplied a diagnosis-first answer instead.');
  } else if (handedOff) {
    const why = fallback!.reason === 'low-confidence' ? "Vai wasn't sure" : "Vai didn't have it in memory";
    steps.push(`${why}, so ${responder} spoke up with the answer.`);
  } else if (model.misrouteSuspected) {
    steps.push('Answered, but the intent looks different from the approach used (see note above).');
  } else if (isConversational(model.strategy, chosenCandidate)) {
    steps.push('Replied conversationally.');
  } else if (chosenCandidate) {
    steps.push(`Answered with ${friendlyHandler(chosenCandidate)}.`);
  } else {
    steps.push(`${responder} answered directly.`);
  }

  // Headline: a concrete one-liner of what this turn actually did, not generic
  // "thought it through". Research and model-handoff outcomes take precedence
  // over the intent verb because they carry the most signal.
  let headline: string;
  if (model.misrouteSuspected) {
    headline = `Possible misroute · ${model.intentLabel.toLowerCase()}`;
  } else if (typeof researchSourceCount === 'number' && researchSourceCount > 0) {
    headline = `Researched ${researchSourceCount} source${researchSourceCount === 1 ? '' : 's'}`;
  } else if (qualityProtected) {
    headline = 'Protected by Vai quality guard';
  } else if (handedOff) {
    headline = `Answered by ${responder}`;
  } else {
    const conversational = /conversation|conversational|\bchat\b|\bmeta\b|greeting/i.test(`${model.intent} ${model.strategy}`);
    headline = INTENT_OUTCOME[model.intent] ?? (conversational ? 'Answered conversationally' : 'Answered');
  }

  const summary = !model.misrouteSuspected && model.durationMs !== undefined
    ? `${headline} · ${formatDuration(model.durationMs)}`
    : headline;

  // "Why this answer" — the reason, framed around the question. Built from the
  // real decision signals: how it was read, what grounded it, and (the key fork)
  // whether Vai answered itself or escalated, and why.
  const reading = describeIntentReading(model);
  let why: string;
  if (qualityProtected) {
    why = `You sent ${reading}. The local model's drafts violated the answer-quality contract, so Vai replaced them with a diagnosis-first checklist instead of showing invented project details.`;
  } else if (handedOff) {
    const reasonText = fallback!.reason === 'low-confidence'
      ? 'Vai was not confident enough in its own draft'
      : 'Vai had no grounded match in memory';
    why = `You sent ${reading}. ${reasonText}, so rather than guess it handed off to ${responder} and verified the answer before showing it.`;
  } else if (belowFloor) {
    why = `You sent ${reading}, but nothing Vai knew cleared its quality bar — so it said so instead of guessing.`;
  } else {
    const groundedIn = model.trustLabel ? ` from ${model.trustLabel.toLowerCase()}` : '';
    const via = chosenCandidate ? `, choosing ${friendlyHandler(chosenCandidate)} over the alternatives` : '';
    why = `You sent ${reading}. Vai answered${groundedIn}${via}.`;
  }

  return { summary, why, steps };
}

/**
 * Conservative misroute detector: only the clearest disagreements, to avoid
 * crying wolf. An action yes/no answered by a definition handler, or a
 * fact/definition answered by a build handler, are the misroute classes the
 * intent gate targets.
 */
function detectMisroute(intent: string, strategy: string): string | null {
  const s = strategy || '';
  if (intent === 'action-yesno' && DEFINITIONAL_STRATEGY.test(s)) {
    return 'Asked a yes/no question but answered with a definition.';
  }
  if ((intent === 'definition' || intent === 'factual-lookup') && BUILD_STRATEGY.test(s)) {
    return 'Asked a factual question but routed to the builder.';
  }
  return null;
}

export function buildThinkingPanelModel(thinking: TurnThinkingUI): ThinkingPanelModel {
  const intent = thinking.intent || 'other';
  const intentLabel = INTENT_LABELS[intent] ?? humanizeStrategy(intent);
  const strategy = thinking.strategy || '';
  const chain = thinking.strategyChain && thinking.strategyChain.length > 0
    ? thinking.strategyChain
    : strategy.split(/\s*->\s*/).filter(Boolean);
  const steps = chain.map((raw) => ({ raw, label: humanizeStrategy(raw) }));

  const confidencePct = typeof thinking.confidence === 'number'
    ? Math.round(Math.max(0, Math.min(1, thinking.confidence)) * 100)
    : undefined;

  const misrouteHint = detectMisroute(intent, strategy) ?? undefined;
  const misrouteSuspected = Boolean(misrouteHint);

  const stepWord = steps.length === 1 ? 'step' : 'steps';
  const headerLabel = `${intentLabel} · ${steps.length} ${stepWord}`;

  return {
    intent,
    intentLabel,
    strategy,
    steps,
    trustBadge: thinking.trustBadge,
    trustLabel: thinking.trustBadge ? (TRUST_LABELS[thinking.trustBadge] ?? thinking.trustBadge) : undefined,
    confidencePct,
    topic: thinking.topic && thinking.topic.trim() ? thinking.topic : undefined,
    knowledgeDepth: thinking.knowledgeDepth,
    durationMs: thinking.durationMs,
    headerLabel,
    misrouteSuspected,
    misrouteHint,
    defaultExpanded: misrouteSuspected,
  };
}
