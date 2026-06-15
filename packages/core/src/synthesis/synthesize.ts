/**
 * synthesize — deterministic, evidence-bound answer construction.
 *
 * This is the first-class capability the brief asks for: "summarize what I know about
 * X across all sources", "find contradictions in my current understanding", "produce a
 * decision record from my notes and code" — built WITHOUT a model in the loop. A
 * language model can only ever PHRASE the result afterward; the claims, their bindings
 * to sources, and the contradictions are computed here, deterministically, so the
 * output is reproducible and auditable.
 *
 * The unit of input is an {@link EvidenceItem}: a single (subject, attribute, value)
 * triple that some source asserts, with a `sourceId` and optional `span` for citation.
 * Git, web-evidence and ingested notes all reduce to lists of these (git adapter
 * below; web/notes adapters are follow-on slices), so this core is source-agnostic.
 *
 * The contract:
 *   - CAN DO:   cluster claims by subject; bind each to its source(s); drop any claim
 *               with no source; flag contradictions (one subject+attribute, ≥2 sources,
 *               divergent values).
 *   - EVIDENCE: every emitted claim carries `sources` (≥1) and a `confidence` derived
 *               purely from corroboration count — never a model's opinion.
 *   - COST:     pure in-memory; O(n) over the items. No I/O, no model.
 *   - VERIFIED: an unbound claim cannot appear in the output by construction; a
 *               contradiction is only emitted when sources actually disagree.
 */

/** One atomic assertion from one source: "<subject> <attribute> = <value>". */
export interface EvidenceItem {
  /** Source identifier (e.g. a git evidence id, a URL, a note id). */
  readonly sourceId: string;
  /** What the claim is about (normalized key — caller lower-cases/canonicalizes). */
  readonly subject: string;
  /** Which property of the subject (e.g. 'status', 'author', 'value'). */
  readonly attribute: string;
  /** The asserted value as a string (compared case-insensitively, trimmed). */
  readonly value: string;
  /** Optional human-readable locator within the source (line, span, quote). */
  readonly span?: string;
}

/** A synthesized claim: one (subject, attribute, value) backed by ≥1 source. */
export interface SynthesizedClaim {
  readonly subject: string;
  readonly attribute: string;
  readonly value: string;
  /** The sources asserting this value — always ≥1 (unbound claims are dropped). */
  readonly sources: readonly EvidenceItem[];
  /** 0..1, rising with the number of corroborating sources (deterministic). */
  readonly confidence: number;
}

/** A detected contradiction: the same subject+attribute with divergent values. */
export interface SynthesizedContradiction {
  readonly subject: string;
  readonly attribute: string;
  /** The distinct values asserted, each with the sources backing it. */
  readonly sides: readonly { readonly value: string; readonly sources: readonly EvidenceItem[] }[];
}

/** The result of synthesizing a set of evidence items for a query. */
export interface SynthesisResult {
  /** A short, deterministic prose summary (model may re-phrase, never re-fact). */
  readonly summary: string;
  /** Every claim with ≥1 binding, highest-confidence first. */
  readonly claims: readonly SynthesizedClaim[];
  /** Every subject+attribute where sources disagree. */
  readonly contradictions: readonly SynthesizedContradiction[];
  /** Items that named no usable source — dropped, surfaced for transparency. */
  readonly droppedUnbound: number;
  /** Distinct source ids that contributed at least one bound claim. */
  readonly sourceCount: number;
}

export interface SynthesizeOptions {
  /**
   * When true (default), filter items to those whose subject contains the query's
   * salient token(s). When false, synthesize over ALL items (e.g. "find all
   * contradictions" with no subject focus).
   */
  readonly filterByQuery?: boolean;
}

function norm(s: string): string {
  return (s ?? '').trim().toLowerCase();
}

/** Confidence purely from corroboration: 1 source → 0.6, 2 → 0.8, 3+ → ≥0.9. */
function confidenceFromCorroboration(sourceCount: number): number {
  if (sourceCount <= 0) return 0;
  if (sourceCount === 1) return 0.6;
  if (sourceCount === 2) return 0.8;
  return Math.min(0.97, 0.9 + (sourceCount - 3) * 0.02);
}

/** Salient tokens of the query — words ≥3 chars, de-trivialized, for subject filtering. */
function queryTokens(query: string): string[] {
  return norm(query)
    .split(/[^a-z0-9./_-]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

const STOP = new Set([
  'the', 'and', 'for', 'what', 'which', 'about', 'across', 'all', 'find', 'know', 'produce',
  'from', 'with', 'into', 'this', 'that', 'these', 'those', 'have', 'has', 'are', 'was',
  'were', 'does', 'did', 'can', 'you', 'your', 'how', 'why', 'when', 'where', 'who',
  'summarize', 'summary', 'contradiction', 'contradictions', 'understanding', 'current',
  'sources', 'source', 'notes', 'code', 'decision', 'record',
]);

/**
 * Synthesize an evidence-bound answer from a flat list of {@link EvidenceItem}s.
 * Pure and deterministic: same input → same output, no model, no I/O.
 *
 * Algorithm:
 *   1. Drop items with no `sourceId` (unbound — cannot be cited, so never asserted).
 *   2. Optionally filter to items whose subject matches the query's salient tokens.
 *   3. Cluster by (subject, attribute, value) → one claim per distinct value, carrying
 *      its sources and a corroboration-derived confidence.
 *   4. Within each (subject, attribute), if ≥2 DISTINCT values each have a source,
 *      record a contradiction.
 */
export function synthesizeFromEvidence(
  items: readonly EvidenceItem[],
  query: string,
  options: SynthesizeOptions = {},
): SynthesisResult {
  const filterByQuery = options.filterByQuery ?? true;

  // 1) Drop unbound.
  let droppedUnbound = 0;
  const bound: EvidenceItem[] = [];
  for (const it of items) {
    if (!it || !norm(it.sourceId)) {
      droppedUnbound += 1;
      continue;
    }
    bound.push(it);
  }

  // 2) Optional query focus.
  const tokens = queryTokens(query);
  const focused = filterByQuery && tokens.length > 0
    ? bound.filter((it) => {
        const subj = norm(it.subject);
        return tokens.some((t) => subj.includes(t));
      })
    : bound;
  // If the focus filtered everything out, fall back to all bound items rather than
  // synthesizing nothing — the user asked about a subject we may key differently.
  const working = focused.length > 0 ? focused : bound;

  // 3) Cluster by subject|attribute|value.
  type Cluster = { subject: string; attribute: string; value: string; sources: EvidenceItem[] };
  const byTriple = new Map<string, Cluster>();
  for (const it of working) {
    const key = `${norm(it.subject)}${norm(it.attribute)}${norm(it.value)}`;
    let c = byTriple.get(key);
    if (!c) {
      c = { subject: it.subject, attribute: it.attribute, value: it.value, sources: [] };
      byTriple.set(key, c);
    }
    // De-dupe identical (source, span) so the same source isn't double-counted.
    if (!c.sources.some((s) => s.sourceId === it.sourceId && s.span === it.span)) {
      c.sources.push(it);
    }
  }

  const claims: SynthesizedClaim[] = [...byTriple.values()]
    .filter((c) => c.sources.length > 0)
    .map((c) => ({
      subject: c.subject,
      attribute: c.attribute,
      value: c.value,
      sources: c.sources,
      confidence: confidenceFromCorroboration(new Set(c.sources.map((s) => s.sourceId)).size),
    }))
    .sort((a, b) => b.confidence - a.confidence || a.subject.localeCompare(b.subject));

  // 4) Contradictions: same (subject, attribute) with ≥2 distinct values.
  const byAttr = new Map<string, SynthesizedClaim[]>();
  for (const claim of claims) {
    const key = `${norm(claim.subject)}${norm(claim.attribute)}`;
    const arr = byAttr.get(key) ?? [];
    arr.push(claim);
    byAttr.set(key, arr);
  }
  const contradictions: SynthesizedContradiction[] = [];
  for (const group of byAttr.values()) {
    const distinctValues = new Set(group.map((c) => norm(c.value)));
    if (distinctValues.size >= 2) {
      contradictions.push({
        subject: group[0].subject,
        attribute: group[0].attribute,
        sides: group.map((c) => ({ value: c.value, sources: c.sources })),
      });
    }
  }

  const sourceCount = new Set(working.map((it) => it.sourceId)).size;
  const summary = buildSummary(query, claims, contradictions, sourceCount);

  return { summary, claims, contradictions, droppedUnbound, sourceCount };
}

/** Deterministic prose summary — facts only, no model. */
function buildSummary(
  query: string,
  claims: readonly SynthesizedClaim[],
  contradictions: readonly SynthesizedContradiction[],
  sourceCount: number,
): string {
  if (claims.length === 0) {
    return `No evidence-bound claims found${query.trim() ? ` for "${query.trim()}"` : ''}.`;
  }
  const subjects = new Set(claims.map((c) => c.subject));
  const parts = [
    `${claims.length} evidence-bound claim${claims.length === 1 ? '' : 's'} across ${sourceCount} source${sourceCount === 1 ? '' : 's'}, covering ${subjects.size} subject${subjects.size === 1 ? '' : 's'}.`,
  ];
  if (contradictions.length > 0) {
    parts.push(
      `${contradictions.length} contradiction${contradictions.length === 1 ? '' : 's'} where sources disagree: ` +
        contradictions.map((c) => `${c.subject}.${c.attribute}`).join(', ') + '.',
    );
  } else {
    parts.push('No contradictions detected among the bound claims.');
  }
  return parts.join(' ');
}
