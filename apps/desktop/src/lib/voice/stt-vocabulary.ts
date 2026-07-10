/**
 * Personal dictation vocabulary — the "custom words" a user says often that
 * generic Whisper mishears (game names, product names, people, jargon). Stored
 * locally and sent with the cleanup request so the local model can restore the
 * exact spelling, e.g. "Allegiance client" → "League of Legends client".
 *
 * This is a CORRECTION aid, not decode-time biasing (transformers.js Whisper
 * can't take an initial_prompt cleanly). The biggest raw-accuracy lever is still
 * the model tier — see stt-quality.ts.
 */

const KEY = 'vai-voice-vocabulary';
const MAX_TERMS = 100;
const MAX_TERM_LEN = 60;

/** The raw text exactly as the user typed it (for the settings field). */
export function loadVocabularyRaw(): string {
  try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; }
}

export function saveVocabularyRaw(raw: string): void {
  try { localStorage.setItem(KEY, raw); } catch { /* non-fatal */ }
  window.dispatchEvent(new CustomEvent('vai:voice-vocabulary-changed', { detail: raw }));
}

/** Parsed, de-duped, capped list of terms (split on newlines or commas). */
export function loadVocabulary(): string[] {
  const raw = loadVocabularyRaw();
  if (!raw.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(/[\n,]+/)) {
    const term = piece.trim();
    if (!term || term.length > MAX_TERM_LEN) continue;
    const dedupe = term.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push(term);
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

/**
 * True when `candidate` restored an exact vocabulary term that wasn't already in
 * `raw` — i.e. the cleanup did the legitimate job we asked for. Used to let a
 * vocab correction through the "don't let the model rewrite things" guard, which
 * would otherwise reject a large-but-correct change.
 */
export function candidateRestoredVocabTerm(raw: string, candidate: string, vocabulary: string[]): boolean {
  if (raw === candidate) return false;
  const rawLower = raw.toLowerCase();
  const candLower = candidate.toLowerCase();
  for (const term of vocabulary) {
    const t = term.toLowerCase();
    if (candLower.includes(t) && !rawLower.includes(t)) return true;
  }
  return false;
}
