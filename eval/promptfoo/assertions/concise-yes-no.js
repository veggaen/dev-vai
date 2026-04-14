/**
 * Short answers to yes/no questions should stay brief (no essays, no code fences).
 * config: { maxChars?: number }  default 120
 */
module.exports = (output, context) => {
  const maxChars = context.config?.maxChars ?? 120;
  const s = typeof output === 'string' ? output : '';
  const t = s.trim();
  const firstLine = t.split(/\r?\n/)[0]?.trim() ?? '';
  if (firstLine.length > maxChars) {
    return { pass: false, score: 0, reason: `First line too long (${firstLine.length} chars, max ${maxChars})` };
  }
  if (!/\b(yes|no)\b/i.test(firstLine)) {
    return { pass: false, score: 0, reason: 'Expected a clear yes/no on the first line' };
  }
  if (/```/.test(firstLine)) {
    return { pass: false, score: 0, reason: 'Unexpected markdown fence in a yes/no reply' };
  }
  return { pass: true, score: 1, reason: 'Concise yes/no' };
};
