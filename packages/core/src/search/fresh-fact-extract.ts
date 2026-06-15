/**
 * fresh-fact-extract — pull the ANSWER-BEARING line out of read page content, generically.
 *
 * The scalable fix for "Vai found sources but couldn't answer": Google's AI Overview works
 * because it READS pages then extracts the fact. Vai's pipeline had domain-specific
 * extractors (OpenStreetMap business contacts, local recs) but nothing general — so a price
 * / weather / score / version question fell through to a vague "I didn't find anything".
 *
 * This is domain-agnostic: given the user's query and the read snippets, it finds the
 * sentence(s) that actually answer the question shape — a price figure for a price ask, a
 * temperature for weather, a version number for "latest version", a date for "when". It does
 * NOT fabricate: it only surfaces text that appears verbatim in a read source, with the
 * source index for citation. When nothing matches, it returns null and the caller degrades
 * honestly. The point is to teach Vai to USE what it read, not to invent.
 */

export interface ReadSource {
  /** Index in the caller's source list (for citation marks). */
  readonly index: number;
  readonly title: string;
  readonly url: string;
  /** The (ideally page-read) text content. */
  readonly text: string;
}

export interface ExtractedFact {
  /** The verbatim answer-bearing sentence/line. */
  readonly text: string;
  /** Which source it came from (citation). */
  readonly sourceIndex: number;
  /** What kind of fact matched — for the caller's framing. */
  readonly kind: 'price' | 'number' | 'temperature' | 'version' | 'date' | 'value';
}

/** What KIND of fresh fact the question is asking for. */
export function classifyFreshFactKind(query: string): ExtractedFact['kind'] | null {
  const q = (query ?? '').toLowerCase();
  if (/\b(price|cost|worth|how much|trading at|market cap|exchange rate|\$|usd|eur|gbp)\b/.test(q)) return 'price';
  if (/\b(weather|temperature|temp|forecast|how (hot|cold|warm)|degrees)\b/.test(q)) return 'temperature';
  if (/\b(latest|newest|current) version|version of|what version\b/.test(q)) return 'version';
  if (/\b(when|what (year|date)|how old|release date|founded|born|died)\b/.test(q)) return 'date';
  if (/\b(how many|how much|number of|count of|population|score)\b/.test(q)) return 'number';
  return null;
}

/** Patterns that capture an answer-bearing figure for each fact kind. */
const KIND_PATTERNS: Record<ExtractedFact['kind'], RegExp> = {
  // A currency amount: $65,706 / 65 706 USD / €1,719.7 / 1763.94 usd
  price: /(?:[$€£]\s?\d[\d,. ]*\d|\d[\d,. ]*\d\s?(?:usd|eur|gbp|dollars?|euros?))/i,
  number: /\b\d[\d,. ]*\d\b/,
  temperature: /-?\d{1,3}\s?(?:°|deg|degrees?)\s?(?:c|f|celsius|fahrenheit)?/i,
  version: /\bv?\d+\.\d+(?:\.\d+)?(?:[-.]\w+)?\b/i,
  date: /\b(?:\d{4}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/i,
  value: /\b\d[\d,. ]*\d\b/,
};

/** Split text into sentence-ish lines for scanning. */
function toLines(text: string): string[] {
  return (text ?? '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+|\n+|(?<=\d)\s{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 320);
}

/** Salient query tokens (the subject) — so a price line is about the asked entity. */
function subjectTokens(query: string): string[] {
  return (query ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}
const STOP = new Set(['the', 'price', 'cost', 'what', 'whats', 'is', 'are', 'of', 'and', 'tell', 'me', 'please', 'how', 'much', 'current', 'currently', 'today', 'now', 'live', 'value', 'worth', 'both', 'give', 'show']);

/**
 * Find the best answer-bearing fact across read sources. Returns the highest-confidence
 * verbatim line that (a) contains the figure-shape the question asks for, and (b) is about
 * the asked subject (shares a salient token, when the query has one). Null when nothing
 * matches — the caller then declines honestly rather than inventing.
 *
 * `wantKind` can be passed when the caller already classified; otherwise it is inferred.
 */
export function extractFreshFact(
  query: string,
  sources: readonly ReadSource[],
  wantKind?: ExtractedFact['kind'] | null,
): ExtractedFact | null {
  const kind = wantKind ?? classifyFreshFactKind(query);
  if (!kind) return null;
  const pattern = KIND_PATTERNS[kind];
  const subjects = subjectTokens(query);

  let best: { fact: ExtractedFact; score: number } | null = null;
  for (const src of sources) {
    // Source-level relevance: the query subject may use a symbol ("btc") while the page
    // uses the name ("Bitcoin"), so we accept a figure-line when the SOURCE (title + text)
    // is clearly about the subject, even if the exact line uses a different surface form.
    const srcHaystack = `${src.title} ${src.url} ${src.text}`.toLowerCase();
    const sourceAboutSubject =
      subjects.length === 0 || subjects.some((t) => srcHaystack.includes(t));
    if (!sourceAboutSubject) continue;
    for (const line of toLines(src.text)) {
      if (!pattern.test(line)) continue;
      const lower = line.toLowerCase();
      const lineMentionsSubject = subjects.some((t) => lower.includes(t));
      // Score: a line that itself names the subject is strongest; otherwise a figure-line
      // from a subject-relevant source is still a valid answer (the surface-form case).
      let score = 1;
      if (lineMentionsSubject) score += 2;
      // Prefer lines that look like a direct statement of the value (figure early).
      const figureIdx = line.search(pattern);
      if (figureIdx >= 0 && figureIdx < 80) score += 1;
      score += Math.max(0, 3 - src.index) * 0.3; // earlier (more trusted) sources rank up
      if (!best || score > best.score) {
        best = { fact: { text: line, sourceIndex: src.index, kind }, score };
      }
    }
  }
  return best?.fact ?? null;
}

/**
 * Extract MULTIPLE facts of the same kind — for multi-entity asks like "price of btc AND
 * eth". Given the per-entity subject tokens, find one answer-bearing line per entity.
 */
export function extractFreshFactsForEntities(
  entities: readonly string[],
  sources: readonly ReadSource[],
  kind: ExtractedFact['kind'],
): Array<{ entity: string; fact: ExtractedFact | null }> {
  return entities.map((entity) => ({
    entity,
    fact: extractFreshFact(entity, sources, kind),
  }));
}
