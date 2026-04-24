export function isExplicitWebSearchRequest(input: string): boolean {
  const normalized = input.toLowerCase().trim();

  return [
    /^(?:just\s+)?google\s+(?:it\s*[:\-–—]?\s*)?.+/i,
    /^(?:just\s+)?google\s+(?:it|that)$/i,
    /^(?:can\s+you\s+)?(?:search|look\s+up|find)\s+(?:for\s+|about\s+)?.+/i,
    /^(?:go\s+)?search\s+(?:the\s+web|online|google)\s+(?:for\s+)?.+/i,
    /^google[:\s]+.+/i,
    /^use\s+web\s+search\b/i,
  ].some((pattern) => pattern.test(normalized));
}