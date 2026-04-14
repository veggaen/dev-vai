/**
 * Local vai:v0 identity — require on-topic markers and reject known off-topic glitches.
 */
module.exports = (output) => {
  const text = typeof output === 'string' ? output : '';
  const s = text.toLowerCase();

  if (/__vai_cursor|moveto\(|cursor api|eased cursor/i.test(text)) {
    return {
      pass: false,
      score: 0,
      reason: 'Off-topic cursor/DOM API answer — expected vai:v0 / VeggaAI model description',
    };
  }

  const ok =
    /\bvai:v0\b/i.test(text) ||
    /\bv0\b/.test(text) ||
    /\bvegga\s*ai\b/i.test(s) ||
    /\bveg(ai|ga)\b/i.test(s) ||
    /pattern\s+matching/i.test(s) ||
    /n[-\s]?gram/i.test(s) ||
    /local[-\s]?first/i.test(s);

  if (!ok) {
    return {
      pass: false,
      score: 0,
      reason: 'Expected vai:v0, VeggaAI, v0, pattern matching, n-gram, or local-first wording',
    };
  }
  return { pass: true, score: 1, reason: 'Identity markers OK' };
};
