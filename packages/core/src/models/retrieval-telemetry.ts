export interface RetrievalTelemetryEvent {
  readonly at: number;
  readonly query: string;
  readonly topScore: number;
  readonly resultCount: number;
  readonly domains: readonly string[];
  readonly lowConfidence: boolean;
}

export interface RetrievalTelemetryDiagnostics {
  totalQueries: number;
  lowConfidenceQueries: number;
  lowConfidenceRate: number;
  averageTopScore: number;
  averageResultCount: number;
  domainHotspots: Array<{ domain: string; hits: number }>;
  recentTrend: Array<{ at: number; topScore: number; lowConfidence: boolean; resultCount: number }>;
  recentLowConfidence: Array<{ query: string; topScore: number; domains: readonly string[]; at: number }>;
}

export function sourceBucket(source: string): string {
  if (source.startsWith('entry:')) return 'memory-entry';
  if (source.startsWith('image:')) return 'image';
  try {
    return new URL(source).hostname.replace(/^www\./, '');
  } catch {
    return source.split(':')[0] || 'unknown';
  }
}

export function uniqueDomains(domains: string[]): string[] {
  return Array.from(new Set(domains.filter(Boolean)));
}

export function summarizeRetrievalTelemetry(
  events: readonly RetrievalTelemetryEvent[],
  domainHits: ReadonlyMap<string, number>,
): RetrievalTelemetryDiagnostics {
  const totalQueries = events.length;
  const lowConfidenceEvents = events.filter((event) => event.lowConfidence);
  const averageTopScore = totalQueries > 0
    ? events.reduce((sum, event) => sum + event.topScore, 0) / totalQueries
    : 0;
  const averageResultCount = totalQueries > 0
    ? events.reduce((sum, event) => sum + event.resultCount, 0) / totalQueries
    : 0;

  return {
    totalQueries,
    lowConfidenceQueries: lowConfidenceEvents.length,
    lowConfidenceRate: totalQueries > 0 ? lowConfidenceEvents.length / totalQueries : 0,
    averageTopScore,
    averageResultCount,
    domainHotspots: Array.from(domainHits.entries())
      .map(([domain, hits]) => ({ domain, hits }))
      .sort((left, right) => right.hits - left.hits)
      .slice(0, 5),
    recentTrend: events.map((event) => ({
      at: event.at,
      topScore: event.topScore,
      lowConfidence: event.lowConfidence,
      resultCount: event.resultCount,
    })),
    recentLowConfidence: lowConfidenceEvents
      .slice(-5)
      .map((event) => ({
        query: event.query,
        topScore: event.topScore,
        domains: event.domains,
        at: event.at,
      })),
  };
}
