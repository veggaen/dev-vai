/**
 * Stage E — Visual / fact grounding log writer.
 *
 * Appends one labeled outcome per cross-check / vision run to `visual_grounding_log`. This is the
 * learning dataset: it lets us tune the corroboration threshold + tolerance, score new-vs-old over
 * real traffic, and (later) fine-tune Vai's visual inspection. The `errorType` taxonomy buckets
 * failure CLASSES (from the council review) instead of a flat pass/fail.
 *
 * Writing is best-effort and must NEVER break a turn — every call is wrapped so a logging failure
 * is swallowed. Append-only; never read on the hot path.
 */

import { ulid } from 'ulid';
import { visualGroundingLog } from '../db/schema.js';

/** Failure classes — buckets for the learning data (null = a clean run). */
export type GroundingErrorType =
  | 'price_hallucination'
  | 'image_claim_without_vision'
  | 'fabricated_timestamp'
  | 'weak_source_confirmation'
  | 'persistent_error_after_correction';

export type GroundingVerdict = 'confirm' | 'contradict' | 'inconclusive' | 'declined';

export interface GroundingLogEntry {
  readonly conversationId?: string | null;
  readonly messageId?: string | null;
  readonly prompt: string;
  readonly subject?: string | null;
  readonly claimNumber?: number | null;
  readonly evidenceMedian?: number | null;
  readonly corroboration?: number;
  readonly verdict: GroundingVerdict;
  readonly visionUsed?: boolean;
  readonly visionConfidence?: number | null;
  readonly shipped?: boolean;
  readonly errorType?: GroundingErrorType | null;
}

/** Minimal shape of the drizzle db needed here (keeps this decoupled from the concrete client). */
export interface GroundingLogDb {
  insert: (table: typeof visualGroundingLog) => { values: (row: Record<string, unknown>) => { run: () => unknown } };
}

/** Append one grounding outcome. Best-effort: any error is swallowed (logging must not break a turn). */
export function logGrounding(db: GroundingLogDb, entry: GroundingLogEntry): void {
  try {
    db.insert(visualGroundingLog).values({
      id: ulid(),
      conversationId: entry.conversationId ?? null,
      messageId: entry.messageId ?? null,
      prompt: entry.prompt.slice(0, 2000),
      subject: entry.subject ?? null,
      claimNumber: entry.claimNumber ?? null,
      evidenceMedian: entry.evidenceMedian ?? null,
      corroboration: entry.corroboration ?? 0,
      verdict: entry.verdict,
      visionUsed: entry.visionUsed ?? false,
      visionConfidence: entry.visionConfidence ?? null,
      shipped: entry.shipped ?? false,
      errorType: entry.errorType ?? null,
      createdAt: new Date(),
    }).run();
  } catch {
    /* logging is best-effort — never break the turn */
  }
}
