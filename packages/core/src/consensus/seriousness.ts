/**
 * Seriousness gate — decides whether (and how deeply) to convene the council, and
 * applies the council's own governance rules to a consensus.
 *
 * These rules were designed *with* the council: on June 2026 the live Qwen council
 * was asked how the council should behave and advised —
 *   - "Engage the full council only if confidence < 0.8 or the message is high-stakes."
 *   - "Tiered authority: minor calls are Vai's; major ones need council consensus."
 *   - "Sensitive topics (medical/legal/financial/safety): always clarify before answering."
 *   - "Weight a member's vote higher in its specialty."
 * (See docs/RECIPROCITY.md — Vai helped design its own governance.)
 */

import type {
  CouncilConsensus,
  CouncilPlan,
  SeriousnessAssessment,
  SeriousnessTier,
} from './types.js';

/** Confidence at/above which a trivial turn needs no council (council's 0.8 rule). */
export const COUNCIL_CONFIDENCE_FLOOR = 0.8;

const TRIVIAL_PATTERN =
  /^\s*(?:hi|hey+|hello|yo|sup|thanks?|thank\s+you|ty|np|lol|haha|ok(?:ay)?|k|cool|nice|great|gotcha|got\s+it|good\s?(?:morning|night|evening|day)|cheers|bye)\b[\s!.?]*$/i;

const SENSITIVE_PATTERN =
  /\b(?:medical|medication|dose|dosage|symptom|diagnos\w*|prescri\w+|cancer|depress\w*|suicid\w*|self[\s-]?harm|overdose|legal|lawsuit|lawyer|attorney|court|custody|immigration\s+status|tax(?:es)?|invest(?:ing|ment)?|mortgage|life\s+savings|bankrupt\w*|emergency|911|poison|allergic\s+reaction|abuse|assault)\b/i;

const HIGH_STAKES_PATTERN =
  /\b(?:urgent|asap|emergency|deadline|contract|sign(?:ing)?\s+(?:a|the)\s+(?:deal|contract|lease)|irreversible|cannot\s+undo|production\s+(?:down|outage)|data\s+loss|delete\s+everything)\b/i;

/** Classify how consequential a message is — drives council depth and caution. */
export function assessSeriousness(input: string): SeriousnessAssessment {
  const text = (input ?? '').trim();
  if (!text) return { tier: 'trivial', sensitive: false, reasons: ['empty input'] };

  const reasons: string[] = [];
  const sensitive = SENSITIVE_PATTERN.test(text);
  if (sensitive) reasons.push('sensitive domain (medical / legal / financial / safety)');

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  let tier: SeriousnessTier;
  if (sensitive || HIGH_STAKES_PATTERN.test(text)) {
    tier = 'high';
    if (!sensitive) reasons.push('high-stakes wording');
  } else if (TRIVIAL_PATTERN.test(text) || (wordCount <= 3 && !text.includes('?'))) {
    tier = 'trivial';
    reasons.push('short / conversational');
  } else {
    tier = 'standard';
    reasons.push('substantive question');
  }
  return { tier, sensitive, reasons };
}

/**
 * Decide whether to convene the council and how deeply, per the council's own rule:
 * skip a trivial turn that Vai is already confident about; otherwise convene — fully
 * when stakes are high or Vai is unsure (draft confidence < 0.8), lightly otherwise.
 */
export function councilPlan(input: string, draftConfidence?: number): CouncilPlan {
  const assessment = assessSeriousness(input);
  const conf = draftConfidence ?? 1;

  if (assessment.tier === 'trivial' && conf >= COUNCIL_CONFIDENCE_FLOOR && !assessment.sensitive) {
    return { convene: false, depth: 'skip', assessment, reason: 'trivial turn; Vai is confident' };
  }

  const lowConfidence = conf < COUNCIL_CONFIDENCE_FLOOR;
  const full = assessment.tier === 'high' || lowConfidence;
  return {
    convene: true,
    depth: full ? 'full' : 'light',
    assessment,
    reason: assessment.tier === 'high'
      ? 'high-stakes question'
      : lowConfidence
        ? 'Vai is not confident in its draft'
        : 'standard quality check',
  };
}

/**
 * Apply the council's governance rules to a consensus, given the turn's stakes:
 *   - Sensitive: clarify before answering — never blind-search a sensitive ask.
 *   - High-stakes + only-borderline-confident "ship": escalate for a second look.
 * Pure; returns a new consensus.
 */
export function governConsensus(
  consensus: CouncilConsensus,
  assessment: SeriousnessAssessment,
): CouncilConsensus {
  let { outcome, recommendedAction, summary } = consensus;

  if (assessment.sensitive) {
    const wouldSearchOrShip =
      outcome === 'ship' || recommendedAction === 'web-search' || recommendedAction === 'local-business-search';
    if (wouldSearchOrShip) {
      outcome = 'act';
      recommendedAction = 'ask-one-question';
      summary = `${summary} Sensitive topic — confirm intent before answering.`;
    }
  }

  if (assessment.tier === 'high' && outcome === 'ship' && consensus.confidence < 0.7) {
    outcome = 'escalate';
    summary = `${summary} High-stakes — escalating for a second look.`;
  }

  if (outcome === consensus.outcome && recommendedAction === consensus.recommendedAction) {
    return consensus; // unchanged
  }
  return { ...consensus, outcome, recommendedAction, summary };
}
