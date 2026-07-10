/**
 * Guards local LLM transcript cleanup from rewriting dictation into different
 * sentences. Models may fix punctuation/casing and narrowly repair obvious ASR
 * artifacts, but they must not substitute new ideas.
 */

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\w\s']/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Share of words in the longer transcript that appear in both (0-1). */
export function transcriptWordOverlap(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.length === 0 && right.length === 0) return 1;
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  let shared = 0;
  for (const word of left) {
    if (rightSet.has(word)) shared += 1;
  }
  return shared / Math.max(left.length, right.length);
}

/**
 * Whisper-family models emit non-speech annotations for silence/noise/music:
 * "[BLANK_AUDIO]", "(blank audio)", "[Music]", "(inaudible)", "♪ … ♪", etc.
 * These must NEVER reach the user — strip them everywhere a transcript is
 * displayed or delivered. Returns '' when the transcript was only annotations.
 */
export function stripNonSpeechAnnotations(text: string): string {
  return text
    .replace(/[[(]\s*(?:blank[\s_]*audio|silence|music|applause|laughter|noise|inaudible|no\s+speech|speaking\s+in\s+foreign\s+language)\s*[\])]/gi, ' ')
    .replace(/♪[^♪]*♪?/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * ASR engines sometimes output syllable debris instead of a word, e.g.
 * "joke-o-o-gost" for "yoghurt". This intentionally does not flag normal
 * hyphenated language such as "state-of-the-art"; it looks for repeated or
 * one-letter fragments inside a long hyphenated token.
 */
export function looksLikeAsrArtifactTranscript(text: string): boolean {
  const normalized = text.toLowerCase();
  const hyphenated = normalized.match(/\b[a-z]+(?:-[a-z]+){2,}\b/g) ?? [];
  for (const token of hyphenated) {
    const parts = token.split('-').filter(Boolean);
    if (parts.length < 4) continue;
    const oneLetterParts = parts.filter((part) => part.length === 1).length;
    let repeatedShortParts = 0;
    for (let i = 1; i < parts.length; i += 1) {
      if (parts[i] === parts[i - 1] && parts[i].length <= 2) repeatedShortParts += 1;
    }
    if (oneLetterParts >= 2 || repeatedShortParts > 0) return true;
  }

  // Same artifact after punctuation cleanup: "joke o o gost".
  return /\b[a-z]{3,}\s+([a-z])\s+\1\s+[a-z]{3,}\b/i.test(text);
}

function matchCase(template: string, replacement: string): string {
  const first = template.trim().charAt(0);
  return first && first === first.toUpperCase()
    ? replacement.charAt(0).toUpperCase() + replacement.slice(1)
    : replacement;
}

/**
 * Deterministic seed repairs for high-confidence personal ASR artifacts. Keep
 * this tiny and boring; broad/contextual repair belongs to the guarded cleanup
 * model or the user's learned speech profile.
 */
export function repairKnownAsrArtifacts(text: string): string {
  return text
    .replace(
      /\b(?:a\s+)?joke[-\s]+o[-\s]+o[-\s]+gost\b/gi,
      (match) => matchCase(match, 'yoghourt'),
    )
    .replace(
      /\ball\s+the\s+worlds\s+that\s+i\s+am\s+saying\b/gi,
      (match) => matchCase(match, 'all the words that I am saying'),
    )
    .replace(
      /\bthe\s+worlds\s+that\s+i\s+am\s+saying\b/gi,
      (match) => matchCase(match, 'the words that I am saying'),
    )
    .replace(
      /\bkey\s+amount\b/gi,
      (match) => matchCase(match, 'keybind'),
    );
}

/** True when every word of `candidate` appears in `source` in the same order —
 *  i.e. the candidate only DELETED words, never added or reordered any. */
export function isTokenSubsequence(source: string, candidate: string): boolean {
  const src = tokens(source);
  const cand = tokens(candidate);
  if (cand.length === 0) return false;
  let i = 0;
  for (const word of src) {
    if (i < cand.length && cand[i] === word) i += 1;
  }
  return i === cand.length;
}

/** Spoken retraction cues — the speaker corrected themselves mid-sentence. Only
 *  when one is present do we allow the cleanup to DROP words (self-correction),
 *  e.g. "meet Tuesday, actually no, Wednesday" -> "meet Wednesday". */
const RETRACTION_CUE = /\b(?:actually|i mean|scratch that|no wait|wait no|never mind|rather|correction|make that|let'?s say)\b/i;

export function shouldAcceptPolishedTranscript(raw: string, polished: string): boolean {
  const source = raw.trim();
  const candidate = polished.trim();
  if (!candidate) return false;
  if (candidate === source) return true;
  const overlap = transcriptWordOverlap(source, candidate);
  if (looksLikeAsrArtifactTranscript(source) && overlap >= 0.5) return true;
  // Self-correction: accept a pure deletion (candidate is an ordered subset of the
  // raw words — nothing invented) WHEN the speaker signalled a retraction. This is
  // the only path that may drop words below the rewrite threshold, and it still
  // can't introduce new content, so it never lets a hallucinated rewrite through.
  if (RETRACTION_CUE.test(source) && isTokenSubsequence(source, candidate)) return true;
  // Reject rewrites that swap most content words ("hello hear" -> "love help").
  return overlap >= 0.62;
}
