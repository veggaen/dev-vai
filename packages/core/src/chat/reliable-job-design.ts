/**
 * Vai-owned reliable asynchronous-work architecture lane.
 *
 * This is a bounded systems-design policy, not a prose lookup. It recognizes a
 * request by its invariants (durability, duplicate safety, progress, overload,
 * recovery, evidence, rollout) and composes the smallest architecture that
 * satisfies them. Models may later critique this answer, but do not own it.
 */

export interface ReliableJobDesign {
  readonly reply: string;
  readonly confidence: number;
  readonly matchedInvariants: readonly string[];
}

const DESIGN_CUE = /\b(?:design|architect|architecture|system\s+design)\b/i;
const ASYNC_WORK_CUE = /\b(?:background[ -]jobs?|job\s+(?:system|runner|worker)|workers?|queues?|index(?:ing)?\s+jobs?|delivery\s+jobs?|async(?:hronous)?\s+(?:tasks?|work))\b/i;

const INVARIANTS: ReadonlyArray<{ readonly id: string; readonly pattern: RegExp }> = [
  { id: 'durability', pattern: /\b(?:persist|durable|survive\s+(?:a\s+)?restart|across\s+restarts?|after\s+(?:process\s+)?crashes?)\b/i },
  { id: 'duplicate-safety', pattern: /\b(?:duplicate|idempoten|exactly[ -]once|side effects?|duplicate sends?|duplicate embeddings?)\b/i },
  { id: 'progress', pattern: /\b(?:progress|checkpoint|status)\b/i },
  { id: 'overload', pattern: /\b(?:overload|backpressure|bounded|queue\s+(?:depth|limit)|concurrency)\b/i },
  { id: 'recovery', pattern: /\b(?:failure|recovery|retry|crash|dead[ -]?letter|lease)\b/i },
  { id: 'metrics', pattern: /\b(?:metrics|measure|observab|telemetry)\b/i },
  { id: 'rollout', pattern: /\b(?:rollout|staged|shadow|canary|kill\s+switch)\b/i },
];

function workloadLabel(input: string): string {
  if (/\bdocument[ -]index/i.test(input)) return 'document-indexing';
  if (/\bemail[ -]delivery/i.test(input)) return 'email-delivery';
  if (/\bdesktop\s+ai\b/i.test(input)) return 'desktop-AI background';
  return 'background';
}

export function tryReliableJobDesign(input: string): ReliableJobDesign | null {
  if (!DESIGN_CUE.test(input) || !ASYNC_WORK_CUE.test(input)) return null;
  const matchedInvariants = INVARIANTS.filter((invariant) => invariant.pattern.test(input)).map((invariant) => invariant.id);
  if (matchedInvariants.length < 3) return null;

  const workload = workloadLabel(input);
  const durableStore = /\b(?:desktop|local|single[ -](?:machine|process))\b/i.test(input)
    ? 'a local SQLite job table'
    : 'a durable transactional job table';
  const effect = /\bemail\b/i.test(input)
    ? 'send'
    : /\bembed/i.test(input)
      ? 'embedding write'
      : 'external side effect';
  const rolloutUnit = /\bemail\b/i.test(input)
    ? 'one email class'
    : /\bdocument\b/i.test(input)
      ? 'one document class'
      : 'one job class';

  const reply = [
    `Architecture: persist the ${workload} jobs in ${durableStore} with an explicit state machine. Bounded workers claim ready jobs using expiring leases. Give every ${effect} an idempotency key, and checkpoint progress after durable steps.`,
    '',
    'Failure handling: retry transient failures with capped exponential backoff, reclaim expired leases after crashes, and move exhausted jobs to a dead-letter state for inspection. Treat delivery as at-least-once and make the side effect idempotent instead of claiming magical exactly-once execution.',
    '',
    'Overload: cap worker concurrency and queue depth, then apply backpressure at intake. Do not accept unlimited work into memory.',
    '',
    'Metrics: queue depth and age, claim latency, active leases, completion latency, retry rate, dead letters, and idempotency conflicts. Expose per-job state and checkpoint progress to the UI.',
    '',
    `Rollout: shadow-record first, enable ${rolloutUnit}, inject a crash and duplicate delivery, verify recovery and side-effect uniqueness, then expand behind a kill switch.`,
  ].join('\n');

  return { reply, confidence: 0.96, matchedInvariants };
}

