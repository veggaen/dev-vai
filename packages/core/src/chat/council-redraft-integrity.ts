import {
  evaluateChatAnswerQuality,
  type ChatAnswerQualityReport,
} from './chat-answer-quality.js';
import {
  checkMultiIntentCoverage,
  type CoverageReport,
} from './multi-intent-coverage.js';

/**
 * Deterministic release gate for a Council-proposed answer revision.
 *
 * Council members may recommend a rewrite, but they do not own release. Vai
 * compares the candidate with the already-produced draft and refuses a rewrite
 * that drops the prompt's subject, loses a previously-covered deliverable, or
 * materially regresses the answer-quality contract. This is deliberately a
 * relative gate: a useful repair does not need to be perfect, but it must not be
 * worse than the answer it replaces.
 */

export type CouncilRedraftIntegrityReason =
  | 'preserved'
  | 'lost-prompt-focus'
  | 'dropped-deliverable'
  | 'quality-regression'
  | 'new-quality-failure';

export interface CouncilRedraftIntegrityReport {
  readonly accepted: boolean;
  readonly reason: CouncilRedraftIntegrityReason;
  readonly detail: string;
  readonly originalQuality: ChatAnswerQualityReport;
  readonly candidateQuality: ChatAnswerQualityReport;
  readonly originalCoverage: CoverageReport;
  readonly candidateCoverage: CoverageReport;
}

const RELEASE_CRITICAL_REQUIREMENTS = new Set([
  'standalone topic retention',
  'core request focus',
  'on-topic grounding coverage',
]);

const MATERIAL_SCORE_REGRESSION = 0.2;

function matchedLabels(report: ChatAnswerQualityReport): Set<string> {
  return new Set(report.matched.map((requirement) => requirement.label));
}

function missingLabels(report: ChatAnswerQualityReport): Set<string> {
  return new Set(report.missing.map((requirement) => requirement.label));
}

export function evaluateCouncilRedraftIntegrity(input: {
  readonly prompt: string;
  readonly originalDraft: string;
  readonly candidateDraft: string;
}): CouncilRedraftIntegrityReport {
  const originalQuality = evaluateChatAnswerQuality({
    prompt: input.prompt,
    response: input.originalDraft,
  });
  const candidateQuality = evaluateChatAnswerQuality({
    prompt: input.prompt,
    response: input.candidateDraft,
  });
  const originalCoverage = checkMultiIntentCoverage(input.prompt, input.originalDraft);
  const candidateCoverage = checkMultiIntentCoverage(input.prompt, input.candidateDraft);

  const originalMatched = matchedLabels(originalQuality);
  const candidateMissing = missingLabels(candidateQuality);
  const lostCriticalRequirements = [...RELEASE_CRITICAL_REQUIREMENTS]
    .filter((label) => originalMatched.has(label) && candidateMissing.has(label));
  if (lostCriticalRequirements.length > 0) {
    return {
      accepted: false,
      reason: 'lost-prompt-focus',
      detail: `The revision lost release-critical prompt coverage: ${lostCriticalRequirements.join(', ')}.`,
      originalQuality,
      candidateQuality,
      originalCoverage,
      candidateCoverage,
    };
  }

  if (
    originalCoverage.isMultiIntent
    && !originalCoverage.hasMissingPart
    && candidateCoverage.hasMissingPart
  ) {
    return {
      accepted: false,
      reason: 'dropped-deliverable',
      detail: 'The revision dropped a request part that the original draft covered.',
      originalQuality,
      candidateQuality,
      originalCoverage,
      candidateCoverage,
    };
  }

  if (candidateQuality.score < originalQuality.score - MATERIAL_SCORE_REGRESSION) {
    return {
      accepted: false,
      reason: 'quality-regression',
      detail: `The revision regressed Vai's deterministic answer-quality score from ${originalQuality.score.toFixed(2)} to ${candidateQuality.score.toFixed(2)}.`,
      originalQuality,
      candidateQuality,
      originalCoverage,
      candidateCoverage,
    };
  }

  if (originalQuality.verdict !== 'fail' && candidateQuality.verdict === 'fail') {
    return {
      accepted: false,
      reason: 'new-quality-failure',
      detail: 'The revision introduced a deterministic answer-quality failure that was not present in the original.',
      originalQuality,
      candidateQuality,
      originalCoverage,
      candidateCoverage,
    };
  }

  return {
    accepted: true,
    reason: 'preserved',
    detail: 'The revision preserved prompt focus, covered deliverables, and answer quality.',
    originalQuality,
    candidateQuality,
    originalCoverage,
    candidateCoverage,
  };
}
