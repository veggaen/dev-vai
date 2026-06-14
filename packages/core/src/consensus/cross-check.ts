/**
 * Council fact cross-check — the layer that turns the council from a *method* reviewer
 * into a *fact* verifier for checkable claims.
 *
 * RE-ARCHITECTED (Stage B/D). The old version confirmed a claim if ANY number anywhere in
 * the search snippets fell within 5% of it — a string-presence test that false-confirmed on
 * coincidental matches (the live "$3,200 ETH" failure). The new version is **subject-anchored
 * and corroborated**:
 *   1. Stage A (`resolveIntent`) tells us the SUBJECT (ETH) and that the user wants a CURRENT
 *      value — so a stale screenshot number is the wrong source and we verify against live web.
 *   2. We extract candidate numbers ONLY from snippets that mention the subject alias AND carry
 *      the value's unit (currency for a price). A reddit "$3,200" with no "eth" context is dropped.
 *   3. We require ≥ MIN_CORROBORATION qualifying candidates and confirm the draft against their
 *      MEDIAN — not against the first within-tolerance hit. A lone coincidence can't outvote a
 *      cluster of the true value.
 *   4. Fewer than MIN_CORROBORATION qualifying candidates → inconclusive (advisory only, never a
 *      pass, never clears a web-search verdict for release).
 * Temporal claims ("as of 10:00 AM UTC") are extracted and only confirmed if the evidence
 * carries a matching time anchor — fabricated timestamps fail like fabricated numbers.
 *
 * Flow (composed in ChatService.crossCheckConsensus, NOT inside the pure `convene`):
 *   1. `extractCheckableClaim(prompt, draft, intent)` — is there a number/date/entity worth
 *      confirming? Returns the claim plus the subject/unit context to anchor matching.
 *   2. ChatService runs ONE web search (its own `searchForEvidence`).
 *   3. `assessClaimAgreement(claim, search, intent)` — does corroborated, subject-anchored
 *      evidence confirm or contradict it?
 *   4. `applyCrossCheck(consensus, assessment)` — new consensus: strong boost on corroborated
 *      confirmation, flip to `reread-intent` on contradiction, advisory no-op when inconclusive.
 *
 * Everything here is PURE (no I/O, no network) so it unit-tests without Ollama or live search.
 */

import type { CouncilConsensus } from './types.js';
import type { SearchResponse } from '../search/types.js';
import type { ResolvedIntent } from './intent-resolver.js';
import { resolveIntent } from './intent-resolver.js';

export type { CouncilCrossCheck } from './types.js';

/** A checkable claim extracted from a draft — the thing we try to confirm. */
export interface CheckableClaim {
  /** Kind of value found (drives the comparison strategy). */
  readonly kind: 'number' | 'date' | 'entity';
  /** The raw token as it appears in the draft (e.g. "$63,450.73", "2021", "PostgreSQL"). */
  readonly value: string;
  /** Normalized numeric value when kind === 'number' (commas/currency stripped). */
  readonly numeric: number | null;
  /** Lowercased subject aliases this claim is about (["eth","ethereum"]) — anchors matching. */
  readonly subjectAliases: readonly string[];
  /** True when the value carries a currency unit (a price), so candidates must too. */
  readonly hasCurrencyUnit: boolean;
  /** A temporal anchor asserted alongside the value ("10:00 AM UTC", "2024-01-01"), or null. */
  readonly temporalClaim: string | null;
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Strip currency/grouping so "$63,450.73" → 63450.73. Returns null if not numeric. */
function parseNumeric(token: string): number | null {
  const cleaned = token.replace(/[$€£,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// A "money / quantity" token: optional currency, digits with optional grouping + decimals.
const NUMBER_RE = /(?:[$€£]\s?)?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?:[$€£]\s?)?\d+(?:\.\d+)?/g;
// A 4-digit year or ISO-ish date.
const DATE_RE = /\b(?:19|20)\d{2}\b|\b\d{4}-\d{2}-\d{2}\b/g;
// A clock-time / "as of" temporal anchor in a draft.
const TEMPORAL_RE = /\b(?:as of\s+)?\d{1,2}:\d{2}\s?(?:[AaPp][Mm])?\s?(?:UTC|GMT|EST|PST|CET)?\b|\bas of\s+[\w,\s:]+?(?=[.;]|$)/;
// A currency marker — symbol or ISO code near a number.
const CURRENCY_RE = /[$€£]|\b(?:usd|eur|gbp|dollars?)\b/i;

/** Words too generic to be a meaningful "entity" claim. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'your', 'you', 'are', 'was', 'has',
  'have', 'can', 'will', 'use', 'using', 'about', 'which', 'what', 'when', 'how', 'why',
]);

/**
 * Find the most salient checkable claim in Vai's draft, carrying the subject/unit context
 * needed to anchor verification. Prefers a concrete number (prices, counts), then a date,
 * then a distinctive entity. Returns null when there is nothing factual to confirm.
 *
 * `intent` (Stage A) supplies the subject aliases and tells us a price ask is current-value.
 * If omitted, it is resolved internally so the function stays usable standalone + in tests.
 */
export function extractCheckableClaim(prompt: string, draft: string, intent?: ResolvedIntent): CheckableClaim | null {
  const resolved = intent ?? resolveIntent(prompt, draft);
  const factShaped =
    resolved.valueKind !== 'none' ||
    /\b(price|cost|worth|value|how much|how many|count|number of|when|what year|who|where|current|latest|today)\b/i.test(prompt) ||
    /[$€£]\s?\d/.test(draft);
  if (!factShaped) return null;

  const subjectAliases = resolved.subjectAliases;
  const temporalClaim = TEMPORAL_RE.exec(draft)?.[0]?.trim() ?? null;

  const numbers = draft.match(NUMBER_RE) ?? [];
  // Prefer a token that carries a currency symbol or grouping (a real "value", not "3").
  const salientNumber = numbers.find((t) => /[$€£]/.test(t) || /,/.test(t) || (parseNumeric(t) ?? 0) >= 100);
  if (salientNumber) {
    const hasCurrencyUnit = /[$€£]/.test(salientNumber) || resolved.valueKind === 'price' || CURRENCY_RE.test(draft);
    return {
      kind: 'number',
      value: salientNumber.trim(),
      numeric: parseNumeric(salientNumber),
      subjectAliases,
      hasCurrencyUnit,
      temporalClaim,
    };
  }

  const dates = draft.match(DATE_RE) ?? [];
  const firstDate = dates[0];
  if (firstDate && /\b(when|what year|year|date)\b/i.test(prompt)) {
    return { kind: 'date', value: firstDate, numeric: parseNumeric(firstDate), subjectAliases, hasCurrencyUnit: false, temporalClaim };
  }

  const entity = (draft.match(/\b[A-Z][a-zA-Z0-9.+-]{2,}\b/g) ?? [])
    .find((w) => !STOPWORDS.has(w.toLowerCase()));
  if (entity && /\b(who|what|which|name)\b/i.test(prompt)) {
    return { kind: 'entity', value: entity, numeric: null, subjectAliases, hasCurrencyUnit: false, temporalClaim };
  }
  return null;
}

/** Result of comparing a claim against the search evidence. */
export interface ClaimAssessment {
  readonly verified: boolean;
  readonly contradicted: boolean;
  readonly confirmsValue: string | null;
  readonly searchConfidence: number;
  readonly query: string;
  readonly sources: ReadonlyArray<{ readonly title?: string; readonly url?: string; readonly snippet?: string }>;
  /** How many subject-anchored, unit-matching candidates corroborated (or disagreed). */
  readonly corroboration: number;
  /** Median of the qualifying candidates (the consensus value), or null. */
  readonly evidenceMedian: number | null;
  /** True when the draft's temporal claim could not be grounded in the evidence. */
  readonly temporalUngrounded: boolean;
}

/** Numbers within this relative tolerance count as "the same value" (prices drift). */
const NUMERIC_TOLERANCE = 0.05;
/** Need at least this many qualifying candidates before a confirmation is trustworthy. */
export const MIN_CORROBORATION = 2;

function median(nums: readonly number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Pull qualifying numeric candidates from the evidence: numbers that appear in a snippet which
 * also mentions a subject alias AND (for a price) carries a currency unit. This is what keeps a
 * stray forum "$3,200" with no "eth" context from counting. When the claim has no subject (we
 * couldn't resolve one), we fall back to the whole haystack but still require the currency unit
 * for a price — degraded, but not blind.
 */
function gatherCandidates(claim: CheckableClaim, search: SearchResponse): number[] {
  const blocks = [
    { text: search.answer ?? '', hasSubject: true }, // the synthesized answer is on-subject by construction
    ...search.sources.slice(0, 8).map((s) => ({ text: `${s.title ?? ''} ${s.text ?? ''}`, hasSubject: false })),
  ];
  const aliases = claim.subjectAliases.map((a) => a.toLowerCase());
  const out: number[] = [];
  for (const block of blocks) {
    const lower = block.text.toLowerCase();
    const onSubject = block.hasSubject || aliases.length === 0 || aliases.some((a) => lower.includes(a));
    if (!onSubject) continue;
    if (claim.hasCurrencyUnit && !CURRENCY_RE.test(block.text)) continue;
    for (const tok of block.text.match(NUMBER_RE) ?? []) {
      const n = parseNumeric(tok);
      if (n !== null && n > 0) out.push(n);
    }
  }
  return out;
}

/**
 * Decide whether the search evidence confirms or contradicts the claim — subject-anchored and
 * corroborated. Pure: takes the already-fetched `SearchResponse`.
 *
 * For a number: gather subject-anchored, unit-matching candidates; require ≥ MIN_CORROBORATION
 * of them; confirm only if the draft is within tolerance of their MEDIAN. If a tight cluster
 * disagrees with the draft → contradiction. Too few candidates → inconclusive.
 * For entities/dates: case-insensitive presence (unchanged), but still records corroboration.
 */
export function assessClaimAgreement(
  claim: CheckableClaim,
  search: SearchResponse,
  query: string,
  intent?: ResolvedIntent,
): ClaimAssessment {
  void intent; // reserved for future intent-specific strategies; claim already carries the context
  const sources = search.sources.slice(0, 5).map((s) => ({ title: s.title, url: s.url, snippet: s.text }));
  const base = {
    searchConfidence: clamp01(search.confidence),
    query: query || search.plan?.originalQuery || '',
    sources,
  };

  // Temporal grounding: a draft "as of 10:00 AM UTC" must be echoed by the evidence, else flag it.
  const temporalUngrounded = (() => {
    if (!claim.temporalClaim) return false;
    const haystack = [search.answer, ...search.sources.slice(0, 5).map((s) => `${s.title} ${s.text}`)].join(' ').toLowerCase();
    const timeBits = (claim.temporalClaim.match(/\d{1,2}:\d{2}|\b(?:utc|gmt|est|pst|cet)\b|\b(?:19|20)\d{2}\b/gi) ?? []).map((t) => t.toLowerCase());
    if (timeBits.length === 0) return false;
    return !timeBits.some((b) => haystack.includes(b));
  })();

  if (claim.kind === 'number' && claim.numeric !== null) {
    const candidates = gatherCandidates(claim, search);
    const target = claim.numeric;
    const matching = candidates.filter((n) => Math.abs(n - target) <= Math.abs(target) * NUMERIC_TOLERANCE);
    const comparable = candidates.filter((n) => n >= target * 0.5 && n <= target * 2);
    const med = candidates.length ? median(candidates) : null;

    // Need a real cluster of corroborating evidence to confirm.
    if (matching.length >= MIN_CORROBORATION && med !== null && Math.abs(med - target) <= Math.abs(target) * NUMERIC_TOLERANCE) {
      return {
        verified: true, contradicted: false, confirmsValue: claim.value,
        corroboration: matching.length, evidenceMedian: med, temporalUngrounded, ...base,
      };
    }
    // A tight cluster of comparable numbers that DISAGREES with the draft → contradiction.
    if (comparable.length >= MIN_CORROBORATION && med !== null && Math.abs(med - target) > Math.abs(target) * NUMERIC_TOLERANCE) {
      return {
        verified: false, contradicted: true, confirmsValue: null,
        corroboration: comparable.length, evidenceMedian: med, temporalUngrounded, ...base,
      };
    }
    // Not enough anchored evidence either way → inconclusive (never a pass).
    return {
      verified: false, contradicted: false, confirmsValue: null,
      corroboration: matching.length, evidenceMedian: med, temporalUngrounded, ...base,
    };
  }

  // Date / entity: presence is confirmation; we don't infer contradiction from absence.
  const haystack = [search.answer, ...search.sources.slice(0, 5).map((s) => `${s.title} ${s.text}`)].join(' \n ');
  const present = haystack.toLowerCase().includes(claim.value.toLowerCase());
  return {
    verified: present, contradicted: false, confirmsValue: present ? claim.value : null,
    corroboration: present ? 1 : 0, evidenceMedian: null, temporalUngrounded, ...base,
  };
}

/** Up to this fraction of the remaining agreement gap is closed by a full-confidence confirm. */
const MAX_BOOST_FACTOR = 0.85;
/** A confirmation at/above this boosted agreement is labelled a verified "pass". */
const PASS_THRESHOLD = 0.9;

/**
 * Apply a claim assessment to a consensus, returning a NEW consensus (never mutates).
 * On corroborated confirmation: strongly boost agreement + confidence toward (never reaching)
 * 1.0, attach the `crossCheck` record (incl. sources). On contradiction OR an ungrounded
 * temporal claim: drop confidence and flip the action to `reread-intent`. With no verdict
 * either way: attach an advisory (unverified) crossCheck without changing the numbers, and —
 * critically — do NOT clear a `web-search` verdict for release (Stage D ship gate).
 */
export function applyCrossCheck(consensus: CouncilConsensus, assessment: ClaimAssessment): CouncilConsensus {
  const boostedFrom = consensus.agreement;
  const crossCheckBase = {
    confirmsValue: assessment.confirmsValue,
    query: assessment.query,
    boostedFrom,
    searchConfidence: assessment.searchConfidence,
    sources: assessment.sources,
  };

  // A confirmed number with a fabricated timestamp is still a flawed draft — treat as contradiction.
  if (assessment.contradicted || (assessment.verified && assessment.temporalUngrounded)) {
    return {
      ...consensus,
      confidence: clamp01(consensus.confidence * 0.5),
      recommendedAction: 'reread-intent',
      outcome: consensus.outcome === 'ship' ? 'act' : consensus.outcome,
      crossCheck: { verified: false, pass: false, contradicted: true, ...crossCheckBase },
    };
  }

  if (assessment.verified) {
    // Corroboration scales the boost: a 2-source confirm boosts less than a 5-source one.
    const corroborationFactor = Math.min(1, assessment.corroboration / 4);
    const factor = MAX_BOOST_FACTOR * assessment.searchConfidence * corroborationFactor;
    const agreement = clamp01(Math.min(0.99, boostedFrom + (1 - boostedFrom) * factor));
    const confidence = clamp01(Math.min(0.99, consensus.confidence + (1 - consensus.confidence) * factor));
    const pass = agreement >= PASS_THRESHOLD;
    // The council wanted a web search to confirm; the search corroborated the draft, so its ask
    // is satisfied — clear it for release instead of leaving the redraft loop armed.
    const satisfiedWebSearch = consensus.recommendedAction === 'web-search';
    return {
      ...consensus,
      agreement,
      confidence,
      outcome: satisfiedWebSearch ? 'ship' : consensus.outcome,
      recommendedAction: satisfiedWebSearch ? 'answer-directly' : consensus.recommendedAction,
      crossCheck: { verified: true, pass, contradicted: false, ...crossCheckBase },
    };
  }

  // Search ran but couldn't corroborate or contradict — advisory only, numbers unchanged, and
  // a web-search verdict STAYS armed (Stage D: a weak confirm must not ship a fact).
  return {
    ...consensus,
    crossCheck: { verified: false, pass: false, contradicted: false, ...crossCheckBase },
  };
}
