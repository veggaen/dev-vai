import type { Message } from '../models/adapter.js';

/**
 * Vai-owned self-assessment for broad questions about Vai's engineering
 * bottlenecks and independence from models.
 *
 * This lane is intentionally evidence-bounded. It does not ask a model to
 * invent a diagnosis about Vai. Instead it reports which operational evidence
 * is actually attached to the turn, identifies the missing deterministic
 * introspection packet as the current bottleneck, and supplies a measurable
 * acceptance test for closing that gap.
 */

export interface VaiSelfAssessmentResult {
  readonly kind: 'operational-introspection-gap' | 'verified-adoption-gap';
  readonly reply: string;
  readonly confidence: number;
}

export interface VaiOperationalEvidenceSnapshot {
  readonly capturedAt: string;
  readonly runtime: {
    readonly sourceId: string;
    readonly healthy: boolean;
    readonly engine: string;
  };
  readonly repository: {
    readonly sourceId: string;
    readonly available: boolean;
    readonly branch: string | null;
    readonly changedFiles: number | null;
    readonly modifiedFiles: number | null;
    readonly untrackedFiles: number | null;
    readonly error?: string;
  };
  readonly verification: {
    readonly sourceId: string;
    readonly available: boolean;
    readonly status: 'pass' | 'fail' | 'unknown';
    readonly capturedAt: string | null;
    readonly totalTestsPassed: number | null;
    readonly typechecks: readonly string[];
    readonly stale: boolean;
    readonly error?: string;
  };
  readonly selfImprovement: {
    readonly sourceId: string;
    readonly available: boolean;
    readonly queuedFixes: number | null;
    readonly qualified: number | null;
    readonly adopted: number | null;
    readonly pendingNominations: number | null;
    readonly integratedNominations: number | null;
    readonly latestRunStatus: string | null;
    readonly latestRunAt: string | null;
    readonly error?: string;
  };
}

export function isVaiSelfAssessmentRequest(content: string): boolean {
  const text = content.trim();
  if (!text) return false;
  const namesVai = /\bVai\b|\byour\s+own\s+improvement\b|\byourself\b/i.test(text);
  const asksForBottleneck = /\b(?:engineering\s+)?(?:bottleneck|blocker|limitation|capability\s+gap|weakness)\b/i.test(text)
    || /\bwhat\s+(?:most|mainly)\s+prevents?\b/i.test(text);
  const asksForGrounding = /\b(?:evidence|inspect|remember|inference|acceptance\s+test|prove|verification)\b/i.test(text);
  const asksForImprovement = /\b(?:improv\w*|more\s+capable|less\s+dependent|rely\s+less|third[- ]party|outside\s+models?)\b/i.test(text);
  return namesVai && asksForBottleneck && asksForGrounding && asksForImprovement;
}

function attachedOperationalEvidence(history: readonly Message[]): string[] {
  const found = new Set<string>();
  for (const message of history) {
    const text = message.content ?? '';
    if (message.role === 'tool' || /\b(?:git:|commit|working tree|git status)\b/i.test(text)) found.add('repository');
    if (/\b(?:run:|test(?:s| suite)? (?:passed|failed)|typecheck|vitest)\b/i.test(text)) found.add('verification');
    if (/\b(?:runtime:|health check|localhost:3006|agent\/introspect)\b/i.test(text)) found.add('runtime');
    if (/\b(?:self-improve|improvement queue|queued fixes|qualified proposals)\b/i.test(text)) found.add('improvement queue');
  }
  return [...found];
}

function countLabel(value: number | null, noun: string): string {
  const count = value ?? 0;
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function tryEmitVaiSelfAssessment(input: {
  readonly content: string;
  readonly history: readonly Message[];
  readonly operationalEvidence?: VaiOperationalEvidenceSnapshot;
}): VaiSelfAssessmentResult | null {
  if (!isVaiSelfAssessmentRequest(input.content)) return null;

  const operational = input.operationalEvidence;
  const evidenceKinds = attachedOperationalEvidence(input.history);
  const evidenceLines = operational
    ? [
        `- [${operational.runtime.sourceId}] Runtime ${operational.runtime.healthy ? 'healthy' : 'unhealthy'}; engine ${operational.runtime.engine}; snapshot ${operational.capturedAt}.`,
        operational.repository.available
          ? `- [${operational.repository.sourceId}] Branch ${operational.repository.branch ?? 'unknown'}; ${operational.repository.changedFiles ?? 0} changed files (${operational.repository.modifiedFiles ?? 0} modified, ${operational.repository.untrackedFiles ?? 0} untracked).`
          : `- [${operational.repository.sourceId}] Repository evidence unavailable${operational.repository.error ? `: ${operational.repository.error}` : '.'}`,
        operational.verification.available
          ? `- [${operational.verification.sourceId}] Verification ${operational.verification.status.toUpperCase()}; ${operational.verification.totalTestsPassed ?? 0} tests passed; typechecks ${operational.verification.typechecks.join(', ') || 'not recorded'}; captured ${operational.verification.capturedAt ?? 'unknown'}${operational.verification.stale ? ' (stale)' : ''}.`
          : `- [${operational.verification.sourceId}] Verification evidence unavailable${operational.verification.error ? `: ${operational.verification.error}` : '.'}`,
        operational.selfImprovement.available
          ? `- [${operational.selfImprovement.sourceId}] ${operational.selfImprovement.queuedFixes ?? 0} queued fixes; ${operational.selfImprovement.qualified ?? 0} qualified proposals; ${operational.selfImprovement.adopted ?? 0} adopted; ${countLabel(operational.selfImprovement.pendingNominations, 'pending nomination')}; ${countLabel(operational.selfImprovement.integratedNominations, 'integrated nomination')}; latest run ${operational.selfImprovement.latestRunStatus ?? 'unknown'} at ${operational.selfImprovement.latestRunAt ?? 'unknown'}.`
          : `- [${operational.selfImprovement.sourceId}] Improvement-queue evidence unavailable${operational.selfImprovement.error ? `: ${operational.selfImprovement.error}` : '.'}`,
        '- This answer is produced by `vai:v0`; Council and response models are bypassed.',
      ]
    : [
        evidenceKinds.length > 0
          ? `- This turn includes these transcript evidence classes: ${evidenceKinds.join(', ')}.`
          : '- This turn includes no attached repository, test, runtime-health, or improvement-queue evidence packet.',
        '- The evidence available here is the persisted transcript plus Vai-owned typed routing state.',
        '- This answer is produced by `vai:v0`; Council and response models are bypassed.',
      ];

  const adoptionBottleneck = Boolean(
    operational?.selfImprovement.available
    && (operational.selfImprovement.qualified ?? 0) > 0
    && (operational.selfImprovement.adopted ?? 0) === 0,
  );
  const bottleneck = adoptionBottleneck
    ? 'Vai\'s single most important bottleneck is verified improvement adoption: it is producing qualified proposals, but the operational record shows none adopted. More proposal generation will not make Vai more capable until one bounded change moves through implementation, tests, review, evidence, and an adopted outcome.'
    : 'Vai does not yet receive a deterministic operational-introspection packet on every self-assessment turn. It can reconstruct the persisted conversation and enforce routing policy, but it cannot honestly rank the current project bottleneck when repository state, tests, runtime health, and the improvement queue are not attached as evidence.';
  const inference = adoptionBottleneck
    ? 'The next engineering budget should go to integrating one high-confidence queued fix, not generating another model proposal. Models may advise, but Vai must own selection, deterministic gates, verification, and the final adoption record.'
    : 'The highest-leverage next capability is a read-only project-introspection packet. Without it, broad self-diagnosis must either guess or delegate to a model; with it, Vai can rank work from current facts and keep models optional critics.';
  const acceptanceTest = adoptionBottleneck
    ? 'Select one bounded qualified fix with explicit acceptance checks. Pass only when the code change clears its focused tests and broader regression gate, the evidence receipt is timestamped, the self-improvement record changes from qualified/queued to adopted, rollback information is recorded, and the next fresh self-assessment observes `adopted >= 1` from the queue database. Proposal generation alone is a failure.'
    : 'From a fresh conversation, ask this same question. Pass only when Vai attaches timestamped evidence for `/api/agent/introspect`, repository status, targeted verification, and self-improvement queue status; cites which evidence supports each conclusion; makes zero Council/response-model calls; and returns within 2 seconds. If any source is unavailable, the answer must name that absence instead of inventing a result.';

  const reply = [
    '**Single most important bottleneck**',
    bottleneck,
    '',
    '**Evidence**',
    ...evidenceLines,
    '',
    '**Inference**',
    inference,
    '',
    '**Acceptance test**',
    acceptanceTest,
  ].join('\n');

  return {
    kind: adoptionBottleneck ? 'verified-adoption-gap' : 'operational-introspection-gap',
    reply,
    confidence: 0.99,
  };
}
