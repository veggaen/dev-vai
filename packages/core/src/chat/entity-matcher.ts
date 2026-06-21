/**
 * Static-key entity matcher — compile once, match in one pass.
 *
 * The deterministic fact router used to find which curated key a prompt mentions by
 * looping over EVERY key in a table and, per key, escaping it and building a fresh
 * `new RegExp("\\b" + key + "\\b", "i")` to `.test()` the content. With the live
 * tables that is ~570+ regex *compilations* on the country/company/brand path of
 * essentially every turn (plus person/acronym/definition/compare loops) — pure waste,
 * because the keys are static.
 *
 * This replaces that O(keys × compile) pattern with O(1) compile + O(content) match:
 * one alternation regex per table, built once, keys sorted longest-first so the
 * longest curated entity wins (the old `key.length > best.length` preference). Exact
 * `\b…\b`, case-insensitive, multi-word-key semantics are preserved. Pure, no IO.
 */

const REGEX_META = /[.*+?^${}()|[\]\\]/g;

/** Escape a literal so it can sit inside a RegExp source. */
export function escapeRegExp(literal: string): string {
  return literal.replace(REGEX_META, '\\$&');
}

export interface EntityMatcher {
  /** The single curated key the content mentions (longest wins), or null. */
  match(content: string): string | null;
  /** Every distinct curated key the content mentions (longest-first order). */
  matchAll(content: string): string[];
}

export interface EntityMatcherOptions {
  /**
   * Boundary style. `word` = `\b…\b` (default, matches the old findEntity). `token`
   * = standalone token allowing surrounding punctuation, case-SENSITIVE (matches the
   * old acronym scan: `(?:^|[^A-Za-z0-9])KEY(?![A-Za-z0-9])`).
   */
  readonly boundary?: 'word' | 'token';
}

/**
 * Build a matcher over a fixed set of keys. Call ONCE at module scope (not per
 * turn). Empty/whitespace keys are dropped. Keys are matched longest-first so
 * "south korea" wins over "korea" and "goldman sachs" over "goldman".
 */
export function buildEntityMatcher(
  keys: readonly string[],
  options: EntityMatcherOptions = {},
): EntityMatcher {
  const boundary = options.boundary ?? 'word';
  // Dedupe + drop blanks, then sort longest-first for longest-match preference.
  const cleaned = [...new Set(keys.map((k) => k.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);

  if (cleaned.length === 0) {
    return { match: () => null, matchAll: () => [] };
  }

  const alternation = cleaned.map(escapeRegExp).join('|');
  // One compiled regex for the whole table. `g` so matchAll can sweep; we read
  // group 1 (the matched key) and lower-case it to map back to the table.
  //
  // Word mode uses lookaround boundaries instead of `\b…\b`. `\b` is defined
  // relative to [A-Za-z0-9_] only, so it BREAKS for keys ending/starting in a
  // non-word char — "c++", ".net", "c#" never matched under the old per-key
  // `\b${key}\b` (a latent bug we inherit-and-fix here). `(?<![A-Za-z0-9])…
  // (?![A-Za-z0-9])` means "not glued to an alphanumeric", which is the intent
  // ("india" ≠ "indiana") and works for symbol-bearing keys too.
  const source = boundary === 'token'
    ? `(?:^|[^A-Za-z0-9])(${alternation})(?![A-Za-z0-9])`
    : `(?<![A-Za-z0-9])(${alternation})(?![A-Za-z0-9])`;
  const flags = boundary === 'token' ? 'g' : 'gi';
  const re = new RegExp(source, flags);
  // Canonical lookup so a case-insensitive hit maps back to the stored key form.
  const canonical = new Map(cleaned.map((k) => [k.toLowerCase(), k]));

  const resolve = (raw: string): string =>
    boundary === 'token' ? (canonical.get(raw) ?? raw) : (canonical.get(raw.toLowerCase()) ?? raw);

  return {
    match(content: string): string | null {
      re.lastIndex = 0;
      const m = re.exec(content);
      if (!m) return null;
      // First hit is not necessarily the longest match in the string, but the
      // alternation is ordered longest-first, so at any given position the longest
      // key wins. To honor "longest key overall" (the old tie-break) sweep all.
      return this.matchAll(content)[0] ?? resolve(m[1]);
    },
    matchAll(content: string): string[] {
      re.lastIndex = 0;
      const hits = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        hits.add(resolve(m[1]));
        if (m.index === re.lastIndex) re.lastIndex += 1; // guard zero-width
      }
      // Longest-first so callers that want "the" entity get the most specific.
      return [...hits].sort((a, b) => b.length - a.length);
    },
  };
}
