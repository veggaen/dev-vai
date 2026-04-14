/**
 * Session Analyzer
 *
 * Post-processes a completed session's events to extract:
 * - What the user actually wanted (intent)
 * - What strategy the AI used (approach)
 * - Whether it worked (outcome)
 * - Specific failure patterns (what went wrong)
 * - What to improve next time
 *
 * This is the feedback loop that turns raw dev logs into Vai learning data.
 */

import type { AgentSession, SessionEvent, SessionEventType } from './types.js';

// ── Outcome signals ───────────────────────────────────────────────

/** Signals that indicate the session went well */
const SUCCESS_SIGNALS = [
  /\b(?:thank(?:s| you)|perfect|great|awesome|works?(?:ing)?|that(?:'s| is) (?:it|right|correct|good)|exactly|nailed it|nice one|good job|looks good)\b/i,
  /\b(?:all tests? (?:pass|passing)|build (?:success|passed)|deployed|it (?:works?|runs?)|fixed)\b/i,
];

/** Signals that indicate frustration or failure */
const FAILURE_SIGNALS = [
  /\b(?:no(?:pe)?|wrong|broken|doesn'?t work|still (?:broken|failing|not working)|that'?s not right|not what I (?:meant|asked|wanted))\b/i,
  /\b(?:error|exception|crash|failed|failing|broken|bug|issue|problem|wrong)\b/i,
  /\b(?:again|try again|still|same (?:issue|error|problem)|didn'?t (?:work|help))\b/i,
];

/** Signals that indicate the AI went in circles */
const LOOP_SIGNALS = [
  /\b(?:i(?:'ve)? (?:already|just) (?:told|said|mentioned)|you (?:already|just) (?:said|did)|i said that|you'?re repeating|same thing again)\b/i,
];

// ── Intent classifiers ────────────────────────────────────────────

const INTENT_PATTERNS: Array<{ pattern: RegExp; intent: string }> = [
  { pattern: /\b(?:build|create|make|implement|add|write)\b.*\b(?:feature|component|page|api|route|endpoint)\b/i, intent: 'build-feature' },
  { pattern: /\b(?:fix|debug|resolve|solve)\b.*\b(?:bug|error|issue|problem|crash)\b/i, intent: 'fix-bug' },
  { pattern: /\b(?:refactor|clean|improve|optimize|rewrite)\b/i, intent: 'refactor' },
  { pattern: /\b(?:explain|what is|how does|why|understand)\b/i, intent: 'learn' },
  { pattern: /\b(?:review|check|look at|read|analyze)\b/i, intent: 'review' },
  { pattern: /\b(?:test|spec|coverage|e2e|unit)\b/i, intent: 'testing' },
  { pattern: /\b(?:deploy|release|publish|ship)\b/i, intent: 'deploy' },
  { pattern: /\b(?:setup|install|configure|scaffold|init)\b/i, intent: 'setup' },
];

// ── Response quality heuristics ───────────────────────────────────

interface ResponseQuality {
  /** Did the response directly address the request? */
  addressed: boolean;
  /** Did it contain a concrete artifact (code block, file path, command)? */
  concrete: boolean;
  /** Was it too long / vague / padded? */
  verbose: boolean;
  /** Did it ask a clarifying question? */
  clarified: boolean;
  /** Did it contain numbered steps / a plan? */
  hadPlan: boolean;
  /** Approximate word count */
  wordCount: number;
}

function analyzeResponseQuality(text: string): ResponseQuality {
  const lower = text.toLowerCase();
  return {
    addressed: /```|`[^`]+`|\b(?:here(?:'s| is)|you can|to do this|steps?:|the (?:issue|fix|solution|answer) is)\b/.test(lower),
    concrete: /```[\s\S]+?```|`[^`]+`|\b(?:run|install|import|const |function |class |export )\b/.test(text),
    verbose: text.length > 2000 && !/```/.test(text), // long but no code
    clarified: /\b(?:could you clarify|what do you mean|which|are you (?:trying|referring)|do you want)\b/i.test(text),
    hadPlan: /(?:^|\n)\s*\d+\.\s+\S/.test(text),
    wordCount: text.split(/\s+/).length,
  };
}

// ── Failure pattern taxonomy ──────────────────────────────────────

export type FailurePattern =
  | 'wrong-file'           // AI edited wrong file
  | 'wrong-approach'       // AI used wrong tech/pattern
  | 'missed-requirement'   // AI ignored part of the request
  | 'verbose-no-code'      // AI talked a lot but didn't code
  | 'infinite-loop'        // Same mistake repeated
  | 'context-drop'         // AI forgot earlier context
  | 'over-engineered'      // AI added too much complexity
  | 'compile-error'        // Code had syntax/type errors
  | 'none';

function detectFailurePattern(events: SessionEvent[]): FailurePattern {
  const messages = events.filter(e => e.type === 'message');
  const userMessages = messages.filter(e => (e.meta as any)?.role === 'user');
  const errors = events.filter(e => e.type === 'error' || e.type === 'terminal');

  // Check for repeated errors
  const errorMessages = errors.map(e => e.content.slice(0, 100));
  const uniqueErrors = new Set(errorMessages);
  if (errorMessages.length > uniqueErrors.size + 1) return 'compile-error';

  // Check for user frustration about context drop
  for (const msg of userMessages) {
    if (LOOP_SIGNALS.some(p => p.test(msg.content))) return 'context-drop';
  }

  // Check for user complaining about wrong approach
  for (const msg of userMessages) {
    if (/\b(?:wrong (?:file|approach|function|method)|not (?:that|the right)|you(?:'re| are) (?:modifying|editing|changing) (?:the )?wrong)\b/i.test(msg.content)) {
      return 'wrong-file';
    }
    if (/\b(?:too (?:complex|complicated|much)|over-?engineer|don'?t need that|simpler|overkill)\b/i.test(msg.content)) {
      return 'over-engineered';
    }
    if (/\b(?:you (?:forgot|missed|ignored|didn'?t (?:do|add|include))|what about|also|and also)\b/i.test(msg.content)) {
      return 'missed-requirement';
    }
  }

  // Check if AI responses were verbose without code
  const aiMessages = messages.filter(e => (e.meta as any)?.role === 'assistant');
  const verboseCount = aiMessages.filter(e => analyzeResponseQuality(e.content).verbose).length;
  if (verboseCount > aiMessages.length / 2) return 'verbose-no-code';

  return 'none';
}

// ── Session outcome ────────────────────────────────────────────────

export type SessionOutcome = 'success' | 'partial' | 'failure' | 'abandoned' | 'unknown';

function detectOutcome(events: SessionEvent[], session: AgentSession): SessionOutcome {
  const messages = events.filter(e => e.type === 'message');
  const userMessages = messages.filter(e => (e.meta as any)?.role === 'user');

  if (userMessages.length === 0) return 'unknown';

  // Last few user messages — outcome usually visible at the end
  const lastMessages = userMessages.slice(-3).map(m => m.content);

  let successScore = 0;
  let failScore = 0;

  for (const msg of lastMessages) {
    if (SUCCESS_SIGNALS.some(p => p.test(msg))) successScore++;
    if (FAILURE_SIGNALS.some(p => p.test(msg))) failScore++;
  }

  // Session ended with no resolution (abandoned)
  const durationMs = (session.endedAt ?? Date.now()) - session.startedAt;
  if (durationMs < 30_000 && userMessages.length <= 2) return 'abandoned';

  if (successScore > failScore) return 'success';
  if (failScore > successScore) return 'failure';
  if (successScore > 0) return 'partial';

  // Default: if session ended normally and had meaningful exchanges
  if (session.status === 'completed' && messages.length > 4) return 'partial';

  return 'unknown';
}

// ── Main types ─────────────────────────────────────────────────────

export interface SessionAnalysis {
  sessionId: string;
  /** What the user was trying to accomplish */
  intent: string;
  /** Primary activity type detected */
  primaryActivity: string;
  /** Did it succeed? */
  outcome: SessionOutcome;
  /** What went wrong (if anything) */
  failurePattern: FailurePattern;
  /** Key metrics */
  metrics: {
    totalMessages: number;
    userMessages: number;
    aiMessages: number;
    thinkingBlocks: number;
    filesChanged: number;
    terminalCommands: number;
    errorsEncountered: number;
    planningEvents: number;
    avgResponseWordCount: number;
    /** Ratio of concrete (code-containing) responses */
    concreteResponseRatio: number;
  };
  /** What worked in this session (for Vai to replicate) */
  whatWorked: string[];
  /** What failed (for Vai to avoid) */
  whatFailed: string[];
  /** Suggested improvement for Vai's next similar session */
  suggestedImprovement: string;
  /** Key decision moments (planning events + major file edits) */
  keyMoments: Array<{
    timestamp: number;
    type: string;
    summary: string;
  }>;
}

export interface SessionInsightsAggregate {
  topFailures: Array<{ pattern: FailurePattern; count: number; pct: number }>;
  topSuccessFactors: Array<{ factor: string; count: number; pct: number }>;
  outcomeBreakdown: Record<SessionOutcome, number>;
  avgConcreteRatio: number;
  avgResponseLength: number;
  recommendation: string;
}

// ── Analyzer ──────────────────────────────────────────────────────

export class SessionAnalyzer {
  analyze(session: AgentSession, events: SessionEvent[]): SessionAnalysis {
    const messages = events.filter(e => e.type === 'message');
    const userMessages = messages.filter(e => (e.meta as any)?.role === 'user');
    const aiMessages = messages.filter(e => (e.meta as any)?.role === 'assistant');
    const thinkingEvents = events.filter(e => e.type === 'thinking');
    const fileEvents = events.filter(e => ['file-create', 'file-edit', 'file-delete'].includes(e.type));
    const terminalEvents = events.filter(e => e.type === 'terminal');
    const errorEvents = events.filter(e => e.type === 'error');
    const planningEvents = events.filter(e => e.type === 'planning');

    // Intent from first user message
    const firstUserMsg = userMessages[0]?.content ?? '';
    let intent = 'general';
    let primaryActivity = 'conversation';
    for (const { pattern, intent: label } of INTENT_PATTERNS) {
      if (pattern.test(firstUserMsg)) {
        intent = label;
        primaryActivity = label;
        break;
      }
    }

    // Override with most frequent event type
    const typeCounts = events.reduce((acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const dominantType = Object.entries(typeCounts)
      .filter(([t]) => !['message', 'state-change'].includes(t))
      .sort((a, b) => b[1] - a[1])[0]?.[0];
    if (dominantType) primaryActivity = dominantType;

    // Response quality
    const responseQualities = aiMessages.map(m => analyzeResponseQuality(m.content));
    const concreteCount = responseQualities.filter(q => q.concrete).length;
    const avgWordCount = responseQualities.length > 0
      ? Math.round(responseQualities.reduce((s, q) => s + q.wordCount, 0) / responseQualities.length)
      : 0;

    // Outcome + failure
    const outcome = detectOutcome(events, session);
    const failurePattern = outcome !== 'success' ? detectFailurePattern(events) : 'none';

    // What worked
    const whatWorked: string[] = [];
    if (concreteCount > aiMessages.length * 0.6) whatWorked.push('Responses were concrete and code-focused');
    if (planningEvents.length > 0) whatWorked.push('AI planned before coding');
    if (thinkingEvents.length > 0) whatWorked.push('AI reasoned through the problem');
    if (fileEvents.length > 0) whatWorked.push(`Made ${fileEvents.length} file changes`);
    if (errorEvents.length === 0 && terminalEvents.length > 0) whatWorked.push('Terminal commands ran without errors');

    // What failed
    const whatFailed: string[] = [];
    if (failurePattern !== 'none') whatFailed.push(`Failure pattern: ${failurePattern}`);
    if (responseQualities.filter(q => q.verbose).length > 1) whatFailed.push('Too many verbose responses without code');
    if (errorEvents.length > 2) whatFailed.push(`${errorEvents.length} errors encountered`);
    if (userMessages.length > aiMessages.length * 2) whatFailed.push('User had to ask many follow-ups — AI underdelivered');

    // Suggested improvement
    const suggestedImprovement = buildSuggestion(failurePattern, intent, responseQualities);

    // Key moments
    const keyMoments = [
      ...planningEvents.map(e => ({
        timestamp: e.timestamp,
        type: 'planning',
        summary: e.content.slice(0, 120),
      })),
      ...fileEvents.slice(0, 5).map(e => ({
        timestamp: e.timestamp,
        type: e.type,
        summary: `${e.type}: ${((e.meta as any)?.filePath ?? e.content).slice(0, 80)}`,
      })),
      ...errorEvents.slice(0, 3).map(e => ({
        timestamp: e.timestamp,
        type: 'error',
        summary: e.content.slice(0, 120),
      })),
    ].sort((a, b) => a.timestamp - b.timestamp);

    return {
      sessionId: session.id,
      intent,
      primaryActivity,
      outcome,
      failurePattern,
      metrics: {
        totalMessages: messages.length,
        userMessages: userMessages.length,
        aiMessages: aiMessages.length,
        thinkingBlocks: thinkingEvents.length,
        filesChanged: fileEvents.length,
        terminalCommands: terminalEvents.length,
        errorsEncountered: errorEvents.length,
        planningEvents: planningEvents.length,
        avgResponseWordCount: avgWordCount,
        concreteResponseRatio: aiMessages.length > 0 ? concreteCount / aiMessages.length : 0,
      },
      whatWorked,
      whatFailed,
      suggestedImprovement,
      keyMoments,
    };
  }

  /**
   * Compare analyses across multiple sessions to find systemic patterns.
   * Returns the top recurring failure patterns and what consistently worked.
   */
  aggregateInsights(analyses: SessionAnalysis[]): SessionInsightsAggregate {
    const total = analyses.length;
    if (total === 0) {
      return {
        topFailures: [],
        topSuccessFactors: [],
        outcomeBreakdown: { success: 0, partial: 0, failure: 0, abandoned: 0, unknown: 0 },
        avgConcreteRatio: 0,
        avgResponseLength: 0,
        recommendation: 'No sessions to analyze yet.',
      };
    }

    // Failure patterns
    const failureCounts: Partial<Record<FailurePattern, number>> = {};
    for (const a of analyses) {
      if (a.failurePattern !== 'none') {
        failureCounts[a.failurePattern] = (failureCounts[a.failurePattern] ?? 0) + 1;
      }
    }
    const topFailures = Object.entries(failureCounts)
      .map(([p, c]) => ({ pattern: p as FailurePattern, count: c!, pct: Math.round(c! / total * 100) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Success factors
    const factorCounts: Record<string, number> = {};
    for (const a of analyses.filter(a => a.outcome === 'success')) {
      for (const f of a.whatWorked) {
        factorCounts[f] = (factorCounts[f] ?? 0) + 1;
      }
    }
    const topSuccessFactors = Object.entries(factorCounts)
      .map(([f, c]) => ({ factor: f, count: c, pct: Math.round(c / total * 100) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Outcomes
    const outcomeBreakdown = analyses.reduce((acc, a) => {
      acc[a.outcome] = (acc[a.outcome] ?? 0) + 1;
      return acc;
    }, {} as Record<SessionOutcome, number>);

    const avgConcreteRatio = analyses.reduce((s, a) => s + a.metrics.concreteResponseRatio, 0) / total;
    const avgResponseLength = analyses.reduce((s, a) => s + a.metrics.avgResponseWordCount, 0) / total;

    const recommendation = buildAggregateRecommendation(topFailures, avgConcreteRatio);

    return {
      topFailures,
      topSuccessFactors,
      outcomeBreakdown,
      avgConcreteRatio: Math.round(avgConcreteRatio * 100) / 100,
      avgResponseLength: Math.round(avgResponseLength),
      recommendation,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────

function buildSuggestion(failure: FailurePattern, intent: string, qualities: ResponseQuality[]): string {
  const verboseRatio = qualities.filter(q => q.verbose).length / Math.max(1, qualities.length);

  if (failure === 'context-drop') return 'Use conversation summary at top of each response to anchor context.';
  if (failure === 'wrong-file') return 'Always confirm file path before editing. Show file path in response header.';
  if (failure === 'over-engineered') return `For ${intent} requests: start minimal. Add complexity only when user explicitly asks.`;
  if (failure === 'missed-requirement') return 'Extract all requirements before coding. List them back to user: "I understand you want: 1. X 2. Y".';
  if (failure === 'verbose-no-code') return 'Lead with code, explain after. If the answer is a function, show it first.';
  if (failure === 'compile-error') return 'Run syntax check before presenting code. For TypeScript: tsc --noEmit first.';
  if (failure === 'infinite-loop') return 'If same error appears twice, change strategy. Do not repeat same fix.';

  if (verboseRatio > 0.5) return 'Too many verbose responses. Lead with code or concrete answer, follow with explanation.';
  if (intent === 'fix-bug') return 'For bug fixes: state root cause first, then show minimal fix. No refactoring unless asked.';
  if (intent === 'build-feature') return 'For new features: confirm requirements → plan → code. Show one working thing before expanding.';

  return 'Continue current approach — session had no clear failure pattern.';
}

function buildAggregateRecommendation(
  topFailures: Array<{ pattern: FailurePattern; count: number; pct: number }>,
  avgConcreteRatio: number,
): string {
  if (topFailures.length === 0 && avgConcreteRatio > 0.7) {
    return 'Sessions look healthy — most responses are concrete and failures are low.';
  }
  if (topFailures[0]?.pattern === 'verbose-no-code' || avgConcreteRatio < 0.4) {
    return `PRIORITY FIX: ${Math.round((1 - avgConcreteRatio) * 100)}% of AI responses lack concrete code/commands. Train on code-first response style.`;
  }
  if (topFailures[0]?.pattern === 'context-drop') {
    return 'PRIORITY FIX: Context drop is the #1 failure. Improve conversation summarization and re-injection at session start.';
  }
  if (topFailures[0]?.pattern === 'missed-requirement') {
    return 'PRIORITY FIX: AI regularly misses parts of requests. Add requirement extraction step before any coding response.';
  }
  if (topFailures[0]) {
    return `Top failure: "${topFailures[0].pattern}" (${topFailures[0].pct}% of sessions). Address this pattern first.`;
  }
  return `Concrete response ratio: ${Math.round(avgConcreteRatio * 100)}%. Target > 70%.`;
}

// Singleton
let _analyzer: SessionAnalyzer | null = null;
export function getSessionAnalyzer(): SessionAnalyzer {
  if (!_analyzer) _analyzer = new SessionAnalyzer();
  return _analyzer;
}
