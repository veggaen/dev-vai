/**
 * Self-evaluator — runs registered predicates against a candidate response.
 *
 * See docs/capabilities/self-evaluation.md.
 *
 * Public API:
 *   new SelfEvaluator({ predicates, generateRevision, debug? })
 *   evaluate(input, history, candidate): Promise<SelfEvalVerdict>
 *
 * Design contract (binding):
 *   - At most ONE revision attempt. If draft-2 also fails, the verdict is
 *     'flag-uncertain' and draft-2 is emitted unchanged.
 *   - Aggregation precedence: any predicate fail → fail. No "majority vote".
 *   - derive() returning null = no-op; predicate doesn't run.
 *   - All evaluation is pure (no I/O). Revision generation is delegated to the
 *     injected generateRevision callback.
 */

import type { Message } from '../models/adapter.js';
import type {
  CompiledPredicate,
  DraftTraceRecord,
  ResponsePredicate,
  SelfEvalVerdict,
} from './types.js';

/** Callback that produces a revised candidate given a hint. */
export type GenerateRevisionFn = (
  input: string,
  history: readonly Message[],
  hint: string,
) => Promise<string>;

export interface SelfEvaluatorOptions {
  /** Predicate registry (constraint-checking only this turn). */
  readonly predicates: readonly ResponsePredicate[];
  /** Called to produce the second draft when first draft fails. */
  readonly generateRevision: GenerateRevisionFn;
  /**
   * When true, SelfEvaluator logs the registered predicate set on construction
   * (count + names). Gated to keep production output clean. Per Addition #1
   * in the design doc.
   */
  readonly debug?: boolean;
}

export class SelfEvaluator {
  private readonly _predicates: readonly ResponsePredicate[];
  private readonly _generateRevision: GenerateRevisionFn;

  constructor(opts: SelfEvaluatorOptions) {
    this._predicates = opts.predicates;
    this._generateRevision = opts.generateRevision;
    if (opts.debug) {
      // eslint-disable-next-line no-console
      console.debug(
        `[self-eval] registered ${this._predicates.length} predicate(s): ${this._predicates
          .map((p) => p.id)
          .join(', ')}`,
      );
    }
  }

  /** Read-only access to registered predicate IDs (for diagnostics). */
  get registeredPredicateIds(): readonly string[] {
    return this._predicates.map((p) => p.id);
  }

  /**
   * Run the self-evaluation cycle on a candidate.
   *
   * Single-revision cap: at most one call to generateRevision().
   * If the second draft also fails, returns 'flag-uncertain' with the
   * second draft as `emit` (callers should still emit; the verdict
   * is observability, not a refusal gate).
   */
  async evaluate(
    input: string,
    history: readonly Message[],
    candidate: string,
  ): Promise<SelfEvalVerdict> {
    const compiled = this._compileApplicable(input, history);

    // No applicable predicates → trivial pass.
    if (compiled.length === 0) {
      return {
        kind: 'pass',
        emit: candidate,
        lastHint: null,
        failedPredicates: [],
        revisionApplied: false,
        capFired: false,
        trace: [
          {
            stage: 'draft-1',
            candidate,
            verdict: 'pass',
            failedPredicates: [],
            hint: null,
          },
        ],
      };
    }

    const trace: DraftTraceRecord[] = [];

    // ── Draft 1 ───────────────────────────────────────────────────────
    const draft1 = this._runPredicates(compiled, candidate, input, history);
    trace.push({
      stage: 'draft-1',
      candidate,
      verdict: draft1.failed.length === 0 ? 'pass' : 'fail',
      failedPredicates: draft1.failed,
      hint: draft1.hint,
    });

    if (draft1.failed.length === 0) {
      return {
        kind: 'pass',
        emit: candidate,
        lastHint: null,
        failedPredicates: [],
        revisionApplied: false,
        capFired: false,
        trace,
      };
    }

    // ── Draft 2 (the only allowed revision) ──────────────────────────
    let draft2Candidate: string;
    try {
      draft2Candidate = await this._generateRevision(input, history, draft1.hint!);
    } catch {
      // Revision generation itself failed → flag-uncertain on draft-1.
      return {
        kind: 'flag-uncertain',
        emit: candidate,
        lastHint: draft1.hint,
        failedPredicates: draft1.failed,
        revisionApplied: false,
        capFired: false,
        trace,
      };
    }

    const draft2 = this._runPredicates(compiled, draft2Candidate, input, history);
    trace.push({
      stage: 'draft-2',
      candidate: draft2Candidate,
      verdict: draft2.failed.length === 0 ? 'pass' : 'fail',
      failedPredicates: draft2.failed,
      hint: draft2.hint,
    });

    if (draft2.failed.length === 0) {
      return {
        kind: 'revise-applied',
        emit: draft2Candidate,
        lastHint: null,
        failedPredicates: [],
        revisionApplied: true,
        capFired: false,
        trace,
      };
    }

    // Cap fires. Second draft also failed. Emit second draft anyway, flag uncertain.
    return {
      kind: 'flag-uncertain',
      emit: draft2Candidate,
      lastHint: draft2.hint,
      failedPredicates: draft2.failed,
      revisionApplied: true,
      capFired: true,
      trace,
    };
  }

  /**
   * Diagnostic-only: generate a third draft and verdict it without emitting.
   * Used by --draft-trace per Addition #2; the engine never emits this draft.
   * Returns null if the prior verdict didn't fire the cap.
   */
  async generateCapSuppressedDiagnostic(
    input: string,
    history: readonly Message[],
    verdict: SelfEvalVerdict,
  ): Promise<DraftTraceRecord | null> {
    if (!verdict.capFired || verdict.lastHint == null) return null;
    const compiled = this._compileApplicable(input, history);
    let draft3: string;
    try {
      draft3 = await this._generateRevision(input, history, verdict.lastHint);
    } catch {
      return null;
    }
    const result = this._runPredicates(compiled, draft3, input, history);
    return {
      stage: 'draft-3-cap-suppressed',
      candidate: draft3,
      verdict: result.failed.length === 0 ? 'pass' : 'fail',
      failedPredicates: result.failed,
      hint: result.hint,
      capSuppressed: true,
    };
  }

  private _compileApplicable(input: string, history: readonly Message[]): CompiledPredicate[] {
    const out: CompiledPredicate[] = [];
    for (const p of this._predicates) {
      const compiled = p.derive(input, history);
      if (compiled !== null) out.push(compiled);
    }
    return out;
  }

  private _runPredicates(
    compiled: readonly CompiledPredicate[],
    candidate: string,
    input: string,
    history: readonly Message[],
  ): { failed: string[]; hint: string | null } {
    const failed: string[] = [];
    const hints: string[] = [];
    for (const c of compiled) {
      const res = c.check(candidate, input, history);
      if (!res.ok) {
        failed.push(c.id);
        hints.push(res.hint);
      }
    }
    return {
      failed,
      hint: hints.length === 0 ? null : hints.join(' ').slice(0, 200),
    };
  }
}
