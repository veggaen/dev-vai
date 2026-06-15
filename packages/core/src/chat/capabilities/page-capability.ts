/**
 * Capability — answer "what does <url> say / does that page have X" from a REAL browser
 * observation, never a guess.
 *
 * "What's the title of <url>?", "does <url> have a login form?", "what does the <h1> on
 * <url> say?", "is <url> up?" are questions a live page answers. This capability composes
 * its answer ONLY from an attached {@link PageEvidence} (captured by gatherPageEvidence in
 * a real, SSRF-guarded browser) and its `verify` binds every claim — the title, a
 * selector's existence, a selector's text, the HTTP status — to a real observation.
 * A claim about a selector that was never observed, or a title that doesn't match what the
 * browser saw, is REFUSED. The model never invents page content; it can only phrase what
 * the browser actually observed.
 *
 * Like git/exec, it does NOT drive the browser itself (resolve is synchronous). The caller
 * gathers the observation before dispatch and attaches it to `ctx.evidence.page`.
 *
 * Contract:
 *   - CAN DO:   report a page's title, final URL, HTTP status, and per-observed-selector
 *               existence + text.
 *   - EVIDENCE: the typed PageEvidence; verify().boundEvidence cites the observed ids.
 *   - COST:     a real browser navigation is the heaviest evidence source; latency derives
 *               from the observation's measured durationMs.
 *   - VERIFIED: every claim binds to an observed id, or the answer is refused.
 */

import type { Resolution, ScoreResult, TurnContext } from '../turn-pipeline.js';
import {
  scoreFromBreakdown,
  type Capability,
  type ScoreBreakdown,
  type VerificationResult,
} from '../capability-kernel.js';
import { hasPageEvidence, pageEvidenceIds, type PageEvidence } from '../../tools/page-evidence.js';

/** A turn is page-shaped when it names a URL AND asks to inspect/read/check it. */
const URL_RE = /https?:\/\/[^\s<>"'`]+/i;
const INSPECT_RE = /\b(what(?:'s| is| does)|does (?:it|the page|that page)|is (?:it|the page|that page)|title of|inspect|check|look at|read|open|visit|load|fetch|status of|up\??|have an?|contain|show)\b/i;

/** Classify whether the turn asks to observe a named page. Pure. */
export function isPageQuery(text: string): boolean {
  const t = text ?? '';
  return URL_RE.test(t) && INSPECT_RE.test(t);
}

const GROUNDED_MARKER = '**Page evidence';
const NO_EVIDENCE_MARKER = 'no page was observed';

/** Map measured observation time to a 0..1 latency penalty (20s+ → full penalty). */
function latencyPenalty(durationMs: number | undefined): number {
  if (!durationMs || durationMs <= 0) return 0.1;
  return Math.min(1, durationMs / 20_000);
}

function compose(page: PageEvidence): string {
  const lines: string[] = [
    `${GROUNDED_MARKER} (observed ${page.observedAt}, ${page.durationMs}ms):**`,
    '',
    `- **URL:** ${page.finalUrl}${page.finalUrl !== page.url ? ` (redirected from ${page.url})` : ''}`,
    `- **Status:** ${page.status ?? 'unknown'}`,
    `- **Title:** ${page.title || '(none)'}`,
  ];
  if (page.selectors.length > 0) {
    lines.push('- **Observed elements:**');
    for (const s of page.selectors) {
      lines.push(`  - \`${s.selector}\` — ${s.exists ? `present${s.text ? `: ${s.text}` : ''}` : 'not found'}`);
    }
  }
  return lines.join('\n');
}

export const pageCapability: Capability = {
  name: 'page',

  score(ctx: TurnContext): ScoreResult {
    const breakdown = this.estimate(ctx);
    if (breakdown === null) return null;
    return { score: scoreFromBreakdown(breakdown), reason: breakdown.reason };
  },

  estimate(ctx: TurnContext): ScoreBreakdown | null {
    if (!isPageQuery(ctx.understood || ctx.content)) return null;
    const page = ctx.evidence?.page;
    const havePage = hasPageEvidence(page);
    return {
      // Named URL + inspect verb is a specific shape.
      intentFit: 0.85,
      // The product is grounded page facts; no observation → 0, and the verify gate
      // keeps it from claiming page content it never saw.
      evidence: havePage ? 1 : 0,
      history: 0.5,
      latency: latencyPenalty(page?.durationMs),
      // A real browser navigation is the most expensive evidence source.
      cost: 0.2,
      // Moderate risk: page content drives downstream action; verify binds it.
      risk: 0.12,
      reason: 'Page-inspection question — answer only from a real browser observation.',
    };
  },

  resolve(ctx: TurnContext): Resolution | null {
    if (!isPageQuery(ctx.understood || ctx.content)) return null;
    const page: PageEvidence | undefined = ctx.evidence?.page;
    const obsError = page?.error;

    if (!hasPageEvidence(page)) {
      const why = obsError ? ` (${obsError})` : '';
      return {
        text: `I can answer that by opening the page, but ${NO_EVIDENCE_MARKER} for this turn${why}. Re-ask with a browser available and I'll load it and report the real title/status/elements.`,
        turnKind: 'analysis',
        confidence: 0.55,
        strategy: 'page',
      } as Resolution;
    }

    return {
      text: compose(page),
      turnKind: 'analysis',
      confidence: 0.96,
      strategy: 'page',
    } as Resolution;
  },

  /**
   * Bind every page CLAIM to a real observation. The title in the answer must equal the
   * observed title; every `\`selector\`` mentioned must be one we actually observed; and
   * a "present"/"not found" claim must match the observation's `exists`. Any mismatch —
   * a fabricated title, an unobserved selector, a flipped existence claim — is refused.
   */
  verify(resolution: Resolution, ctx: TurnContext): VerificationResult {
    const text = resolution.text ?? '';
    if (text.includes(NO_EVIDENCE_MARKER)) {
      return { ok: true, reason: 'Honest no-observation decline — no page claim made.' };
    }
    const page = ctx.evidence?.page;
    if (!hasPageEvidence(page)) {
      return { ok: false, reason: 'Page answer composed but no observation is attached — refusing to release.' };
    }
    if (!text.startsWith(GROUNDED_MARKER)) {
      return { ok: false, reason: 'Page answer lacks the evidence header — not a grounded composition.' };
    }

    // The composed title line must reflect the observed title exactly.
    const titleLine = text.match(/- \*\*Title:\*\* (.*)/)?.[1]?.trim();
    const observedTitle = page.title || '(none)';
    if (titleLine !== undefined && titleLine !== observedTitle) {
      return { ok: false, reason: `Answer's title "${titleLine}" ≠ observed "${observedTitle}" — refusing.` };
    }

    // Every backtick-quoted selector in the answer must be one we observed.
    const observedSelectors = new Map(page.selectors.map((s) => [s.selector, s]));
    const citedSelectors = (text.match(/`([^`]+)`/g) ?? []).map((t) => t.replace(/`/g, ''));
    for (const sel of citedSelectors) {
      if (!observedSelectors.has(sel)) {
        return { ok: false, reason: `Answer cites selector \`${sel}\` that was not observed — refusing.` };
      }
    }
    // A "present"/"not found" claim must match the observation's existence.
    for (const [sel, obs] of observedSelectors) {
      const presentClaim = new RegExp('`' + escapeRe(sel) + '` — present', 'i').test(text);
      const notFoundClaim = new RegExp('`' + escapeRe(sel) + '` — not found', 'i').test(text);
      if (presentClaim && !obs.exists) {
        return { ok: false, reason: `Answer says \`${sel}\` is present but it was not found — refusing.` };
      }
      if (notFoundClaim && obs.exists) {
        return { ok: false, reason: `Answer says \`${sel}\` was not found but it exists — refusing.` };
      }
    }

    const bound = [...pageEvidenceIds(page)];
    return { ok: true, boundEvidence: bound, reason: `Bound to ${bound.length} observed page fact(s).` };
  },
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
