/**
 * source-adapters — map each evidence FAMILY into the source-agnostic
 * {@link EvidenceItem} triples the deterministic synthesis core reasons over.
 *
 * This is what lets "summarize what I know about X across all sources" be real: git,
 * a web search, a live page observation, and the local knowledge store all reduce to the
 * same (subject, attribute, value, sourceId) shape, so {@link synthesizeFromEvidence} can
 * cluster, cite, and find contradictions across ALL of them at once.
 *
 * The hard rule that keeps synthesis honest: an adapter NEVER fabricates a value. It only
 * ever copies a verbatim fact (a git status, a page title) or a verbatim snippet (a web
 * result, a stored note) and binds it to the real source id. Free-text sources (web/notes)
 * therefore contribute "this source mentions <topic>: <verbatim snippet>" items — the
 * synthesis can cite and cluster them, but it does not invent attribute-level claims it
 * cannot verify. Structured sources (git, page) contribute real attribute-level facts, so
 * cross-source contradiction detection works where — and only where — the data supports it.
 */

import type { EvidenceItem } from './synthesize.js';
import type { GitEvidence } from '../tools/git-evidence.js';
import type { PageEvidence } from '../tools/page-evidence.js';

export { gitEvidenceToItems } from './git-adapter.js';

/** A web source snippet (matches consensus/web-evidence WebEvidenceSource, decoupled). */
export interface WebSourceLike {
  readonly title?: string;
  readonly url?: string;
  readonly snippet?: string;
}

/** A stored note / knowledge entry (decoupled from the knowledge-store row type). */
export interface NoteLike {
  /** Stable identifier for the note (id, pattern key, file path). */
  readonly id: string;
  /** The note's text content. */
  readonly text: string;
  /** Optional human label / title. */
  readonly title?: string;
  /** Optional provenance tag (e.g. 'youtube', 'web', 'manual'). */
  readonly source?: string;
}

/** Trim a snippet to a citeable length without cutting mid-word. */
function clip(text: string, max = 280): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/**
 * Web search results → evidence items. The `subject` is the query topic the caller passes
 * (so all web items about the same topic cluster), the `attribute` is 'mention', and the
 * `value` is a VERBATIM clipped snippet — never a synthesized claim. Each item binds to the
 * source URL (or a stable index when a result has no URL).
 */
export function webEvidenceToItems(
  sources: readonly WebSourceLike[],
  subject: string,
): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  sources.forEach((s, i) => {
    const snippet = clip(s.snippet ?? '');
    if (!snippet) return;
    const sourceId = s.url ? `web:${s.url}` : `web:result-${i}`;
    // Free-text snippet — corroboration, not a comparable claim (no contradiction detection).
    out.push({ sourceId, subject, attribute: 'mention', value: snippet, span: s.title ?? s.url, comparable: false });
  });
  return out;
}

/**
 * A Google AI Overview summary → ONE evidence item, labelled as a synthesized overview so a
 * reader knows its provenance. Still verbatim — we copy the overview text, not re-summarize.
 */
export function aiOverviewToItem(aiOverview: string | null, subject: string): EvidenceItem[] {
  const text = clip(aiOverview ?? '', 400);
  if (!text) return [];
  return [{ sourceId: 'web:ai-overview', subject, attribute: 'overview', value: text, span: 'Google AI Overview (synthesized)', comparable: false }];
}

/**
 * A live page observation → evidence items. These ARE structured facts (title, status,
 * per-selector existence/text), so they contribute real attribute-level claims that can
 * participate in cross-source contradiction detection. Subject is the page's final URL.
 */
export function pageEvidenceToItems(evidence: PageEvidence): EvidenceItem[] {
  if (!evidence.ok) return [];
  const subject = evidence.finalUrl || evidence.url;
  const out: EvidenceItem[] = [
    { sourceId: evidence.titleId, subject, attribute: 'title', value: evidence.title || '(none)' },
  ];
  if (evidence.status != null) {
    out.push({ sourceId: evidence.titleId, subject, attribute: 'http-status', value: String(evidence.status) });
  }
  for (const s of evidence.selectors) {
    out.push({ sourceId: s.id, subject, attribute: `element:${s.selector}`, value: s.exists ? (s.text || 'present') : 'absent' });
  }
  return out;
}

/**
 * Stored notes / knowledge entries → evidence items. Free text, so 'mention' + verbatim
 * clipped snippet bound to the note id. The subject is the caller's topic so notes cluster
 * with web/git items about the same thing.
 */
export function notesToItems(notes: readonly NoteLike[], subject: string): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  for (const n of notes) {
    const snippet = clip(n.text ?? '');
    if (!snippet || !n.id) continue;
    // Free-text note — corroboration, not a comparable claim (no contradiction detection).
    out.push({ sourceId: `note:${n.id}`, subject, attribute: 'mention', value: snippet, span: n.title ?? n.source, comparable: false });
  }
  return out;
}

/** A bundle of every evidence family available for a synthesis turn. */
export interface CrossSourceInputs {
  readonly subject: string;
  readonly git?: GitEvidence;
  readonly web?: readonly WebSourceLike[];
  readonly aiOverview?: string | null;
  readonly page?: PageEvidence;
  readonly notes?: readonly NoteLike[];
}
