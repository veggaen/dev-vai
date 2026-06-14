/**
 * Web evidence gathering for the council — the "web witness" / RAG retrieval step.
 *
 * Vai googles the turn, brings back sources AND (best-effort) Google's AI Overview
 * synthesized summary, then hands the lot to EVERY council member as shared, clearly
 * labelled evidence (see member.ts `buildUserPrompt`). This is the front half of a
 * Perplexity-style flow, done Vai's way: multiple members reason over the same retrieved
 * snippets, and the fact-quarantine guardrail still holds — the web text informs each
 * member's reasoning, but no member hands its claims to the user as fact. Vai's own
 * grounded tools own every surfaced number/name.
 *
 * Policy (V3gga's choice): SearXNG-default + Chrome-fallback.
 *  - The stable, free source list comes from the existing {@link SearchPipeline} (SearXNG →
 *    Brave → browser-Google → Bing/DDG/Mojeek chain).
 *  - The AI Overview box is a BONUS from driving real Chrome — brittle by nature (Google
 *    fights scraping and renames its DOM), so it degrades to null and never blocks.
 *
 * Everything here is best-effort: any failure yields empty evidence, and the council simply
 * convenes without it (exactly as it does today). This module never throws to the caller.
 */

import { SearchPipeline } from '../search/pipeline.js';
import { fetchGooglePageViaBrowser, isBrowserSearchEnabled } from '../search/browser-search.js';

/** A source snippet shaped to drop straight into `CouncilInput.sources`. */
export interface WebEvidenceSource {
  readonly title?: string;
  readonly url?: string;
  readonly snippet?: string;
}

/** What Vai retrieved for a turn, to share with every council member. */
export interface WebEvidence {
  /** Google's AI Overview summary, when present — labelled as synthesized, still to-be-verified. */
  readonly aiOverview: string | null;
  /** Ranked source snippets (title / url / snippet), most-trusted first. */
  readonly sources: readonly WebEvidenceSource[];
  /** ISO timestamp the evidence was gathered (freshness signal for members). */
  readonly gatheredAt: string;
  /** Which path produced the sources, for the audit/panel. */
  readonly via: 'pipeline' | 'browser-fallback' | 'none';
}

export interface GatherWebEvidenceOptions {
  /** Min sources before we consider the pipeline result "thick enough". Default 3. */
  readonly minSources?: number;
  /** Cap on sources passed to the council. Default 6 (Perplexity-ish). */
  readonly maxSources?: number;
  /** Reuse one pipeline instance across calls (cache hits). Optional. */
  readonly pipeline?: SearchPipeline;
  /** Force-skip the Chrome AI-Overview fetch (tests / speed). */
  readonly skipAiOverview?: boolean;
}

const EMPTY: WebEvidence = { aiOverview: null, sources: [], gatheredAt: '', via: 'none' };

/**
 * Gather web evidence for a query. SearXNG/pipeline first (stable); if results are thin,
 * fall back to driving Chrome for organic results; always try (unless disabled) to grab the
 * Google AI Overview box as a bonus synthesized summary. Never throws — returns EMPTY on any
 * failure so the council convenes unchanged.
 */
export async function gatherWebEvidence(
  query: string,
  options: GatherWebEvidenceOptions = {},
): Promise<WebEvidence> {
  const trimmed = (query ?? '').trim();
  if (!trimmed) return EMPTY;

  const minSources = options.minSources ?? 3;
  const maxSources = options.maxSources ?? 6;
  const pipeline = options.pipeline ?? new SearchPipeline();

  let sources: WebEvidenceSource[] = [];
  let via: WebEvidence['via'] = 'none';

  // 1) Stable path: the existing search pipeline (SearXNG-preferred chain, cached, ranked).
  try {
    const res = await pipeline.search(trimmed);
    sources = res.sources.map((s) => ({ title: s.title, url: s.url, snippet: s.text }));
    if (sources.length > 0) via = 'pipeline';
  } catch {
    sources = [];
  }

  // 2) AI Overview bonus + thin-result fallback: drive Chrome for the Google page. We grab
  //    the page once and use BOTH its AI Overview and (only if the pipeline was thin) its
  //    organic results, so we never pay for two browser runs.
  let aiOverview: string | null = null;
  const wantBrowser = !options.skipAiOverview && isBrowserSearchEnabled();
  if (wantBrowser) {
    try {
      const page = await fetchGooglePageViaBrowser(trimmed, 12_000);
      aiOverview = page.aiOverview;
      if (sources.length < minSources && page.results.length > 0) {
        const fromBrowser: WebEvidenceSource[] = page.results.map((r) => ({
          title: r.title, url: r.url, snippet: r.snippet,
        }));
        // Merge, de-duping by URL, keeping the pipeline's ranked sources first.
        const seen = new Set(sources.map((s) => s.url).filter(Boolean));
        for (const r of fromBrowser) {
          if (r.url && seen.has(r.url)) continue;
          if (r.url) seen.add(r.url);
          sources.push(r);
        }
        if (via === 'none') via = 'browser-fallback';
      }
    } catch {
      // Chrome/Google unavailable or cooling down — AI Overview stays null, sources unchanged.
    }
  }

  if (sources.length === 0 && !aiOverview) return EMPTY;

  return {
    aiOverview,
    sources: sources.slice(0, maxSources),
    gatheredAt: new Date().toISOString(),
    via: via === 'none' ? 'browser-fallback' : via,
  };
}
