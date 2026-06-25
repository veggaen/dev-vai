/**
 * parse-proposal — robustly extract the {file,find,replace,why} JSON a local model emits.
 *
 * THE BUG this fixes: code fixes carry REGEX escapes (\b \s \w \d \. inside /.../). In the model's
 * raw JSON those are LONE backslashes that `JSON.parse` rejects ("Bad escaped character") — so a
 * perfectly good regex fix is silently discarded as "no parseable JSON" and the loop learns nothing.
 * Measured live: the comparison-class fix was a sound regex narrowing, thrown away on a \b/\s escape.
 *
 * Strategy: try strict JSON.parse first (cheap, correct when the model escaped properly). Only if
 * that fails, REPAIR — double every backslash that isn't JSON-structural (\" or \\), so \b \s \w
 * stay LITERAL in the parsed string and the `find` still matches the source verbatim. Pure + no I/O.
 */

/** Double regex-style backslash escapes so a code line survives JSON.parse with its escapes literal.
 *  Keeps \" (quote) and \\ (already escaped) as-is; turns \b \s \w \. \n … into \\b \\s … */
export function repairJsonRegexEscapes(s) {
  return String(s).replace(/\\(.)/g, (m, c) => (c === '"' || c === '\\') ? m : '\\\\' + c);
}

/**
 * Parse the first {...} object out of a raw model response. Returns the object or null.
 * Never throws. Tries strict parse, then the regex-escape repair.
 */
export function parseProposal(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  const block = m[0];
  try { return JSON.parse(block); } catch { /* fall through to repair */ }
  try { return JSON.parse(repairJsonRegexEscapes(block)); } catch { return null; }
}
