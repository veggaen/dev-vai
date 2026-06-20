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

export type ContextStateKind = 'used' | 'unused' | 'considered' | 'unavailable';

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
