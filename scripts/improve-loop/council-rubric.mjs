/**
 * council-rubric — deterministic measurement of the capability council's ROUNDTABLE,
 * and of each capability PROPOSAL it produces. Pure + I/O-free (like motion.mjs /
 * grader.mjs), so it unit-tests without a model or a DB.
 *
 * Two questions the rest of the loop could never answer before:
 *   1. "Does the roundtable actually WORK?" — scoreCouncilProcess() grades a round
 *      on breadth (many angles), convergence (≥2 lenses agreeing), tool-chaining,
 *      delegation (a named smallest next step), grounding (real file evidence), and
 *      actionability (a stated way to verify). This is what makes "improve the
 *      council" a MEASURED objective instead of a wish.
 *   2. "Is THIS proposal worth queuing?" — scoreCapabilityProposal() ranks a feature
 *      idea by goal-fit (north-star keywords), grounding, actionability, scope, and
 *      specificity, so the engine queues the highest-leverage upgrade first.
 */

const clamp = (n, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, n));
const round1 = (n) => Math.round(n * 10) / 10;
const isFileRef = (s) => typeof s === 'string' && /[\w./-]+\.(ts|tsx|mjs|js|md|json)\b|:\d+/.test(s);
const sigWords = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3);

/**
 * True when proposal `p` explicitly builds on a DIFFERENT proposal in the round — its
 * `buildsOn` text references another proposal's title words or area. This is the REAL
 * convergence signal (the roundtable synthesising on itself), distinct from several
 * lenses merely landing in the same area by coincidence. Exported for testability.
 */
export function buildsOnAnother(p, all = []) {
  const refWords = new Set(sigWords(p?.buildsOn));
  if (!refWords.size) return false;
  for (const q of all) {
    if (q === p || !q) continue;
    if (sigWords(q.area).some((w) => refWords.has(w))) return true;
    if (sigWords(q.title).some((w) => refWords.has(w))) return true;
  }
  return false;
}

/** North-star keywords distilled from MASTER_PROMPT.md (voice + interface, any task,
 *  honest escalation) and the loop's own goals. Goal-fit is overlap with these. */
export const GOAL_KEYWORDS = [
  'voice', 'speak', 'audio', 'speech', 'interface', 'image', 'vision', 'multimodal',
  'tool', 'tooling', 'chain', 'delegate', 'delegation', 'orchestrate', 'council',
  'roundtable', 'synthesis', 'reliable', 'trust', 'honest', 'verify', 'task', 'memory',
];

const hits = (text, words) => {
  const t = String(text ?? '').toLowerCase();
  return words.reduce((n, w) => (t.includes(w) ? n + 1 : n), 0);
};

/**
 * Score a single capability proposal 0..10 on five axes, then a weighted `impact`.
 * Every axis is a countable feature of the proposal object — no model judgment.
 */
export function scoreCapabilityProposal(p = {}, { goalKeywords = GOAL_KEYWORDS } = {}) {
  const evidence = Array.isArray(p.evidence) ? p.evidence.filter(isFileRef) : [];
  const steps = Array.isArray(p.steps) ? p.steps.filter(Boolean) : [];
  const fit = hits(`${p.area} ${p.title} ${p.capability}`, goalKeywords);
  const capLen = String(p.capability ?? '').trim().length;

  const scores = {
    // goal-fit: how many north-star themes this touches (2 themes already = strong).
    goalFit: clamp(fit * 3.5),
    // grounding: real file/symbol references gathered from the codebase.
    grounding: clamp([0, 4, 6, 8, 10][Math.min(evidence.length, 4)]),
    // actionability: a smallest-first slice (+4), a way to verify (+4), a title (+2).
    actionability: clamp((p.firstSlice ? 4 : 0) + (p.verify ? 4 : 0) + (p.title ? 2 : 0)),
    // scope: bounded beats sprawling — a first slice with a short, ordered plan.
    scope: clamp((p.firstSlice ? 5 : 0) + (steps.length >= 1 && steps.length <= 5 ? 5 : steps.length > 5 ? 2 : 0)),
    // specificity: a concrete capability sentence, not a vague aspiration.
    specificity: clamp(Math.min(capLen / 18, 10)),
    // reviewBurden — the Zig/OCaml lesson made numeric, inverted to a SHIPPABILITY score:
    // a small, single-concern, bounded change is cheap to review and trustworthy to ship;
    // a sprawling multi-step wall-of-text is the "13k-line PR" maintainers reject on sight
    // regardless of correctness. 10 = low burden (worth a human's review now), 0 = high.
    reviewBurden: clamp(
      (p.firstSlice ? 3 : 0) +
      (steps.length === 0 ? 3 : steps.length <= 3 ? 7 : steps.length <= 5 ? 4 : 1) -
      (capLen > 240 ? 2 : 0),
    ),
  };
  const impact = round1(
    scores.goalFit * 0.27 + scores.grounding * 0.22 + scores.actionability * 0.18 +
    scores.scope * 0.12 + scores.specificity * 0.09 + scores.reviewBurden * 0.12,
  );
  return { impact, scores, evidenceCount: evidence.length, area: p.area ?? 'unscoped' };
}

const verdictFor = (n) => (n >= 7 ? 'strong' : n >= 5 ? 'workable' : n >= 3 ? 'weak' : 'broken');

/**
 * Score the whole roundtable round. `round.proposals` is the per-lens output array.
 * Returns six 0..10 dimensions + an overall + a one-line headline + a lesson naming
 * the weakest dimension (what to improve next about the council itself).
 */
export function scoreCouncilProcess(round = {}) {
  const proposals = Array.isArray(round.proposals) ? round.proposals : [];
  const usable = proposals.filter((p) => p && p.title && p.capability);
  const n = usable.length || 0;
  const safe = (x) => (n ? x : 0);

  // breadth: distinct capability areas considered (5 distinct angles ⇒ full marks).
  const areas = new Map();
  for (const p of usable) areas.set(p.area ?? 'unscoped', (areas.get(p.area ?? 'unscoped') ?? 0) + 1);
  const distinct = areas.size;
  const topCluster = Math.max(0, ...areas.values());

  const fracWith = (pred) => safe(usable.filter(pred).length / Math.max(n, 1));
  const avgEvidence = safe(usable.reduce((s, p) => s + (Array.isArray(p.evidence) ? p.evidence.filter(isFileRef).length : 0), 0) / Math.max(n, 1));
  // The real convergence signal: proposals that explicitly build on a sibling this round.
  const crossRefs = usable.filter((p) => buildsOnAnother(p, usable)).length;
  const refFrac = safe(crossRefs / Math.max(n, 1));

  const dimensions = {
    synthesis: clamp(distinct * 2),                                  // many angles on the table
    // agreement on an area (lenses clustering) PLUS the stronger signal of a member
    // genuinely building on another's proposal — a real council, not parallel monologues.
    convergence: clamp((topCluster >= 2 ? 4 + topCluster * 1.5 : topCluster * 2) + refFrac * 4),
    chaining: clamp(fracWith((p) => (p.steps?.length ?? 0) >= 2) * 10),
    delegation: clamp(fracWith((p) => p.firstSlice && /\bwe |add |build |wire |create |extend |stage |owner|next\b/i.test(`${p.firstSlice} ${p.capability}`)) * 10),
    grounding: clamp([0, 4, 6, 8, 10][Math.min(Math.round(avgEvidence), 4)]),
    actionability: clamp(fracWith((p) => p.verify) * 10),
  };
  const overall = round1(Object.values(dimensions).reduce((s, v) => s + v, 0) / 6);
  const weakest = Object.entries(dimensions).sort((a, b) => a[1] - b[1])[0] ?? ['synthesis', 0];

  return {
    overall,
    verdict: verdictFor(overall),
    dimensions,
    lensesUsed: n,
    distinctAreas: distinct,
    topClusterSize: topCluster,
    crossRefs,
    headline: `council ${overall}/10 (${verdictFor(overall)}) · ${n} lenses · ${distinct} areas · top cluster ${topCluster}`,
    lesson: `weakest council dimension: ${weakest[0]} (${round1(weakest[1])}/10) — improve the roundtable here next`,
  };
}
