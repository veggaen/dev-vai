/**
 * page-evidence — real browser/page interaction as VERIFIABLE evidence.
 *
 * The brief asks for "browser/page interaction when needed (via extension)." This is the
 * deterministic core: navigate to a URL in the real browser and capture STRUCTURED
 * observations — the page title, the final (post-redirect) URL, the HTTP status, and for
 * each requested CSS selector whether it exists and its text. Those are FACTS read from a
 * live DOM, each carrying a stable evidence id, so a downstream capability binds every
 * claim about the page to a real observation and refuses anything it didn't see. The model
 * never invents page content — it can only phrase what was observed.
 *
 * Contract:
 *   - CAN DO:   load one public URL, report title/finalUrl/status + per-selector
 *               existence and text.
 *   - EVIDENCE: typed {@link PageEvidence} with per-item ids (`page:title:<url>`,
 *               `page:selector:<url>#<sel>`).
 *   - COST:     one real browser navigation (the heaviest evidence source — gated, polite,
 *               serialized by the shared browser singleton); durationMs is reported.
 *   - VERIFIED: the caller binds claims to observed ids; this module guarantees each id
 *               maps to a real observation it actually made.
 *
 * Safety:
 *   - SSRF guard FIRST: the URL is validated as public http(s) (no localhost / private /
 *     credentialed / non-http) BEFORE any navigation — a real browser would happily load
 *     internal addresses, so this is the gate that prevents it. Reuses {@link validatePublicUrl}.
 *   - Injectable `observer` so unit tests never launch a browser.
 *   - Never throws — every failure is `{ ok: false, error }`.
 */

import { validatePublicUrl } from '../network/safe-fetch.js';
import { observePage, type PageObservation } from '../search/browser-search.js';

/** One selector observation as bindable evidence. */
export interface PageSelectorEvidence {
  /** Stable id, e.g. `page:selector:https://x.com#h1`. */
  readonly id: string;
  readonly selector: string;
  readonly exists: boolean;
  readonly text: string;
}

/** A page observation shaped as bindable evidence. */
export interface PageEvidence {
  readonly ok: boolean;
  readonly url: string;
  readonly finalUrl: string;
  readonly status: number | null;
  readonly title: string;
  /** Stable id for the title fact, e.g. `page:title:https://x.com`. */
  readonly titleId: string;
  readonly selectors: readonly PageSelectorEvidence[];
  readonly observedAt: string;
  readonly durationMs: number;
  readonly error?: string;
}

/** Inject a fake observer (tests). Default drives the real browser via observePage. */
export type PageObserver = (
  url: string,
  selectors: readonly string[],
  timeoutMs: number,
) => Promise<PageObservation>;

export interface GatherPageEvidenceOptions {
  /** CSS selectors to observe (existence + text). */
  readonly selectors?: readonly string[];
  /** Navigation timeout (ms). Default 15_000. */
  readonly timeoutMs?: number;
  /** Inject a fake observer for tests. */
  readonly observer?: PageObserver;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Navigate to a public URL and return a structured, bindable observation. SSRF-guards the
 * URL before any browser work; never throws.
 */
export async function gatherPageEvidence(
  url: string,
  options: GatherPageEvidenceOptions = {},
): Promise<PageEvidence> {
  const selectors = options.selectors ?? [];
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const observer = options.observer ?? observePage;
  const observedAt = new Date().toISOString();

  const fail = (error: string): PageEvidence => ({
    ok: false, url, finalUrl: url, status: null, title: '', titleId: `page:title:${url}`,
    selectors: [], observedAt, durationMs: 0, error,
  });

  // SSRF guard FIRST — a real browser will load internal addresses, so reject anything
  // that isn't a public http(s) URL before we navigate.
  let safeUrl: string;
  try {
    safeUrl = validatePublicUrl(url).toString();
  } catch (err) {
    return fail(`unsafe url: ${err instanceof Error ? err.message : String(err)}`);
  }

  let obs: PageObservation;
  try {
    obs = await observer(safeUrl, selectors, timeoutMs);
  } catch (err) {
    return fail(`observation failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!obs.ok) return { ...fail(obs.error ?? 'observation failed'), durationMs: obs.durationMs };

  return {
    ok: true,
    url: obs.url,
    finalUrl: obs.finalUrl,
    status: obs.status,
    title: obs.title,
    titleId: `page:title:${obs.url}`,
    selectors: obs.selectors.map((s) => ({
      id: `page:selector:${obs.url}#${s.selector}`,
      selector: s.selector,
      exists: s.exists,
      text: s.text,
    })),
    observedAt: obs.observedAt,
    durationMs: obs.durationMs,
  };
}

/** Every bindable evidence id present in a {@link PageEvidence}. */
export function pageEvidenceIds(evidence: PageEvidence): Set<string> {
  const ids = new Set<string>();
  if (evidence.ok) {
    ids.add(evidence.titleId);
    for (const s of evidence.selectors) ids.add(s.id);
  }
  return ids;
}

/** True when the evidence is a real, successful observation. */
export function hasPageEvidence(evidence: PageEvidence | undefined | null): evidence is PageEvidence {
  return Boolean(evidence && evidence.ok);
}
