import type { VenuePracticalDetailKind } from '../venue-practical-detail.js';

/**
 * Inspectable, bounded learning about what a web source has actually exposed.
 *
 * A capability observation is deliberately scoped to both a domain and the
 * requested venue identity. One restaurant succeeding on a marketplace must
 * not make every page on that marketplace authoritative. Learned capabilities
 * may add a site-scoped discovery query; they never promote source trust.
 */
export type WebSourceCapability = 'venue-locator' | `venue-${VenuePracticalDetailKind}`;

export interface WebSourceCapabilityStat {
  readonly domain: string;
  readonly capability: WebSourceCapability;
  readonly subjectKey: string;
  verified: number;
  lastVerifiedAt: number;
  readonly exampleUrls: string[];
}

export interface WebSourceCapabilitySnapshot {
  readonly version: 1;
  readonly stats: readonly WebSourceCapabilityStat[];
}

export interface WebSourceCapabilityObservation {
  readonly domain: string;
  readonly capability: WebSourceCapability;
  readonly subject: string;
  readonly url: string;
}

function fold(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDomain(value: string): string {
  const candidate = value.includes('://') ? value : `https://${value}`;
  try {
    return new URL(candidate).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function webSourceSubjectKey(subject: string): string {
  return fold(subject).split(' ').filter((token) => token.length >= 2).slice(0, 8).join(' ');
}

function statKey(domain: string, capability: WebSourceCapability, subjectKey: string): string {
  return `${domain}\n${capability}\n${subjectKey}`;
}

export class WebSourceCapabilityLedger {
  private readonly stats = new Map<string, WebSourceCapabilityStat>();

  constructor(private readonly maxStats = 256) {}

  observeVerified(observation: WebSourceCapabilityObservation, now = Date.now()): boolean {
    const domain = normalizeDomain(observation.domain);
    const subjectKey = webSourceSubjectKey(observation.subject);
    if (!domain || !subjectKey) return false;
    let parsed: URL;
    try {
      parsed = new URL(observation.url);
    } catch {
      return false;
    }
    if (normalizeDomain(parsed.hostname) !== domain || !/^https?:$/.test(parsed.protocol)) return false;

    const key = statKey(domain, observation.capability, subjectKey);
    let stat = this.stats.get(key);
    if (!stat) {
      stat = {
        domain,
        capability: observation.capability,
        subjectKey,
        verified: 0,
        lastVerifiedAt: now,
        exampleUrls: [],
      };
      this.stats.set(key, stat);
    }
    stat.verified += 1;
    stat.lastVerifiedAt = now;
    const cleanUrl = `${parsed.origin}${parsed.pathname}`;
    if (!stat.exampleUrls.includes(cleanUrl)) stat.exampleUrls.unshift(cleanUrl);
    stat.exampleUrls.splice(3);
    this.trim();
    return true;
  }

  /**
   * Site-scoped hints for a semantically equivalent later request. Hints are
   * returned only for the same normalized venue identity and verified shape.
   */
  domainsFor(capability: WebSourceCapability, subject: string): string[] {
    const subjectKey = webSourceSubjectKey(subject);
    if (!subjectKey) return [];
    return [...this.stats.values()]
      .filter((stat) => stat.capability === capability && stat.subjectKey === subjectKey && stat.verified > 0)
      .sort((a, b) => b.verified - a.verified || b.lastVerifiedAt - a.lastVerifiedAt)
      .map((stat) => stat.domain)
      .filter((domain, index, values) => values.indexOf(domain) === index)
      .slice(0, 2);
  }

  confidence(domain: string, capability: WebSourceCapability, subject: string): number {
    const normalizedDomain = normalizeDomain(domain);
    const subjectKey = webSourceSubjectKey(subject);
    const stat = this.stats.get(statKey(normalizedDomain, capability, subjectKey));
    if (!stat) return 0.5;
    // Laplace shrinkage toward a neutral cold start. Learning can influence
    // discovery gently; it is never itself evidence for an answer.
    return (stat.verified + 2) / (stat.verified + 4);
  }

  serialize(): WebSourceCapabilitySnapshot {
    return {
      version: 1,
      stats: [...this.stats.values()].map((stat) => ({
        ...stat,
        exampleUrls: [...stat.exampleUrls],
      })),
    };
  }

  restore(snapshot: WebSourceCapabilitySnapshot | null | undefined): void {
    this.stats.clear();
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.stats)) return;
    for (const candidate of snapshot.stats.slice(-this.maxStats)) {
      const domain = normalizeDomain(candidate.domain);
      const subjectKey = webSourceSubjectKey(candidate.subjectKey);
      const verified = Math.max(0, Math.floor(Number(candidate.verified)));
      if (!domain || !subjectKey || !candidate.capability || verified < 1) continue;
      const rawExampleUrls: unknown[] = Array.isArray(candidate.exampleUrls) ? candidate.exampleUrls : [];
      const exampleUrls = rawExampleUrls
        .filter((url): url is string => typeof url === 'string')
        .filter((url: string) => normalizeDomain(url) === domain)
        .slice(0, 3);
      const stat: WebSourceCapabilityStat = {
        domain,
        capability: candidate.capability,
        subjectKey,
        verified,
        lastVerifiedAt: Number.isFinite(candidate.lastVerifiedAt) ? candidate.lastVerifiedAt : 0,
        exampleUrls,
      };
      this.stats.set(statKey(domain, stat.capability, subjectKey), stat);
    }
    this.trim();
  }

  size(): number {
    return this.stats.size;
  }

  private trim(): void {
    if (this.stats.size <= this.maxStats) return;
    const oldest = [...this.stats.entries()]
      .sort(([, a], [, b]) => a.lastVerifiedAt - b.lastVerifiedAt)
      .slice(0, this.stats.size - this.maxStats);
    for (const [key] of oldest) this.stats.delete(key);
  }
}
