/**
 * speakableText — turn Markdown answers into clean prose for text-to-speech.
 *
 * Reading raw Markdown aloud is jarring: the engine says "asterisk asterisk", spells out
 * URLs, and stumbles over code. This strips formatting to what a person would actually SAY,
 * so Vai's voice-back sounds natural. Pure and dependency-free (unit-testable).
 *
 * It intentionally DROPS code blocks (you don't want a paragraph of syntax read out) and
 * replaces links with the word "link" — the on-screen text still shows everything; this is
 * only what gets spoken.
 */

export function speakableText(markdown: string): string {
  if (!markdown) return '';
  let t = markdown;

  // Fenced code blocks — don't read syntax aloud.
  t = t.replace(/```[\s\S]*?```/g, ' ');
  // Inline code — keep the words, drop the backticks.
  t = t.replace(/`([^`]+)`/g, '$1');
  // Images / links → their visible text (or "link" for bare URLs).
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  t = t.replace(/https?:\/\/\S+/g, 'link');
  // Line-leading markers: headings, quotes, list bullets/numbers.
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  t = t.replace(/^\s{0,3}>\s?/gm, '');
  t = t.replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, '');
  // Emphasis markers.
  t = t.replace(/(\*\*|__)(.*?)\1/g, '$2');
  t = t.replace(/(\*|_)(.*?)\1/g, '$2');
  t = t.replace(/~~(.*?)~~/g, '$2');
  // Tables → readable-ish: drop separator rows, turn pipes into pauses.
  t = t.replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, ' ');
  t = t.replace(/\|/g, ', ');
  // Emoji / decorative symbols.
  t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]|\u{FE0F}/gu, '');
  // Paragraph breaks → sentence stops; collapse whitespace.
  t = t.replace(/\n{2,}/g, '. ').replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
  // Tidy spacing/duplication around punctuation.
  t = t.replace(/\s+([.,!?;:])/g, '$1');
  t = t.replace(/([.!?])[.!?]+/g, '$1');
  return t.trim();
}

/**
 * A short, listenable version — the first N sentences — for a "focused" spoken reply while
 * the full answer stays on screen. Voice mode reads this; the user reads the rest if wanted.
 */
export function focusedSpeech(markdown: string, maxSentences = 3): string {
  const clean = speakableText(markdown);
  if (!clean) return '';
  const sentences = clean.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [clean];
  return sentences.slice(0, maxSentences).join(' ').trim();
}
