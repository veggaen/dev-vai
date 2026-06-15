/**
 * Capability — answer "did the tests pass / does it build / does it typecheck" from a
 * REAL command run, never a guess.
 *
 * "Run the tests", "does it build?", "did lint pass?" are questions a command answers
 * with an exit code. This capability composes its answer ONLY from attached
 * {@link RunEvidence} (captured by {@link runCommandEvidence}) and — critically — its
 * `verify` binds the pass/fail claim to the REAL exit code. If the composed answer says
 * "passed" but the evidence's exit code is non-zero (or vice-versa), verify REFUSES and
 * the dispatcher falls through. This is the structural guard against the most damaging
 * exec hallucination: claiming a green run that never happened.
 *
 * Like git, it does NOT run the command itself (resolve is synchronous). The caller runs
 * the allowlisted command before dispatch and attaches the result to `ctx.evidence.run`.
 *
 * Contract:
 *   - CAN DO:   report the outcome (pass/fail/timeout), exit code, and a stdout/stderr
 *               tail of one attached verification run.
 *   - EVIDENCE: the typed RunEvidence; verify().boundEvidence cites its id.
 *   - COST:     latency/cost derive from the run's measured durationMs (the command's own
 *               runtime dominates); risk is moderate — a wrong claim about a build is
 *               costly, which is exactly why verify binds to the exit code.
 *   - VERIFIED: the released claim's pass/fail MUST equal the evidence's exit-code outcome.
 */

import type { Resolution, ScoreResult, TurnContext } from '../turn-pipeline.js';
import {
  scoreFromBreakdown,
  type Capability,
  type ScoreBreakdown,
  type VerificationResult,
} from '../capability-kernel.js';
import { hasRunEvidence, type RunEvidence } from '../../tools/run-evidence.js';

/** Phrasing that indicates a "run a verification command" question. */
const EXEC_RE = /\b(run (?:the )?(?:tests?|test suite|build|lint|typecheck|checks?)|do(?:es)? (?:it|the (?:tests?|build|code)) (?:pass|build|compile|typecheck)|did (?:the )?(?:tests?|build|lint|ci) pass|is (?:it|the build) (?:green|passing)|are (?:the )?tests? passing|check if it (?:builds|compiles|passes))\b/i;

/** Classify whether the turn is asking to run/verify via a command. Pure. */
export function isExecQuery(text: string): boolean {
  return EXEC_RE.test(text ?? '');
}

const GROUNDED_MARKER = '**Run evidence';
const NO_EVIDENCE_MARKER = 'no command was run';

/** Map measured run time to a 0..1 latency penalty (60s+ → full penalty). */
function latencyPenalty(durationMs: number | undefined): number {
  if (!durationMs || durationMs <= 0) return 0.1;
  return Math.min(1, durationMs / 60_000);
}

function outcomeWord(run: RunEvidence): 'passed' | 'failed' | 'timed out' {
  if (run.timedOut) return 'timed out';
  return run.passed ? 'passed' : 'failed';
}

/** A short tail of output for the answer (the most recent, most relevant lines). */
function outputTail(text: string, maxLines = 12): string {
  const lines = text.trimEnd().split('\n');
  return lines.slice(-maxLines).join('\n');
}

function compose(run: RunEvidence): string {
  const word = outcomeWord(run);
  const lines: string[] = [
    `${GROUNDED_MARKER} (\`${run.command} ${run.args.join(' ')}\`.trim(), ${run.durationMs}ms):**`,
    '',
    `- **Outcome:** ${word} (exit code ${run.exitCode ?? 'killed'})`,
  ];
  if (run.timedOut) lines.push('- **Timed out** before completing.');
  const tail = outputTail(run.stderr || run.stdout);
  if (tail.trim()) {
    lines.push('', '```', tail, '```');
  }
  return lines.join('\n');
}

export const execCapability: Capability = {
  name: 'exec',

  score(ctx: TurnContext): ScoreResult {
    const breakdown = this.estimate(ctx);
    if (breakdown === null) return null;
    return { score: scoreFromBreakdown(breakdown), reason: breakdown.reason };
  },

  estimate(ctx: TurnContext): ScoreBreakdown | null {
    if (!isExecQuery(ctx.understood || ctx.content)) return null;
    const run = ctx.evidence?.run;
    const haveRun = hasRunEvidence(run);
    return {
      // Exec phrasing is specific ("run the tests", "does it build").
      intentFit: 0.88,
      // The product is a grounded run outcome; with no attached run this is 0 and the
      // resolve/verify gate keeps the capability from claiming a result it doesn't have.
      evidence: haveRun ? 1 : 0,
      history: 0.5,
      latency: latencyPenalty(run?.durationMs),
      cost: 0.1,
      // Moderate intrinsic risk: a wrong claim about a build/test outcome is costly.
      // The verify gate (bind to exit code) is what contains it.
      risk: 0.15,
      reason: 'Run/verify question — answer only from a real attached command run.',
    };
  },

  resolve(ctx: TurnContext): Resolution | null {
    if (!isExecQuery(ctx.understood || ctx.content)) return null;
    const run: RunEvidence | undefined = ctx.evidence?.run;
    const runError = run?.error;

    if (!hasRunEvidence(run)) {
      const why = runError ? ` (${runError})` : '';
      return {
        text: `I can answer that by running it, but ${NO_EVIDENCE_MARKER} for this turn${why}. Re-ask with a runnable project and I'll run the allowlisted check and report the real exit code.`,
        turnKind: 'analysis',
        confidence: 0.55,
        strategy: 'exec',
      } as Resolution;
    }

    return {
      text: compose(run),
      turnKind: 'analysis',
      confidence: 0.97,
      strategy: 'exec',
    } as Resolution;
  },

  /**
   * Bind the pass/fail CLAIM in the answer to the REAL exit code. The released text
   * must state an outcome consistent with the evidence: a "passed" answer requires
   * exit 0 and no timeout; a "failed"/"timed out" answer requires the matching
   * evidence. Any inconsistency is refused — the guard against a fabricated green run.
   */
  verify(resolution: Resolution, ctx: TurnContext): VerificationResult {
    const text = resolution.text ?? '';
    if (text.includes(NO_EVIDENCE_MARKER)) {
      return { ok: true, reason: 'Honest no-run decline — no run claim made.' };
    }
    const run = ctx.evidence?.run;
    if (!hasRunEvidence(run)) {
      return { ok: false, reason: 'Run answer composed but no run evidence is attached — refusing to release.' };
    }
    if (!text.startsWith(GROUNDED_MARKER)) {
      return { ok: false, reason: 'Run answer lacks the evidence header — not a grounded composition.' };
    }

    const claimsPassed = /\boutcome:\*\*\s*passed\b/i.test(text);
    const claimsFailed = /\boutcome:\*\*\s*failed\b/i.test(text);
    const claimsTimedOut = /\boutcome:\*\*\s*timed out\b/i.test(text) || /\btimed out\b/i.test(text);
    const realOutcome = outcomeWord(run);

    if (claimsPassed && realOutcome !== 'passed') {
      return { ok: false, reason: `Answer claims the run passed but the real exit code is ${run.exitCode ?? 'null'} (${realOutcome}) — refusing.` };
    }
    if (claimsFailed && realOutcome !== 'failed') {
      return { ok: false, reason: `Answer claims the run failed but the real outcome is ${realOutcome} — refusing.` };
    }
    if (claimsTimedOut && !run.timedOut) {
      return { ok: false, reason: 'Answer claims a timeout but the run completed — refusing.' };
    }
    if (!claimsPassed && !claimsFailed && !claimsTimedOut) {
      return { ok: false, reason: 'Run answer states no bindable outcome — refusing.' };
    }
    return { ok: true, boundEvidence: [run.id], reason: `Outcome bound to exit code ${run.exitCode ?? 'null'} (${realOutcome}).` };
  },
};
