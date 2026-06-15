/**
 * synthesize-across — the headline capability, deterministically.
 *
 * "Summarize what I know about X across all sources", "find contradictions in my current
 * understanding", "produce a decision record from my notes and code" — answered WITHOUT a
 * model in the loop. This module collects every available evidence family (git, web, a live
 * page, stored notes) via {@link source-adapters}, runs the pure {@link synthesizeFromEvidence}
 * core over the merged items, and formats the result three ways the brief names:
 *
 *   - a SUMMARY brief: what the sources collectively say about X, each line cited.
 *   - a CONTRADICTIONS view: where sources disagree, both sides cited.
 *   - a DECISION RECORD: the standard ADR shape (context / evidence / decision-pending),
 *     built only from cited claims — a starting record a human finalizes, never an invented
 *     conclusion.
 *
 * Every claim in every output is bound to a real source id; an unbound claim cannot appear
 * (the core drops it). A model may re-phrase the prose afterward, but it can neither add a
 * fact nor remove a citation.
 */

import { synthesizeFromEvidence, type EvidenceItem, type SynthesisResult } from './synthesize.js';
import {
  gitEvidenceToItems,
  webEvidenceToItems,
  aiOverviewToItem,
  pageEvidenceToItems,
  notesToItems,
  type CrossSourceInputs,
} from './source-adapters.js';

export interface CrossSourceSynthesis extends SynthesisResult {
  /** The subject the synthesis was focused on. */
  readonly subject: string;
  /** Per-family item counts (transparency on what fed the synthesis). */
  readonly contributions: {
    readonly git: number;
    readonly web: number;
    readonly page: number;
    readonly notes: number;
  };
}

/**
 * Collect items from every provided source family, run the deterministic synthesis core,
 * and return the result annotated with per-family contribution counts. Pure aside from the
 * adapters (which are also pure); no model, no I/O. The caller gathers the evidence
 * (git/web/page/notes) beforehand — this only reasons over it.
 */
export function synthesizeAcrossSources(inputs: CrossSourceInputs): CrossSourceSynthesis {
  const subject = (inputs.subject ?? '').trim();
  const gitItems = inputs.git ? gitEvidenceToItems(inputs.git) : [];
  const webItems = [
    ...(inputs.web ? webEvidenceToItems(inputs.web, subject) : []),
    ...aiOverviewToItem(inputs.aiOverview ?? null, subject),
  ];
  const pageItems = inputs.page ? pageEvidenceToItems(inputs.page) : [];
  const noteItems = inputs.notes ? notesToItems(inputs.notes, subject) : [];

  const items: EvidenceItem[] = [...gitItems, ...webItems, ...pageItems, ...noteItems];
  // filterByQuery off: the caller has already scoped the sources to the subject, and the
  // git/page subjects are file paths / URLs that wouldn't match a topic token.
  const base = synthesizeFromEvidence(items, subject, { filterByQuery: false });

  return {
    ...base,
    subject,
    contributions: {
      git: gitItems.length,
      web: webItems.length,
      page: pageItems.length,
      notes: noteItems.length,
    },
  };
}

/** Short source label for a citation from an evidence sourceId. */
function citeLabel(sourceId: string): string {
  if (sourceId.startsWith('web:ai-overview')) return 'Google AI Overview';
  if (sourceId.startsWith('web:')) return sourceId.slice('web:'.length);
  if (sourceId.startsWith('note:')) return `note ${sourceId.slice('note:'.length)}`;
  if (sourceId.startsWith('git:')) return sourceId;
  if (sourceId.startsWith('page:')) return 'observed page';
  return sourceId;
}

/**
 * Render a cited SUMMARY brief: the synthesized claims, each with its source(s). Verbatim
 * values only; the header reports the source count and contribution mix.
 */
export function formatSummaryBrief(result: CrossSourceSynthesis): string {
  if (result.claims.length === 0) {
    return `I have no evidence-bound claims about "${result.subject}" across the available sources.`;
  }
  const lines: string[] = [
    `**What I know about "${result.subject}"** — ${result.summary}`,
    '',
  ];
  for (const claim of result.claims) {
    const cites = claim.sources.map((s) => citeLabel(s.sourceId)).join(', ');
    const attr = claim.attribute === 'mention' ? '' : `**${claim.attribute}:** `;
    lines.push(`- ${attr}${claim.value} _(${cites})_`);
  }
  if (result.contradictions.length > 0) {
    lines.push('', `⚠️ ${result.contradictions.length} contradiction(s) — see the contradictions view.`);
  }
  return lines.join('\n');
}

/** Render the CONTRADICTIONS view: each conflict with both sides cited. */
export function formatContradictions(result: CrossSourceSynthesis): string {
  if (result.contradictions.length === 0) {
    return `No contradictions found about "${result.subject}" among ${result.sourceCount} source(s).`;
  }
  const lines: string[] = [`**Contradictions about "${result.subject}":**`, ''];
  for (const c of result.contradictions) {
    lines.push(`- **${c.subject} · ${c.attribute}** — sources disagree:`);
    for (const side of c.sides) {
      const cites = side.sources.map((s) => citeLabel(s.sourceId)).join(', ');
      lines.push(`  - "${side.value}" _(${cites})_`);
    }
  }
  return lines.join('\n');
}

/**
 * Render a DECISION RECORD (lightweight ADR). It lays out the cited evidence and an explicit
 * "Decision: PENDING" — a starting record for a human to finalize. It NEVER fabricates a
 * decision; synthesis assembles evidence, it does not choose.
 */
export function formatDecisionRecord(result: CrossSourceSynthesis, title?: string): string {
  const heading = title?.trim() || `Decision record: ${result.subject}`;
  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    `# ${heading}`,
    '',
    `- **Date:** ${date}`,
    `- **Status:** Proposed (decision pending — finalize manually)`,
    '',
    '## Context',
    result.claims.length > 0
      ? `Synthesized from ${result.sourceCount} source(s) (${result.contributions.git} git, ${result.contributions.web} web, ${result.contributions.page} page, ${result.contributions.notes} notes).`
      : 'No evidence-bound claims were available.',
    '',
    '## Evidence',
  ];
  if (result.claims.length === 0) {
    lines.push('_(none)_');
  } else {
    for (const claim of result.claims) {
      const cites = claim.sources.map((s) => citeLabel(s.sourceId)).join(', ');
      lines.push(`- ${claim.value} _(${cites})_`);
    }
  }
  if (result.contradictions.length > 0) {
    lines.push('', '## Open conflicts');
    for (const c of result.contradictions) {
      lines.push(`- **${c.subject} · ${c.attribute}:** ${c.sides.map((s) => `"${s.value}"`).join(' vs ')}`);
    }
  }
  lines.push('', '## Decision', '**PENDING** — review the evidence above and record the chosen option and rationale.');
  return lines.join('\n');
}
