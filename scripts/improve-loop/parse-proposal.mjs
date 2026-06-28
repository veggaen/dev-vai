/**
 * parse-proposal — robustly extract the {file,find,replace,why} JSON a local model emits.
 *
 * THE BUG this fixes: code fixes carry REGEX escapes (\b \s \w \d \. inside /.../). Two distinct
 * failure modes, BOTH measured live on the comparison class:
 *   1. PARSE ERROR — \s \w \d \. are invalid JSON escapes → JSON.parse throws "Bad escaped
 *      character" → the proposal is discarded as "no parseable JSON".
 *   2. PARSE SUCCEEDS WRONGLY — \b \f \n \r \t ARE valid JSON escapes, so JSON.parse silently
 *      turns a regex \b (word boundary) into a literal BACKSPACE char (0x08). The parse "works"
 *      but the `find` now contains a control char and no longer matches the source → a FALSE
 *      hallucinated-find. A naive "strict-then-repair" MISSES this because strict never throws.
 *      (Observed: model find /\b(?:design|build)\b/ → \b became 0x08 → verify wrongly rejected it.)
 *
 * Strategy: REPAIR FIRST — double every backslash that isn't JSON-structural (\" or \\) so EVERY
 * regex escape (\b \s \n …) stays LITERAL in the parsed string and the find matches source verbatim.
 * Fall back to strict parse only if the repaired parse fails or looks uncorrupted. A parsed object
 * whose find/replace still holds a C0 control char is rejected (it can never match a one-line source).
 * Pure + no I/O.
 */

/** Double regex-style backslash escapes so a code line survives JSON.parse with its escapes literal.
 *  Keeps \" (quote) and \\ (already escaped) as-is; turns \b \s \w \. \n … into \\b \\s … */
export function repairJsonRegexEscapes(s) {
  return String(s).replace(/\\(.)/g, (m, c) => (c === '"' || c === '\\') ? m : '\\\\' + c);
}

/** True if find/replace contains any C0 control char (0x00-0x1f) — a single code line never does,
 *  so its presence means a regex escape (\b→0x08, \n, \t…) was mis-decoded by JSON.parse. */
function looksEscapeCorrupted(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const hasControl = (s) => { for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) < 0x20) return true; return false; };
  for (const k of ['find', 'replace']) {
    const v = obj[k];
    if (typeof v === 'string' && hasControl(v)) return true;
  }
  return false;
}

/**
 * Parse the first {...} object out of a raw model response. Returns the object or null.
 * Never throws. Prefers the regex-escape-safe parse; uses strict parse only as a clean fallback.
 */
export function parseProposal(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  const block = m[0];
  // 1) Repaired parse first — keeps regex escapes literal (fixes BOTH the throw and the silent-0x08).
  try {
    const repaired = JSON.parse(repairJsonRegexEscapes(block));
    if (!looksEscapeCorrupted(repaired)) return repaired;
  } catch { /* repaired form didn't parse — fall back to strict */ }
  // 2) Strict parse fallback (a well-formed object with no troublesome escapes).
  try {
    const strict = JSON.parse(block);
    if (!looksEscapeCorrupted(strict)) return strict;
  } catch { /* neither parsed */ }
  return null;
}
