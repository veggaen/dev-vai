/**
 * Privacy controls — what to capture, what to skip, and how each domain behaves.
 */

export type CapturePolicy = 'always' | 'ask' | 'never';
export type DomainCapturePolicyMap = Record<string, CapturePolicy>;

const EXCLUDED_PATTERNS = [
  /accounts?\.google\.com/i,
  /login|signin|sign-in|password|oauth|auth/i,
  /banking|financial|credit|payment/i,
  /mail\.google\.com/i,
  /outlook\.(live|office)\.com/i,
  /github\.com.*settings/i,
  /github\.com.*billing/i,
];

export function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isSensitivePage(url: string): boolean {
  return EXCLUDED_PATTERNS.some((pattern) => pattern.test(url));
}

export function getDefaultCapturePolicy(url: string): CapturePolicy {
  return isSensitivePage(url) ? 'never' : 'always';
}

export function getCapturePolicy(
  url: string,
  rules: DomainCapturePolicyMap = {},
): CapturePolicy {
  if (isSensitivePage(url)) return 'never';

  const hostname = hostnameFromUrl(url);
  if (!hostname) return 'never';

  const exact = rules[hostname];
  if (exact) return exact;

  const withoutWww = hostname.replace(/^www\./, '');
  if (withoutWww !== hostname && rules[withoutWww]) {
    return rules[withoutWww]!;
  }

  return getDefaultCapturePolicy(url);
}

export function sanitizeContent(text: string): string {
  return text
    .replace(/password[:\s]*[\S]+/gi, '[REDACTED]')
    .replace(/api[_-]?key[:\s]*[\S]+/gi, '[REDACTED]')
    .replace(/secret[:\s]*[\S]+/gi, '[REDACTED]')
    .replace(/token[:\s]*[\S]+/gi, '[REDACTED]')
    .replace(/session[_-]?id[:\s]*[\S]+/gi, '[REDACTED]')
    .replace(/bearer\s+[\S]+/gi, '[REDACTED]')
    .replace(/\b\d{13,19}\b/g, '[CARD_NUMBER]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]');
}
