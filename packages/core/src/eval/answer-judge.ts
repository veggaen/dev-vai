/**
 * answer-judge — a FAIR judge for "Vai's answer vs the model's answer".
 *
 * The problem this fixes (the user's thought #6): today the council — made of LLM members —
 * compares Vai's deterministic draft against an LLM draft and grades with LLM-shaped
 * criteria (fluency, length, "completeness"). Vai's answers are terser and more grounded,
 * which reads as "worse" to an LLM judge even when they're MORE correct. So Vai loses by
 * default, escalates to the model, and no evidence ever accumulates that Vai was right. The
 * judge is also a contestant — it grades its own kind up.
 *
 * This judge is the opposite by construction:
 *   - DETERMINISTIC: no model call. The same two answers always get the same verdict, so it
 *     is reproducible and can drive a learning loop (#7) without drift.
 *   - BLIND: it does not know which answer is Vai's and which is the model's. The caller
 *     passes two candidates; swapping their order must not change the winner (tested).
 *   - EVIDENCE-GROUNDED: the dominant criterion is GROUNDEDNESS, scored from real evidence
 *     bindings (the kernel's `boundEvidence`) — not from prose vibe. A grounded, terse,
 *     correct answer BEATS a fluent ungrounded one. An honest "I don't have that" beats a
 *     confident fabrication.
 *
 * It judges on what actually matters to a power user: is the claim backed? does it answer
 * the asked task? is it free of hallucination markers? — and explicitly does NOT reward
 * length or hedging. This is what lets Vai win on its own terms, which is the precondition
 * for measuring whether Vai is at par (#5) and for internalizing only the model wins that
 * were genuinely better (#3).
 */

/** One answer to be judged, with whatever grounding the producer can attest. */
export interface JudgeCandidate {
  /** Opaque id so the caller can map the winner back WITHOUT the judge seeing roles. */
  readonly id: string;
  /** The answer text. */
  readonly text: string;
  /**
   * Evidence ids this answer's claims are bound to (from a capability's verify()
   * `boundEvidence`, or a citation extractor). Empty = ungrounded. This is the spine of
   * the groundedness score — real bindings, not self-asserted confidence.
   */
  readonly boundEvidence?: readonly string[];
  /** Did the producer's own verify gate pass? (A capability that refused to release = false.) */
  readonly verified?: boolean;
  /** Producer's self-reported confidence — RECORDED but deliberately NOT a scoring input. */
  readonly selfConfidence?: number;
}

export interface JudgeCriterionScore {
  readonly criterion: 'groundedness' | 'taskFit' | 'honesty' | 'directness';
  /** 0..1 for this criterion. */
  readonly score: number;
  readonly note: string;
}

export interface JudgedCandidate {
  readonly id: string;
  /** Folded 0..1 total. */
  readonly total: number;
  readonly criteria: readonly JudgeCriterionScore[];
}

export interface JudgeVerdict {
  /** Winning candidate id, or null on a genuine tie. */
  readonly winnerId: string | null;
  /** True when the two are within `tieEpsilon` — "at par". */
  readonly atPar: boolean;
  /** Both candidates scored, highest first. */
  readonly ranked: readonly JudgedCandidate[];
  /** One-line, human-readable rationale (which criterion decided it). */
  readonly rationale: string;
}

export interface JudgeContext {
  /** The user's question/task — used to score task-fit deterministically. */
  readonly prompt: string;
}

export interface JudgeOptions {
  /** Score difference below which the two are "at par". Default 0.05. */
  readonly tieEpsilon?: number;
  /** Criterion weights. Groundedness dominates by design. */
  readonly weights?: Partial<Record<JudgeCriterionScore['criterion'], number>>;
}

const DEFAULT_WEIGHTS: Record<JudgeCriterionScore['criterion'], number> = {
  groundedness: 0.45, // the product is grounded answers — this leads
  taskFit: 0.3,       // does it actually answer what was asked
  honesty: 0.15,      // an honest "I don't know" beats a confident fabrication
  directness: 0.1,    // answers the question without padding (NOT "longer is better")
};

/** Markers of an ungrounded, hallucination-prone, or evasive answer. */
const FABRICATION_MARKERS = /\b(?:as an ai\b|i think probably|i'?m not sure but|might be|could be around|approximately\b.*\bor so|trust me|i believe it'?s|presumably|i would guess)\b/i;
/** Markers of an HONEST limitation — a good thing, not a failure. */
const HONEST_LIMIT_MARKERS = /\b(?:i don'?t have|no (?:grounded|attached|fresh) (?:evidence|answer|data)|not in my (?:knowledge|memory)|i can'?t verify|unavailable\b|re-?ask|no command was run|no page was observed|no git evidence)\b/i;

function clamp01(n: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Salient content tokens of a string (≥3 chars, de-trivialized). */
function tokens(text: string): Set<string> {
  return new Set(
    (text ?? '')
      .toLowerCase()
      .split(/[^a-z0-9.+#/_-]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}
const STOP = new Set(['the', 'and', 'for', 'what', 'which', 'with', 'this', 'that', 'are', 'was', 'you', 'your', 'how', 'why', 'when', 'does', 'did', 'can', 'will', 'would', 'should', 'about', 'from', 'into', 'have', 'has']);

/** Groundedness: bound-evidence count + verify pass, saturating. Empty bindings → low. */
function scoreGroundedness(c: JudgeCandidate): JudgeCriterionScore {
  const n = c.boundEvidence?.length ?? 0;
  // 0 bindings → 0.0 (unless honestly declining, handled by honesty); 1 → 0.6; 3+ → ~0.9.
  let score = n === 0 ? 0 : n === 1 ? 0.6 : n === 2 ? 0.8 : Math.min(0.95, 0.85 + n * 0.02);
  if (c.verified === true) score = Math.min(1, score + 0.05);
  if (c.verified === false) score = Math.min(score, 0.3); // a refused/failed verify caps it
  return { criterion: 'groundedness', score: clamp01(score), note: `${n} evidence binding(s)${c.verified === true ? ', verify passed' : c.verified === false ? ', verify FAILED' : ''}` };
}

/** Task-fit: overlap of the answer's tokens with the prompt's salient tokens. */
function scoreTaskFit(c: JudgeCandidate, ctx: JudgeContext): JudgeCriterionScore {
  const want = tokens(ctx.prompt);
  if (want.size === 0) return { criterion: 'taskFit', score: 0.5, note: 'no salient prompt tokens' };
  const have = tokens(c.text);
  let hit = 0;
  for (const t of want) if (have.has(t)) hit += 1;
  const score = clamp01(hit / want.size);
  return { criterion: 'taskFit', score, note: `${hit}/${want.size} prompt topics addressed` };
}

/** Honesty: reward an honest limitation; PENALIZE fabrication/hedging markers. */
function scoreHonesty(c: JudgeCandidate): JudgeCriterionScore {
  const text = c.text ?? '';
  const grounded = (c.boundEvidence?.length ?? 0) > 0;
  if (FABRICATION_MARKERS.test(text) && !grounded) {
    return { criterion: 'honesty', score: 0.15, note: 'hedged/fabrication markers without grounding' };
  }
  if (HONEST_LIMIT_MARKERS.test(text) && !grounded) {
    // An honest "I don't have grounded evidence" is GOOD — better than a confident guess.
    return { criterion: 'honesty', score: 0.85, note: 'honest limitation, no fabrication' };
  }
  return { criterion: 'honesty', score: grounded ? 0.9 : 0.6, note: grounded ? 'grounded claim' : 'plain claim' };
}

/**
 * Directness: answers the question without padding. Scored as a soft band, NOT
 * "shorter is always better" — extremely short non-answers and rambling both lose a little;
 * a focused answer wins. Deliberately the SMALLEST weight so it can never override grounding.
 */
function scoreDirectness(c: JudgeCandidate, ctx: JudgeContext): JudgeCriterionScore {
  const len = (c.text ?? '').trim().length;
  if (len === 0) return { criterion: 'directness', score: 0, note: 'empty' };
  // Penalize obvious padding (LLM verbosity) and empty filler; reward focused length.
  const padding = /\b(?:as i mentioned|in conclusion|it'?s worth noting|to summarize|as you can see|in other words|at the end of the day|needless to say)\b/i.test(c.text) ? 0.15 : 0;
  // A focused answer is roughly proportional to prompt complexity; cap the reward so length
  // is never the deciding factor.
  const promptLen = Math.max(40, (ctx.prompt ?? '').length);
  const ratio = len / (promptLen * 8); // ~8x prompt length is "thorough but not padded"
  const focus = ratio <= 1 ? 0.8 + 0.2 * ratio : Math.max(0.4, 1 - (ratio - 1) * 0.3);
  return { criterion: 'directness', score: clamp01(focus - padding), note: padding ? 'contains padding phrases' : 'focused' };
}

function fold(criteria: readonly JudgeCriterionScore[], weights: Record<JudgeCriterionScore['criterion'], number>): number {
  let sum = 0;
  let wsum = 0;
  for (const c of criteria) {
    const w = weights[c.criterion];
    sum += w * c.score;
    wsum += w;
  }
  return wsum > 0 ? clamp01(sum / wsum) : 0;
}

/**
 * Judge two (or more) candidate answers BLIND. The caller does not tell the judge which is
 * Vai's; the judge scores each on groundedness/taskFit/honesty/directness and returns the
 * winner. Deterministic and order-independent (ties broken by id for stability).
 */
export function judgeAnswers(
  candidates: readonly JudgeCandidate[],
  ctx: JudgeContext,
  options: JudgeOptions = {},
): JudgeVerdict {
  const tieEpsilon = options.tieEpsilon ?? 0.05;
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };

  const judged: JudgedCandidate[] = candidates.map((c) => {
    const criteria = [
      scoreGroundedness(c),
      scoreTaskFit(c, ctx),
      scoreHonesty(c),
      scoreDirectness(c, ctx),
    ];
    let total = fold(criteria, weights);
    const text = c.text ?? '';
    const grounded = (c.boundEvidence?.length ?? 0) > 0;
    // Fabrication is a DISQUALIFIER: an ungrounded answer that hedges/invents ("I believe
    // it's", "trust me", "presumably") must lose to an honest "I don't have that". Cap it
    // hard so task-fit keyword-echo can't carry a confident fabrication.
    if (!grounded && FABRICATION_MARKERS.test(text)) {
      total = Math.min(total, 0.2);
    }
    // An honest limitation ("no grounded evidence / re-ask") gets a FLOOR above the
    // fabrication cap, so a truthful "I don't know" always beats a confident guess even
    // when it echoes fewer prompt keywords. Refusing to fabricate is the correct behavior.
    if (!grounded && HONEST_LIMIT_MARKERS.test(text) && !FABRICATION_MARKERS.test(text)) {
      total = Math.max(total, 0.35);
    }
    return { id: c.id, total, criteria };
  });

  // Stable sort: by total desc, then id asc (so order of input never decides a tie).
  const ranked = [...judged].sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));

  if (ranked.length === 0) {
    return { winnerId: null, atPar: true, ranked, rationale: 'no candidates' };
  }
  if (ranked.length === 1) {
    return { winnerId: ranked[0].id, atPar: false, ranked, rationale: 'single candidate' };
  }

  const [top, second] = ranked;
  const atPar = top.total - second.total <= tieEpsilon;
  const decidingCriterion = top.criteria
    .map((c, i) => ({ name: c.criterion, delta: c.score - second.criteria[i].score }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];

  return {
    winnerId: atPar ? null : top.id,
    atPar,
    ranked,
    rationale: atPar
      ? `at par (within ${tieEpsilon}) — no clear winner`
      : `${top.id} wins on ${decidingCriterion.name} (Δ${decidingCriterion.delta.toFixed(2)})`,
  };
}
