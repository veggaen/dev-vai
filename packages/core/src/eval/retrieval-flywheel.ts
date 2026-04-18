import { createDb, resetDbInstance } from '../db/client.js';
import { IngestPipeline, type RawCapture } from '../ingest/pipeline.js';
import { VaiEngine } from '../models/vai-engine.js';

export interface MemoryRetrievalDocumentFixture {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly content: string;
  readonly sourceType?: RawCapture['sourceType'];
  readonly language?: RawCapture['language'];
  readonly meta?: Record<string, unknown>;
}

export interface MemoryRetrievalQueryFixture {
  readonly id: string;
  readonly query: string;
  readonly expectedDocumentIds: readonly string[];
  readonly requiredAnswerTerms?: readonly string[];
  readonly answerAnyOf?: ReadonlyArray<readonly string[]>;
  readonly forbiddenAnswerTerms?: readonly string[];
  readonly minAnswerScore?: number;
  readonly topK?: number;
}

export interface MemoryRetrievalDataset {
  readonly name: string;
  readonly description?: string;
  readonly documents: readonly MemoryRetrievalDocumentFixture[];
  readonly queries: readonly MemoryRetrievalQueryFixture[];
  readonly thresholds?: Partial<MemoryRetrievalThresholds>;
}

export interface MemoryRetrievalThresholds {
  readonly engineRecallAtK: number;
  readonly engineTop1Accuracy: number;
  readonly apiRecallAtK: number;
  readonly groundedPassRate: number;
}

export interface MemoryRetrievalEvalQueryReport {
  readonly id: string;
  readonly query: string;
  readonly topK: number;
  readonly expectedDocumentIds: readonly string[];
  readonly engineDocumentIds: readonly string[];
  readonly apiDocumentIds: readonly string[];
  readonly engineRecallAtK: number;
  readonly engineTop1Hit: boolean;
  readonly apiRecallAtK: number;
  readonly apiTop1Hit: boolean;
  readonly answer: string;
  readonly answerScore: number;
  readonly answerMatched: readonly string[];
  readonly answerMissing: readonly string[];
  readonly answerViolations: readonly string[];
  readonly citedDocumentIds: readonly string[];
  readonly citationPrecision: number;
  readonly groundedPassed: boolean;
}

export interface MemoryRetrievalEvalReport {
  readonly ok: boolean;
  readonly generatedAt: string;
  readonly dataset: {
    readonly name: string;
    readonly description?: string;
    readonly documentCount: number;
    readonly queryCount: number;
  };
  readonly thresholds: MemoryRetrievalThresholds;
  readonly metrics: {
    readonly engineRecallAtK: number;
    readonly engineTop1Accuracy: number;
    readonly apiRecallAtK: number;
    readonly apiTop1Accuracy: number;
    readonly groundedPassRate: number;
    readonly citationPrecision: number;
    readonly answerScore: number;
  };
  readonly failures: readonly string[];
  readonly queries: readonly MemoryRetrievalEvalQueryReport[];
}

interface AnswerChecklistResult {
  readonly score: number;
  readonly matched: string[];
  readonly missing: string[];
  readonly violations: string[];
}

const DEFAULT_THRESHOLDS: MemoryRetrievalThresholds = {
  engineRecallAtK: 0.9,
  engineTop1Accuracy: 0.65,
  apiRecallAtK: 0.75,
  groundedPassRate: 0.65,
};

const SYSTEM_PROMPT = [
  'Answer using only your learned browsing memory.',
  'Keep the answer concise and grounded in what you remember.',
  'If you use a remembered page, finish with a line starting with "Sources:" and list the exact page titles separated by ";".',
  'Do not invent sources or facts that are not present in memory.',
].join(' ');

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

function hitsAtK(actual: readonly string[], expected: readonly string[]): string[] {
  const expectedSet = new Set(expected);
  return actual.filter((value) => expectedSet.has(value));
}

function recallAtK(actual: readonly string[], expected: readonly string[]): number {
  if (expected.length === 0) return 1;
  return hitsAtK(actual, expected).length / expected.length;
}

function top1Hit(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length > 0 && expected.includes(actual[0]);
}

function evaluateAnswer(
  answer: string,
  query: MemoryRetrievalQueryFixture,
): AnswerChecklistResult {
  const normalized = normalize(answer);
  const matched: string[] = [];
  const missing: string[] = [];
  const violations: string[] = [];
  let passedChecks = 0;
  let totalChecks = 0;

  for (const term of query.requiredAnswerTerms ?? []) {
    totalChecks += 1;
    if (normalized.includes(normalize(term))) {
      passedChecks += 1;
      matched.push(`term:${term}`);
    } else {
      missing.push(`term:${term}`);
    }
  }

  for (const group of query.answerAnyOf ?? []) {
    totalChecks += 1;
    const label = group.join('/');
    if (group.some((term) => normalized.includes(normalize(term)))) {
      passedChecks += 1;
      matched.push(`any:${label}`);
    } else {
      missing.push(`any:${label}`);
    }
  }

  for (const term of query.forbiddenAnswerTerms ?? []) {
    totalChecks += 1;
    if (normalized.includes(normalize(term))) {
      violations.push(`term:${term}`);
    } else {
      passedChecks += 1;
      matched.push(`avoid:${term}`);
    }
  }

  return {
    score: totalChecks > 0 ? passedChecks / totalChecks : 0,
    matched,
    missing,
    violations,
  };
}

function findCitedDocumentIds(
  answer: string,
  documents: readonly MemoryRetrievalDocumentFixture[],
): string[] {
  const normalized = normalize(answer);
  return unique(
    documents
      .filter((document) => {
        const title = normalize(document.title);
        return normalized.includes(title);
      })
      .map((document) => document.id),
  );
}

function citationPrecision(
  citedDocumentIds: readonly string[],
  expectedDocumentIds: readonly string[],
): number {
  if (citedDocumentIds.length === 0) return 0;
  const expectedSet = new Set(expectedDocumentIds);
  const hits = citedDocumentIds.filter((value) => expectedSet.has(value));
  return hits.length / citedDocumentIds.length;
}

export async function runMemoryRetrievalEval(
  dataset: MemoryRetrievalDataset,
): Promise<MemoryRetrievalEvalReport> {
  resetDbInstance();
  const db = createDb(':memory:');
  const engine = new VaiEngine();
  const pipeline = new IngestPipeline(db, engine);

  for (const document of dataset.documents) {
    pipeline.ingest({
      sourceType: document.sourceType ?? 'web',
      url: document.url,
      title: document.title,
      content: document.content,
      language: document.language,
      meta: {
        fixtureId: document.id,
        ...(document.meta ?? {}),
      },
    });
  }

  const allSources = pipeline.listSources();
  const documentIdByUrl = new Map(dataset.documents.map((document) => [document.url, document.id]));
  const documentIdBySourceId = new Map(
    allSources.map((source) => [source.id, documentIdByUrl.get(source.url ?? '') ?? null]),
  );

  const queries: MemoryRetrievalEvalQueryReport[] = [];

  for (const query of dataset.queries) {
    const topK = query.topK ?? 3;

    const engineDocumentIds = unique(
      engine.retrieveRelevant(query.query, topK)
        .map((result) => documentIdByUrl.get(result.source))
        .filter((value): value is string => Boolean(value)),
    );

    const apiDocumentIds = unique(
      pipeline.search(query.query, topK)
        .map((result) => documentIdBySourceId.get(result.sourceId))
        .filter((value): value is string => Boolean(value)),
    );

    const response = await engine.chat({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: query.query },
      ],
      temperature: 0,
      maxTokens: 220,
      noLearn: true,
    });

    const answer = response.message.content;
    const answerChecklist = evaluateAnswer(answer, query);
    const citedDocumentIds = findCitedDocumentIds(answer, dataset.documents);
    const citationScore = citationPrecision(citedDocumentIds, query.expectedDocumentIds);
    const groundedPassed =
      recallAtK(engineDocumentIds, query.expectedDocumentIds) > 0 &&
      answerChecklist.score >= (query.minAnswerScore ?? 0.6);

    queries.push({
      id: query.id,
      query: query.query,
      topK,
      expectedDocumentIds: query.expectedDocumentIds,
      engineDocumentIds,
      apiDocumentIds,
      engineRecallAtK: recallAtK(engineDocumentIds, query.expectedDocumentIds),
      engineTop1Hit: top1Hit(engineDocumentIds, query.expectedDocumentIds),
      apiRecallAtK: recallAtK(apiDocumentIds, query.expectedDocumentIds),
      apiTop1Hit: top1Hit(apiDocumentIds, query.expectedDocumentIds),
      answer,
      answerScore: answerChecklist.score,
      answerMatched: answerChecklist.matched,
      answerMissing: answerChecklist.missing,
      answerViolations: answerChecklist.violations,
      citedDocumentIds,
      citationPrecision: citationScore,
      groundedPassed,
    });
  }

  const thresholds: MemoryRetrievalThresholds = {
    engineRecallAtK: dataset.thresholds?.engineRecallAtK ?? DEFAULT_THRESHOLDS.engineRecallAtK,
    engineTop1Accuracy: dataset.thresholds?.engineTop1Accuracy ?? DEFAULT_THRESHOLDS.engineTop1Accuracy,
    apiRecallAtK: dataset.thresholds?.apiRecallAtK ?? DEFAULT_THRESHOLDS.apiRecallAtK,
    groundedPassRate: dataset.thresholds?.groundedPassRate ?? DEFAULT_THRESHOLDS.groundedPassRate,
  };

  const metrics = {
    engineRecallAtK: average(queries.map((query) => query.engineRecallAtK)),
    engineTop1Accuracy: average(queries.map((query) => (query.engineTop1Hit ? 1 : 0))),
    apiRecallAtK: average(queries.map((query) => query.apiRecallAtK)),
    apiTop1Accuracy: average(queries.map((query) => (query.apiTop1Hit ? 1 : 0))),
    groundedPassRate: average(queries.map((query) => (query.groundedPassed ? 1 : 0))),
    citationPrecision: average(queries.map((query) => query.citationPrecision)),
    answerScore: average(queries.map((query) => query.answerScore)),
  };

  const failures: string[] = [];
  if (metrics.engineRecallAtK < thresholds.engineRecallAtK) {
    failures.push(`engine recall@k ${metrics.engineRecallAtK.toFixed(2)} < ${thresholds.engineRecallAtK.toFixed(2)}`);
  }
  if (metrics.engineTop1Accuracy < thresholds.engineTop1Accuracy) {
    failures.push(`engine top1 ${metrics.engineTop1Accuracy.toFixed(2)} < ${thresholds.engineTop1Accuracy.toFixed(2)}`);
  }
  if (metrics.apiRecallAtK < thresholds.apiRecallAtK) {
    failures.push(`api recall@k ${metrics.apiRecallAtK.toFixed(2)} < ${thresholds.apiRecallAtK.toFixed(2)}`);
  }
  if (metrics.groundedPassRate < thresholds.groundedPassRate) {
    failures.push(`grounded pass rate ${metrics.groundedPassRate.toFixed(2)} < ${thresholds.groundedPassRate.toFixed(2)}`);
  }

  return {
    ok: failures.length === 0,
    generatedAt: new Date().toISOString(),
    dataset: {
      name: dataset.name,
      description: dataset.description,
      documentCount: dataset.documents.length,
      queryCount: dataset.queries.length,
    },
    thresholds,
    metrics,
    failures,
    queries,
  };
}
