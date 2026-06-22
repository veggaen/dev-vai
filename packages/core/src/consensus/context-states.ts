/**
 * context-states — per-member "what context did you actually use?" tracking.
 *
 * V3gga's framing: like validation states on a blockchain, each piece of context a council
 * member touched has a lifecycle state. A member fetches context (the pull model), then votes;
 * we classify each fetched item by whether the member's note actually drew on it:
 *
 *   considered  → the member fetched it (a tool request that returned real content)
 *   used        → the fetched content shows up in the member's note (it grounded on it)
 *   unused      → fetched but absent from the note (the member looked, then discarded it)
 *   unavailable → the fetch returned nothing / an error (there was nothing to use)
 *
 * This makes deliberation legible: the UI can show "qwen3 read 3 files, grounded on 1, ignored 2"
 * — turning an opaque vote into an auditable trail. Pure + deterministic; no model calls here.
 */

import type { ToolRequest } from './member-evidence.js';

/**
 * Provenance lifecycle of a piece of context a member touched (V3gga's blockchain-validation
 * framing). The verification spine (Pillar B) adds `disputed` to the original four:
 *   considered  → fetched (a tool request returned content) but no distinctive signal to match
 *   used        → the fetched content grounded the member's note
 *   unused      → fetched but absent from the note (looked, then discarded)
 *   unavailable → the fetch returned nothing / errored
 *   disputed    → a USED claim that another source (cross-check / a peer) contradicted — the
 *                 spine's "this grounding is contested" state. Set by the aggregator, never by
 *                 the per-item classifier (which only sees one member's fetch+note).
 */
export type ContextStateKind = 'used' | 'unused' | 'considered' | 'unavailable' | 'disputed';

export interface ContextItemState {
  /** Stable label for the fetched item, e.g. "grep /SECRET/" or "readFile src/a.ts". */
  readonly label: string;
  /** The tool that produced it. */
  readonly tool: ToolRequest['tool'];
  readonly state: ContextStateKind;
  /** Short reason for the classification (for the trace tooltip). */
  readonly reason: string;
}

export interface MemberContextLedger {
  readonly memberId: string;
  readonly items: readonly ContextItemState[];
  /** Rollup counts for a compact UI badge. */
  readonly summary: { readonly used: number; readonly unused: number; readonly unavailable: number };
}

/** A fetched evidence item: the request the member made + the raw result text it got back. */
export interface FetchedEvidence {
  readonly request: ToolRequest;
  readonly resultText: string;
}

/** Human label for a request (mirrors the formatting the member saw). */
export function labelForRequest(req: ToolRequest): string {
  switch (req.tool) {
    case 'grep': return `grep /${req.pattern ?? ''}/`;
    case 'readFile': return `readFile ${req.path ?? ''}`.trim();
    case 'listFiles': return `listFiles ${req.glob ?? ''}`.trim();
    default: return req.tool;
  }
}

/** True when a fetched result is empty / a not-found / an error sentinel. */
function isUnavailableResult(resultText: string): boolean {
  const t = resultText.trim().toLowerCase();
  if (!t) return true;
  return /no matches|→ none\.|not found|unreadable|rejected:|too large|missing (?:pattern|path|glob)|unknown tool/.test(t);
}

/**
 * Extract the distinctive tokens a result carried — identifiers, paths, quoted strings — that
 * would show up VERBATIM in a note that actually used this evidence. Generic words are excluded
 * so "the file mentions code" doesn't count as grounding. Mirrors the spirit of the fact-shim's
 * distinctive-subject check but scoped to fetched code/text.
 */
export function distinctiveTokens(text: string): string[] {
  const out = new Set<string>();
  // Identifiers with case/camel/underscore/digits, file paths, and quoted literals.
  for (const m of text.matchAll(/[A-Za-z_][A-Za-z0-9_]{3,}|[\w./-]+\.[a-z]{1,4}\b|"[^"]{3,}"|'[^']{3,}'/g)) {
    const tok = m[0].replace(/['"]/g, '').toLowerCase();
    if (tok.length >= 4) out.add(tok);
  }
  return [...out];
}

const GENERIC = new Set([
  'readfile', 'grep', 'listfiles', 'lines', 'matches', 'file', 'files', 'code', 'text', 'true', 'false', 'null', 'const', 'function', 'return', 'import', 'export', 'this', 'that', 'with', 'from', 'have', 'note', 'council', 'truncated',
]);

/**
 * Classify one fetched item against the member's note. `used` when a distinctive token from the
 * result appears in the note; `unused` when it returned content the note never references;
 * `unavailable` when the fetch produced nothing usable.
 */
export function classifyContextItem(ev: FetchedEvidence, note: string): ContextItemState {
  const label = labelForRequest(ev.request);
  if (isUnavailableResult(ev.resultText)) {
    return { label, tool: ev.request.tool, state: 'unavailable', reason: 'fetch returned nothing' };
  }
  const noteLower = (note || '').toLowerCase();
  const tokens = distinctiveTokens(ev.resultText).filter((t) => !GENERIC.has(t));
  const hit = tokens.find((t) => noteLower.includes(t));
  if (hit) {
    return { label, tool: ev.request.tool, state: 'used', reason: `note references "${hit}"` };
  }
  // It returned real content the member chose not to lean on.
  return { label, tool: ev.request.tool, state: tokens.length > 0 ? 'unused' : 'considered', reason: tokens.length > 0 ? 'fetched but not reflected in the note' : 'fetched; no distinctive signal to match' };
}

/** Build the full per-member ledger from its fetched evidence + final note text. */
export function buildMemberContextLedger(
  memberId: string,
  fetched: readonly FetchedEvidence[],
  note: string,
): MemberContextLedger {
  const items = fetched.map((ev) => classifyContextItem(ev, note));
  const summary = {
    used: items.filter((i) => i.state === 'used').length,
    unused: items.filter((i) => i.state === 'unused').length,
    unavailable: items.filter((i) => i.state === 'unavailable').length,
  };
  return { memberId, items, summary };
}

// ── Verification spine (Pillar B) ──────────────────────────────────────────
//
// Aggregates per-member ledgers into ONE consensus-level provenance view: how much of the
// panel's grounding was actually USED vs merely considered/unused/unavailable, and whether any
// used grounding is DISPUTED. This is ADVISORY/audit-only for now — it surfaces a groundedness
// signal for the UI and a future ship/refuse gate, but does NOT itself block anything yet
// (gating ship/refuse is a verification-path change, done deliberately as a later, risk-gated
// step). Pure → unit-tested without models.

export interface ProvenanceSpine {
  /** Total context items the panel touched across all members. */
  readonly total: number;
  /** Rollup by state across the whole panel. */
  readonly counts: Record<ContextStateKind, number>;
  /** Fraction of touched items that actually grounded a note (used / total), 0..1. */
  readonly groundedness: number;
  /** True when at least one USED grounding is contradicted (disputed). */
  readonly hasDisputed: boolean;
  /**
   * Advisory groundedness verdict (NOT a gate yet):
   *   'grounded'   → solid: used grounding dominates, nothing disputed
   *   'thin'       → little of the fetched context actually grounded the answer
   *   'contested'  → a used grounding is disputed (a peer/cross-check contradicted it)
   *   'none'       → no context was touched (prompt-only review)
   */
  readonly verdict: 'grounded' | 'thin' | 'contested' | 'none';
}

const EMPTY_COUNTS: Record<ContextStateKind, number> = { used: 0, unused: 0, considered: 0, unavailable: 0, disputed: 0 };

/**
 * Build the consensus provenance spine from every member's ledger. `disputedLabels` (optional)
 * marks item labels that another source contradicted — those USED items become `disputed` in
 * the rollup. Pure; never throws.
 */
export function buildProvenanceSpine(
  ledgers: readonly MemberContextLedger[],
  disputedLabels: readonly string[] = [],
): ProvenanceSpine {
  const disputed = new Set(disputedLabels);
  const counts: Record<ContextStateKind, number> = { ...EMPTY_COUNTS };
  let total = 0;
  for (const ledger of ledgers) {
    for (const item of ledger.items) {
      total++;
      const state: ContextStateKind = item.state === 'used' && disputed.has(item.label) ? 'disputed' : item.state;
      counts[state]++;
    }
  }
  const groundedness = total > 0 ? counts.used / total : 0;
  const hasDisputed = counts.disputed > 0;
  const verdict: ProvenanceSpine['verdict'] =
    total === 0 ? 'none'
    : hasDisputed ? 'contested'
    : groundedness >= 0.34 ? 'grounded'
    : 'thin';
  return { total, counts, groundedness, hasDisputed, verdict };
}

/**
 * Bridge: derive disputed-context labels from a cross-check contradiction. cross-check.ts works
 * at the CLAIM level (e.g. a draft's "$3,200 ETH" the free web search contradicted); the spine
 * works at the CONTEXT-ITEM level. When a claim is contradicted, the claim's subject aliases +
 * value are the tokens to mark any matching USED grounding as `disputed` — turning a web
 * contradiction into the spine's `contested` verdict. Pure; returns [] when nothing contradicted.
 *
 * NOT YET WIRED into the live council path (intentionally). The projected `CouncilCrossCheck`
 * currently carries only `confirmsValue` (null on contradiction) and no `subjectAliases`, so
 * feeding it produces no needles. Threading the cross-check subject through CouncilCrossCheck is
 * the prerequisite to enabling real contested-grounding; this helper + its tests are kept ready
 * for that. (We removed a gating path that relied on synthetic data — see git history.)
 *
 * @param assessment { contradicted, subjectAliases?, value? } — the cross-check ClaimAssessment
 *   (loosely typed to avoid a hard import cycle; we only read these fields).
 * @param itemLabels  the context-item labels in play (from member ledgers) to match against.
 * @returns the subset of itemLabels whose text references a contradicted subject/value.
 */
export function disputedLabelsFromCrossCheck(
  assessment: { contradicted?: boolean; subjectAliases?: readonly string[]; value?: string } | null | undefined,
  itemLabels: readonly string[],
): string[] {
  if (!assessment?.contradicted) return [];
  const needles = [
    ...(assessment.subjectAliases ?? []),
    ...(assessment.value ? [assessment.value] : []),
  ].map((s) => String(s).toLowerCase()).filter((s) => s.length >= 2);
  if (needles.length === 0) return [];
  return itemLabels.filter((label) => {
    const l = label.toLowerCase();
    return needles.some((n) => l.includes(n));
  });
}

/**
 * Build the provenance spine straight from council NOTES' attached contextLedger data — the
 * shape actually available at consensus time (note.contextLedger.items: {label,state,reason}).
 * A thin adapter over buildProvenanceSpine so the spine can be computed in reachConsensus
 * without re-running the per-item classifier. `disputedLabels` (e.g. from
 * disputedLabelsFromCrossCheck) promote matching used items to `disputed`. Pure; ignores notes
 * without a ledger. The note's `state` is a string → coerced to ContextStateKind defensively.
 */
export function spineFromNotes(
  notes: ReadonlyArray<{ memberId?: string; contextLedger?: { items?: ReadonlyArray<{ label: string; state: string; reason?: string }> } }>,
  disputedLabels: readonly string[] = [],
): ProvenanceSpine {
  const ledgers: MemberContextLedger[] = notes
    .filter((n) => n.contextLedger?.items?.length)
    .map((n) => ({
      memberId: n.memberId ?? 'member',
      items: (n.contextLedger!.items ?? []).map((it) => ({
        label: it.label,
        tool: 'readFile' as const, // tool isn't carried on the note ledger; spine ignores it
        state: (['used', 'unused', 'considered', 'unavailable', 'disputed'].includes(it.state) ? it.state : 'considered') as ContextStateKind,
        reason: it.reason ?? '',
      })),
      summary: { used: 0, unused: 0, unavailable: 0 },
    }));
  return buildProvenanceSpine(ledgers, disputedLabels);
}
