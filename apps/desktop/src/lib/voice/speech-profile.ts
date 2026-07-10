/**
 * Per-user speech profile — the self-healing dictation learner.
 *
 * Every time the user dictates and then edits a word before sending, that edit is a
 * signal ("we heard X, they meant Y"). This module turns those signals into a persistent
 * profile of replacement rules that are APPLIED to future transcripts once they've been
 * seen enough times — and DEMOTED again if the user ever edits an auto-applied word back
 * (the rule was wrong for them → the algo heals itself).
 *
 * Grooming ("prettify") is deterministic and model-free so it can run on every final
 * transcript with zero latency: sentence casing, terminal punctuation, doubled-word
 * collapse, filler-word removal, punctuation spacing. The council/model hook point for a
 * deeper groom is deliberately AFTER this pass (see useVoiceDictation) so anything
 * heavier only ever refines an already-clean baseline.
 *
 * Pure logic + a thin localStorage persistence seam; fully unit-tested.
 */

import { detectCorrections, plausibleMishearing } from './correction-detection.js';
import { repairKnownAsrArtifacts } from '@vai/core/browser';

export interface SpeechRule {
  /** Normalized token(s) the engine keeps mishearing. */
  readonly heard: string;
  /** What the user actually says. */
  readonly corrected: string;
  /** Times we've seen this correction. */
  readonly count: number;
  /** Times an auto-applied rule was edited BACK by the user (heals the profile). */
  readonly strikes: number;
  readonly lastSeen: string;
}

export interface SpeechProfile {
  readonly version: 1;
  readonly rules: readonly SpeechRule[];
}

export interface AppliedReplacement {
  readonly heard: string;
  readonly corrected: string;
}

/** Rules apply automatically once seen this many times (and while strikes stay low). */
export const PROMOTE_AT = 2;
/** A promoted rule that gets edited back this many times is retired. */
export const RETIRE_AT = 2;

const norm = (s: string): string => s.trim().toLowerCase();

export function emptyProfile(): SpeechProfile {
  return { version: 1, rules: [] };
}

/** Rules currently active (promoted and not struck out). */
export function activeRules(profile: SpeechProfile): readonly SpeechRule[] {
  return profile.rules.filter((r) => r.count >= PROMOTE_AT && r.strikes < RETIRE_AT);
}

/** All rules, newest first — for a "Learned corrections" settings list (transparency). */
export function listRules(profile: SpeechProfile): readonly SpeechRule[] {
  return [...profile.rules].sort((a, b) => (b.lastSeen > a.lastSeen ? 1 : -1));
}

/** Delete a specific learned rule (user removed a correction they didn't want). */
export function removeRule(profile: SpeechProfile, heard: string, corrected: string): SpeechProfile {
  const h = norm(heard);
  const c = norm(corrected);
  return { version: 1, rules: profile.rules.filter((r) => !(norm(r.heard) === h && norm(r.corrected) === c)) };
}

/**
 * Apply the profile's active rules to a fresh transcript (whole-word, case-insensitive;
 * preserves a leading capital). Returns the corrected text plus which rules fired so the
 * caller can pass them along for self-heal detection at send time.
 */
export function applyProfile(text: string, profile: SpeechProfile): { text: string; applied: AppliedReplacement[] } {
  let out = text;
  const applied: AppliedReplacement[] = [];
  for (const rule of activeRules(profile)) {
    const pattern = new RegExp(`\\b${escapeRegExp(rule.heard)}\\b`, 'gi');
    if (!pattern.test(out)) continue;
    pattern.lastIndex = 0;
    out = out.replace(pattern, (match) => {
      const replacement = match[0] === match[0]?.toUpperCase()
        ? rule.corrected.charAt(0).toUpperCase() + rule.corrected.slice(1)
        : rule.corrected;
      return replacement;
    });
    applied.push({ heard: rule.heard, corrected: rule.corrected });
  }
  return { text: out, applied };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Learn from one dictate→edit→send cycle.
 *
 * `insertedText` is what dictation put in the composer (after grooming + profile);
 * `sentText` is what the user actually sent. New substitutions become rules (promoted at
 * {@link PROMOTE_AT} sightings). If the user edited an AUTO-APPLIED correction back to the
 * original, that rule earns a strike — at {@link RETIRE_AT} strikes it stops applying.
 */
export function learnFromEdit(
  profile: SpeechProfile,
  args: {
    readonly insertedText: string;
    readonly sentText: string;
    /** Rules applyProfile fired for this utterance (for self-heal detection). */
    readonly applied?: readonly AppliedReplacement[];
  },
): SpeechProfile {
  const { insertedText, sentText, applied = [] } = args;

  // Span-integrity guard: only learn when the dictated text substantially SURVIVES in
  // what was sent. If the user deleted or rewrote most of it, there's no clean signal
  // (this covers "they removed the whole sentence" and unrelated later edits).
  const insertedTokens = insertedText.trim().split(/\s+/).filter(Boolean);
  if (insertedTokens.length > 0) {
    const sentSet = new Set(sentText.toLowerCase().split(/\s+/).filter(Boolean));
    const survived = insertedTokens.filter((t) => sentSet.has(t.toLowerCase())).length;
    if (survived / insertedTokens.length < 0.5) return profile;
  }

  const result = detectCorrections(insertedText, sentText);
  const now = new Date().toISOString();
  const rules = new Map<string, SpeechRule>(profile.rules.map((r) => [`${norm(r.heard)}→${norm(r.corrected)}`, r]));

  for (const m of result.mishearings) {
    const heard = norm(m.heard);
    const corrected = m.corrected.trim();
    if (!heard || !corrected || heard === norm(corrected)) continue;

    // Self-heal FIRST (ungated): the user reverted an auto-applied rule back to what we
    // heard. This must always register a strike, regardless of phonetics.
    const reverted = applied.find((a) => norm(a.corrected) === heard && norm(a.heard) === norm(corrected));
    if (reverted) {
      const key = `${norm(reverted.heard)}→${norm(reverted.corrected)}`;
      const rule = rules.get(key);
      if (rule) rules.set(key, { ...rule, strikes: rule.strikes + 1, lastSeen: now });
      continue;
    }

    // Plausibility gate: only a genuine mishearing of a distinctive word becomes a rule.
    // Rejects change-of-mind swaps ("park"→"beach") and common-word homophones.
    if (plausibleMishearing(m.heard, m.corrected) === 'none') continue;

    const key = `${heard}→${norm(corrected)}`;
    const existing = rules.get(key);
    rules.set(key, existing
      ? { ...existing, count: existing.count + 1, lastSeen: now }
      : { heard, corrected, count: 1, strikes: 0, lastSeen: now });
  }

  // Keep the profile bounded: retire the stalest rules past a sane cap.
  const kept = [...rules.values()]
    .sort((a, b) => (b.lastSeen > a.lastSeen ? 1 : -1))
    .slice(0, 200);

  return { version: 1, rules: kept };
}

/**
 * Deterministic transcript groom — the zero-latency "prettify" pass.
 * Order matters: fillers → doubles → spacing → casing → terminal punctuation.
 */
export function confirmCorrection(
  profile: SpeechProfile,
  args: { readonly heard: string; readonly corrected: string },
): SpeechProfile {
  const heard = norm(args.heard);
  const corrected = args.corrected.trim();
  if (!heard || !corrected || heard === norm(corrected)) return profile;

  const now = new Date().toISOString();
  const rules = new Map<string, SpeechRule>(profile.rules.map((r) => [`${norm(r.heard)}→${norm(r.corrected)}`, r]));
  const key = `${heard}→${norm(corrected)}`;
  const existing = rules.get(key);
  rules.set(key, existing
    ? { ...existing, count: Math.max(PROMOTE_AT, existing.count + 1), strikes: 0, lastSeen: now }
    : { heard, corrected, count: PROMOTE_AT, strikes: 0, lastSeen: now });

  const kept = [...rules.values()]
    .sort((a, b) => (b.lastSeen > a.lastSeen ? 1 : -1))
    .slice(0, 200);

  return { version: 1, rules: kept };
}

export function prettifyTranscript(raw: string): string {
  let t = repairKnownAsrArtifacts(raw).trim();
  if (!t) return t;

  // Strip standalone filler tokens (never inside words).
  t = t.replace(/\b(?:um+|uh+|uhm+|erm+|hmm+)\b[,.]?\s*/gi, '');

  // Collapse immediately-doubled words ("the the plan" → "the plan").
  t = t.replace(/\b(\w+)(\s+\1)+\b/gi, '$1');

  // Punctuation spacing: no space before, one after.
  t = t.replace(/\s+([,.!?;:])/g, '$1').replace(/([,.!?;:])(?=\S)/g, '$1 ');

  // Collapse whitespace runs.
  t = t.replace(/\s{2,}/g, ' ').trim();
  if (!t) return t;

  // Sentence casing: first letter, and after terminal punctuation.
  t = t.charAt(0).toUpperCase() + t.slice(1);
  t = t.replace(/([.!?]\s+)([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());

  // Standalone "i" → "I".
  t = t.replace(/\bi\b/g, 'I');

  // Terminal punctuation for real sentences (3+ words), question mark for question shapes.
  if (!/[.!?…]$/.test(t) && t.split(/\s+/).length >= 3) {
    const isQuestion = /^(?:who|what|when|where|why|how|is|are|do|does|did|can|could|should|would|will)\b/i.test(t);
    t += isQuestion ? '?' : '.';
  }

  return t;
}

// ── Persistence (thin, guarded — safe in any webview) ─────────────────────────

const STORAGE_KEY = 'vai.speech-profile.v1';

export function loadProfile(): SpeechProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyProfile();
    const parsed = JSON.parse(raw) as SpeechProfile;
    if (parsed?.version !== 1 || !Array.isArray(parsed.rules)) return emptyProfile();
    return parsed;
  } catch {
    return emptyProfile();
  }
}

export function saveProfile(profile: SpeechProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    /* non-fatal — the profile simply doesn't persist in this environment */
  }
}

export function clearProfile(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* non-fatal */ }
}
