/**
 * Dictation correction detection.
 *
 * After voice→text drops a transcript into the composer, the user often fixes a
 * word the engine misheard before sending. Comparing what we transcribed against
 * what they actually sent tells us where the engine likely got it wrong — a signal
 * we can both (a) surface gently ("did we mishear 'X'? we heard 'Y'") and (b) feed
 * the dictionary / improvement loop so the same word stops getting mangled.
 *
 * This is a word-level diff (LCS-based) that classifies edits as replacements,
 * insertions, or deletions, then keeps only the REPLACEMENTS — the substitutions
 * that look like mishearings, not the user adding or trimming words. Pure, no IO,
 * unit-tested. We do NOT call this "the answer is wrong"; it's a heuristic about
 * the transcription, with quarantine of intent left to the user.
 */

export interface WordEdit {
  readonly type: 'replace' | 'insert' | 'delete';
  /** Word(s) we transcribed (empty for a pure insertion). */
  readonly heard: string;
  /** Word(s) the user ended up with (empty for a pure deletion). */
  readonly corrected: string;
}

export interface CorrectionResult {
  readonly edits: readonly WordEdit[];
  /** Substitutions that look like mishearings (the actionable subset). */
  readonly mishearings: readonly { heard: string; corrected: string }[];
  /** True when the user changed wording, not merely appended/trimmed. */
  readonly hasCorrections: boolean;
}

function tokenize(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

const norm = (w: string): string => w.toLowerCase().replace(/[.,!?;:"'`]+$/g, '');

/** Longest-common-subsequence table over normalized words. */
function lcs(a: readonly string[], b: readonly string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = norm(a[i]) === norm(b[j])
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

/**
 * Compare the transcript Vai heard with the text the user sent.
 * `minWordLen` ignores trivial 1-char substitutions (punctuation noise).
 */
export function detectCorrections(
  heardText: string,
  sentText: string,
  opts: { minWordLen?: number } = {},
): CorrectionResult {
  const minWordLen = opts.minWordLen ?? 2;
  const heard = tokenize(heardText);
  const sent = tokenize(sentText);

  if (heard.length === 0) {
    return { edits: [], mishearings: [], hasCorrections: false };
  }

  const table = lcs(heard, sent);
  const edits: WordEdit[] = [];
  let i = 0;
  let j = 0;

  // Walk the LCS, collapsing adjacent delete+insert runs into single replacements.
  while (i < heard.length && j < sent.length) {
    if (norm(heard[i]) === norm(sent[j])) {
      i += 1; j += 1;
      continue;
    }
    const delRun: string[] = [];
    const insRun: string[] = [];
    // Advance on whichever side the LCS says to drop.
    while (i < heard.length && j < sent.length && norm(heard[i]) !== norm(sent[j])) {
      if (table[i + 1][j] >= table[i][j + 1]) { delRun.push(heard[i]); i += 1; }
      else { insRun.push(sent[j]); j += 1; }
    }
    if (delRun.length && insRun.length) {
      edits.push({ type: 'replace', heard: delRun.join(' '), corrected: insRun.join(' ') });
    } else if (delRun.length) {
      edits.push({ type: 'delete', heard: delRun.join(' '), corrected: '' });
    } else if (insRun.length) {
      edits.push({ type: 'insert', heard: '', corrected: insRun.join(' ') });
    }
  }
  if (i < heard.length) edits.push({ type: 'delete', heard: heard.slice(i).join(' '), corrected: '' });
  if (j < sent.length) edits.push({ type: 'insert', heard: '', corrected: sent.slice(j).join(' ') });

  // Collapse any adjacent delete↔insert pair into a single replacement, wherever
  // it lands. The LCS walk can split a substitution into a delete then an insert
  // (e.g. a misheard last word); merging here recovers it uniformly.
  const merged: WordEdit[] = [];
  for (const edit of edits) {
    const prev = merged[merged.length - 1];
    if (prev && prev.type === 'delete' && edit.type === 'insert') {
      merged[merged.length - 1] = { type: 'replace', heard: prev.heard, corrected: edit.corrected };
    } else if (prev && prev.type === 'insert' && edit.type === 'delete') {
      merged[merged.length - 1] = { type: 'replace', heard: edit.heard, corrected: prev.corrected };
    } else {
      merged.push(edit);
    }
  }

  const mishearings = merged
    .filter((e): e is WordEdit & { type: 'replace' } => e.type === 'replace')
    .filter((e) => e.heard.length >= minWordLen && e.corrected.length >= minWordLen)
    // A wholesale rewrite isn't a "mishearing" — cap the ratio so we only flag
    // plausible word swaps, not the user retyping the whole sentence.
    .filter((e) => e.corrected.split(/\s+/).length <= 3)
    .map((e) => ({ heard: e.heard, corrected: e.corrected }));

  return {
    edits: merged,
    mishearings,
    hasCorrections: merged.some((e) => e.type === 'replace'),
  };
}

// ── Plausibility gate ─────────────────────────────────────────────────────────
// A word swap is only a MISHEARING worth learning if the two sound alike AND at
// least one side is a distinctive word. This is what separates "leech → league"
// (learn it) from "park → beach" (a change of mind — never learn it) and from
// "their → there" (common-word homophone — a global rule would be unsafe).

/** Common/function words a global replacement rule must never hinge on. */
const COMMON_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'so', 'as', 'of', 'to', 'too', 'two',
  'in', 'on', 'at', 'for', 'with', 'by', 'from', 'into', 'out', 'up', 'down', 'over',
  'is', 'are', 'was', 'were', 'be', 'been', 'am', 'do', 'does', 'did', 'not', 'no', 'yes',
  'this', 'that', 'these', 'those', 'it', 'its', 'here', 'there', 'their', 'they', 'them',
  'i', 'you', 'he', 'she', 'we', 'me', 'him', 'her', 'us', 'my', 'your', 'our', 'his',
  'now', 'then', 'than', 'when', 'what', 'who', 'how', 'why', 'where', 'can', 'will',
]);

/** Cheap, dependency-free phonetic key: vowels collapsed, doubles removed, like-sounds merged. */
export function phoneticKey(word: string): string {
  return word.toLowerCase().replace(/[^a-z]/g, '')
    .replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/gh/g, 'g').replace(/wr/g, 'r')
    .replace(/[aeiou]+/g, 'a')
    .replace(/(.)\1+/g, '$1')
    .replace(/[sz]/g, 's').replace(/[dt]/g, 't');
}

function phraseKey(phrase: string): string {
  return phrase.split(/\s+/).map(phoneticKey).filter(Boolean).join(' ');
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j += 1) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i += 1) {
      const tmp = dp[i];
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = tmp;
    }
  }
  return dp[a.length];
}

function levenshteinRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

function hasRareToken(phrase: string): boolean {
  return phrase.toLowerCase().split(/\s+/).some((t) => {
    const clean = t.replace(/[^a-z0-9]/g, '');
    return clean.length >= 3 && !COMMON_WORDS.has(clean);
  });
}

/**
 * Confidence that a `heard → corrected` swap is a real mishearing worth learning.
 * - 'high'   : sounds identical AND distinctive → safe to accumulate silently.
 * - 'medium' : sounds close AND distinctive → learn, but a confirm prompt is warranted.
 * - 'none'   : mind-change, common-word homophone, or a rewrite → NEVER learn.
 */
export function plausibleMishearing(heard: string, corrected: string): 'high' | 'medium' | 'none' {
  const h = heard.trim();
  const c = corrected.trim();
  if (!h || !c || norm(h) === norm(c)) return 'none';
  if (c.split(/\s+/).length > 3) return 'none';                 // rewrite, not a fix
  if (!hasRareToken(h) && !hasRareToken(c)) return 'none';      // common-word homophones
  const orth = levenshteinRatio(norm(h), norm(c));
  if (orth < 0.34 || orth > 0.95) return 'none';                // too far / effectively identical
  const hk = phraseKey(h);
  const ck = phraseKey(c);
  if (!hk || !ck) return 'none';
  if (hk === ck) return 'high';
  const budget = Math.max(1, Math.ceil(Math.max(hk.length, ck.length) / 4));
  return levenshtein(hk, ck) <= budget ? 'medium' : 'none';
}

/** A short, friendly prompt for the most likely PLAUSIBLE mishearing (or null). */
export function mishearingPrompt(result: CorrectionResult): string | null {
  const top = result.mishearings.find((m) => plausibleMishearing(m.heard, m.corrected) !== 'none');
  if (!top) return null;
  return `Did we mishear you? We heard “${top.heard}” but you wrote “${top.corrected}”. Add “${top.corrected}” to your dictionary so we get it right next time?`;
}
