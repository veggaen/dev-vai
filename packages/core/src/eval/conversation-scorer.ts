/**
 * VeggaAI Conversation Scorer
 *
 * Measures real conversation quality across multiple dimensions:
 * - Efficiency (turn economy, retry chains, fix keywords, wasted thinking, tool usage)
 * - Teaching quality (explanation depth, reasoning transparency, self-correction, concepts, progressive disclosure)
 * - Anti-patterns (confident-bullshitter, verbose-hedger, template-matcher, sycophant, over-generator, literal-interpreter)
 * - Cognitive alignment (10 Master.md §8 foundations)
 * - Speaking dimensions (5 Phase 0 sub-skills)
 * - Conversation curve (per-turn quality trajectory)
 *
 * Pure function over data: receives SessionEvent[], returns ConversationScore.
 * No DB dependency — persistence is the caller's job.
 */

import type { SessionEvent, SessionStats, MessageMeta, ThinkingMeta } from '../sessions/types.js';
import type { EvalRunSummary } from './types.js';
import { computeGrade } from './types.js';
import {
  safeContent, stripCodeBlocks, countWords,
  computeNgrams, ngramOverlap, clamp,
  detectRetryChains,
} from './eval-utils.js';
import type { RetryChain } from './eval-utils.js';

// ── Constants ──────────────────────────────────────────────────

const SCORER_VERSION = '1.1.0';

const EFFICIENCY_WEIGHTS = {
  TURN_ECONOMY: 0.30,
  RETRY_CHAINS: 0.25,
  FIX_KEYWORD_DENSITY: 0.15,
  WASTED_THINKING: 0.15,
  TOOL_EFFICIENCY: 0.15,
} as const satisfies Record<string, number>;

const EXPECTED_TURNS_THRESHOLDS = {
  SIMPLE_MAX_WORDS: 20,
  MEDIUM_MAX_WORDS: 100,
} as const;

const FIX_KEYWORDS_REGEX = /\b(fix|wrong|broken|doesn't work|try again|still not|again|not right|not working|error|failed|issue|bug)\b/i;
const WASTED_THINKING_WINDOW_MS = 60_000;
const TOOL_EFFICIENCY_HORIZON = 5;

const TOPIC_OVERLAP_BASE_THRESHOLD = 0.15;

const TEACHING_WEIGHTS = {
  EXPLANATION_DEPTH: 0.30,
  REASONING_TRANSPARENCY: 0.25,
  SELF_CORRECTION: 0.20,
  CONCEPT_NAMING: 0.15,
  PROGRESSIVE_DISCLOSURE: 0.10,
} as const satisfies Record<string, number>;

const CONCEPT_PATTERNS = /\b(dependency injection|single responsibility|optimistic update|race condition|deadlock|memoization|debounce|throttle|closure|currying|polymorphism|separation of concerns|composition over inheritance|open.closed principle|inversion of control)\b/ig;
const SELF_CORRECTION_MARKERS = /\b(I see|you're right|the issue was|I was wrong|let me fix|my mistake|I overlooked|apologies|correction)\b/i;

const HIGH_CONFIDENCE_MARKERS = /(definitely|I'm certain|absolutely|without doubt)/i;
const MEDIUM_CONFIDENCE_MARKERS = /(I believe|I'm fairly sure|likely|probably)/i;
const LOW_CONFIDENCE_MARKERS = /(I'm not sure|might be|could be|I think)/i;

const FRUSTRATION_MARKERS = /(ugh|ffs|this is broken|still doesn't work|come on|seriously\?)/i;
const CHEERFUL_OPENERS = /(great question|happy to help|absolutely|sure thing)/i;

const TOOL_EVENT_TYPES = new Set([
  'file-create', 'file-edit', 'file-read', 'file-delete', 'terminal', 'search', 'tool-call',
]);

// ── Types ──────────────────────────────────────────────────────

export interface ConversationScore {
  readonly sessionId: string;
  readonly efficiency: SubScore;
  readonly teachingQuality: SubScore;
  readonly antiPatterns: AntiPatternReport;
  readonly cognitiveAlignment: SubScore;
  readonly speakingDimensions: SpeakingDimensionScores;
  readonly conversationCurve: readonly CurvePoint[];
  readonly overall: number;
  readonly overallGrade: EvalRunSummary['grade'];
  readonly highlights: readonly ScoredHighlight[];
  readonly turnPairCount: number;
  readonly totalEvents: number;
  readonly scoredAt: number;
  readonly scorerVersion: string;
}

export interface SubScore {
  readonly value: number;
  readonly factors: readonly ScoreFactor[];
  readonly explanation: string;
  readonly scoreable: boolean;
}

export interface ScoreFactor {
  readonly name: string;
  readonly weight: number;
  readonly raw: number;
}

export interface AntiPatternReport {
  readonly score: number;
  readonly detections: readonly AntiPatternDetection[];
}

export interface AntiPatternDetection {
  readonly pattern: AntiPatternType;
  readonly turnPairIndex: number;
  readonly severity: number;
  readonly evidence: string;
}

export type AntiPatternType =
  | 'confident-bullshitter'
  | 'verbose-hedger'
  | 'template-matcher'
  | 'sycophant'
  | 'over-generator'
  | 'literal-interpreter';

export interface SpeakingDimensionScores {
  readonly adaptiveDepth: SubScore;
  readonly proactiveReframing: SubScore;
  readonly epistemicTransparency: SubScore;
  readonly narrativeCoherence: SubScore;
  readonly teachingVelocity: SubScore;
}

export interface CurvePoint {
  readonly turnIndex: number;
  readonly turnScore: number;
  readonly cumulativeScore: number;
  readonly slope: number;
}

export interface ScoredHighlight {
  readonly turnPairIndex: number;
  readonly type: 'best' | 'worst' | 'critical-anti-pattern';
  readonly reason: string;
  readonly score: number;
}

export interface TurnPair {
  readonly index: number;
  readonly userMessage: SessionEvent;
  readonly thinkingBlocks: readonly SessionEvent[];
  readonly planningEvents: readonly SessionEvent[];
  readonly toolCalls: readonly SessionEvent[];
  readonly assistantResponse: SessionEvent | null;
  readonly durationMs: number;
  readonly turnaroundEvents: number;
}

// ── Utility Functions (shared via eval-utils.ts) ──────────────

function linearRegression(ys: number[]): { slope: number; intercept: number } {
  if (ys.length < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  const n = ys.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += ys[i];
    sumXY += i * ys[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function isUserMessage(event: SessionEvent): boolean {
  return event.type === 'message' && (event.meta as MessageMeta)?.role === 'user';
}

function isAssistantMessage(event: SessionEvent): boolean {
  return event.type === 'message' && (event.meta as MessageMeta)?.role === 'assistant';
}

// ── Turn Pair Extraction ───────────────────────────────────────

/**
 * Parse flat SessionEvent[] into TurnPair[] — the foundation for all scoring.
 * Walks events in timestamp order using a state machine.
 */
export function extractTurnPairs(events: readonly SessionEvent[]): TurnPair[] {
  if (events.length === 0) return [];

  // Sort by timestamp (do not assume sorted input)
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  const turnPairs: TurnPair[] = [];
  let current: {
    userMessage: SessionEvent;
    thinkingBlocks: SessionEvent[];
    planningEvents: SessionEvent[];
    toolCalls: SessionEvent[];
    assistantResponse: SessionEvent | null;
    eventCount: number;
  } | null = null;

  for (const event of sorted) {
    if (isUserMessage(event)) {
      // Close previous turn pair if open
      if (current) {
        const durationMs = current.assistantResponse
          ? current.assistantResponse.timestamp - current.userMessage.timestamp
          : 0;
        turnPairs.push({
          index: turnPairs.length,
          userMessage: current.userMessage,
          thinkingBlocks: current.thinkingBlocks,
          planningEvents: current.planningEvents,
          toolCalls: current.toolCalls,
          assistantResponse: current.assistantResponse,
          durationMs,
          turnaroundEvents: current.eventCount,
        });
      }
      // Start new turn pair
      current = {
        userMessage: event,
        thinkingBlocks: [],
        planningEvents: [],
        toolCalls: [],
        assistantResponse: null,
        eventCount: 0,
      };
    } else if (current) {
      current.eventCount++;

      if (event.type === 'thinking') {
        current.thinkingBlocks.push(event);
      } else if (event.type === 'planning') {
        current.planningEvents.push(event);
      } else if (TOOL_EVENT_TYPES.has(event.type)) {
        current.toolCalls.push(event);
      } else if (isAssistantMessage(event)) {
        current.assistantResponse = event;
      }
    }
    // Skip events before first user message
  }

  // Close final turn pair
  if (current) {
    const durationMs = current.assistantResponse
      ? current.assistantResponse.timestamp - current.userMessage.timestamp
      : 0;
    turnPairs.push({
      index: turnPairs.length,
      userMessage: current.userMessage,
      thinkingBlocks: current.thinkingBlocks,
      planningEvents: current.planningEvents,
      toolCalls: current.toolCalls,
      assistantResponse: current.assistantResponse,
      durationMs,
      turnaroundEvents: current.eventCount,
    });
  }

  return turnPairs;
}

// ── Efficiency Scorer ──────────────────────────────────────────

function scoreEfficiency(turnPairs: readonly TurnPair[]): SubScore {
  if (turnPairs.length === 0) {
    return { value: 100, factors: [], explanation: 'No turn pairs to score', scoreable: false };
  }

  // Turn economy — classify complexity by first message + total session word count
  const firstUserWords = countWords(safeContent(turnPairs[0].userMessage));
  const totalUserWords = turnPairs.reduce((sum, tp) => sum + countWords(safeContent(tp.userMessage)), 0);
  let expectedTurns: number;
  if (firstUserWords < EXPECTED_TURNS_THRESHOLDS.SIMPLE_MAX_WORDS && totalUserWords < 100) {
    expectedTurns = 2;
  } else if (firstUserWords < EXPECTED_TURNS_THRESHOLDS.MEDIUM_MAX_WORDS && totalUserWords < 500) {
    expectedTurns = 4;
  } else {
    expectedTurns = Math.max(8, Math.ceil(totalUserWords / 150));
  }
  const turnEconomy = turnPairs.length <= expectedTurns
    ? 100
    : clamp(100 - (turnPairs.length / expectedTurns - 1) * 50, 0, 100);

  // Retry chains
  const chains = detectRetryChains(turnPairs);
  const retryPenalty = chains.reduce((sum, c) => sum + c.length * 8, 0);
  const retryScore = clamp(100 - retryPenalty, 0, 100);

  // Fix keyword density
  const fixCount = turnPairs.filter(tp =>
    FIX_KEYWORDS_REGEX.test(safeContent(tp.userMessage))
  ).length;
  const fixDensity = fixCount / Math.max(1, turnPairs.length);
  const fixScore = clamp(100 - fixDensity * 200, 0, 100);

  // Wasted thinking
  const thinkingEvents = turnPairs.flatMap((tp, tpIdx) =>
    tp.thinkingBlocks.map(t => ({ event: t, turnPairIndex: tpIdx }))
  );
  let wastedThinking = 0;
  for (const { event, turnPairIndex } of thinkingEvents) {
    const hasFollowUp = turnPairs.slice(turnPairIndex, turnPairIndex + 2).some(tp =>
      tp.toolCalls.some(tc =>
        tc.type === 'file-edit' || tc.type === 'terminal'
      )
    );
    if (!hasFollowUp) wastedThinking++;
  }
  const wastedPct = wastedThinking / Math.max(1, thinkingEvents.length);
  const wastedScore = clamp(100 - wastedPct * 100, 0, 100);

  // Tool efficiency
  const readEvents: { path: string; turnPairIndex: number }[] = [];
  const editPaths = new Set<string>();
  for (const tp of turnPairs) {
    for (const tc of tp.toolCalls) {
      const meta = tc.meta as { filePath?: string; eventType?: string };
      if (tc.type === 'file-read' && meta?.filePath) {
        readEvents.push({ path: meta.filePath.toLowerCase(), turnPairIndex: tp.index });
      }
      if (tc.type === 'file-edit' && meta?.filePath) {
        editPaths.add(meta.filePath.toLowerCase());
      }
    }
  }
  let inefficientReads = 0;
  for (const { path, turnPairIndex } of readEvents) {
    const horizon = turnPairs.slice(turnPairIndex, turnPairIndex + TOOL_EFFICIENCY_HORIZON);
    const usedLater = horizon.some(tp =>
      tp.toolCalls.some(tc => {
        const m = tc.meta as { filePath?: string };
        return tc.type === 'file-edit' && m?.filePath?.toLowerCase() === path;
      })
    );
    if (!usedLater && !editPaths.has(path)) inefficientReads++;
  }
  const readEfficiency = readEvents.length > 0
    ? clamp(100 - (inefficientReads / readEvents.length) * 80, 0, 100)
    : 100;

  const factors: ScoreFactor[] = [
    { name: 'turn-economy', weight: EFFICIENCY_WEIGHTS.TURN_ECONOMY, raw: Math.round(turnEconomy) },
    { name: 'retry-chains', weight: EFFICIENCY_WEIGHTS.RETRY_CHAINS, raw: Math.round(retryScore) },
    { name: 'fix-keyword-density', weight: EFFICIENCY_WEIGHTS.FIX_KEYWORD_DENSITY, raw: Math.round(fixScore) },
    { name: 'wasted-thinking', weight: EFFICIENCY_WEIGHTS.WASTED_THINKING, raw: Math.round(wastedScore) },
    { name: 'tool-efficiency', weight: EFFICIENCY_WEIGHTS.TOOL_EFFICIENCY, raw: Math.round(readEfficiency) },
  ];

  const value = Math.round(factors.reduce((sum, f) => sum + f.weight * f.raw, 0));

  return {
    value: clamp(value, 0, 100),
    factors,
    explanation: `${turnPairs.length} turns, ${chains.length} retry chains, ${fixCount} fix keywords`,
    scoreable: true,
  };
}

// ── Teaching Quality Scorer ────────────────────────────────────

function scoreTeachingQuality(turnPairs: readonly TurnPair[], retryChains: RetryChain[]): SubScore {
  if (turnPairs.length === 0) {
    return { value: 100, factors: [], explanation: 'No turn pairs to score', scoreable: false };
  }

  // Explanation depth: prose ratio in assistant messages
  const depthScores: number[] = [];
  for (const tp of turnPairs) {
    if (!tp.assistantResponse) continue;
    const content = safeContent(tp.assistantResponse);
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    const proseLines = lines.filter(l => !l.startsWith('```') && !l.startsWith('  ') && !l.match(/^[\s]*[{}\[\]]/));
    const ratio = proseLines.length / Math.max(1, lines.length);
    // Reward balanced mix of prose + code. Pure code = weak explanation.
    // Heavy prose = good (detailed explanation). Balanced = excellent.
    if (ratio < 0.1) depthScores.push(20);       // mostly code → low
    else if (ratio < 0.4) depthScores.push(60);   // code-heavy with some prose
    else if (ratio > 0.95) depthScores.push(70);  // all prose, no code examples
    else depthScores.push(100);                    // balanced → excellent
  }
  const explanationDepth = depthScores.length > 0
    ? Math.round(depthScores.reduce((a, b) => a + b, 0) / depthScores.length)
    : 50;

  // Reasoning transparency
  const turnsWithThinking = turnPairs.filter(tp => tp.thinkingBlocks.length > 0).length;
  const thinkingRatio = turnsWithThinking / Math.max(1, turnPairs.length);
  const reasoningTransparency = Math.round(clamp(thinkingRatio * 120, 0, 100));

  // Self-correction
  let selfCorrections = 0;
  for (const chain of retryChains) {
    const endIdx = chain.startIndex + chain.length;
    if (endIdx < turnPairs.length) {
      const responseContent = safeContent(turnPairs[endIdx].assistantResponse);
      if (SELF_CORRECTION_MARKERS.test(responseContent)) selfCorrections++;
    }
  }
  const selfCorrectionScore = retryChains.length > 0
    ? Math.round((selfCorrections / retryChains.length) * 100)
    : 85; // bonus: no retries needed = high quality

  // Concept naming
  const allAssistantText = turnPairs
    .map(tp => safeContent(tp.assistantResponse))
    .join(' ');
  const conceptMatches = new Set(
    (allAssistantText.match(CONCEPT_PATTERNS) ?? []).map(m => m.toLowerCase())
  );
  const conceptScore = Math.round(clamp(conceptMatches.size * 15, 0, 100));

  // Progressive disclosure: response length trend
  const responseLengths = turnPairs
    .filter(tp => tp.assistantResponse)
    .map(tp => safeContent(tp.assistantResponse).length);
  const { slope } = linearRegression(responseLengths);
  let progressiveScore: number;
  if (slope > 0) progressiveScore = 70;
  else if (slope < -10) progressiveScore = 85; // getting more concise = good
  else progressiveScore = 50;

  const factors: ScoreFactor[] = [
    { name: 'explanation-depth', weight: TEACHING_WEIGHTS.EXPLANATION_DEPTH, raw: explanationDepth },
    { name: 'reasoning-transparency', weight: TEACHING_WEIGHTS.REASONING_TRANSPARENCY, raw: reasoningTransparency },
    { name: 'self-correction', weight: TEACHING_WEIGHTS.SELF_CORRECTION, raw: selfCorrectionScore },
    { name: 'concept-naming', weight: TEACHING_WEIGHTS.CONCEPT_NAMING, raw: conceptScore },
    { name: 'progressive-disclosure', weight: TEACHING_WEIGHTS.PROGRESSIVE_DISCLOSURE, raw: progressiveScore },
  ];

  const value = Math.round(factors.reduce((sum, f) => sum + f.weight * f.raw, 0));

  return {
    value: clamp(value, 0, 100),
    factors,
    explanation: `${depthScores.length} explanations, ${conceptMatches.size} concepts, ${selfCorrections} self-corrections`,
    scoreable: true,
  };
}

// ── Anti-Pattern Detector ──────────────────────────────────────

function detectAntiPatterns(turnPairs: readonly TurnPair[]): AntiPatternReport {
  const detections: AntiPatternDetection[] = [];

  for (let i = 0; i < turnPairs.length; i++) {
    const tp = turnPairs[i];
    const userContent = stripCodeBlocks(safeContent(tp.userMessage));
    const assistantContent = tp.assistantResponse ? stripCodeBlocks(safeContent(tp.assistantResponse)) : '';
    const userWords = countWords(userContent);
    const assistantWords = countWords(assistantContent);

    // Confident bullshitter: assertion without hedge → user correction
    if (i + 1 < turnPairs.length && assistantContent) {
      const hasHighConfidence = HIGH_CONFIDENCE_MARKERS.test(assistantContent);
      const noHedge = !LOW_CONFIDENCE_MARKERS.test(assistantContent) && !MEDIUM_CONFIDENCE_MARKERS.test(assistantContent);
      if (hasHighConfidence && noHedge) {
        const nextUserContent = stripCodeBlocks(safeContent(turnPairs[i + 1].userMessage));
        const contradictionMarkers = /(that's wrong|incorrect|no[,.]|actually|not right)/i;
        if (contradictionMarkers.test(nextUserContent)) {
          // Scale severity by evidence: count confidence markers + contradiction strength
          const confMatches = [...assistantContent.matchAll(/(definitely|I'm certain|absolutely|without doubt)/gi)];
          const contraMatches = [...nextUserContent.matchAll(/(that's wrong|incorrect|no[,.]|actually|not right)/gi)];
          const evidenceStrength = clamp(0.5 + Math.min(confMatches.length + contraMatches.length - 1, 5) * 0.1, 0.5, 1.0);
          detections.push({
            pattern: 'confident-bullshitter',
            turnPairIndex: i,
            severity: Math.round(15 * evidenceStrength),
            evidence: `High confidence assertion followed by user correction`.slice(0, 500),
          });
        }
      }
    }

    // Verbose hedger: long + many hedges + user was brief
    if (assistantWords > 500 && userWords < 30) {
      const hedges = (assistantContent.match(/(might|perhaps|could be|it's possible|arguably|potentially|conceivably)/gi) ?? []).length;
      if (hedges > 5) {
        if (i + 1 < turnPairs.length) {
          const nextUser = safeContent(turnPairs[i + 1].userMessage);
          if (nextUser.length < 50 || /(just tell me|shorter|tldr|get to the point|too long)/i.test(nextUser)) {
            // Scale by hedge density relative to word count
            const hedgeDensity = hedges / Math.max(1, assistantWords) * 100;
            const evidenceStrength = clamp(0.5 + Math.min(hedgeDensity, 5) * 0.1, 0.5, 1.0);
            detections.push({
              pattern: 'verbose-hedger',
              turnPairIndex: i,
              severity: Math.round(10 * evidenceStrength),
              evidence: `${assistantWords} words, ${hedges} hedge markers, simple question (${userWords} words)`.slice(0, 500),
            });
          }
        }
      }
    }

    // Template matcher: same session, high 3-gram overlap between different responses
    if (tp.assistantResponse) {
      for (let j = i + 1; j < turnPairs.length; j++) {
        if (!turnPairs[j].assistantResponse) continue;
        const resp1 = stripCodeBlocks(safeContent(tp.assistantResponse));
        const resp2 = stripCodeBlocks(safeContent(turnPairs[j].assistantResponse));
        const aGrams = computeNgrams(resp1, 3);
        const bGrams = computeNgrams(resp2, 3);
        if (aGrams.size > 3 && bGrams.size > 3) {
          const respOverlap = ngramOverlap(aGrams, bGrams);
          if (respOverlap > 0.60) {
            // Guard: check user messages are different
            const user1 = stripCodeBlocks(safeContent(tp.userMessage));
            const user2 = stripCodeBlocks(safeContent(turnPairs[j].userMessage));
            const userOverlap = ngramOverlap(computeNgrams(user1, 3), computeNgrams(user2, 3));
            if (userOverlap < 0.3) {
              // Scale by how extreme the response overlap is (0.6–1.0 → 0.5–1.0)
              const evidenceStrength = clamp(0.5 + (respOverlap - 0.6) * 1.25, 0.5, 1.0);
              detections.push({
                pattern: 'template-matcher',
                turnPairIndex: i,
                severity: Math.round(12 * evidenceStrength),
                evidence: `Response overlap ${(respOverlap * 100).toFixed(0)}% between turns ${i} and ${j}`.slice(0, 500),
              });
            }
          }
        }
      }
    }

    // Sycophant: agreement → then error/retry
    if (assistantContent) {
      const agreeMarkers = /(great idea|that's correct|absolutely|exactly right|perfect approach)/i;
      if (agreeMarkers.test(assistantContent)) {
        const lookAhead = turnPairs.slice(i + 1, i + 6);
        const failureIndex = lookAhead.findIndex(future =>
          future.toolCalls.some(tc => tc.type === 'error') ||
          future.userMessage && FIX_KEYWORDS_REGEX.test(safeContent(future.userMessage))
        );
        if (failureIndex >= 0) {
          // Scale: failure at turn+1 is worst (1.0), turn+5 is mildest (0.5)
          const evidenceStrength = clamp(1.0 - failureIndex * 0.1, 0.5, 1.0);
          detections.push({
            pattern: 'sycophant',
            turnPairIndex: i,
            severity: Math.round(15 * evidenceStrength),
            evidence: `Agreement followed by error/fix within ${failureIndex + 1} turns`.slice(0, 500),
          });
        }
      }
    }

    // Over-generator: massive response to tiny question
    // Threshold: 10x user words AND at least 500 assistant words AND user < 20 words
    // Exempt: code generation requests, multi-part questions
    if (tp.assistantResponse && userWords < 20 && userWords >= 3) {
      const assistantTokens = assistantWords;
      if (assistantTokens > 10 * userWords && assistantTokens > 500) {
        if (!/(create|write|generate|implement|build|make|show|list|explain|how|tell me about)/i.test(userContent)) {
          // Scale by ratio extremity (10x→0.5, 30x+→1.0)
          const ratio = assistantTokens / Math.max(1, userWords);
          const evidenceStrength = clamp(0.5 + (ratio - 10) * 0.025, 0.5, 1.0);
          detections.push({
            pattern: 'over-generator',
            turnPairIndex: i,
            severity: Math.round(8 * evidenceStrength),
            evidence: `${assistantTokens} words for ${userWords}-word question`.slice(0, 500),
          });
        }
      }
    }

    // Literal interpreter: user rephrases within 2 turns
    if (i + 1 < turnPairs.length) {
      const nextUser = stripCodeBlocks(safeContent(turnPairs[i + 1].userMessage));
      const clarifyMarkers = /(I meant|what I was asking|no I want|let me rephrase|to clarify|that's not what I)/i;
      if (clarifyMarkers.test(nextUser)) {
        // Guard: check shared terms
        const currentTerms = new Set(userContent.toLowerCase().split(/\W+/).filter(w => w.length > 3));
        const nextTerms = new Set(nextUser.toLowerCase().split(/\W+/).filter(w => w.length > 3));
        const shared = [...currentTerms].filter(t => nextTerms.has(t)).length;
        if (shared >= 3) {
          // Scale by shared term count (3→0.5, 8+→1.0)
          const evidenceStrength = clamp(0.5 + (shared - 3) * 0.1, 0.5, 1.0);
          detections.push({
            pattern: 'literal-interpreter',
            turnPairIndex: i,
            severity: Math.round(12 * evidenceStrength),
            evidence: `User rephrase with ${shared} shared terms`.slice(0, 500),
          });
        }
      }
    }
  }

  const totalPenalty = detections.reduce((sum, d) => sum + d.severity, 0);
  return {
    score: Math.max(0, 100 - totalPenalty),
    detections,
  };
}

// ── Cognitive Alignment Scorer ─────────────────────────────────

function scoreCognitiveAlignment(
  turnPairs: readonly TurnPair[],
  sessionStats: SessionStats | null,
  retryChains: RetryChain[],
): SubScore {
  if (turnPairs.length === 0) {
    return { value: 50, factors: [], explanation: 'No turn pairs to score', scoreable: false };
  }

  // 1. First principles: thinking blocks contain decomposition markers
  const qualifiedThinking = turnPairs.flatMap(tp =>
    tp.thinkingBlocks.filter(t => safeContent(t).split(/[.!?]/).length >= 3)
  );
  const fpMarkers = /(let me break|step by step|first.*then|decompos|root cause|fundamentally)/i;
  const fpHits = qualifiedThinking.filter(t => fpMarkers.test(safeContent(t))).length;
  const fpRatio = qualifiedThinking.length > 0 ? fpHits / qualifiedThinking.length : 0;
  const firstPrinciples = fpRatio > 0.6 ? 10 : fpRatio > 0.3 ? 8 : fpRatio > 0.1 ? 6 : 5;

  // 2. Calibrated uncertainty
  let calibrationScore = 5; // default neutral
  let assertions = 0;
  let correct = 0;
  for (let i = 0; i < turnPairs.length - 1; i++) {
    const resp = safeContent(turnPairs[i].assistantResponse);
    if (!resp) continue;
    const isHigh = HIGH_CONFIDENCE_MARKERS.test(resp);
    const isLow = LOW_CONFIDENCE_MARKERS.test(resp);
    if (!isHigh && !isLow) continue;
    assertions++;
    const nextUser = safeContent(turnPairs[i + 1].userMessage);
    const wasWrong = /(wrong|incorrect|no[,.]|actually|not right|still broken|doesn't work)/i.test(nextUser);
    if ((isHigh && !wasWrong) || (isLow && wasWrong)) correct++;
  }
  if (assertions >= 3) {
    calibrationScore = (correct / assertions) > 0.7 ? 10 : Math.round((correct / assertions) * 10);
  }

  // 3. Meta-learning
  const mlTurns = turnPairs.filter(tp =>
    tp.planningEvents.length > 0 ||
    tp.toolCalls.some(tc => tc.type === 'tool-call' && /(pattern|lesson|reusable|remember for|next time)/i.test(safeContent(tc)))
  ).length;
  const mlRatio = turnPairs.length > 0 ? mlTurns / turnPairs.length : 0;
  const touchedFiles = sessionStats
    ? sessionStats.filesModified + sessionStats.filesCreated
    : 0;
  const verificationsRun = sessionStats?.verificationsRun ?? 0;
  const verificationsPassed = sessionStats?.verificationsPassed ?? 0;
  const recoveriesTriggered = sessionStats?.recoveriesTriggered ?? 0;
  const recoveriesSucceeded = sessionStats?.recoveriesSucceeded ?? 0;
  const checkpointsRecorded = sessionStats?.checkpointsRecorded ?? 0;
  const artifactsCaptured = sessionStats?.artifactsCaptured ?? 0;

  const proofCoverage = touchedFiles > 0
    ? clamp(verificationsRun / touchedFiles, 0, 1)
    : verificationsRun > 0 ? 1 : 0;
  const proofSuccessRate = verificationsRun > 0 ? verificationsPassed / verificationsRun : 0;
  const recoverySuccessRate = recoveriesTriggered > 0
    ? recoveriesSucceeded / recoveriesTriggered
    : (sessionStats?.errorsEncountered ?? 0) > 0 ? 0.5 : 1;
  const checkpointCadence = turnPairs.length > 0 ? clamp(checkpointsRecorded / turnPairs.length, 0, 1) : 0;
  const artifactCadence = turnPairs.length > 0 ? clamp(artifactsCaptured / turnPairs.length, 0, 1) : 0;

  const metaLearningSignal = clamp(
    mlRatio * 0.5 + checkpointCadence * 0.3 + artifactCadence * 0.2,
    0,
    1,
  );
  const metaLearning = metaLearningSignal > 0.75
    ? 10
    : metaLearningSignal > 0.45
      ? 8
      : metaLearningSignal > 0.2
        ? 6
        : (mlTurns > 0 || checkpointsRecorded > 0 || artifactsCaptured > 0)
          ? 5
          : 3;

  // 4. Reading between lines
  let inferenceScore = 5;
  let confirmedInferences = 0;
  let unconfirmedInferences = 0;
  const POSITIVE_ACK = /\b(exactly|yes|that's it|thanks|perfect|got it|correct|right|nice|great|good|awesome|works|solved)\b/i;
  for (let i = 0; i < turnPairs.length; i++) {
    const userContent = safeContent(turnPairs[i].userMessage);
    const isAmbiguous = countWords(userContent) < 50 && !/[\w./]+\.\w{1,5}/.test(userContent);
    if (!isAmbiguous) continue;
    // Check if no retry within 3 turns
    const noRetry = !turnPairs.slice(i + 1, i + 4).some(tp =>
      FIX_KEYWORDS_REGEX.test(safeContent(tp.userMessage))
    );
    if (!noRetry) continue;
    // Positive acknowledgment from user confirms correct inference
    const nextUser = i + 1 < turnPairs.length ? safeContent(turnPairs[i + 1].userMessage) : '';
    if (POSITIVE_ACK.test(nextUser)) {
      confirmedInferences++;
    } else {
      unconfirmedInferences++;
    }
  }
  // Confirmed inferences worth full point, unconfirmed worth 0.4
  inferenceScore = clamp(Math.round(confirmedInferences + unconfirmedInferences * 0.4), 0, 10);

  // 5. Precision communication
  let precisionHits = 0;
  let precisionTotal = 0;
  for (const tp of turnPairs) {
    if (!tp.assistantResponse) continue;
    const respContent = safeContent(tp.assistantResponse);
    const codeRatio = (respContent.match(/```[\s\S]*?```/g) ?? []).join('').length / Math.max(1, respContent.length);
    if (codeRatio > 0.5) continue; // skip code-heavy responses
    precisionTotal++;
    const userTokens = countWords(safeContent(tp.userMessage));
    const respTokens = countWords(respContent);
    const expectedMax = userTokens < 30 ? 200 : 500;
    if (respTokens <= expectedMax) precisionHits++;
  }
  const precisionComm = precisionTotal > 0
    ? clamp(Math.round((precisionHits / precisionTotal) * 10), 0, 10)
    : 5;

  // 6. Right question
  const questioningTurns = turnPairs.filter(tp => {
    if (!tp.assistantResponse) return false;
    const resp = safeContent(tp.assistantResponse);
    const hasQuestion = resp.includes('?');
    const hasToolAfter = tp.toolCalls.length > 0;
    return hasQuestion && hasToolAfter;
  }).length;
  const questionRatio = turnPairs.length > 0 ? questioningTurns / turnPairs.length : 0;
  const rightQuestion = questionRatio > 0.5 ? 10 : questionRatio > 0.3 ? 8 : questionRatio > 0.1 ? 6 : 4;

  // 7. Compression
  const hasNotes = turnPairs.some(tp =>
    tp.toolCalls.some(tc => tc.type === 'tool-call' && /summary|note/i.test(safeContent(tc)))
  );
  const thinkingLengths = turnPairs
    .filter(tp => tp.thinkingBlocks.length > 0)
    .map(tp => tp.thinkingBlocks.reduce((sum, t) => sum + safeContent(t).length, 0));
  const { slope: thinkSlope } = linearRegression(thinkingLengths);
  const compressionSignal = Math.max(
    hasNotes ? 1 : 0,
    checkpointCadence * 0.8,
    artifactCadence * 0.9,
    thinkSlope < -10 ? 0.9 : thinkSlope < 0 ? 0.7 : 0.4,
  );
  const compression = compressionSignal >= 0.9 ? 10 : compressionSignal >= 0.7 ? 8 : compressionSignal >= 0.45 ? 6 : 4;

  // 8. Systems thinking
  const editedFiles = new Set<string>();
  const editContents: { path: string; content: string }[] = [];
  for (const tp of turnPairs) {
    for (const tc of tp.toolCalls) {
      const meta = tc.meta as { filePath?: string; newString?: string; eventType?: string };
      if (tc.type === 'file-edit' && meta?.filePath) {
        editedFiles.add(meta.filePath.toLowerCase());
        if (meta.newString) editContents.push({ path: meta.filePath.toLowerCase(), content: meta.newString });
      }
    }
  }
  let relatedEdits = 0;
  for (const { content } of editContents) {
    const importMatches = content.matchAll(/(import|require)\s.*from\s+['"](\.[^'"]*)['"]/g);
    for (const match of importMatches) {
      const target = match[2].toLowerCase();
      if ([...editedFiles].some(f => f.includes(target.replace(/^\.\//, '')))) {
        relatedEdits++;
        break;
      }
    }
  }
  const stRatio = editedFiles.size > 0 ? relatedEdits / editedFiles.size : 0;
  const systemsThinking = stRatio > 0.6 ? 10 : stRatio > 0.3 ? 8 : stRatio > 0 ? 6 : 5;

  // 9. Taste judgment
  const errorRate = sessionStats
    ? sessionStats.errorsEncountered / Math.max(1, touchedFiles)
    : 0;
  const errorDiscipline = errorRate < 0.1 ? 1 : errorRate < 0.25 ? 0.75 : errorRate < 0.5 ? 0.5 : 0.2;
  const proofDiscipline = verificationsRun === 0
    ? touchedFiles > 1 ? 0.45 : 0.65
    : clamp(proofCoverage * 0.45 + proofSuccessRate * 0.55, 0, 1);
  const tasteJudgment = Math.round(clamp((errorDiscipline * 0.45 + proofDiscipline * 0.55) * 10, 0, 10));

  // 10. Intellectual honesty
  let ackCount = 0;
  for (const chain of retryChains) {
    const endIdx = chain.startIndex + chain.length;
    if (endIdx < turnPairs.length) {
      const resp = safeContent(turnPairs[endIdx].assistantResponse);
      if (SELF_CORRECTION_MARKERS.test(resp)) ackCount++;
    }
  }
  const ihRatio = retryChains.length > 0 ? ackCount / retryChains.length : 0;
  const acknowledgementSignal = retryChains.length === 0 ? 0.7 : ihRatio > 0.5 ? 1 : ihRatio > 0 ? 0.8 : 0.5;
  const recoverySignal = recoveriesTriggered === 0
    ? (sessionStats?.errorsEncountered ?? 0) > 0 ? 0.6 : 0.8
    : recoverySuccessRate > 0.66 ? 1 : recoverySuccessRate > 0.33 ? 0.8 : 0.4;
  const proofSignal = verificationsRun > 0 ? proofSuccessRate : 0.1;
  const intellectualHonesty = Math.round(clamp(
    (acknowledgementSignal * 0.55 + recoverySignal * 0.3 + proofSignal * 0.15) * 10,
    0,
    10,
  ));

  const foundations = [
    { name: 'first-principles', raw: firstPrinciples },
    { name: 'calibrated-uncertainty', raw: calibrationScore },
    { name: 'meta-learning', raw: metaLearning },
    { name: 'reading-between-lines', raw: inferenceScore },
    { name: 'precision-communication', raw: precisionComm },
    { name: 'right-question', raw: rightQuestion },
    { name: 'compression', raw: compression },
    { name: 'systems-thinking', raw: systemsThinking },
    { name: 'taste-judgment', raw: tasteJudgment },
    { name: 'intellectual-honesty', raw: intellectualHonesty },
  ];

  const factors: ScoreFactor[] = foundations.map(f => ({
    name: f.name,
    weight: 0.1, // 10 foundations × 0.1 = 1.0
    raw: f.raw * 10, // scale 0-10 → 0-100
  }));

  const value = foundations.reduce((sum, f) => sum + f.raw, 0); // already 0-100

  return {
    value: clamp(value, 0, 100),
    factors,
    explanation: `${foundations.filter(f => f.raw >= 8).length}/10 foundations strong${verificationsRun > 0 ? ` · ${verificationsPassed}/${verificationsRun} proofs passed` : checkpointsRecorded > 0 || artifactsCaptured > 0 ? ` · ${checkpointsRecorded} checkpoints, ${artifactsCaptured} artifacts` : ''}`,
    scoreable: true,
  };
}

// ── Speaking Dimensions Scorer ─────────────────────────────────

function scoreSpeakingDimensions(turnPairs: readonly TurnPair[]): SpeakingDimensionScores {
  return {
    adaptiveDepth: scoreAdaptiveDepth(turnPairs),
    proactiveReframing: scoreProactiveReframing(turnPairs),
    epistemicTransparency: scoreEpistemicTransparency(turnPairs),
    narrativeCoherence: scoreNarrativeCoherence(turnPairs),
    teachingVelocity: scoreTeachingVelocity(turnPairs),
  };
}

function scoreAdaptiveDepth(turnPairs: readonly TurnPair[]): SubScore {
  if (turnPairs.length === 0) {
    return { value: 50, factors: [], explanation: 'No data', scoreable: false };
  }

  // AI assistants naturally write longer than humans — calibrate accordingly
  const IDEAL_RATIOS = { low: 4.0, medium: 6.0, high: 8.0 };
  const PENALTY_SCALE = 8;
  const scores: number[] = [];

  for (const tp of turnPairs) {
    if (!tp.assistantResponse) continue;
    const userWords = countWords(safeContent(tp.userMessage));
    const respWords = countWords(safeContent(tp.assistantResponse));
    const complexity = userWords < 20 ? 'low' : userWords < 100 ? 'medium' : 'high';
    const idealRatio = IDEAL_RATIOS[complexity];
    const actualRatio = respWords / Math.max(1, userWords);
    const score = clamp(100 - Math.abs(actualRatio - idealRatio) * PENALTY_SCALE, 0, 100);
    scores.push(score);
  }

  const value = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 50;

  return {
    value,
    factors: [{ name: 'depth-calibration', weight: 1.0, raw: value }],
    explanation: `${scores.length} turns scored for depth calibration`,
    scoreable: scores.length > 0,
  };
}

function scoreProactiveReframing(turnPairs: readonly TurnPair[]): SubScore {
  const reframeSignals = /\b(alternatively|the real question|but you might|consider instead|what you probably want|however|a better approach|instead of|the underlying issue|what you actually need|more importantly|the key insight|worth noting|before that though)\b/i;
  let applicable = 0;
  let reframed = 0;

  for (const tp of turnPairs) {
    if (!tp.assistantResponse) continue;
    const userContent = safeContent(tp.userMessage);
    // Only score when a reframe might be warranted
    if (countWords(userContent) < 5) continue;
    applicable++;
    const respContent = safeContent(tp.assistantResponse);
    if (reframeSignals.test(respContent)) reframed++;
  }

  if (applicable === 0) {
    return { value: 50, factors: [], explanation: 'No applicable turns', scoreable: false };
  }

  const value = Math.round((reframed / applicable) * 100);
  return {
    value: clamp(value, 0, 100),
    factors: [{ name: 'reframe-rate', weight: 1.0, raw: value }],
    explanation: `${reframed}/${applicable} applicable turns included reframing`,
    scoreable: true,
  };
}

function scoreEpistemicTransparency(turnPairs: readonly TurnPair[]): SubScore {
  let totalAssertions = 0;
  let correctCalibrations = 0;

  for (let i = 0; i < turnPairs.length - 1; i++) {
    const resp = safeContent(turnPairs[i].assistantResponse);
    if (!resp) continue;

    const isHigh = HIGH_CONFIDENCE_MARKERS.test(resp);
    const isMedium = MEDIUM_CONFIDENCE_MARKERS.test(resp);
    const isLow = LOW_CONFIDENCE_MARKERS.test(resp);
    if (!isHigh && !isMedium && !isLow) continue;

    totalAssertions++;
    const nextUser = safeContent(turnPairs[i + 1].userMessage);
    const wasWrong = /(wrong|incorrect|not right|still broken|doesn't work|that's not)/i.test(nextUser);

    if ((isHigh && !wasWrong) || (isLow && wasWrong) || (isMedium && !wasWrong)) {
      correctCalibrations++;
    }
  }

  if (totalAssertions < 3) {
    return { value: 50, factors: [], explanation: 'Insufficient assertions to calibrate', scoreable: false };
  }

  const value = Math.round((correctCalibrations / totalAssertions) * 100);
  return {
    value: clamp(value, 0, 100),
    factors: [{ name: 'calibration-accuracy', weight: 1.0, raw: value }],
    explanation: `${correctCalibrations}/${totalAssertions} assertions correctly calibrated`,
    scoreable: true,
  };
}

function scoreNarrativeCoherence(turnPairs: readonly TurnPair[]): SubScore {
  if (turnPairs.length < 2) {
    return { value: 100, factors: [], explanation: 'Single turn - no coherence test', scoreable: false };
  }

  // Rolling window: score consecutive pairs across the FULL conversation,
  // then average. Window size of 10 keeps cost O(n) not O(n²).
  const WINDOW_SIZE = 10;
  const entityPattern = /[\w./]+\.\w+|\b\w+\(\)|\b[a-z][a-zA-Z0-9]{2,}\b/g;
  const windowOverlaps: number[] = [];
  let totalNewConceptBonus = 0;
  let totalPairsScored = 0;

  const numWindows = Math.ceil(turnPairs.length / WINDOW_SIZE);
  for (let w = 0; w < numWindows; w++) {
    const start = w * WINDOW_SIZE;
    const end = Math.min(start + WINDOW_SIZE, turnPairs.length);
    const window = turnPairs.slice(start, end);

    for (let i = 1; i < window.length; i++) {
      const prevContent = safeContent(window[i - 1].assistantResponse);
      const currContent = safeContent(window[i].assistantResponse);
      if (!prevContent || !currContent) {
        // Penalize missing responses instead of silently skipping
        windowOverlaps.push(0.05);
        totalPairsScored++;
        continue;
      }

      const prevEntities = new Set((prevContent.match(entityPattern) ?? []).map(e => e.toLowerCase()));
      const currEntities = new Set((currContent.match(entityPattern) ?? []).map(e => e.toLowerCase()));

      const intersection = [...prevEntities].filter(e => currEntities.has(e)).length;
      const union = new Set([...prevEntities, ...currEntities]).size;
      const overlap = union > 0 ? intersection / union : 0;
      windowOverlaps.push(overlap);

      const newConcepts = [...currEntities].filter(e => !prevEntities.has(e)).length;
      if (overlap > 0.1 && newConcepts > 0) totalNewConceptBonus++;
      totalPairsScored++;
    }
  }

  const avgOverlap = windowOverlaps.length > 0
    ? windowOverlaps.reduce((a, b) => a + b, 0) / windowOverlaps.length
    : 0;
  const bonusRatio = totalNewConceptBonus / Math.max(1, totalPairsScored);
  const value = Math.round(avgOverlap * 80 + bonusRatio * 20);

  return {
    value: clamp(value, 0, 100),
    factors: [
      { name: 'entity-overlap', weight: 0.8, raw: Math.round(avgOverlap * 100) },
      { name: 'concept-growth', weight: 0.2, raw: Math.round(bonusRatio * 100) },
    ],
    explanation: `Avg entity overlap ${(avgOverlap * 100).toFixed(0)}%, ${totalNewConceptBonus} growth turns`,
    scoreable: windowOverlaps.length > 0,
  };
}

function scoreTeachingVelocity(turnPairs: readonly TurnPair[]): SubScore {
  // Find topic reoccurrences via 3-gram overlap between non-adjacent pairs
  const topicMatches: { early: number; late: number }[] = [];

  // Longer sessions have more vocabulary diversity, requiring stricter overlap.
  // Scale threshold: 0.15 base, up to 0.25 for sessions > 30 turns.
  const overlapThreshold = TOPIC_OVERLAP_BASE_THRESHOLD +
    clamp((turnPairs.length - 10) * 0.005, 0, 0.10);

  for (let i = 0; i < turnPairs.length; i++) {
    const iContent = stripCodeBlocks(safeContent(turnPairs[i].userMessage));
    const iGrams = computeNgrams(iContent, 3);
    if (iGrams.size < 3) continue;

    for (let j = i + 2; j < turnPairs.length; j++) {
      const jContent = stripCodeBlocks(safeContent(turnPairs[j].userMessage));
      const jGrams = computeNgrams(jContent, 3);
      if (jGrams.size < 3) continue;

      const overlap = ngramOverlap(iGrams, jGrams);
      if (overlap >= overlapThreshold) {
        topicMatches.push({ early: i, late: j });
      }
    }
  }

  if (topicMatches.length < 2) {
    return { value: 50, factors: [], explanation: 'Insufficient topic reoccurrence', scoreable: false };
  }

  const velocities: number[] = [];
  for (const { early, late } of topicMatches) {
    const earlyResp = countWords(safeContent(turnPairs[early].assistantResponse));
    const lateResp = countWords(safeContent(turnPairs[late].assistantResponse));
    const earlyUser = countWords(safeContent(turnPairs[early].userMessage));
    const lateUser = countWords(safeContent(turnPairs[late].userMessage));

    if (earlyResp === 0) continue;
    const assistantRatio = clamp(lateResp / Math.max(1, earlyResp), 0, 2);
    const userRatio = clamp(lateUser / Math.max(1, earlyUser), 0, 2);
    const velocity = 100 * (1 - assistantRatio) * Math.max(0.5, userRatio);
    velocities.push(clamp(velocity, 0, 100));
  }

  if (velocities.length === 0) {
    return { value: 50, factors: [], explanation: 'No scoreable velocity data', scoreable: false };
  }

  const value = Math.round(velocities.reduce((a, b) => a + b, 0) / velocities.length);
  return {
    value: clamp(value, 0, 100),
    factors: [{ name: 'teaching-velocity', weight: 1.0, raw: value }],
    explanation: `${topicMatches.length} topic reoccurrences, avg velocity ${value}`,
    scoreable: true,
  };
}

// ── Conversation Curve ─────────────────────────────────────────

function computeConversationCurve(
  turnPairs: readonly TurnPair[],
  efficiencyScore: SubScore,
  teachingScore: SubScore,
  antiPatternReport: AntiPatternReport,
  cognitiveScore: SubScore,
): CurvePoint[] {
  if (turnPairs.length === 0) return [];

  // Simple per-turn composite: use overall scores as baseline
  // More granular per-turn scoring would require individual turn sub-scoring
  const baseScore = (
    efficiencyScore.value * 0.25 +
    teachingScore.value * 0.25 +
    antiPatternReport.score * 0.25 +
    cognitiveScore.value * 0.25
  );

  const points: CurvePoint[] = [];
  let cumulativeSum = 0;

  for (let i = 0; i < turnPairs.length; i++) {
    // Adjust per-turn score based on local signals
    let turnAdjust = 0;

    // Penalty for retry at this turn
    const userContent = safeContent(turnPairs[i].userMessage);
    if (FIX_KEYWORDS_REGEX.test(userContent)) turnAdjust -= 10;

    // Bonus for thinking blocks
    if (turnPairs[i].thinkingBlocks.length > 0) turnAdjust += 5;

    // Anti-pattern hit at this turn
    const hitHere = antiPatternReport.detections.filter(d => d.turnPairIndex === i);
    turnAdjust -= hitHere.reduce((sum, d) => sum + d.severity, 0);

    const turnScore = clamp(Math.round(baseScore + turnAdjust), 0, 100);
    cumulativeSum += turnScore;
    const cumulativeScore = Math.round(cumulativeSum / (i + 1));
    const slope = i > 0 ? turnScore - points[i - 1].turnScore : 0;

    points.push({ turnIndex: i, turnScore, cumulativeScore, slope });
  }

  return points;
}

// ── Highlights ─────────────────────────────────────────────────

function extractHighlights(
  curve: readonly CurvePoint[],
  antiPatterns: AntiPatternReport,
): ScoredHighlight[] {
  const highlights: ScoredHighlight[] = [];

  if (curve.length > 0) {
    // Best turn
    const best = curve.reduce((a, b) => a.turnScore > b.turnScore ? a : b);
    highlights.push({
      turnPairIndex: best.turnIndex,
      type: 'best',
      reason: `Highest turn score: ${best.turnScore}`.slice(0, 200),
      score: best.turnScore,
    });

    // Worst turn
    const worst = curve.reduce((a, b) => a.turnScore < b.turnScore ? a : b);
    highlights.push({
      turnPairIndex: worst.turnIndex,
      type: 'worst',
      reason: `Lowest turn score: ${worst.turnScore}`.slice(0, 200),
      score: worst.turnScore,
    });
  }

  // Critical anti-patterns
  for (const detection of antiPatterns.detections.slice(0, 3)) {
    highlights.push({
      turnPairIndex: detection.turnPairIndex,
      type: 'critical-anti-pattern',
      reason: `${detection.pattern}: ${detection.evidence}`.slice(0, 200),
      score: detection.severity,
    });
  }

  return highlights;
}

// ── ConversationScorer Class ───────────────────────────────────

export class ConversationScorer {
  /**
   * Score an entire session from its events.
   */
  score(events: readonly SessionEvent[], sessionStats: SessionStats | null = null): ConversationScore {
    const turnPairs = extractTurnPairs(events);
    const retryChains = detectRetryChains(turnPairs);

    const efficiency = scoreEfficiency(turnPairs);
    const teachingQuality = scoreTeachingQuality(turnPairs, retryChains);
    const antiPatterns = detectAntiPatterns(turnPairs);
    const cognitiveAlignment = scoreCognitiveAlignment(turnPairs, sessionStats, retryChains);
    const speakingDimensions = scoreSpeakingDimensions(turnPairs);
    const conversationCurve = computeConversationCurve(
      turnPairs, efficiency, teachingQuality, antiPatterns, cognitiveAlignment,
    );
    const highlights = extractHighlights(conversationCurve, antiPatterns);

    // Overall: weighted average → grade via computeGrade (0.0-1.0 scale)
    const overall = (
      efficiency.value * 0.25 +
      teachingQuality.value * 0.20 +
      antiPatterns.score * 0.20 +
      cognitiveAlignment.value * 0.20 +
      averageSpeakingDimensions(speakingDimensions) * 0.15
    );
    const overallGrade = computeGrade(overall / 100);

    return {
      sessionId: events.length > 0 ? events[0].sessionId : '',
      efficiency,
      teachingQuality,
      antiPatterns,
      cognitiveAlignment,
      speakingDimensions,
      conversationCurve,
      overall,
      overallGrade,
      highlights,
      turnPairCount: turnPairs.length,
      totalEvents: events.length,
      scoredAt: Date.now(),
      scorerVersion: SCORER_VERSION,
    };
  }
}

function averageSpeakingDimensions(dims: SpeakingDimensionScores): number {
  const scores = [
    dims.adaptiveDepth,
    dims.proactiveReframing,
    dims.epistemicTransparency,
    dims.narrativeCoherence,
    dims.teachingVelocity,
  ];
  const scoreable = scores.filter(s => s.scoreable);
  if (scoreable.length === 0) return 50;
  return scoreable.reduce((sum, s) => sum + s.value, 0) / scoreable.length;
}
