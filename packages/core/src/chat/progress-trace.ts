import type { ChatChunk } from '../models/adapter.js';
import {
  chatProgressStepSchema,
  progressOutcomeSchema,
  type ProgressOutcome,
} from '@vai/contracts/chat-ws';

/**
 * Core-owned structural view of one streamed progress frame. The runtime may
 * enrich a core progress frame with an advisor packet before it reaches the
 * WebSocket; persistence treats that packet as opaque structured metadata.
 */
export type ChatProgressStep = NonNullable<ChatChunk['progress']> & {
  readonly advisor?: Readonly<Record<string, unknown>>;
};

export type TurnProgressOutcome = ProgressOutcome;

export interface ProgressTraceAssistantCandidate {
  readonly id: string;
  readonly content: string;
}

export type ProgressTraceOwnerResolution =
  | { readonly kind: 'update'; readonly id: string }
  | { readonly kind: 'insert' }
  | { readonly kind: 'ambiguous' };

/**
 * Resolve which newly-created assistant row owns a turn trace.
 *
 * Content identity is the concurrency token: a non-empty streamed response may
 * update exactly one matching row; otherwise it gets its own durable row. Empty
 * responses may claim a sole new row, but never guess between concurrent rows.
 */
export function resolveProgressTraceOwner(
  candidates: readonly ProgressTraceAssistantCandidate[],
  streamedAssistantText: string,
): ProgressTraceOwnerResolution {
  if (streamedAssistantText) {
    const exactMatches = candidates.filter((row) => row.content === streamedAssistantText);
    if (exactMatches.length === 1) return { kind: 'update', id: exactMatches[0].id };
    if (exactMatches.length > 1) return { kind: 'ambiguous' };
    return { kind: 'insert' };
  }
  if (candidates.length === 0) return { kind: 'insert' };
  if (candidates.length === 1) return { kind: 'update', id: candidates[0].id };
  return { kind: 'ambiguous' };
}

function evidenceId(stage: string, index: number): string {
  const normalized = stage
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'step';
  return `progress:${index + 1}:${normalized}`;
}

/**
 * Process-trace persistence (prune ↔ rehydrate).
 *
 * The live ProcessTree the user watches is assembled on the client from streamed
 * `progress` chunks. Those chunks carry bulky payloads (full council notes, full
 * tool inputs/outputs, every process-log body). Persisting them verbatim would
 * bloat `vai.db`; persisting NOTHING (the previous behaviour) means a reopened
 * conversation shows only bare, un-expandable leaf rows — the regression this fixes.
 *
 * We persist a PRUNED snapshot: the same step/council/tool/log STRUCTURE (so the
 * tree expands identically), with long free-text fields clamped and the whole blob
 * size-capped. Pure functions, no IO — unit-tested without a DB.
 */

/**
 * Accumulate streamed progress steps server-side, mirroring the client store's
 * {@link mergeProgressStepsForMessage} so the persisted trace is identical to what
 * the user watched live: re-emitted stages merge (preserving late-arriving council
 * members / tool runs), and a new stage settles the previous running one.
 */
export function accumulateProgressStep(
  existing: readonly ChatProgressStep[],
  incoming: ChatProgressStep,
): ChatProgressStep[] {
  let priorIndex = -1;
  for (let index = existing.length - 1; index >= 0; index -= 1) {
    if (existing[index]?.stage === incoming.stage) {
      priorIndex = index;
      break;
    }
  }
  if (priorIndex !== -1) {
    const prior = existing[priorIndex];
    const identifiesOneLogicalStep = prior?.status === 'running'
      || prior?.label === incoming.label
      || incoming.stage === 'search'
      || /(?:^|-)round-?\d+(?:$|-)/i.test(incoming.stage);
    if (identifiesOneLogicalStep) {
      const next = [...existing];
      const staleRunningUpdate = prior?.outcome !== undefined
        && incoming.status === 'running';
      next[priorIndex] = {
        ...prior,
        ...incoming,
        status: staleRunningUpdate ? prior.status : incoming.status,
        outcome: staleRunningUpdate
          ? prior.outcome
          : incoming.outcome ?? prior.outcome,
        evidenceId: incoming.evidenceId ?? prior.evidenceId ?? evidenceId(incoming.stage, priorIndex),
        advisor: incoming.advisor ?? prior.advisor,
        councilMembers: incoming.councilMembers?.length ? incoming.councilMembers : prior.councilMembers,
        processLog: incoming.processLog?.length ? incoming.processLog : prior.processLog,
        toolRuns: incoming.toolRuns?.length ? incoming.toolRuns : prior.toolRuns,
        draftRace: incoming.draftRace ?? prior.draftRace,
      };
      return next;
    }
  }
  return [
    ...existing,
    {
      ...incoming,
      evidenceId: incoming.evidenceId ?? evidenceId(incoming.stage, existing.length),
    },
  ];
}

/** Per-field clamp for any single free-text value (notes, tool output, log bodies). */
const FIELD_MAX = 1200;
/** Hard ceiling for the serialized blob; beyond this we drop trailing steps. */
export const TRACE_BLOB_MAX = 24_000;
/** Never persist more than this many steps (defensive against runaway turns). */
const MAX_STEPS = 40;
const MAX_COUNCIL_MEMBERS = 12;
const MAX_CONCERNS = 12;
const MAX_PROCESS_LOG_ENTRIES = 24;
const MAX_TOOL_RUNS = 24;
const MAX_DRAFT_CANDIDATES = 12;
const MAX_DRAFT_VOTES = 12;
const MAX_DRAFT_SCORES = 12;

function clamp(value: string | undefined, max = FIELD_MAX): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

/** Drop undefined keys so the JSON stays compact and round-trips cleanly. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined) delete obj[key];
  }
  return obj;
}

function pruneStep(
  step: ChatProgressStep,
  index: number,
  turnOutcome: TurnProgressOutcome,
): ChatProgressStep {
  const outcome: ProgressOutcome = step.outcome
    ?? (step.status === 'done'
      ? 'succeeded'
      : turnOutcome === 'failed'
        ? 'failed'
        : turnOutcome === 'succeeded'
          ? 'interrupted'
          : turnOutcome);
  const council = step.councilMembers?.slice(0, MAX_COUNCIL_MEMBERS).map((m) =>
    compact({
      memberId: m.memberId,
      name: m.name,
      topic: clamp(m.topic, 120),
      verdict: m.verdict,
      confidence: m.confidence,
      durationMs: m.durationMs,
      note: clamp(m.note),
      // `pending` is a live-only flag — a persisted member has already returned.
      failed: m.failed || undefined,
      realIntent: clamp(m.realIntent),
      hiddenMeaning: clamp(m.hiddenMeaning),
      missingCapability: clamp(m.missingCapability),
      methodLesson: clamp(m.methodLesson),
      suggestedAction: clamp(m.suggestedAction),
      concerns: m.concerns?.length
        ? m.concerns.slice(0, MAX_CONCERNS).map((c) => clamp(c, 240)!).filter(Boolean)
        : undefined,
    }),
  );
  const log = step.processLog?.slice(0, MAX_PROCESS_LOG_ENTRIES).map((entry) =>
    compact({ kind: entry.kind, label: entry.label, body: clamp(entry.body) }),
  );
  const tools = step.toolRuns?.slice(0, MAX_TOOL_RUNS).map((run) => {
    const toolOutcome: ProgressOutcome = run.outcome
      ?? (run.status === 'failed' || run.success === false
        ? 'failed'
        : run.status === 'done'
          ? 'succeeded'
          : turnOutcome === 'failed'
            ? 'failed'
            : turnOutcome === 'succeeded'
              ? 'interrupted'
              : turnOutcome);
    return compact({
      id: run.id,
      name: run.name,
      status: toolOutcome === 'failed' ? 'failed' as const : 'done' as const,
      outcome: toolOutcome,
      evidenceId: run.evidenceId ?? `${evidenceId(step.stage, index)}:tool:${run.id}`,
      success: toolOutcome === 'succeeded'
        ? true
        : toolOutcome === 'failed'
          ? false
          : undefined,
      durationMs: run.durationMs,
      input: clamp(run.input),
      output: clamp(run.output),
    });
  }) as ChatProgressStep['toolRuns'];

  // Persisted race: keep the structure (who fielded, who voted, who won) with the
  // candidate texts clamped like every other free-text field. Live-only `pending`
  // flags drop — a persisted candidate has already returned or failed.
  const race = step.draftRace
      ? compact({
        status: 'decided' as const,
        outcome: step.draftRace.outcome
          ?? (step.draftRace.status === 'decided'
            ? 'succeeded'
            : turnOutcome === 'failed'
              ? 'failed'
              : turnOutcome === 'succeeded'
                ? 'interrupted'
                : turnOutcome),
        evidenceId: step.draftRace.evidenceId ?? `${evidenceId(step.stage, index)}:draft-race`,
        candidates: step.draftRace.candidates.slice(0, MAX_DRAFT_CANDIDATES).map((c) =>
          compact({
            authorId: c.authorId,
            authorName: c.authorName,
            modelId: c.modelId,
            text: clamp(c.text) ?? '',
            provisional: c.provisional || undefined,
            failed: c.failed || undefined,
            durationMs: c.durationMs,
          }),
        ),
        votes: step.draftRace.votes?.slice(0, MAX_DRAFT_VOTES).map((v) =>
          compact({
            voterId: v.voterId,
            voterName: v.voterName,
            scores: Object.fromEntries(Object.entries(v.scores).slice(0, MAX_DRAFT_SCORES)),
            note: clamp(v.note, 240),
          }),
        ) ?? [],
        winnerId: step.draftRace.winnerId,
        tieBrokenToVai: step.draftRace.tieBrokenToVai || undefined,
      })
    : undefined;

  return compact({
    stage: step.stage,
    label: step.label,
    detail: clamp(step.detail),
    // A persisted step is always settled — running rows finalize to done.
    status: 'done',
    outcome,
    evidenceId: step.evidenceId ?? evidenceId(step.stage, index),
    durationMs: step.durationMs,
    advisor: step.advisor,
    councilMembers: council?.length ? council : undefined,
    processLog: log?.length ? log : undefined,
    toolRuns: tools?.length ? tools : undefined,
    draftRace: race,
  }) as ChatProgressStep;
}

/**
 * Serialize a turn's progress steps to a compact JSON blob for the DB, or
 * `undefined` when there is nothing worth persisting. Trailing steps are dropped
 * if the blob would exceed {@link TRACE_BLOB_MAX} (rare; keeps storage bounded).
 */
export function serializeProgressTrace(
  steps: readonly ChatProgressStep[] | undefined,
  turnOutcome: TurnProgressOutcome = 'succeeded',
): string | undefined {
  if (!steps || steps.length === 0) return undefined;
  const terminal: ChatProgressStep = {
    stage: 'turn-terminal',
    label: turnOutcome === 'succeeded'
      ? 'Turn completed'
      : turnOutcome === 'failed'
        ? 'Turn failed'
        : turnOutcome === 'interrupted'
          ? 'Turn interrupted'
          : turnOutcome === 'withheld'
            ? 'Output withheld'
            : 'Turn not run',
    status: 'done',
    outcome: turnOutcome,
    evidenceId: 'progress:terminal:turn',
  };
  const workSteps = steps.filter((step) => step.stage !== 'turn-terminal');
  let pruned = [
    ...workSteps.slice(0, MAX_STEPS - 1).map((step, index) => pruneStep(step, index, turnOutcome)),
    terminal,
  ];
  let blob = JSON.stringify({ version: 3, turnOutcome, steps: pruned });
  while (blob.length > TRACE_BLOB_MAX && pruned.length > 2) {
    pruned = [...pruned.slice(0, -2), pruned.at(-1)!];
    blob = JSON.stringify({ version: 3, turnOutcome, steps: pruned });
  }
  // A single oversized step still beats showing nothing — it's already field-clamped.
  if (blob.length > TRACE_BLOB_MAX) {
    pruned = [terminal];
    blob = JSON.stringify({ version: 3, turnOutcome, steps: pruned });
  }
  return blob;
}

function isValidVersion3Trace(
  steps: readonly ChatProgressStep[],
  turnOutcome: ProgressOutcome,
): boolean {
  const terminalIndexes = steps
    .map((step, index) => step.stage === 'turn-terminal' ? index : -1)
    .filter((index) => index >= 0);
  if (
    terminalIndexes.length !== 1
    || terminalIndexes[0] !== steps.length - 1
    || steps.at(-1)?.outcome !== turnOutcome
    || steps.at(-1)?.evidenceId !== 'progress:terminal:turn'
  ) {
    return false;
  }

  const evidenceIds = new Set<string>();
  const recordEvidence = (value: string | undefined): boolean => {
    if (!value || evidenceIds.has(value)) return false;
    evidenceIds.add(value);
    return true;
  };

  for (const step of steps) {
    if (step.status !== 'done' || !step.outcome || !recordEvidence(step.evidenceId)) {
      return false;
    }
    for (const run of step.toolRuns ?? []) {
      if (
        run.status === 'running'
        || !run.outcome
        || !recordEvidence(run.evidenceId)
        || (run.status === 'failed') !== (run.outcome === 'failed')
        || (run.success === false && run.outcome !== 'failed')
        || (run.success === true && run.outcome !== 'succeeded')
      ) {
        return false;
      }
    }
    if (step.draftRace) {
      if (
        step.draftRace.status !== 'decided'
        || !step.draftRace.outcome
        || !recordEvidence(step.draftRace.evidenceId)
        || step.draftRace.candidates.some((candidate) => candidate.pending)
        || (step.draftRace.votes ?? []).some((vote) => vote.pending)
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Rehydrate a persisted blob back into progress steps for the ProcessTree.
 * Returns `undefined` for null/empty/corrupt input (the tree simply renders its
 * settled summary line, exactly as before this column existed).
 */
export function deserializeProgressTrace(
  blob: string | null | undefined,
): ChatProgressStep[] | undefined {
  if (!blob) return undefined;
  try {
    const parsed = JSON.parse(blob) as {
      version?: unknown;
      turnOutcome?: unknown;
      steps?: unknown;
    };
    // Version-1 traces were persisted before the assistant row existed and were
    // therefore attached to the preceding answer. They are intentionally not
    // rendered: missing history is safer than showing another turn's work as fact.
    if (!parsed || ![2, 3].includes(parsed.version as number) || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      return undefined;
    }
    if (parsed.version === 3) {
      const outcome = progressOutcomeSchema.safeParse(parsed.turnOutcome);
      if (!outcome.success) return undefined;
      const validated = chatProgressStepSchema.array().safeParse(parsed.steps);
      if (!validated.success) return undefined;
      const steps = validated.data as ChatProgressStep[];
      return isValidVersion3Trace(steps, outcome.data) ? steps : undefined;
    }
    // Trust-but-shape: keep only objects with the required stage/label/status.
    const steps = parsed.steps.filter(
      (value: unknown): value is ChatProgressStep => {
        const step = value as Partial<ChatProgressStep> | null;
        return Boolean(step && typeof step.stage === 'string' && typeof step.label === 'string' && typeof step.status === 'string');
      },
    );
    return steps.length ? steps : undefined;
  } catch {
    return undefined;
  }
}
