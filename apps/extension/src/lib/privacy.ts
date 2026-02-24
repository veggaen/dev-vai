/**
 * Privacy controls — what to capture, what to skip.
 */

const EXCLUDED_PATTERNS = [
  /accounts?\.google\.com/i,
  /login|signin|sign-in|password|oauth|auth/i,
  /banking|financial|credit|payment/i,
  /mail\.google\.com/i,
  /outlook\.(live|office)\.com/i,
  /github\.com.*settings/i,
  /github\.com.*billing/i,
];

export function isSensitivePage(url: string): boolean {
  return EXCLUDED_PATTERNS.some((pattern) => pattern.test(url));
}

export function sanitizeContent(text: string): string {
  return text
    .replace(/password[:\s]*[\S]+/gi, '[REDACTED]')
    .replace(/api[_-]?key[:\s]*[\S]+/gi, '[REDACTED]')
    .replace(/token[:\s]*[\S]+/gi, '[REDACTED]')
    .replace(/bearer\s+[\S]+/gi, '[REDACTED]')
    .replace(/\b\d{13,19}\b/g, '[CARD_NUMBER]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]');
}
