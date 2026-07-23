const JSON_OUTPUT_REQUEST =
  /\b(?:as|in|return|respond(?:\s+with)?|reply(?:\s+with)?|output|format(?:ted)?\s+as)\s+(?:a\s+)?json\b|\bjson\s+(?:object|format|output|only)\b/i;

const NATURAL_TEXT_KEYS = new Set(['answer', 'message', 'response', 'text']);

/**
 * Local models occasionally wrap an ordinary prose answer in a one-field JSON
 * object. The desktop correctly renders that as code, but the user did not ask
 * for code. Unwrap only an entire, one-field envelope with a known text key;
 * explicit JSON requests and all other structured payloads stay untouched.
 */
export function unwrapNaturalLanguageResponseEnvelope(prompt: string, response: string): string {
  if (!response.trim() || JSON_OUTPUT_REQUEST.test(prompt)) return response;

  const trimmed = response.trim();
  const fenced = /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```$/i.exec(trimmed);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  if (!candidate.startsWith('{') || !candidate.endsWith('}')) return response;

  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return response;
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length !== 1) return response;
    const [key, value] = entries[0];
    if (!NATURAL_TEXT_KEYS.has(key.toLowerCase()) || typeof value !== 'string' || !value.trim()) {
      return response;
    }
    return value.trim();
  } catch {
    return response;
  }
}
