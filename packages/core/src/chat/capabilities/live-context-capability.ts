import type { Resolution, ScoreResult, TurnContext } from '../turn-pipeline.js';
import { scoreFromBreakdown, type Capability, type ScoreBreakdown, type VerificationResult } from '../capability-kernel.js';
import {
  isWorkspaceDeltaQuestion,
  getRequestedLiveContextFields,
  tryEmitPrivateLiveContextResponse,
  tryEmitBridgeCapabilityAudit,
} from '../bridge-evidence-discipline.js';

/**
 * Capability #1 — Live workspace / editor context, kernel-wrapped.
 *
 * This is the first real capability expressed in the {@link capability-kernel.ts}
 * contract, chosen because the review flagged it precisely: "Which files changed
 * in my repo right now?" returns verified evidence, but a paraphrase misses the
 * route and hallucinates. Wrapping it as a Capability does two things the bare
 * handler did not:
 *
 *   - `estimate` reports an INSPECTABLE breakdown (high intent fit when the turn
 *     asks about live workspace state; high RISK because answering this kind of
 *     question from memory instead of attached evidence is exactly the failure
 *     mode to avoid). The risk term is what keeps it from grabbing a turn it
 *     can only answer by guessing.
 *
 *   - `verify` enforces evidence discipline as a first-class gate: the only
 *     answers this capability may release are (a) ones grounded in fresh
 *     attached evidence, or (b) an honest "live X unavailable" response. A
 *     confident claim about live state with no evidence binding fails verify and
 *     the dispatcher falls through — the structural fix for the class of bug
 *     where Vai claimed evidence it did not have.
 *
 * It reuses the existing, tested `bridge-evidence-discipline` functions verbatim
 * rather than reimplementing the regexes — the kernel is about contract and
 * verification, not a second copy of the matching logic.
 */

/** Marker emitted by the bridge's honest no-evidence responses. */
const UNAVAILABLE_MARKER = /\bunavailable\.?\*\*|I do not have a fresh timestamped|did not receive (?:an? )?(?:attributed|timestamped)/i;

/** A response is evidence-grounded when it carries the bridge's evidence line. */
const EVIDENCE_MARKER = /\*\*Evidence:\*\*|captured\s+`/i;

function asksAboutLiveContext(ctx: TurnContext): boolean {
  return (
    isWorkspaceDeltaQuestion(ctx.understood) ||
    getRequestedLiveContextFields(ctx.understood).length > 0 ||
    tryEmitBridgeCapabilityAudit(ctx.understood) !== null
  );
}

export const liveContextCapability: Capability = {
  name: 'live-context',

  // `score` satisfies the TurnHandler contract directly (so the capability can
  // be dropped into a plain handler list without the asTurnHandler adapter); it
  // derives from the same estimate, keeping one source of truth.
  score(ctx: TurnContext): ScoreResult {
    const breakdown = this.estimate(ctx);
    if (breakdown === null) return null;
    return { score: scoreFromBreakdown(breakdown), reason: breakdown.reason };
  },

  estimate(ctx: TurnContext): ScoreBreakdown | null {
    if (!asksAboutLiveContext(ctx)) return null;
    return {
      // The phrasing strongly indicates a live-state question.
      intentFit: 0.95,
      // Evidence is bound at resolve/verify time from what the turn attached;
      // at estimate time we only know the question shape, so this stays modest
      // and the verify gate does the real grounding work.
      evidence: 0.4,
      // No learned history wired yet — neutral. (Learning loop will set this.)
      history: 0.5,
      // Cheap: local string/inspection, no model or network call.
      latency: 0.05,
      cost: 0.02,
      // High intrinsic risk: answering live state from anything other than
      // attached evidence is a hallucination. The verify gate contains it, but
      // the risk term keeps the capability honest in ranking.
      risk: 0.2,
      reason: 'Live workspace/editor state question — answer only from attached evidence.',
    };
  },

  resolve(ctx: TurnContext): Resolution | null {
    const reply = tryEmitPrivateLiveContextResponse(ctx.understood)
      ?? tryEmitBridgeCapabilityAudit(ctx.understood);
    if (!reply) return null;
    return {
      text: reply,
      turnKind: 'analysis',
      confidence: 0.99,
      strategy: 'live-context',
    } as Resolution;
  },

  verify(resolution: Resolution, _ctx: TurnContext): VerificationResult {
    const text = resolution.text ?? '';
    // Honest "unavailable" / "no, I did not call X" responses are always safe to
    // release — they explicitly DECLINE to claim live state.
    if (UNAVAILABLE_MARKER.test(text)) {
      return { ok: true, reason: 'Honest unavailable/declined response — no live claim made.' };
    }
    // A capability-audit ledger that separates observed-vs-planned is safe.
    if (/\*\*Observed in this turn\*\*/i.test(text) && /\*\*Not demonstrated in this turn\*\*/i.test(text)) {
      return { ok: true, reason: 'Capability audit separates observed from planned — no unbound claim.' };
    }
    // Any other answer must carry an evidence line binding the claim to a real
    // attached capture. Without it, we refuse to release the claim.
    if (EVIDENCE_MARKER.test(text)) {
      return { ok: true, boundEvidence: ['vscode-capture-adapter'], reason: 'Claim bound to attached capture evidence.' };
    }
    return {
      ok: false,
      reason: 'Live-state answer carries no evidence binding and is not an honest unavailable response — refusing to release.',
    };
  },
};
