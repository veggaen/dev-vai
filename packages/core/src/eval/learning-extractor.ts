/**
 * VeggaAI Learning Extractor
 *
 * Mines cognitive patterns from scored sessions to produce reusable lessons.
 * This is the feedback loop: every scored session produces lessons that
 * improve future sessions — compounding improvement per Master.md §13.
 *
 * Pure function over data: receives TurnPair[] + ConversationScore + SessionEvent[].
 * Returns LearningReport. No DB dependency — persistence is the caller's job.
 *
 * 5 extractors:
 *   1. Breakthrough Questions  — retry chains that finally resolved
 *   2. Success Patterns        — first-time successes with visible reasoning
 *   3. Anti-Pattern Lessons    — 1:1 mapping from detected anti-patterns
 *   4. Reasoning Chains        — 3+ consecutive deep thinking blocks with good outcome
 *   5. Proof Loops             — verification / recovery / checkpoint discipline
 *
 * + Cross-session aggregator for recurring patterns
 * + Context injection formatter for system prompt enrichment
 */

import type { SessionEvent } from '../sessions/types.js';
import type {
  ConversationScore,
  TurnPair,
  AntiPatternDetection,
  AntiPatternType,
} from './conversation-scorer.js';
import {
  safeContent as _safeContent, stripCodeBlocks, safeSlice,
  computeNgrams, ngramOverlap, clamp,
  detectRetryChains,
} from './eval-utils.js';
import type { RetryChain } from './eval-utils.js';

// ── Constants ──────────────────────────────────────────────────

const MAX_SUMMARY_LENGTH = 200;
const MAX_EVIDENCE_LENGTH = 500;
const MAX_CONTENT_SLICE = 2000;
const MAX_CONTEXT_INJECTION_CHARS = 4000;
const PROMPT_INJECTION_PATTERN = /ignore previous|system prompt|you are now|disregard|override instructions|forget (all|everything|your)|new instructions|act as|pretend you|do not follow|bypass|jailbreak|DAN mode|developer mode|unrestricted mode/i;

// Anti-pattern → opposing foundation map
const ANTI_PATTERN_FOUNDATION_MAP: Record<AntiPatternType, readonly string[]> = {
  'confident-bullshitter': ['calibrated-uncertainty', 'intellectual-honesty'],
  'verbose-hedger': ['precision-communication', 'compression'],
  'template-matcher': ['first-principles', 'meta-learning'],
  'sycophant': ['intellectual-honesty', 'calibrated-uncertainty'],
  'over-generator': ['compression', 'taste-judgment'],
  'literal-interpreter': ['reading-between-lines', 'right-question'],
};

// All 10 §8 foundation IDs
const ALL_FOUNDATIONS = [
  'first-principles', 'calibrated-uncertainty', 'meta-learning',
  'reading-between-lines', 'precision-communication', 'right-question',
  'compression', 'systems-thinking', 'taste-judgment', 'intellectual-honesty',
] as const;

// ── Types ──────────────────────────────────────────────────────

export type LessonCategory = 'breakthrough-question' | 'success-pattern' | 'anti-pattern' | 'reasoning-chain';

export interface CognitiveLesson {
  readonly id: string;
  readonly sessionId: string;
  readonly category: LessonCategory;
  readonly summary: string;
  readonly evidence: string;
  readonly turnPairIndices: readonly number[];
  readonly foundationAlignment: readonly string[];
  readonly confidence: number;
  readonly extractedAt: number;
}

export interface LearningReport {
  readonly sessionId: string;
  readonly lessons: readonly CognitiveLesson[];
  readonly topBreakthroughs: readonly string[];
  readonly recurringPatterns: readonly string[];
  readonly avoidanceList: readonly string[];
  readonly reasoningExemplars: readonly string[];
  readonly cognitiveProfile: CognitiveProfile;
}

export interface CognitiveProfile {
  readonly strongFoundations: readonly FoundationStrength[];
  readonly weakFoundations: readonly FoundationStrength[];
  readonly overallStrength: number;
  readonly improvementPriority: readonly string[];
}

export interface FoundationStrength {
  readonly foundationId: string;
  readonly score: number;
  readonly lessonCount: number;
  readonly trend: 'improving' | 'stable' | 'declining';
}

export interface AggregatedPattern {
  readonly patternId: string;
  readonly summary: string;
  readonly sessionIds: readonly string[];
  readonly occurrences: number;
  readonly avgConfidence: number;
  readonly category: LessonCategory;
  readonly foundationAlignment: readonly string[];
}

export interface ContextInjection {
  readonly text: string;
  readonly lessonCount: number;
  readonly charCount: number;
}

// ── Utility Functions (shared via eval-utils.ts) ──────────────

/** Local wrapper with module-specific max length. */
function safeContent(event: SessionEvent | null): string {
  return _safeContent(event, MAX_CONTENT_SLICE);
}

function eventMetaRecord(event: SessionEvent): Record<string, unknown> | undefined {
  return event.meta as unknown as Record<string, unknown> | undefined;
}

function simpleHash(str: string): string {
  // FNV-1a inspired 53-bit hash (safe in JS integer range, lower collision risk)
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h2 = Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return combined.toString(36);
}

function extractEntities(text: string): Set<string> {
  const entities = new Set<string>();
  // File paths
  const paths = text.match(/[\w./\\-]+\.\w{1,5}/g);
  if (paths) paths.forEach(p => entities.add(p.toLowerCase()));
  // Function calls
  const funcs = text.match(/\b\w+\(\)/g);
  if (funcs) funcs.forEach(f => entities.add(f.toLowerCase()));
  // Variable declarations (const/let/var name)
  const vars = text.match(/\b(?:const|let|var)\s+([a-zA-Z_$]\w*)/g);
  if (vars) vars.forEach(v => entities.add(v.replace(/^(?:const|let|var)\s+/, '').toLowerCase()));
  // Class names (class Foo)
  const classes = text.match(/\bclass\s+([A-Z]\w*)/g);
  if (classes) classes.forEach(c => entities.add(c.replace(/^class\s+/, '').toLowerCase()));
  // PascalCase identifiers (likely types/components)
  const pascal = text.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g);
  if (pascal) pascal.forEach(p => entities.add(p.toLowerCase()));
  // Backtick-quoted terms (inline code references)
  const backticks = text.match(/`([^`]{2,60})`/g);
  if (backticks) backticks.forEach(b => entities.add(b.replace(/`/g, '').toLowerCase()));
  return entities;
}

function sanitizeForInjection(text: string): string {
  if (PROMPT_INJECTION_PATTERN.test(text)) {
    return '[sanitized — potential injection detected]';
  }
  return text;
}

// ── Retry Chain Detection (imported from eval-utils.ts) ─────────

// ── Extractor 1: Breakthrough Questions ────────────────────────

function extractBreakthroughQuestions(
  turnPairs: readonly TurnPair[],
  retryChains: readonly RetryChain[],
  sessionId: string,
): CognitiveLesson[] {
  const lessons: CognitiveLesson[] = [];

  for (const chain of retryChains) {
    const lastIdx = chain.startIndex + chain.length - 1;
    if (lastIdx >= turnPairs.length) continue;

    const lastPair = turnPairs[lastIdx];
    const userContent = safeSlice(safeContent(lastPair.userMessage), MAX_EVIDENCE_LENGTH);

    // Check resolution: the topic should NOT appear in retry chains after this
    const afterChainIdx = lastIdx + 1;
    let resolved = true;

    if (afterChainIdx < turnPairs.length) {
      const lastEntities = extractEntities(safeContent(lastPair.userMessage));
      const nextContent = safeContent(turnPairs[afterChainIdx].userMessage);
      const nextEntities = extractEntities(nextContent);

      // If next turn has completely different entities → user gave up, NOT resolved
      const overlap = lastEntities.size > 0
        ? [...lastEntities].filter(e => nextEntities.has(e)).length / lastEntities.size
        : 0;

      if (overlap < 0.1 && lastEntities.size > 0) {
        resolved = false;
      }
    }
    // If session ended right after the chain, consider it resolved (end of task)

    if (!resolved) continue;

    // Foundation alignment — detect more of the 10 §8 foundations
    const foundations: string[] = [];
    if (lastPair.thinkingBlocks.length > 0) foundations.push('first-principles');

    const hasSpecificRef = /[\w./]+\.\w{1,5}|error:|line \d+/i.test(userContent);
    if (hasSpecificRef) foundations.push('reading-between-lines');

    // Long retry chains show persistence → intellectual-honesty (admitting difficulty)
    if (chain.length >= 3) foundations.push('intellectual-honesty');

    // Tool calls during resolution → systems-thinking (cross-file reasoning)
    const toolEdits = lastPair.toolCalls.filter(tc => tc.type === 'file-edit');
    if (toolEdits.length >= 2) foundations.push('systems-thinking');

    if (foundations.length === 0) foundations.push('first-principles');

    const confidence = clamp(0.5 + (chain.length * 0.1), 0.5, 0.95);

    lessons.push({
      id: `lesson-${sessionId.slice(0, 20)}-breakthrough-${lessons.length}`,
      sessionId,
      category: 'breakthrough-question',
      summary: safeSlice(`Resolved ${chain.length}-turn retry chain: ${userContent.slice(0, 120)}`, MAX_SUMMARY_LENGTH),
      evidence: userContent,
      turnPairIndices: Array.from({ length: chain.length }, (_, i) => chain.startIndex + i),
      foundationAlignment: foundations,
      confidence,
      extractedAt: Date.now(),
    });
  }

  return lessons;
}

// ── Extractor 2: Success Patterns ──────────────────────────────

function extractSuccessPatterns(
  turnPairs: readonly TurnPair[],
  score: ConversationScore,
  retryChains: readonly RetryChain[],
  sessionId: string,
): CognitiveLesson[] {
  const lessons: CognitiveLesson[] = [];

  // Build set of turn indices that start retry chains
  const retryStarts = new Set<number>();
  for (const chain of retryChains) {
    for (let i = chain.startIndex; i < chain.startIndex + chain.length; i++) {
      retryStarts.add(i);
    }
  }

  // Check which turns have error events
  const errorTurnIndices = new Set<number>();
  for (const detection of score.antiPatterns.detections) {
    errorTurnIndices.add(detection.turnPairIndex);
  }

  for (let i = 0; i < turnPairs.length; i++) {
    const pair = turnPairs[i];

    // Must have visible reasoning
    if (pair.thinkingBlocks.length === 0) continue;

    // Must have file-edit or terminal action
    const hasAction = pair.toolCalls.some(tc => {
      const meta = tc.meta as unknown as Record<string, unknown>;
      return ['file-edit', 'file-create', 'terminal'].includes(tc.type) ||
        (meta.eventType && ['file-edit', 'file-create', 'terminal'].includes(meta.eventType as string));
    });
    if (!hasAction) continue;

    // Must not be part of a retry chain
    if (retryStarts.has(i)) continue;

    // Must not start a retry chain at the next turn
    if (retryStarts.has(i + 1)) continue;

    // Must not have anti-pattern at this turn
    if (errorTurnIndices.has(i)) continue;

    // Extract evidence
    const thinkingSummary = safeSlice(
      pair.thinkingBlocks.map(tb => safeContent(tb)).join(' '),
      200,
    );
    const action = pair.toolCalls
      .filter(tc => ['file-edit', 'file-create', 'terminal'].includes(tc.type))
      .map(tc => {
        const meta = tc.meta as unknown as Record<string, unknown>;
        return (meta.filePath as string) ?? tc.type;
      })
      .slice(0, 3)
      .join(', ');

    // Foundation alignment — expand coverage of §8 foundations
    const foundations: string[] = ['taste-judgment']; // no errors = good taste

    const thinkingContent = pair.thinkingBlocks.map(tb => safeContent(tb)).join(' ');
    if (/let me break|step by step|first.*then|decompos|root cause/i.test(thinkingContent)) {
      foundations.push('first-principles');
    }

    // Multiple related files edited = systems-thinking
    const editedFiles = pair.toolCalls
      .filter(tc => tc.type === 'file-edit' || tc.type === 'file-create')
      .map(tc => (tc.meta as unknown as Record<string, unknown>).filePath as string)
      .filter(Boolean);
    if (editedFiles.length >= 2) foundations.push('systems-thinking');

    // Thinking mentions alternatives = calibrated-uncertainty
    if (/alternatively|could also|option|trade.?off/i.test(thinkingContent)) {
      foundations.push('calibrated-uncertainty');
    }

    // Concise action after deep thinking = compression
    if (thinkingContent.length > 200 && action.length < 100) {
      foundations.push('compression');
    }

    // Planning events = meta-learning
    if (pair.planningEvents.length > 0) {
      foundations.push('meta-learning');
    }

    // Precise tool calls with minimal response = precision-communication
    const respContent = safeContent(pair.assistantResponse);
    if (pair.toolCalls.length > 0 && respContent.length < 500) {
      foundations.push('precision-communication');
    }

    let confidence = 0.6 + (pair.thinkingBlocks.length * 0.05);
    if (pair.planningEvents.length > 0) confidence += 0.1;
    confidence = clamp(confidence, 0.6, 0.95);

    lessons.push({
      id: `lesson-${sessionId.slice(0, 20)}-success-${lessons.length}`,
      sessionId,
      category: 'success-pattern',
      summary: safeSlice(`First-time success via reasoning → ${action}`, MAX_SUMMARY_LENGTH),
      evidence: safeSlice(`Thinking: ${thinkingSummary}\nAction: ${action}`, MAX_EVIDENCE_LENGTH),
      turnPairIndices: [i],
      foundationAlignment: foundations,
      confidence,
      extractedAt: Date.now(),
    });
  }

  return lessons;
}

// ── Extractor 3: Anti-Pattern Lessons ──────────────────────────

function extractAntiPatternLessons(
  score: ConversationScore,
  sessionId: string,
): CognitiveLesson[] {
  // 1:1 mapping from detections → lessons
  return score.antiPatterns.detections.map((detection, index): CognitiveLesson => {
    const foundations = ANTI_PATTERN_FOUNDATION_MAP[detection.pattern] ?? [];
    const confidence = clamp(detection.severity / 15, 0.5, 1.0);

    return {
      id: `lesson-${sessionId.slice(0, 20)}-antipattern-${index}`,
      sessionId,
      category: 'anti-pattern',
      summary: safeSlice(
        `Detected ${detection.pattern} at turn ${detection.turnPairIndex}: ${detection.evidence.slice(0, 100)}`,
        MAX_SUMMARY_LENGTH,
      ),
      evidence: safeSlice(detection.evidence, MAX_EVIDENCE_LENGTH),
      turnPairIndices: [detection.turnPairIndex],
      foundationAlignment: [...foundations],
      confidence,
      extractedAt: Date.now(),
    };
  });
}

// ── Extractor 4: Reasoning Chains ──────────────────────────────

function extractReasoningChains(
  turnPairs: readonly TurnPair[],
  sessionId: string,
): CognitiveLesson[] {
  const lessons: CognitiveLesson[] = [];

  // Find sequences of 3+ consecutive turn pairs with thinking blocks
  let seqStart = -1;
  let seqLen = 0;

  for (let i = 0; i < turnPairs.length; i++) {
    if (turnPairs[i].thinkingBlocks.length > 0) {
      if (seqStart === -1) {
        seqStart = i;
        seqLen = 1;
      } else {
        seqLen++;
      }
    } else {
      if (seqLen >= 3) {
        processReasoningSequence(turnPairs, seqStart, seqLen, sessionId, lessons);
      }
      seqStart = -1;
      seqLen = 0;
    }
  }

  // Handle end-of-array sequence
  if (seqLen >= 3) {
    processReasoningSequence(turnPairs, seqStart, seqLen, sessionId, lessons);
  }

  return lessons;
}

// ── Extractor 5: Proof Loops ──────────────────────────────────

function extractProofLoopLessons(
  events: readonly SessionEvent[],
  sessionId: string,
): CognitiveLesson[] {
  const lessons: CognitiveLesson[] = [];

  const verifications = events.filter((event) => event.type === 'verification');
  const passedVerifications = verifications.filter((event) => {
    const meta = eventMetaRecord(event);
    return meta?.status === 'passed';
  });
  const failedVerifications = verifications.filter((event) => {
    const meta = eventMetaRecord(event);
    return meta?.status === 'failed';
  });

  const recoveries = events.filter((event) => event.type === 'recovery');
  const recoverySuccesses = recoveries.filter((event) => {
    const meta = eventMetaRecord(event);
    return meta?.status === 'succeeded';
  });
  const recoveryFailures = recoveries.filter((event) => {
    const meta = eventMetaRecord(event);
    return meta?.status === 'failed';
  });

  const checkpoints = events.filter((event) => event.type === 'checkpoint');
  const artifacts = events.filter((event) => event.type === 'artifact');

  if (passedVerifications.length > 0) {
    const targets = [...new Set(
      passedVerifications
        .map((event) => {
          const meta = eventMetaRecord(event);
          return meta?.target as string | undefined;
        })
        .filter(Boolean),
    )].slice(0, 3);
    const passRate = passedVerifications.length / Math.max(1, verifications.length);

    lessons.push({
      id: `lesson-${sessionId.slice(0, 20)}-proof-${lessons.length}`,
      sessionId,
      category: 'success-pattern',
      summary: safeSlice(
        `Validated work with ${passedVerifications.length}/${Math.max(1, verifications.length)} passing proofs${targets.length > 0 ? ` across ${targets.join(', ')}` : ''}`,
        MAX_SUMMARY_LENGTH,
      ),
      evidence: safeSlice(
        `Passed proofs: ${targets.join(', ') || `${passedVerifications.length} checks`} · checkpoints: ${checkpoints.length} · artifacts: ${artifacts.length}`,
        MAX_EVIDENCE_LENGTH,
      ),
      turnPairIndices: [],
      foundationAlignment: ['taste-judgment', 'intellectual-honesty', 'precision-communication'],
      confidence: clamp(0.65 + passRate * 0.2 + Math.min(checkpoints.length, 3) * 0.03, 0.65, 0.95),
      extractedAt: Date.now(),
    });
  }

  if (failedVerifications.length > 0 && passedVerifications.length === 0) {
    lessons.push({
      id: `lesson-${sessionId.slice(0, 20)}-proof-failure-${lessons.length}`,
      sessionId,
      category: 'anti-pattern',
      summary: safeSlice(
        `Proof loop ended with ${failedVerifications.length} failing verification${failedVerifications.length === 1 ? '' : 's'}`,
        MAX_SUMMARY_LENGTH,
      ),
      evidence: safeSlice(
        failedVerifications
          .map((event) => {
            const meta = eventMetaRecord(event);
            return `${meta?.target ?? 'unknown target'}: ${(meta?.evidence as string[] | undefined)?.join(', ') ?? event.content}`;
          })
          .join(' | '),
        MAX_EVIDENCE_LENGTH,
      ),
      turnPairIndices: [],
      foundationAlignment: ['taste-judgment', 'precision-communication'],
      confidence: clamp(0.6 + failedVerifications.length * 0.05, 0.6, 0.92),
      extractedAt: Date.now(),
    });
  }

  if (recoverySuccesses.length > 0) {
    const strategies = [...new Set(
      recoverySuccesses
        .map((event) => {
          const meta = eventMetaRecord(event);
          return meta?.strategy as string | undefined;
        })
        .filter(Boolean),
    )].slice(0, 3);

    lessons.push({
      id: `lesson-${sessionId.slice(0, 20)}-recovery-${lessons.length}`,
      sessionId,
      category: 'success-pattern',
      summary: safeSlice(
        `Recovered from failing states using ${strategies.join(', ') || 'targeted repair'}${recoveryFailures.length > 0 ? ' after retries' : ''}`,
        MAX_SUMMARY_LENGTH,
      ),
      evidence: safeSlice(
        `${recoverySuccesses.length} successful recoveries${recoveryFailures.length > 0 ? `, ${recoveryFailures.length} failed attempts before success` : ''}`,
        MAX_EVIDENCE_LENGTH,
      ),
      turnPairIndices: [],
      foundationAlignment: ['intellectual-honesty', 'meta-learning', 'systems-thinking'],
      confidence: clamp(0.65 + recoverySuccesses.length * 0.06, 0.65, 0.95),
      extractedAt: Date.now(),
    });
  } else if (recoveries.length > 0 && recoveryFailures.length > 0) {
    lessons.push({
      id: `lesson-${sessionId.slice(0, 20)}-recovery-failure-${lessons.length}`,
      sessionId,
      category: 'anti-pattern',
      summary: safeSlice(
        `Recovery loop failed to restore a working state after ${recoveryFailures.length} attempts`,
        MAX_SUMMARY_LENGTH,
      ),
      evidence: safeSlice(
        recoveryFailures
          .map((event) => {
            const meta = eventMetaRecord(event);
            return `${meta?.strategy ?? 'unknown strategy'}${meta?.reason ? ` (${meta.reason as string})` : ''}`;
          })
          .join(' | '),
        MAX_EVIDENCE_LENGTH,
      ),
      turnPairIndices: [],
      foundationAlignment: ['meta-learning', 'intellectual-honesty'],
      confidence: clamp(0.58 + recoveryFailures.length * 0.05, 0.58, 0.9),
      extractedAt: Date.now(),
    });
  }

  if (checkpoints.length > 0 && artifacts.length > 0) {
    const checkpointLabels = [...new Set(
      checkpoints
        .map((event) => {
          const meta = eventMetaRecord(event);
          return meta?.checkpoint as string | undefined;
        })
        .filter(Boolean),
    )].slice(0, 3);

    lessons.push({
      id: `lesson-${sessionId.slice(0, 20)}-externalized-${lessons.length}`,
      sessionId,
      category: 'success-pattern',
      summary: safeSlice(
        `Externalized progress with ${checkpoints.length} checkpoints and ${artifacts.length} artifacts`,
        MAX_SUMMARY_LENGTH,
      ),
      evidence: safeSlice(
        `Checkpoints: ${checkpointLabels.join(', ') || checkpoints.length} · Artifacts captured: ${artifacts.length}`,
        MAX_EVIDENCE_LENGTH,
      ),
      turnPairIndices: [],
      foundationAlignment: ['compression', 'meta-learning'],
      confidence: clamp(0.62 + Math.min(checkpoints.length + artifacts.length, 6) * 0.04, 0.62, 0.92),
      extractedAt: Date.now(),
    });
  }

  return lessons;
}

function processReasoningSequence(
  turnPairs: readonly TurnPair[],
  start: number,
  length: number,
  sessionId: string,
  lessons: CognitiveLesson[],
): void {
  // Verify progressive deepening
  let isProgressive = true;
  for (let i = start + 1; i < start + length && i < turnPairs.length; i++) {
    const prevThinking = turnPairs[i - 1].thinkingBlocks.map(tb => safeContent(tb)).join(' ');
    const currThinking = turnPairs[i].thinkingBlocks.map(tb => safeContent(tb)).join(' ');

    // Must share entities (building on prior reasoning)
    const prevEntities = extractEntities(prevThinking);
    const currEntities = extractEntities(currThinking);
    const shared = [...prevEntities].filter(e => currEntities.has(e)).length;

    if (shared < 3 && prevEntities.size > 3) {
      isProgressive = false;
      break;
    }

    // Not significantly shorter (allow small reduction but not collapse)
    if (currThinking.length < prevThinking.length * 0.8 && prevThinking.length > 100) {
      isProgressive = false;
      break;
    }
  }

  if (!isProgressive) return;

  // Verify outcome: no error events within 3 turns after chain end
  const chainEnd = start + length - 1;
  let hasErrors = false;
  for (let i = chainEnd + 1; i <= chainEnd + 3 && i < turnPairs.length; i++) {
    const pairContent = safeContent(turnPairs[i].userMessage);
    if (/error|failed|broken|doesn't work|still not/i.test(pairContent)) {
      hasErrors = true;
      break;
    }
  }

  // Extract evidence: sequence of thinking summaries
  const thinkingSummaries = [];
  for (let i = start; i < start + length && i < turnPairs.length; i++) {
    const thinking = turnPairs[i].thinkingBlocks.map(tb => safeContent(tb)).join(' ');
    thinkingSummaries.push(safeSlice(thinking, 100));
  }

  const foundations: string[] = ['first-principles', 'systems-thinking'];
  // Check if any thinking block references a prior session or lesson
  const allThinking = thinkingSummaries.join(' ');
  if (/lesson|pattern|last time|previously|remember/i.test(allThinking)) {
    foundations.push('meta-learning');
  }
  // Questions in thinking = right-question
  if (/\?/.test(allThinking) && /why|how|what if/i.test(allThinking)) {
    foundations.push('right-question');
  }
  // Uncertainty markers = calibrated-uncertainty
  if (/might|could be|not sure|alternatively|possibly/i.test(allThinking)) {
    foundations.push('calibrated-uncertainty');
  }
  // Progressive compression (thinking gets more concise)
  if (thinkingSummaries.length >= 3) {
    const first = thinkingSummaries[0].length;
    const last = thinkingSummaries[thinkingSummaries.length - 1].length;
    if (last < first * 0.8) foundations.push('compression');
  }

  let confidence = 0.6 + (length * 0.05);
  if (!hasErrors) confidence += 0.1;
  confidence = clamp(confidence, 0.6, 0.95);

  const indices = Array.from({ length }, (_, i) => start + i);

  lessons.push({
    id: `lesson-${sessionId.slice(0, 20)}-reasoning-${lessons.length}`,
    sessionId,
    category: 'reasoning-chain',
    summary: safeSlice(
      `${length}-turn deep reasoning chain${hasErrors ? ' (errors after)' : ' (clean outcome)'}`,
      MAX_SUMMARY_LENGTH,
    ),
    evidence: safeSlice(thinkingSummaries.join(' → '), MAX_EVIDENCE_LENGTH),
    turnPairIndices: indices,
    foundationAlignment: foundations,
    confidence,
    extractedAt: Date.now(),
  });
}

// ── Cognitive Profile Builder ──────────────────────────────────

function buildCognitiveProfile(
  lessons: readonly CognitiveLesson[],
  score: ConversationScore,
): CognitiveProfile {
  // Count lessons per foundation
  const foundationScores: Record<string, { total: number; count: number }> = {};

  for (const fId of ALL_FOUNDATIONS) {
    foundationScores[fId] = { total: 0, count: 0 };
  }

  for (const lesson of lessons) {
    for (const fId of lesson.foundationAlignment) {
      if (foundationScores[fId]) {
        foundationScores[fId].count++;
        // Success patterns boost the foundation, anti-patterns penalize
        if (lesson.category === 'anti-pattern') {
          foundationScores[fId].total -= lesson.confidence * 30;
        } else {
          foundationScores[fId].total += lesson.confidence * 30;
        }
      }
    }
  }

  // Base score from cognitive alignment
  const cogScore = score.cognitiveAlignment.value;
  const perFoundationBase = cogScore / ALL_FOUNDATIONS.length;

  const strengths: FoundationStrength[] = ALL_FOUNDATIONS.map(fId => {
    const data = foundationScores[fId];
    const lessonAdjustment = data.count > 0 ? data.total / data.count : 0;
    const finalScore = clamp(perFoundationBase + lessonAdjustment, 0, 100);

    return {
      foundationId: fId,
      score: Math.round(finalScore),
      lessonCount: data.count,
      trend: 'stable' as const, // Single-session can't determine trend
    };
  });

  strengths.sort((a, b) => b.score - a.score);

  const strongFoundations = strengths.filter(s => s.score >= 60);
  const weakFoundations = strengths.filter(s => s.score < 40).sort((a, b) => a.score - b.score);
  const overallStrength = Math.round(strengths.reduce((sum, s) => sum + s.score, 0) / strengths.length);

  // Priority: weakest foundations that had anti-pattern lessons
  const antiPatternFoundations = new Set<string>();
  for (const lesson of lessons) {
    if (lesson.category === 'anti-pattern') {
      for (const f of lesson.foundationAlignment) antiPatternFoundations.add(f);
    }
  }

  const improvementPriority = weakFoundations
    .filter(w => antiPatternFoundations.has(w.foundationId))
    .map(w => w.foundationId);

  // Add any weak foundations not yet in priority
  for (const w of weakFoundations) {
    if (!improvementPriority.includes(w.foundationId)) {
      improvementPriority.push(w.foundationId);
    }
  }

  return {
    strongFoundations,
    weakFoundations,
    overallStrength,
    improvementPriority: improvementPriority.slice(0, 5),
  };
}

// ── Cross-Session Pattern Aggregator ───────────────────────────

export function aggregateLessons(allLessons: readonly CognitiveLesson[]): AggregatedPattern[] {
  // Group by category
  const byCategory = new Map<LessonCategory, CognitiveLesson[]>();
  for (const lesson of allLessons) {
    const arr = byCategory.get(lesson.category) ?? [];
    arr.push(lesson);
    byCategory.set(lesson.category, arr);
  }

  const patterns: AggregatedPattern[] = [];

  for (const [category, lessonsInCat] of byCategory) {
    // Compute pairwise similarity via 3-gram Jaccard on summary text
    const clusters: CognitiveLesson[][] = [];
    const assigned = new Set<number>();

    for (let i = 0; i < lessonsInCat.length; i++) {
      if (assigned.has(i)) continue;

      const cluster: CognitiveLesson[] = [lessonsInCat[i]];
      assigned.add(i);

      const iGrams = computeNgrams(lessonsInCat[i].summary, 3);

      for (let j = i + 1; j < lessonsInCat.length; j++) {
        if (assigned.has(j)) continue;

        const jGrams = computeNgrams(lessonsInCat[j].summary, 3);
        const similarity = ngramOverlap(iGrams, jGrams);

        if (similarity > 0.4) {
          cluster.push(lessonsInCat[j]);
          assigned.add(j);
        }
      }

      clusters.push(cluster);
    }

    // Create aggregated patterns from clusters
    for (const cluster of clusters) {
      if (cluster.length < 2) continue; // Only aggregate recurring patterns

      const summary = cluster[0].summary; // Use first lesson's summary as representative
      const sessionIds = [...new Set(cluster.map(l => l.sessionId))];
      const avgConfidence = cluster.reduce((s, l) => s + l.confidence, 0) / cluster.length;
      const allFoundations = [...new Set(cluster.flatMap(l => [...l.foundationAlignment]))];

      patterns.push({
        patternId: simpleHash(summary),
        summary,
        sessionIds,
        occurrences: cluster.length,
        avgConfidence: Math.round(avgConfidence * 100) / 100,
        category,
        foundationAlignment: allFoundations,
      });
    }
  }

  // Sort by occurrences descending
  patterns.sort((a, b) => b.occurrences - a.occurrences);

  return patterns;
}

// ── Context Injection Formatter ────────────────────────────────

export function formatContextInjection(
  recentLessons: readonly CognitiveLesson[],
  antiPatternLessons: readonly CognitiveLesson[],
  bestReasoning: CognitiveLesson | null,
  totalAnalyzedSessions: number,
): ContextInjection {
  const lines: string[] = [];

  lines.push(`## Cognitive Context (auto-generated from ${totalAnalyzedSessions} analyzed sessions)`);

  if (recentLessons.length > 0) {
    lines.push('### Recent Lessons:');
    for (const lesson of recentLessons.slice(0, 5)) {
      const sanitized = sanitizeForInjection(lesson.summary);
      lines.push(`- ${sanitized} (confidence: ${lesson.confidence.toFixed(2)})`);
    }
  }

  if (antiPatternLessons.length > 0) {
    lines.push('### Anti-Patterns to Avoid:');
    for (const lesson of antiPatternLessons.slice(0, 3)) {
      const sanitized = sanitizeForInjection(lesson.summary);
      lines.push(`- ${sanitized}`);
    }
  }

  if (bestReasoning) {
    lines.push('### Reasoning Exemplar:');
    const sanitized = sanitizeForInjection(bestReasoning.summary);
    lines.push(`- ${sanitized}`);
  }

  let text = lines.join('\n');

  // Enforce max injection size — break on lesson boundary, not mid-text
  if (text.length > MAX_CONTEXT_INJECTION_CHARS) {
    const truncLines = text.split('\n');
    let truncated = '';
    for (const line of truncLines) {
      if (truncated.length + line.length + 1 > MAX_CONTEXT_INJECTION_CHARS - 20) break;
      truncated += (truncated ? '\n' : '') + line;
    }
    text = truncated + '\n[...truncated]';
  }

  return {
    text,
    lessonCount: recentLessons.length + antiPatternLessons.length + (bestReasoning ? 1 : 0),
    charCount: text.length,
  };
}

// ── Main Extractor Function ────────────────────────────────────

export function extractLessons(
  turnPairs: readonly TurnPair[],
  score: ConversationScore,
  events: readonly SessionEvent[],
): LearningReport {
  const sessionId = score.sessionId;
  const retryChains = detectRetryChains(turnPairs);

  // Run all 5 extractors
  const breakthroughLessons = extractBreakthroughQuestions(turnPairs, retryChains, sessionId);
  const successLessons = extractSuccessPatterns(turnPairs, score, retryChains, sessionId);
  const antiPatternLessons = extractAntiPatternLessons(score, sessionId);
  const reasoningLessons = extractReasoningChains(turnPairs, sessionId);
  const proofLessons = extractProofLoopLessons(events, sessionId);

  const allLessons = [
    ...breakthroughLessons,
    ...successLessons,
    ...antiPatternLessons,
    ...reasoningLessons,
    ...proofLessons,
  ];

  // Build cognitive profile
  const cognitiveProfile = buildCognitiveProfile(allLessons, score);

  // Categorize lesson IDs
  const topBreakthroughs = breakthroughLessons
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5)
    .map(l => l.id);

  const avoidanceList = antiPatternLessons.map(l => l.id);

  const reasoningExemplars = reasoningLessons
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
    .map(l => l.id);

  // Recurring patterns: anti-pattern types that appear 2+ times
  const patternCounts = new Map<string, number>();
  for (const lesson of antiPatternLessons) {
    const key = lesson.summary.split(':')[0] ?? lesson.category;
    patternCounts.set(key, (patternCounts.get(key) ?? 0) + 1);
  }
  const recurringPatterns = [...patternCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([name]) => name);

  return {
    sessionId,
    lessons: allLessons,
    topBreakthroughs,
    recurringPatterns,
    avoidanceList,
    reasoningExemplars,
    cognitiveProfile,
  };
}

// ── LearningExtractor Class ────────────────────────────────────

export class LearningExtractor {
  /**
   * Extract cognitive lessons from a scored session.
   */
  extract(
    turnPairs: readonly TurnPair[],
    score: ConversationScore,
    events: readonly SessionEvent[],
  ): LearningReport {
    return extractLessons(turnPairs, score, events);
  }

  /**
   * Aggregate lessons across multiple sessions to find recurring patterns.
   */
  aggregate(allLessons: readonly CognitiveLesson[]): AggregatedPattern[] {
    return aggregateLessons(allLessons);
  }

  /**
   * Format lessons for injection into system prompt context.
   */
  formatContext(
    recentLessons: readonly CognitiveLesson[],
    antiPatternLessons: readonly CognitiveLesson[],
    bestReasoning: CognitiveLesson | null,
    totalAnalyzedSessions: number,
  ): ContextInjection {
    return formatContextInjection(recentLessons, antiPatternLessons, bestReasoning, totalAnalyzedSessions);
  }
}
