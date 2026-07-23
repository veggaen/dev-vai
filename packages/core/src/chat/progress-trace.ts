import type { ChatChunk } from '../models/adapter.js';

/**
 * Core-owned structural view of one streamed progress frame. The runtime may
 * enrich a core progress frame with an advisor packet before it reaches the
 * WebSocket; persistence treats that packet as opaque structured metadata.
 */
export type ChatProgressStep = NonNullable<ChatChunk['progress']> & {
  readonly advisor?: Readonly<Record<string, unknown>>;
};

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
      next[priorIndex] = {
        ...prior,
        ...incoming,
        advisor: incoming.advisor ?? prior.advisor,
        councilMembers: incoming.councilMembers?.length ? incoming.councilMembers : prior.councilMembers,
        processLog: incoming.processLog?.length ? incoming.processLog : prior.processLog,
        toolRuns: incoming.toolRuns?.length ? incoming.toolRuns : prior.toolRuns,
        draftRace: incoming.draftRace ?? prior.draftRace,
      };
      return next;
    }
  }
  const settled = existing.map((step) =>
    step.status === 'running' ? { ...step, status: 'done' as const } : step,
  );
  return [...settled, incoming];
}

/** Per-field clamp for any single free-text value (notes, tool output, log bodies). */
const FIELD_MAX = 1200;
/** Hard ceiling for the serialized blob; beyond this we drop trailing steps. */
export const TRACE_BLOB_MAX = 24_000;
/** Never persist more than this many steps (defensive against runaway turns). */
const MAX_STEPS = 40;

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

function pruneStep(step: ChatProgressStep): ChatProgressStep {
  const council = step.councilMembers?.map((m) =>
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
      concerns: m.concerns?.length ? m.concerns.map((c) => clamp(c, 240)!).filter(Boolean) : undefined,
    }),
  );
  const log = step.processLog?.map((entry) =>
    compact({ kind: entry.kind, label: entry.label, body: clamp(entry.body) }),
  );
  const tools = step.toolRuns?.map((run) =>
    compact({
      id: run.id,
      name: run.name,
      // A persisted tool run is finished; running/failed both settle to a terminal state.
      status: run.status === 'running' ? 'done' : run.status,
      success: run.success,
      durationMs: run.durationMs,
      input: clamp(run.input),
      output: clamp(run.output),
    }),
  ) as ChatProgressStep['toolRuns'];

  // Persisted race: keep the structure (who fielded, who voted, who won) with the
  // candidate texts clamped like every other free-text field. Live-only `pending`
  // flags drop — a persisted candidate has already returned or failed.
  const race = step.draftRace
    ? compact({
        // A persisted race is always settled.
        status: 'decided' as const,
        candidates: step.draftRace.candidates.map((c) =>
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
        votes: step.draftRace.votes?.map((v) =>
          compact({ voterId: v.voterId, voterName: v.voterName, scores: v.scores, note: clamp(v.note, 240) }),
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
    status: step.status === 'running' ? 'done' : step.status,
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
): string | undefined {
  if (!steps || steps.length === 0) return undefined;
  let pruned = steps.slice(0, MAX_STEPS).map(pruneStep);
  let blob = JSON.stringify({ version: 2, steps: pruned });
  while (blob.length > TRACE_BLOB_MAX && pruned.length > 1) {
    pruned = pruned.slice(0, -1);
    blob = JSON.stringify({ version: 2, steps: pruned });
  }
  // A single oversized step still beats showing nothing — it's already field-clamped.
  return blob;
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
    const parsed = JSON.parse(blob) as { version?: unknown; steps?: unknown };
    // Version-1 traces were persisted before the assistant row existed and were
    // therefore attached to the preceding answer. They are intentionally not
    // rendered: missing history is safer than showing another turn's work as fact.
    if (!parsed || parsed.version !== 2 || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      return undefined;
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
