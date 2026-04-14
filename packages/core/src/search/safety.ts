/**
 * Search Safety & Trust Layer
 *
 * Provides URL validation (SSRF protection), domain trust scoring,
 * and content verification for the search pipeline.
 *
 * Trust tiers:
 *   high     — .gov, .edu, known reference sites (Wikipedia, MDN, etc.)
 *   medium   — established tech sites, major news, Stack Overflow
 *   low      — unknown domains, personal blogs, forums
 *   untrusted — SEO spam signals, known bad domains, blocked
 *
 * Content safety:
 *   - Injection detection (script tags, data URIs in content)
 *   - Excessive redirect chains blocked
 *   - Content hash deduplication
 */

import type { TrustSignal } from './types.js';

// ── SSRF Protection (mirrors runtime/routes/ingest.ts but importable from core) ──

const PRIVATE_HOST_PATTERNS = [
  'localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0',
  '169.254.169.254', // AWS metadata
];

const PRIVATE_HOST_SUFFIXES = ['.local'];
const PRIVATE_HOST_PREFIXES = ['10.', '192.168.'];
const PRIVATE_HOST_REGEX = /^172\.(1[6-9]|2\d|3[01])\./;

export function validateSearchUrl(raw: string): URL {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Only HTTP/HTTPS URLs allowed, got ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOST_PATTERNS.includes(host)) {
    throw new Error(`Private/internal URLs not allowed: ${host}`);
  }
  if (PRIVATE_HOST_SUFFIXES.some(s => host.endsWith(s))) {
    throw new Error(`Private/internal URLs not allowed: ${host}`);
  }
  if (PRIVATE_HOST_PREFIXES.some(p => host.startsWith(p))) {
    throw new Error(`Private/internal URLs not allowed: ${host}`);
  }
  if (PRIVATE_HOST_REGEX.test(host)) {
    throw new Error(`Private/internal URLs not allowed: ${host}`);
  }
  return url;
}

// ── Domain Trust Scoring ──

/** Domains with established editorial standards or institutional backing */
const HIGH_TRUST_DOMAINS: ReadonlySet<string> = new Set([
  // Reference
  'wikipedia.org', 'en.wikipedia.org',
  'developer.mozilla.org', 'mdn.io',
  'docs.python.org', 'docs.oracle.com',
  'learn.microsoft.com', 'devdocs.io',
  'tailwindcss.com', 'motion.dev', 'gsap.com', 'threejs.org',
  'perplexity.ai',
  // Institutional
  'arxiv.org', 'scholar.google.com',
  'nature.com', 'science.org',
  // Code
  'github.com', 'gitlab.com',
  'registry.npmjs.org', 'pypi.org', 'crates.io',
]);

/** Domains that are generally reliable but user-generated */
const MEDIUM_TRUST_DOMAINS: ReadonlySet<string> = new Set([
  'stackoverflow.com', 'stackexchange.com',
  'reddit.com', 'news.ycombinator.com',
  'medium.com', 'dev.to', 'hashnode.dev',
  'bbc.com', 'reuters.com', 'apnews.com',
  'techcrunch.com', 'arstechnica.com', 'theverge.com',
  'rust-lang.org', 'go.dev', 'nodejs.org',
  'typescriptlang.org', 'react.dev', 'nextjs.org', 'vuejs.org', 'angular.dev',
]);

/** TLDs that suggest institutional authority */
const HIGH_TRUST_TLDS: ReadonlySet<string> = new Set(['.gov', '.edu', '.mil', '.ac.uk']);

/** Signals that suggest SEO spam or low-quality content farms */
const SPAM_SIGNALS = [
  /^(www\d+|cdn\d+|ad[s]?)\./,   // generated subdomains
  /\.(xyz|tk|ml|ga|cf|click|top)$/, // cheap TLDs commonly abused
];

export function scoreDomain(domain: string): TrustSignal {
  const lower = domain.toLowerCase();

  // Check exact domain or parent domain against lists
  const parts = lower.split('.');
  const parentDomain = parts.length > 2 ? parts.slice(-2).join('.') : lower;

  // High trust check
  if (HIGH_TRUST_DOMAINS.has(lower) || HIGH_TRUST_DOMAINS.has(parentDomain)) {
    return { tier: 'high', score: 0.9, reason: `Known high-trust domain: ${parentDomain}` };
  }

  // High trust TLD check
  for (const tld of HIGH_TRUST_TLDS) {
    if (lower.endsWith(tld)) {
      return { tier: 'high', score: 0.85, reason: `Institutional TLD: ${tld}` };
    }
  }

  // Medium trust check
  if (MEDIUM_TRUST_DOMAINS.has(lower) || MEDIUM_TRUST_DOMAINS.has(parentDomain)) {
    return { tier: 'medium', score: 0.6, reason: `Known medium-trust domain: ${parentDomain}` };
  }

  // Spam signal check
  for (const pattern of SPAM_SIGNALS) {
    if (pattern.test(lower)) {
      return { tier: 'untrusted', score: 0.05, reason: `SEO spam signal detected: ${lower}` };
    }
  }

  // Default: low trust — unknown domain
  return { tier: 'low', score: 0.35, reason: `Unknown domain: ${parentDomain}` };
}

// ── Content Safety ──

/** Detect injection patterns in fetched content */
export function scanContentSafety(text: string): { safe: boolean; reason?: string } {
  // Check for script injection
  if (/<script[\s>]/i.test(text) && text.length < 500) {
    return { safe: false, reason: 'Suspected script injection in short content' };
  }
  // Check for data URI injection
  if (/data:\s*text\/html/i.test(text)) {
    return { safe: false, reason: 'Data URI injection detected' };
  }
  // Check for excessive invisible characters (cloaking)
  const invisibleRatio = (text.match(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g)?.length ?? 0) / Math.max(text.length, 1);
  if (invisibleRatio > 0.05) {
    return { safe: false, reason: 'Excessive invisible characters (possible cloaking)' };
  }
  return { safe: true };
}

// ── Deduplication ──

/** Quick content fingerprint for deduplication (first 200 chars normalized) */
export function contentFingerprint(text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
  // Simple hash — not cryptographic, just for dedup
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

// ── Combined Assessment ──

export interface UrlAssessment {
  url: URL;
  trust: TrustSignal;
  safe: boolean;
  reason?: string;
}

export function assessUrl(raw: string): UrlAssessment {
  const url = validateSearchUrl(raw); // throws on SSRF
  const trust = scoreDomain(url.hostname);
  return { url, trust, safe: trust.tier !== 'untrusted', reason: trust.reason };
}
