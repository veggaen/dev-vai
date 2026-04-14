/**
 * Shared vocabulary for the Proof-Backed Builder Loop: evidence tiers, failure taxonomy, recovery hooks.
 * Narration and ledgers should reference these — avoids "confidence: 82%" without grounding.
 *
 * Meta-loop extension: log outcomeTelemetry alongside tier + failureClass for closed-loop tuning later.
 */

/** Grounded trust level for user-facing narration */
export type EvidenceConfidenceTier = 'high' | 'medium' | 'low' | 'unverified';

/** Narrow failure buckets → attach recovery playbooks in the ledger (incremental quality) */
export type FailureClass =
  | 'syntax_build'
  | 'typecheck'
  | 'dependency_install'
  | 'runtime'
  | 'hydration'
  | 'browser_console'
  | 'browser_automation'
  | 'selector_drift'
  | 'config_env'
  | 'contract_api'
  | 'asset_render'
  | 'ambiguous_spec'
  | 'unknown';

export interface ProofFlags {
  readonly buildOk?: boolean;
  readonly typecheckOk?: boolean;
  readonly screenshotOk?: boolean;
  readonly testsOk?: boolean;
  /** No execution proof — model reasoning only */
  readonly reasoningOnly?: boolean;
}

/**
 * Map verifier outputs to a tier. Conservative: missing proof → unverified/low.
 */
export function evidenceTierFromProof(flags: ProofFlags): EvidenceConfidenceTier {
  if (flags.reasoningOnly) return 'low';
  const { buildOk, typecheckOk, screenshotOk, testsOk } = flags;
  if (screenshotOk && buildOk && typecheckOk) return 'high';
  if (buildOk && typecheckOk) return 'medium';
  if (buildOk === true || typecheckOk === true || testsOk === true) return 'medium';
  if (buildOk === false || typecheckOk === false) return 'unverified';
  return 'low';
}
