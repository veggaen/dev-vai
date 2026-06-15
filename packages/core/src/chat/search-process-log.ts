/**
 * Search/research progress payloads for ProcessTree — queries run, sources found.
 */

import type { ResearchTrace } from '../models/adapter.js';
import type { ProcessLogEntry } from './council-process-log.js';

export interface SearchSourceLike {
  readonly title?: string;
  readonly url?: string;
  readonly snippet?: string;
}

function trim(text: string, max = 4_000): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function buildSearchProcessLog(input: {
  readonly prompt: string;
  readonly sources?: readonly SearchSourceLike[];
  readonly researchTrace?: ResearchTrace;
}): ProcessLogEntry[] {
  const log: ProcessLogEntry[] = [];
  const queries = input.researchTrace?.fanOutQueries?.length
    ? input.researchTrace.fanOutQueries
    : [input.prompt.trim()].filter(Boolean);

  if (queries.length) {
    log.push({
      kind: 'action',
      label: queries.length === 1 ? 'Vai searched the web' : `Vai ran ${queries.length} web searches`,
      body: queries.map((query, index) => `${index + 1}. ${query}`).join('\n'),
    });
  }

  if (input.researchTrace?.stages?.length) {
    const stageLines = input.researchTrace.stages
      .map((stage) => `${stage.label}${stage.detail ? `: ${stage.detail}` : ''}`)
      .slice(0, 12);
    if (stageLines.length) {
      log.push({
        kind: 'thought',
        label: 'Search pipeline',
        body: stageLines.join('\n'),
      });
    }
  }

  const sources = input.sources ?? [];
  if (sources.length) {
    log.push({
      kind: 'artifact',
      label: `Sources found (${sources.length})`,
      body: trim(
        sources.slice(0, 8).map((source, index) => {
          const title = source.title?.trim() || source.url || `Source ${index + 1}`;
          const snippet = source.snippet?.trim();
          return snippet ? `${title}\n${snippet}` : title;
        }).join('\n\n'),
      ),
    });
  }

  return log;
}
