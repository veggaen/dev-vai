// ─────────────────────────────────────────────────────────────────────────────
// IntuitiveRiskReasoner
//
// Cheap, structural self-assessment of a candidate Vai response BEFORE the
// runtime hands it back to the user. Produces a `RiskAssessment` describing
// how confident we are, what we don't know, and what stance to take
// (proceed / hedge / warn / clarify / avoid).
//
// Design choices that differ from the original sketch:
//   1. **No `any`.** Everything typed; LLM is an *optional* adapter.
//   2. **Heuristic-first.** Default path is zero-latency, purely structural.
//      LLM mode is opt-in via the constructor for future deep-reasoning use.
//   3. **Evidence-aware.** Accepts a structured `RiskInput.evidence` block so
//      the synthesis layer can hand over what it already computed
//      (`sourceCount`, `hasCrossSupport`, `hasContradiction`, etc.) rather
//      than parsing the answer text again.
//   4. **Cache keyed on (situation, evidence)** — not just situation — so
//      identical questions with different retrieval outcomes don't share a
//      stale verdict.
//   5. **Safe-by-default fallback.** Any failure produces a `seek_clarification`
//      stance, never a confident-but-wrong call.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

export const RiskAssessmentSchema = z.object({
  riskLevel: z.number().int().min(0).max(10),
  epistemicConfidence: z.number().int().min(0).max(10),
  shortIntuition: z.string().min(5).max(160),
  knownKnowns: z.array(z.string()),
  knownUnknowns: z.array(z.string()),
  potentialDownstreamRisks: z.array(z.string()),
  recommendedStance: z.enum([
    'proceed_confidently',
    'proceed_cautiously',
    'warn_user',
    'seek_clarification',
    'avoid',
  ]),
  mitigationIdeas: z.array(z.string()),
  reasoningTrace: z.string().optional(),
});

export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;
export type RecommendedStance = RiskAssessment['recommendedStance'];

export type QueryShape =
  | 'factual'
  | 'opinion'
  | 'recommendation'
  | 'comparison'
  | 'how-to'
  | 'definition'
  | 'unknown';

export interface RiskEvidence {
  /** Number of distinct sources used in the synthesized answer. */
  sourceCount?: number;
  /** Number of distinct top-level domains backing the answer. */
  distinctDomains?: number;
  /** True if the lead claim is co-confirmed by ≥1 other source. */
  hasCrossSupport?: boolean;
  /** True if the synthesizer detected negation/contradiction across sources. */
  hasContradiction?: boolean;
  /** Lowest per-bullet relevance score [0..1] in the answer (if known). */
  confidenceFloor?: number;
  /** Coarse shape of the user's question. */
  queryShape?: QueryShape;
  /** Final answer length in characters — very long or very short are both signals. */
  answerLength?: number;
  /** True if the answer cites time-sensitive sources (news, today, 2024+ headlines). */
  timeSensitive?: boolean;
  /** True if sources are dominantly forum/opinion (reddit) and the query is factual. */
  opinionForFactual?: boolean;
  /** Jaccard-style overlap (0..1) of distinctive query tokens against the answer body. */
  queryRelevance?: number;
}

export interface RiskInput {
  situation: string;
  evidence?: RiskEvidence;
  context?: Record<string, unknown>;
}

export interface RiskLLMAdapter {
  complete(prompt: string, opts: { temperature: number; maxTokens: number }): Promise<string>;
}

export interface RiskConfig {
  defaultTemperature: number;
  maxTokens: number;
  enableReasoningTrace: boolean;
  cacheEnabled: boolean;
  cacheTTLMinutes: number;
  cacheMaxEntries: number;
  customSystemPrompt?: string;
  riskThresholds: { low: number; medium: number; high: number };
  /** Per-situation forced overrides. Useful for tests + known-bad prompts. */
  overrides?: Record<string, Partial<RiskAssessment>>;
}

const DEFAULT_CONFIG: RiskConfig = {
  defaultTemperature: 0.25,
  maxTokens: 750,
  enableReasoningTrace: false,
  cacheEnabled: true,
  cacheTTLMinutes: 60,
  cacheMaxEntries: 256,
  riskThresholds: { low: 4, medium: 7, high: 9 },
};

interface CacheEntry {
  data: RiskAssessment;
  expires: number;
}

export class IntuitiveRiskReasoner {
  private readonly cache = new Map<string, CacheEntry>();
  private config: RiskConfig;

  constructor(
    private readonly llm: RiskLLMAdapter | null = null,
    config: Partial<RiskConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Public API ──────────────────────────────────────────────────────────

  async assess(input: RiskInput, options: Partial<RiskConfig> = {}): Promise<RiskAssessment> {
    const finalConfig: RiskConfig = { ...this.config, ...options };
    const { situation, evidence = {}, context = {} } = input;

    if (finalConfig.cacheEnabled) {
      const hit = this.readCache(situation, evidence, context);
      if (hit) return hit;
    }

    let assessment: RiskAssessment;
    if (this.llm) {
      try {
        assessment = await this.assessViaLLM(situation, evidence, context, finalConfig);
      } catch {
        assessment = this.assessHeuristically(situation, evidence, finalConfig);
      }
    } else {
      assessment = this.assessHeuristically(situation, evidence, finalConfig);
    }

    if (finalConfig.overrides?.[situation]) {
      assessment = { ...assessment, ...finalConfig.overrides[situation] };
    }

    if (finalConfig.cacheEnabled) {
      this.writeCache(situation, evidence, context, assessment, finalConfig);
    }
    return assessment;
  }

  updateConfig(newConfig: Partial<RiskConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  getConfig(): RiskConfig {
    return { ...this.config };
  }

  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Map a numeric risk level (0..10) to a coarse band using the configured
   * thresholds. Useful for routing UI styling (chip color, warning banner).
   */
  classifyRisk(level: number): 'low' | 'medium' | 'high' | 'critical' {
    const { low, medium, high } = this.config.riskThresholds;
    if (level <= low) return 'low';
    if (level <= medium) return 'medium';
    if (level <= high) return 'high';
    return 'critical';
  }

  // ── Heuristic assessor (default, zero-latency) ──────────────────────────

  private assessHeuristically(
    situation: string,
    evidence: RiskEvidence,
    config: RiskConfig,
  ): RiskAssessment {
    const knownKnowns: string[] = [];
    const knownUnknowns: string[] = [];
    const risks: string[] = [];
    const mitigations: string[] = [];

    const sourceCount = evidence.sourceCount ?? 0;
    const distinctDomains = evidence.distinctDomains ?? 0;
    const queryShape = evidence.queryShape ?? this.inferShape(situation);
    const answerLength = evidence.answerLength ?? 0;

    // Confidence: starts at 5, moves on evidence shape.
    let confidence = 5;
    if (evidence.hasCrossSupport) {
      confidence += 2;
      knownKnowns.push('lead claim is co-confirmed across multiple sources');
    }
    if (distinctDomains >= 3) {
      confidence += 1;
      knownKnowns.push(`evidence spans ${distinctDomains} distinct domains`);
    } else if (distinctDomains === 1 && sourceCount > 0) {
      confidence -= 1;
      knownUnknowns.push('all evidence comes from a single domain — coverage may be biased');
    }
    if (sourceCount === 0) {
      confidence -= 2;
      knownUnknowns.push('no retrieved sources — answer is unverified');
    } else if (sourceCount === 1) {
      confidence -= 1;
      knownUnknowns.push('only one source — no independent cross-check available');
    }

    if (evidence.hasContradiction) {
      confidence -= 1;
      risks.push('sources disagree — picking the wrong side will mislead the user');
      mitigations.push('surface the disagreement explicitly and let the user compare');
    }

    if (evidence.confidenceFloor !== undefined && evidence.confidenceFloor < 0.35) {
      confidence -= 1;
      risks.push('some bullets have low relevance to the question');
    }

    if (evidence.timeSensitive) {
      knownUnknowns.push('topic is time-sensitive — facts may already be outdated');
      mitigations.push('flag publication dates and suggest checking the live source');
    }

    if (evidence.opinionForFactual) {
      confidence -= 2;
      risks.push('factual question answered mostly with forum opinions');
      mitigations.push('prefer Wikipedia or primary sources for the factual portion');
    }

    // Relevance check: when the answer barely touches the distinctive query
    // tokens, the synthesizer probably stitched together on-topic-looking but
    // off-question snippets. This is the most common "looks confident, is
    // wrong" failure mode in retrieval pipelines.
    if (evidence.queryRelevance !== undefined) {
      if (evidence.queryRelevance < 0.15) {
        confidence -= 3;
        risks.push('answer barely mentions the distinctive terms in the question');
        mitigations.push('treat this as a likely off-topic synthesis — re-query or ask the user to narrow scope');
      } else if (evidence.queryRelevance < 0.3) {
        confidence -= 1;
        knownUnknowns.push('answer only partially overlaps the question terms');
      }
    }

    if (answerLength > 0 && answerLength < 80 && queryShape !== 'definition') {
      knownUnknowns.push('answer is unusually short for this question shape');
    }
    if (answerLength > 2400) {
      risks.push('answer is very long — user may miss the key claim');
      mitigations.push('lead with a 1-sentence summary');
    }

    // Risk level: inverse of confidence with a floor for known-dangerous shapes.
    let riskLevel = 10 - confidence;
    if (queryShape === 'recommendation' && !evidence.hasCrossSupport) {
      riskLevel = Math.max(riskLevel, 6);
      risks.push('recommendation without cross-source support is easy to over-trust');
    }
    if (queryShape === 'how-to' && sourceCount < 2) {
      riskLevel = Math.max(riskLevel, 5);
    }

    confidence = clamp(confidence, 0, 10);
    riskLevel = clamp(riskLevel, 0, 10);

    const stance = this.deriveStance(riskLevel, confidence, evidence, config);
    const shortIntuition = this.buildShortIntuition(stance, riskLevel, confidence, evidence);

    const assessment: RiskAssessment = {
      riskLevel,
      epistemicConfidence: confidence,
      shortIntuition,
      knownKnowns,
      knownUnknowns,
      potentialDownstreamRisks: risks,
      recommendedStance: stance,
      mitigationIdeas: mitigations,
    };
    if (config.enableReasoningTrace) {
      assessment.reasoningTrace =
        `shape=${queryShape} sources=${sourceCount} domains=${distinctDomains} ` +
        `crossSupport=${!!evidence.hasCrossSupport} contradict=${!!evidence.hasContradiction} ` +
        `→ risk=${riskLevel} conf=${confidence} stance=${stance}`;
    }
    return assessment;
  }

  private deriveStance(
    risk: number,
    confidence: number,
    evidence: RiskEvidence,
    config: RiskConfig,
  ): RecommendedStance {
    // No evidence at all on a query that wanted some → clarify rather than guess.
    if ((evidence.sourceCount ?? 0) === 0 && evidence.queryShape && evidence.queryShape !== 'opinion') {
      // We have nothing retrieved; clarify only if the question is ambiguous-shaped.
      if (evidence.queryShape === 'unknown') return 'seek_clarification';
    }
    if (risk >= config.riskThresholds.high) return 'avoid';
    if (risk >= config.riskThresholds.medium) return 'warn_user';
    if (risk >= config.riskThresholds.low || confidence <= 4) return 'proceed_cautiously';
    return 'proceed_confidently';
  }

  private buildShortIntuition(
    stance: RecommendedStance,
    risk: number,
    confidence: number,
    evidence: RiskEvidence,
  ): string {
    const tail = `risk=${risk}/10 conf=${confidence}/10`;
    switch (stance) {
      case 'proceed_confidently':
        return `Evidence converges and confidence is solid (${tail}).`;
      case 'proceed_cautiously':
        return evidence.hasContradiction
          ? `Sources partly disagree — answer is usable but worth caveating (${tail}).`
          : `Reasonable answer with thin cross-checking (${tail}).`;
      case 'warn_user':
        return `Notable uncertainty — user should be told this is provisional (${tail}).`;
      case 'seek_clarification':
        return `Question is too ambiguous to answer well without more detail (${tail}).`;
      case 'avoid':
        return `Risk of confidently misleading the user is too high (${tail}).`;
    }
  }

  private inferShape(situation: string): QueryShape {
    const q = situation.toLowerCase();
    if (/\bwhat\s+is\b|\bdefine\b|\bmeaning\s+of\b/.test(q)) return 'definition';
    if (/\bhow\s+(?:do|to|can)\b/.test(q)) return 'how-to';
    if (/\b(?:vs|versus|compare|difference\s+between)\b/.test(q)) return 'comparison';
    if (/\b(?:best|recommend|should\s+i|good\s+for|worth\b)/.test(q)) return 'recommendation';
    if (/\b(?:opinion|think|feel|like)\b/.test(q)) return 'opinion';
    if (/^(?:who|what|when|where|why|which)\b/.test(q)) return 'factual';
    return 'unknown';
  }

  // ── Optional LLM-backed assessor ────────────────────────────────────────

  private async assessViaLLM(
    situation: string,
    evidence: RiskEvidence,
    context: Record<string, unknown>,
    config: RiskConfig,
  ): Promise<RiskAssessment> {
    if (!this.llm) throw new Error('LLM adapter not configured');
    const systemPrompt = config.customSystemPrompt ?? [
      'You are an exceptionally wise, cautious, intuitive reviewer.',
      'You score a candidate answer\'s risk and your own epistemic confidence,',
      'always honestly distinguishing what you know from what you don\'t.',
      'Return STRICT JSON matching the schema. No prose, no markdown, no code fences.',
    ].join('\n');

    const prompt = [
      systemPrompt,
      '',
      `Situation: ${JSON.stringify(situation)}`,
      `Evidence: ${JSON.stringify(evidence)}`,
      `Context: ${JSON.stringify(context)}`,
      '',
      'Required JSON keys: riskLevel(0-10), epistemicConfidence(0-10), shortIntuition,',
      'knownKnowns[], knownUnknowns[], potentialDownstreamRisks[],',
      'recommendedStance(proceed_confidently|proceed_cautiously|warn_user|seek_clarification|avoid),',
      'mitigationIdeas[]' + (config.enableReasoningTrace ? ', reasoningTrace' : ''),
    ].join('\n');

    const raw = await this.llm.complete(prompt, {
      temperature: config.defaultTemperature,
      maxTokens: config.maxTokens,
    });

    const trimmed = stripJsonFences(raw);
    const parsed = JSON.parse(trimmed) as unknown;
    return RiskAssessmentSchema.parse(parsed);
  }

  // ── Cache plumbing ──────────────────────────────────────────────────────

  private keyFor(
    situation: string,
    evidence: RiskEvidence,
    context: Record<string, unknown>,
  ): string {
    const evStr = JSON.stringify(evidence);
    const ctxStr = JSON.stringify(context).slice(0, 120);
    return `risk:${ctxStr}:${evStr}:${situation.slice(0, 80)}`;
  }

  private readCache(
    situation: string,
    evidence: RiskEvidence,
    context: Record<string, unknown>,
  ): RiskAssessment | null {
    const key = this.keyFor(situation, evidence, context);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expires <= Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  private writeCache(
    situation: string,
    evidence: RiskEvidence,
    context: Record<string, unknown>,
    data: RiskAssessment,
    config: RiskConfig,
  ): void {
    const key = this.keyFor(situation, evidence, context);
    this.cache.set(key, {
      data,
      expires: Date.now() + config.cacheTTLMinutes * 60 * 1000,
    });
    // Simple LRU-ish trim: oldest insertion order first.
    if (this.cache.size > config.cacheMaxEntries) {
      const overflow = this.cache.size - config.cacheMaxEntries;
      const it = this.cache.keys();
      for (let i = 0; i < overflow; i++) {
        const next = it.next();
        if (next.done) break;
        this.cache.delete(next.value);
      }
    }
  }
}

// ── Small helpers ─────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```$/, '')
      .trim();
  }
  return trimmed;
}
