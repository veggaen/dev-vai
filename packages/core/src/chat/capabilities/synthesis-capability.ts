/**
 * Capability — "summarize what I know about X across sources", "find contradictions",
 * "produce a decision record" from ALREADY-GATHERED evidence, deterministically.
 *
 * This wraps {@link synthesizeAcrossSources}: it merges every evidence family attached to
 * the turn (git / page / web / notes) into source-bound claims and renders the view the
 * turn asked for. No model, no I/O — resolve only reasons over `ctx.evidence`.
 *
 * The anti-hijack contract is the whole point of `verify`:
 *   - a "cross-source" answer with fewer than TWO distinct contributing sources is refused
 *     (a single-source answer dressed up as a synthesis is exactly the hijack shape);
 *   - every claim's sourceId must be derivable from the attached evidence — a claim citing
 *     a source that the adapters never produced is a fabrication and is refused.
 *
 * Contract:
 *   - CAN DO:   cited summary brief / contradictions view / decision record over the
 *               turn's attached evidence families.
 *   - EVIDENCE: the adapters' source-bound items; verify().boundEvidence cites the ids.
 *   - COST:     pure computation over already-gathered data — the cheapest capability.
 *   - VERIFIED: ≥2 distinct sources and every claim bound to a known sourceId, or refused.
 */

import type { Resolution, ScoreResult, TurnContext, TurnEvidence } from '../turn-pipeline.js';
import {
  scoreFromBreakdown,
  type Capability,
  type ScoreBreakdown,
  type VerificationResult,
} from '../capability-kernel.js';
import {
  synthesizeAcrossSources,
  formatSummaryBrief,
  formatContradictions,
  formatDecisionRecord,
  citeLabel,
} from '../../synthesis/synthesize-across.js';
import {
  gitEvidenceToItems,
  webEvidenceToItems,
  aiOverviewToItem,
  pageEvidenceToItems,
  notesToItems,
  type CrossSourceInputs,
} from '../../synthesis/source-adapters.js';

/** Turns that ask to reason ACROSS gathered knowledge, kept deliberately narrow. */
const SYNTHESIS_RE = new RegExp(
  [
    /across (?:all |my |the )?(?:sources|everything|evidence|notes)/.source,
    /what do (?:i|we) know about/.source,
    /summari[sz]e what (?:i|we) know/.source,
    /(?:find|any|are there|check for|look for) contradictions?/.source,
    /contradictions? (?:in|across|between)/.source,
    /decision record/.source,
    /compare\b[^.?!]{0,80}\b(?:across|from)\b[^.?!]{0,40}\bsources/.source,
  ].map((s) => `\\b(?:${s})\\b`).join('|'),
  'i',
);

/** Build/creation asks must never be hijacked into a synthesis, even if phrased with
 *  synthesis words ("build a page that compares data across sources"). */
const BUILD_SUPPRESS_RE = /\b(?:build|create|make|implement|write|generate|scaffold)\s+(?:me\s+)?(?:a|an|the)\b/i;

/** Classify whether the turn asks for a cross-source synthesis. Pure. */
export function isSynthesisQuery(text: string): boolean {
  const t = text ?? '';
  return SYNTHESIS_RE.test(t) && !BUILD_SUPPRESS_RE.test(t);
}

/** Extract the synthesis subject ("what do we know about X" → X). Pure. */
export function synthesisSubject(text: string): string {
  const t = (text ?? '').trim();
  const about = t.match(/\b(?:about|regarding|on)\s+["'“]?(.+?)["'”]?\s*[?.!]*$/i)?.[1];
  const cleaned = (about ?? '')
    .replace(/\s*(?:across|from) (?:all |my |the )?(?:sources|everything|evidence|notes).*$/i, '')
    .trim();
  return cleaned || 'the available evidence';
}

const NO_EVIDENCE_MARKER = 'no evidence was gathered';
const SINGLE_SOURCE_MARKER = 'needs at least two distinct sources';

type SynthesisView = 'summary' | 'contradictions' | 'decision';

function viewOf(text: string): SynthesisView {
  if (/\bcontradictions?\b/i.test(text)) return 'contradictions';
  if (/\bdecision record\b/i.test(text)) return 'decision';
  return 'summary';
}

function inputsFrom(evidence: TurnEvidence | undefined, subject: string): CrossSourceInputs {
  return {
    subject,
    git: evidence?.git,
    page: evidence?.page,
    web: evidence?.web,
    aiOverview: evidence?.aiOverview ?? null,
    notes: evidence?.notes,
  };
}

function familiesPresent(evidence: TurnEvidence | undefined): number {
  if (!evidence) return 0;
  let n = 0;
  if (evidence.git) n += 1;
  if (evidence.page) n += 1;
  if ((evidence.web?.length ?? 0) > 0 || (evidence.aiOverview ?? '').trim()) n += 1;
  if ((evidence.notes?.length ?? 0) > 0) n += 1;
  return n;
}

/** Every sourceId the attached evidence can legitimately produce — the fabrication fence. */
function knownSourceIds(inputs: CrossSourceInputs): Set<string> {
  const items = [
    ...(inputs.git ? gitEvidenceToItems(inputs.git) : []),
    ...(inputs.web ? webEvidenceToItems(inputs.web, inputs.subject) : []),
    ...aiOverviewToItem(inputs.aiOverview ?? null, inputs.subject),
    ...(inputs.page ? pageEvidenceToItems(inputs.page) : []),
    ...(inputs.notes ? notesToItems(inputs.notes, inputs.subject) : []),
  ];
  return new Set(items.map((i) => i.sourceId));
}

export const synthesisCapability: Capability = {
  name: 'synthesis',

  score(ctx: TurnContext): ScoreResult {
    const breakdown = this.estimate(ctx);
    if (breakdown === null) return null;
    return { score: scoreFromBreakdown(breakdown), reason: breakdown.reason };
  },

  estimate(ctx: TurnContext): ScoreBreakdown | null {
    if (!isSynthesisQuery(ctx.understood || ctx.content)) return null;
    const families = familiesPresent(ctx.evidence);
    return {
      // "Across sources / contradictions / decision record" is a specific, explicit shape.
      intentFit: 0.9,
      // The product is a MULTI-source view; one family alone is thin, two saturate it.
      evidence: Math.min(1, families / 2),
      history: 0.5,
      // Pure computation over already-gathered data — near-free.
      latency: 0.05,
      cost: 0.05,
      // Cross-source claims can drive decisions; verify binds every one.
      risk: 0.15,
      reason: 'Cross-source synthesis question — cited claims from already-gathered evidence only.',
    };
  },

  resolve(ctx: TurnContext): Resolution | null {
    const text = ctx.understood || ctx.content;
    if (!isSynthesisQuery(text)) return null;

    const subject = synthesisSubject(text);
    const inputs = inputsFrom(ctx.evidence, subject);

    if (familiesPresent(ctx.evidence) === 0) {
      return {
        text: `I can synthesize that across sources, but ${NO_EVIDENCE_MARKER} for this turn. Ask again with git/web/page/notes context in play and I'll produce a cited view.`,
        turnKind: 'analysis',
        confidence: 0.55,
        strategy: 'synthesis',
      } as Resolution;
    }

    const synthesis = synthesizeAcrossSources(inputs);
    if (synthesis.sourceCount < 2) {
      return {
        text: `A cross-source synthesis ${SINGLE_SOURCE_MARKER}, and only ${synthesis.sourceCount} contributed bound claims about "${subject}" this turn. I won't dress a single-source answer up as a synthesis — ask about that source directly, or bring more context in.`,
        turnKind: 'analysis',
        confidence: 0.55,
        strategy: 'synthesis',
      } as Resolution;
    }

    const view = viewOf(text);
    const body =
      view === 'contradictions' ? formatContradictions(synthesis)
      : view === 'decision' ? formatDecisionRecord(synthesis)
      : formatSummaryBrief(synthesis);

    return {
      text: body,
      turnKind: 'analysis',
      confidence: 0.93,
      strategy: 'synthesis',
    } as Resolution;
  },

  /**
   * The anti-hijack gate. An honest decline always passes; a released synthesis must
   * (1) have evidence attached at all, (2) rest on ≥2 distinct contributing sources, and
   * (3) cite ONLY sourceIds the attached evidence can produce. The synthesis core is
   * deterministic, so recomputing from ctx is an independent check of the same claims.
   */
  verify(resolution: Resolution, ctx: TurnContext): VerificationResult {
    const text = resolution.text ?? '';
    if (text.includes(NO_EVIDENCE_MARKER) || text.includes(SINGLE_SOURCE_MARKER)) {
      return { ok: true, reason: 'Honest decline — no cross-source claim made.' };
    }
    if (familiesPresent(ctx.evidence) === 0) {
      return { ok: false, reason: 'Synthesis composed but no evidence is attached — refusing to release.' };
    }

    const subject = synthesisSubject(ctx.understood || ctx.content);
    const inputs = inputsFrom(ctx.evidence, subject);
    const synthesis = synthesizeAcrossSources(inputs);

    if (synthesis.sourceCount < 2) {
      return { ok: false, reason: `Cross-source answer with only ${synthesis.sourceCount} contributing source(s) — refusing.` };
    }

    const known = knownSourceIds(inputs);
    const bound = new Set<string>();
    for (const claim of synthesis.claims) {
      for (const source of claim.sources) {
        if (!known.has(source.sourceId)) {
          return { ok: false, reason: `Claim cites unknown source "${source.sourceId}" — refusing.` };
        }
        bound.add(source.sourceId);
      }
    }

    // The gate must bite on the RELEASED text, not just the recomputed claims: every
    // `_( … )_` citation the answer renders must map back to a source the attached
    // evidence can actually produce. A fabricated citation is a hijack — refused.
    const knownLabels = new Set([...known].map(citeLabel));
    for (const group of text.matchAll(/_\(([^)]+)\)_/g)) {
      for (const label of group[1].split(', ')) {
        if (!knownLabels.has(label.trim())) {
          return { ok: false, reason: `Answer cites "${label.trim()}" which no attached evidence produced — refusing.` };
        }
      }
    }

    return {
      ok: true,
      boundEvidence: [...bound],
      reason: `Bound to ${bound.size} source(s) across ${synthesis.claims.length} claim(s).`,
    };
  },
};
