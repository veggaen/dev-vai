import { SearchPipeline } from '../packages/core/src/search/pipeline.ts';
import { answerMatchesVenuePracticalDetail, detectVenuePracticalDetail } from '../packages/core/src/venue-practical-detail.ts';

const defaultCases = [
  'what are the opening hours for the Lawsons branch closest to Trafalgar Square?',
  'how can I phone the nearest Lawsons branch to Trafalgar Square?',
  'can you find the menu for the Jafs restaurant closest to Helsfyr?',
  'what time does the Jafs restaurant closest to Helsfyr open?',
] as const;
const cases: readonly string[] = process.argv.length > 2 ? process.argv.slice(2) : defaultCases;

const pipeline = new SearchPipeline({ fetchTimeoutMs: 10_000, readTopN: 4 });
const results: Array<Record<string, unknown>> = [];

for (const query of cases) {
  const kind = detectVenuePracticalDetail(query);
  const response = await pipeline.search(query);
  const passesShape = kind ? answerMatchesVenuePracticalDetail(kind, response.answer) : false;
  const nearestBranch = /Closest verified branch/i.test(response.answer);
  const expectedBranch = /\bLawsons\b/i.test(query)
    ? 'Lawsons Camden'
    : /\bJafs\b/i.test(query)
      ? 'Jafs Teisen'
      : null;
  const correctBranch = expectedBranch ? response.answer.includes(expectedBranch) : nearestBranch;
  const learned = response.audit.some((entry) => /Learned \d+ verified web source capabilit/i.test(entry.detail));
  const reusedLearning = response.audit.some((entry) => /previously verified site-capability hint/i.test(entry.detail));
  results.push({
    query,
    kind,
    passesShape,
    nearestBranch,
    expectedBranch,
    correctBranch,
    learned,
    reusedLearning,
    confidence: response.confidence,
    answer: response.answer,
    sources: response.sources.map((source) => ({ title: source.title, domain: source.domain, trust: source.trust.tier, reason: source.trust.reason })),
    audit: response.audit.map((entry) => entry.detail),
  });
}

console.log(JSON.stringify({
  passed: results.filter((result) => result.passesShape && result.nearestBranch && result.correctBranch).length,
  total: results.length,
  learnedProfileCount: pipeline.serializeSourceCapabilities().stats.length,
  results,
}, null, 2));
