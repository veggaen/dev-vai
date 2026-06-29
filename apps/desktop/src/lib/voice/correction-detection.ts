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

/** A short, friendly prompt for the most likely mishearing (or null if none). */
export function mishearingPrompt(result: CorrectionResult): string | null {
  const top = result.mishearings[0];
  if (!top) return null;
  return `Did we mishear you? We heard “${top.heard}” but you wrote “${top.corrected}”. Add “${top.corrected}” to your dictionary so we get it right next time?`;
}
