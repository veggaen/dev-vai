/**
 * Post-generation verification + sanitization arm (Master.md §12.5.3).
 *
 * §12.5.3 requires that generative output pass back through the deterministic
 * layer for verification and sanitization *before it reaches the user*. The
 * decline detector in `vai-fallback.ts` only gates the **entrance** to
 * escalation (should we promote vai:v0 → external?). This module gates the
 * **exit** of every generative arm — the part that was previously missing:
 *
 *   1. Sanitize scratch / template / continuation scaffolding and off-topic
 *      retrieval-drift lines that should never reach the user.
 *   2. Re-check the *produced* text for a decline shape the entrance gate
 *      missed (covers the local-only config where no fallback model exists, and
 *      the rare case where the fallback model itself declines).
 *   3. Calibrate confident-but-thin output instead of presenting low-confidence
 *      reasoning, or an unsupported factual assertion, as certainty
 *      (consistent with §6.4 epistemic transparency and §6.6 truth > polish).
 *
 * Design constraints (Thorsen doctrine):
 *   - Pure + side-effect-free so every generative arm routes through the *same*
 *     verifier (no per-arm reimplementation) and so it is trivially testable.
 *   - Configurable thresholds + pattern sets (§4.5 good defaults, tunable) —
 *     not a fresh hard-coded smell list. The default leak patterns are the
 *     exact scaffolding smells the bulk-wave analyzer already tags
 *     (`scripts/lib/vai-wave-core.mjs` → `template_leak` /
 *     `off_topic_retrieval_drift`), so detection stays in one conceptual place.
 *   - Conservative: it must never rewrite or suppress a genuine answer. Every
 *     transform is line-scoped and every escalation/ calibration decision is
 *     gated so precision stays high.
 */

import { looksLikeDecline, detectAnswerTopicMismatch } from './vai-fallback.js';

export type VerificationAction = 'pass' | 'sanitize' | 'calibrate' | 'decline';

/**
 * Typed-grounding classification (GSAR-style, arXiv 2604.23366): every produced
 * answer is one of grounded / ungrounded / contradicted / complementary. This is
 * the structural lens the fallback (local-model) arm needs — a local model has no
 * retrieval, so its confident factual claims are *ungrounded* by construction,
 * and an answer about a different subject than the prompt asked is *contradicted*.
 */
export type VerificationGrounding = 'grounded' | 'ungrounded' | 'contradicted' | 'complementary';

/**
 * Scaffolding / drift lines that must never surface. Mirrors the smells the
 * bulk-wave analyzer tags so the harness and the live arm agree on what "leak"
 * means. Line-scoped: a matching *line* is dropped, never the whole answer.
 */
export const DEFAULT_LEAK_PATTERNS: readonly RegExp[] = [
  /grounded continuation|deeper grounded pass|thinking out loud|\[scratch\]|continuing from|answer the next turn this way|relevant context is|mini-brief/i,
  /\bscratch\s*:/i,
  /slash symbol|slash fiction|femslash|learn how and when to remove this message/i,
];

/**
 * Confidence at/above this floor would NOT have escalated through the decline
 * detector, yet may still be "thin" enough to deserve a calibration note. Kept
 * in sync conceptually with `VAI_FALLBACK_CONFIDENCE_THRESHOLD` (0.4): below the
 * floor the entrance gate already escalates; this band sits just above it.
 */
export const VERIFICATION_CALIBRATE_CEILING = 0.55;

/** Default honest hedge prepended when a turn is calibrated. */
export const DEFAULT_CALIBRATION_NOTE =
  'Calibrated take (lower confidence on this topic):';

const CALIBRATION_PREAMBLE =
  /^\s*Calibrated take \(lower confidence on this topic\):\s*/i;

export interface ResponseVerificationConfig {
  /** Override the scaffolding/drift line patterns. Defaults to {@link DEFAULT_LEAK_PATTERNS}. */
  readonly leakPatterns?: readonly RegExp[];
  /** Operator-supplied extra decline markers (shared with the fallback detector, e.g. localized phrasings). */
  readonly extraDeclineMarkers?: readonly string[];
  /** Upper bound of the "thin but not a decline" confidence band. Defaults to {@link VERIFICATION_CALIBRATE_CEILING}. */
  readonly calibrateCeiling?: number;
  /** Confidence below this is treated as already-escalated (no calibration note added). Defaults to 0.4. */
  readonly declineFloor?: number;
  /**
   * When true, a confident factual assertion with NO supporting evidence is
   * down-graded to a calibration (closes the "confident-wrong bypasses
   * escalation" gap, §8 Confident Bullshitter). Off by default: it needs the
   * evidence signal wired through and a precision check before going global.
   */
  readonly requireEvidenceForFactualClaims?: boolean;
  /** Calibration note text. Defaults to {@link DEFAULT_CALIBRATION_NOTE}. */
  readonly calibrationNote?: string;
}

export interface ResponseVerificationInput {
  /** Full produced text of the generative arm (after the stream completes). */
  readonly text: string;
  /** Confidence emitted on the most recent `sources` chunk, if any. */
  readonly confidence?: number;
  /** Whether any retrieved evidence / sources backed this turn. */
  readonly hasEvidence?: boolean;
  /** Original user prompt — enables the `contradicted` (answers-a-different-subject) classification. */
  readonly prompt?: string;
  /** Which generative arm produced the text. `fallback` is the escalated local model. */
  readonly arm?: 'primary' | 'fallback' | 'plain';
  readonly config?: ResponseVerificationConfig;
}

export interface ResponseVerificationVerdict {
  readonly action: VerificationAction;
  /** Typed-grounding classification of the produced text. */
  readonly grounding: VerificationGrounding;
  /** Sanitized text to surface + persist (leak lines removed; calibration note NOT inlined). */
  readonly text: string;
  /** True when `text` differs from the input (leak lines were stripped). */
  readonly changed: boolean;
  /** Traceable reasons for the verdict (e.g. `leak-stripped`, `post-hoc-decline`, `thin-confidence`). */
  readonly reasons: readonly string[];
  /** Present when `action === 'calibrate'`: the honest hedge to prepend. */
  readonly calibrationNote?: string;
}

/** Classify the produced text into the typed-grounding taxonomy from available structural signals. */
export function classifyGrounding(input: ResponseVerificationInput, text: string): VerificationGrounding {
  if (detectAnswerTopicMismatch(input.prompt, text)) return 'contradicted';
  const confident = looksLikeConfidentFactualClaim(text);
  if (confident && input.hasEvidence === false) return 'ungrounded';
  if (input.hasEvidence === true || confident) return 'grounded';
  return 'complementary';
}

const HEDGE_PATTERN =
  /\b(?:might|maybe|probably|i think|i believe|as far as i know|not (?:entirely )?sure|uncertain|likely|approximately|roughly|i'?m not certain|could be)\b/i;

/**
 * A confident factual *assertion* — a yes/no verdict or an "X is Y" / "the
 * answer is …" claim — with no hedging. Deliberately narrow: we only flag clear
 * assertions so we never calibrate a genuinely tentative or conversational
 * reply.
 */
export function looksLikeConfidentFactualClaim(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return trimmed.split(/(?<=[.!?])\s+/).some((sentence) => {
    if (HEDGE_PATTERN.test(sentence)) return false;
    if (/^\s*(?:yes|no)\b/i.test(sentence)) return true;
    return /\b(?:the answer is|it is|that is|this is|is the|are the|equals|the capital of|was founded|is located|is a|is the largest|is|are|was|were|handles?|uses?|supports?|provides?|allows?|favo(?:u)?rs?|differs?|manages?|includes?|relies?|consists?)\b/i.test(
      sentence,
    );
  });
}

/* ── Script/language consistency (T3 class of failures) ───────────────────
 * Small local models can drift into another writing system mid-answer (e.g.
 * Chinese sentences spliced into a Norwegian reply) and then narrate their own
 * translation. The prompt's writing system is the contract: an answer may only
 * use scripts the prompt used — unless the prompt explicitly asked for another
 * language. Conservative by construction:
 *   - only entire runs of a *leaked* script are stripped (never Latin text),
 *   - fenced code blocks are left untouched (string literals may legitimately
 *     contain any script),
 *   - a small threshold avoids flagging a single quoted glyph.
 */

const SCRIPT_DETECTORS: ReadonlyArray<{ readonly name: string; readonly chars: RegExp; readonly run: RegExp }> = [
  // CJK ideographs + kana + hangul + CJK punctuation/fullwidth forms
  { name: 'cjk', chars: /[\u2e80-\u9fff\u3040-\u30ff\uac00-\ud7af\uff00-\uffef]/, run: /[\u2e80-\u9fff\u3040-\u30ff\uac00-\ud7af\uff00-\uffef\u3000-\u303f]+/g },
  { name: 'cyrillic', chars: /[\u0400-\u04ff]/, run: /[\u0400-\u04ff]+/g },
  { name: 'arabic', chars: /[\u0600-\u06ff]/, run: /[\u0600-\u06ff]+/g },
];

/** Prompt explicitly asks for / about another language → mismatch is legitimate. */
const LANGUAGE_REQUEST_PATTERN =
  /\b(?:translat\w*|oversett\w*|chinese|mandarin|cantonese|japanese|korean|hanzi|kanji|hangul|kinesisk|japansk|koreansk|russian|russisk|ukrainian|cyrillic|kyrillisk|arabic|arabisk|farsi|persian|urdu)\b|[\u2e80-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff]/i;

const MIN_FOREIGN_CHARS = 6;

/**
 * Strip runs of writing systems the prompt never used (outside code fences).
 * Returns the cleaned text plus which scripts leaked.
 */
export function sanitizeForeignScript(
  text: string,
  prompt: string | undefined,
): { text: string; leakedScripts: string[] } {
  if (!text || !prompt || LANGUAGE_REQUEST_PATTERN.test(prompt)) {
    return { text, leakedScripts: [] };
  }

  const leakedScripts: string[] = [];
  // Split out fenced code blocks so we only clean prose segments.
  const segments = text.split(/(```[\s\S]*?(?:```|$))/);
  let cleaned = '';
  for (const segment of segments) {
    if (segment.startsWith('```')) {
      cleaned += segment;
      continue;
    }
    let prose = segment;
    for (const script of SCRIPT_DETECTORS) {
      const matches = prose.match(script.run);
      if (!matches) continue;
      const leakedCount = matches.join('').length;
      if (leakedCount < MIN_FOREIGN_CHARS) continue;
      if (!leakedScripts.includes(script.name)) leakedScripts.push(script.name);
      prose = prose.replace(script.run, ' ');
    }
    cleaned += prose;
  }

  if (leakedScripts.length === 0) return { text, leakedScripts };
  const tidied = cleaned
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: tidied, leakedScripts };
}

/** Strip scaffolding/drift lines. Line-scoped so a genuine answer is never gutted. */
export function sanitizeLeakage(
  text: string,
  patterns: readonly RegExp[] = DEFAULT_LEAK_PATTERNS,
): { text: string; removed: number } {
  if (!text) return { text, removed: 0 };
  const lines = text.split(/\r?\n/);
  let removed = 0;
  const kept = lines.filter((line) => {
    const isLeak = line.trim().length > 0 && patterns.some((re) => re.test(line));
    if (isLeak) removed += 1;
    return !isLeak;
  });
  if (removed === 0) return { text, removed: 0 };
  // Collapse the blank gaps left by removed lines so output stays tidy.
  const cleaned = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: cleaned, removed };
}

/**
 * Run the deterministic verification arm over a generative turn's final text.
 * Returns the sanitized text plus a calibrated, traceable verdict.
 */
export function verifyResponse(input: ResponseVerificationInput): ResponseVerificationVerdict {
  const config = input.config ?? {};
  const declineFloor = config.declineFloor ?? 0.4;
  const calibrateCeiling = config.calibrateCeiling ?? VERIFICATION_CALIBRATE_CEILING;
  const reasons: string[] = [];

  const original = input.text ?? '';
  const { text: scriptSanitized, leakedScripts } = sanitizeForeignScript(original, input.prompt);
  if (leakedScripts.length > 0) reasons.push(`foreign-script-stripped:${leakedScripts.join('+')}`);
  const { text: leakSanitized, removed } = sanitizeLeakage(scriptSanitized, config.leakPatterns);
  if (removed > 0) reasons.push(`leak-stripped:${removed}`);
  const hadCalibrationPreamble = CALIBRATION_PREAMBLE.test(leakSanitized);
  const sanitized = hadCalibrationPreamble
    ? leakSanitized.replace(CALIBRATION_PREAMBLE, '').trim()
    : leakSanitized;
  if (hadCalibrationPreamble) reasons.push('calibration-moved-to-metadata');
  const changed = sanitized !== original;
  const note = config.calibrationNote ?? DEFAULT_CALIBRATION_NOTE;
  const calibrate = (grounding: VerificationGrounding): ResponseVerificationVerdict => ({
    action: 'calibrate', grounding, text: sanitized, changed, reasons, calibrationNote: note,
  });

  // 1. Exit decline re-check: the produced text itself is a decline the
  //    entrance gate didn't catch (novel wording, or fallback model declined).
  if (sanitized && looksLikeDecline(sanitized, config.extraDeclineMarkers)) {
    reasons.push('post-hoc-decline');
    return { action: 'decline', grounding: 'ungrounded', text: sanitized, changed, reasons };
  }

  const grounding = classifyGrounding({ ...input, text: sanitized }, sanitized);
  const confidence = input.confidence;

  // 2. Contradicted: the answer is about a different subject than the prompt
  //    asked (article-hijack). On the terminal fallback arm there is nothing
  //    further to escalate to, so surface it honestly calibrated.
  if (grounding === 'contradicted') {
    reasons.push('contradicted-topic');
    return calibrate('contradicted');
  }

  // 3. Script drift: the model wandered into a writing system the prompt never
  //    used (translation babble spliced into the answer). The leaked runs are
  //    already stripped; what remains is surfaced with an honest hedge because
  //    the turn demonstrably lost language coherence.
  if (leakedScripts.length > 0) {
    reasons.push('script-mismatch');
    return calibrate(grounding);
  }

  // 4. Ungrounded: a confident factual assertion with zero supporting evidence
  //    (the local model has no retrieval). Opt-in so the primary arm does not
  //    over-hedge; the fallback arm enables it (see service wiring).
  const evidenceGap =
    config.requireEvidenceForFactualClaims === true &&
    grounding === 'ungrounded' &&
    (confidence === undefined || confidence >= declineFloor);
  if (evidenceGap) {
    reasons.push('unsupported-factual-claim');
    return calibrate('ungrounded');
  }

  // 5. Thin-but-not-declining confidence band → calibrate.
  if (typeof confidence === 'number' && confidence >= declineFloor && confidence < calibrateCeiling) {
    reasons.push(`thin-confidence:${confidence.toFixed(2)}`);
    return calibrate(grounding);
  }

  if (changed) return { action: 'sanitize', grounding, text: sanitized, changed, reasons };
  return { action: 'pass', grounding, text: sanitized, changed: false, reasons };
}
