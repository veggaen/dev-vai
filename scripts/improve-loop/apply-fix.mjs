/**
 * Apply-fix harness — the keystone of the audit→fix→verify self-improvement loop.
 *
 * Closes the loop the existing tooling left open: consensus-fix.mjs PROPOSES a grep-verified
 * {file,find,replace}; this module is the gate that actually applies it — SAFELY:
 *
 *   1. Risk-tier gate (risk-tier.mjs): a 'review'-tier fix is NEVER auto-applied — returned
 *      as { applied:false, tier:'review', reasons } to be flagged to Vegga (the friend-tap).
 *   2. Exact, single-occurrence find→replace: the `find` must be grep-verified AND appear
 *      EXACTLY ONCE in the file (an ambiguous match is refused — we never guess which line).
 *   3. Verify: run the injected verifier (tsc + tests). GREEN → commit to council/auto-improve
 *      with the audit reasoning. NOT green → REVERT the file and report (never leave a broken
 *      tree, never commit red).
 *
 * All side-effecting deps (readFile/writeFile, verify, commit) are INJECTED so the harness is
 * unit-tested without touching real source or git. The real wiring passes node:fs + a runner
 * that shells `tsc`/`vitest` + a git committer scoped to the dedicated branch. Never throws.
 */

import { classifyRisk, RISK_TIER } from './risk-tier.mjs';

/**
 * @param proposal { file, find, replace, why }
 * @param deps {
 *   readFile(file): string|null,         // current file contents (null if missing)
 *   writeFile(file, contents): void,     // overwrite
 *   verify(): Promise<{ok:boolean, detail:string}>,  // tsc + tests; ok=green
 *   commit(message, file): Promise<void>, // stage `file` + commit to council/auto-improve
 *   branch?: string,                     // for the audit message (default council/auto-improve)
 * }
 * @returns { applied, tier, reasons, verifyDetail?, committed }
 */
export async function applyVerifiedFix(proposal, deps) {
  const branch = deps.branch ?? 'council/auto-improve';
  const { tier, reasons } = classifyRisk(proposal);

  // Gate 1 — risk tier. Review-tier fixes are surfaced, never auto-applied.
  if (tier === RISK_TIER.REVIEW) {
    return { applied: false, committed: false, tier, reasons, verifyDetail: 'propose-only (risk tier) — flagged for Vegga' };
  }

  // Gate 2 — exact, unambiguous application.
  const before = deps.readFile(proposal.file);
  if (before == null) {
    return { applied: false, committed: false, tier, reasons: [`file not found: ${proposal.file}`] };
  }
  const occurrences = before.split(proposal.find).length - 1;
  if (occurrences === 0) {
    return { applied: false, committed: false, tier, reasons: [`find not present in ${proposal.file} (stale/hallucinated)`] };
  }
  if (occurrences > 1) {
    return { applied: false, committed: false, tier, reasons: [`find is ambiguous (${occurrences} matches) — refusing to guess which line`] };
  }

  const after = before.replace(proposal.find, proposal.replace);
  if (after === before) {
    return { applied: false, committed: false, tier, reasons: ['no-op (replace equals find)'] };
  }

  // Apply, then verify. Revert on red so the tree is never left broken.
  deps.writeFile(proposal.file, after);
  let verifyResult;
  try {
    verifyResult = await deps.verify();
  } catch (err) {
    deps.writeFile(proposal.file, before);
    return { applied: false, committed: false, tier, reasons: [`verify threw: ${String(err).slice(0, 80)}`] };
  }

  if (!verifyResult.ok) {
    deps.writeFile(proposal.file, before); // revert — NEVER commit red
    return { applied: false, committed: false, tier, reasons, verifyDetail: `reverted — verify failed: ${verifyResult.detail}` };
  }

  // Green → commit to the dedicated branch with the audit reasoning.
  const message = [
    `fix(self-improve): ${proposal.why || 'council-verified fix'}`,
    '',
    `file: ${proposal.file}`,
    proposal.why ? `why: ${proposal.why}` : '',
    `verified: ${verifyResult.detail}`,
    `auto-applied to ${branch} (risk tier: safe). Reversible; visible in git history.`,
  ].filter(Boolean).join('\n');
  try {
    await deps.commit(message, proposal.file);
  } catch (err) {
    return { applied: true, committed: false, tier, reasons: [`applied + verified, but commit failed: ${String(err).slice(0, 80)}`], verifyDetail: verifyResult.detail };
  }
  return { applied: true, committed: true, tier, reasons, verifyDetail: verifyResult.detail };
}
