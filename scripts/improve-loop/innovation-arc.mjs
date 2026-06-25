/**
 * innovation-arc — the loop doing ITSELF what a human did by hand for the grounding-gate:
 * mine a non-obvious self-discovered gap → shape it into a buildable innovation → judge whether
 * it is small-and-safe enough to pursue autonomously or FUNDAMENTAL enough to escalate to V3gga.
 *
 * This is the "self-innovator" layer above the "self-tuner" experiment arc. The experiment arc
 * (innovation-engine.mjs) only ranks 4 fixed self-TWEAK types (model/prompt/grading/seed_class);
 * it is structurally incapable of innovation. This arc removes that ceiling: a candidate can be a
 * DISCOVERY (a stuck lesson the loop keeps re-learning but never acts on — the 52× grounding gap),
 * a GUARD (turn a measured-but-unenforced weakness into a pre-ship enforcement), or a FEATURE
 * (a capability proposal). Each is classified by IMPACT, not byte-diff:
 *
 *   - 'autonomous' : small, reversible, provable WITHOUT changing what Vai fundamentally is — the
 *                    loop may pursue it (build a pure guard, prove it against its own data, land it).
 *   - 'escalate'   : fundamental — touches architecture, the answer contract, a new subsystem, or
 *                    anything irreversible. The loop STOPS and tells V3gga (the "with or without me,
 *                    but flag the fundamental" contract). It never builds these unattended.
 *
 * Pure + I/O-light: mining reads the corpus; everything else is pure, so the whole arc unit-tests
 * with injected lessons. It PROPOSES + ROUTES; it does not itself edit Vai source (the build step is
 * a separate, gated action) — same propose-only safety contract as the rest of the loop.
 */
import { detectStuckLessons } from './grader.mjs';

/** A lesson re-learned at least this many times with a flat low score is a real, actionable gap
 *  (matches grader's STUCK threshold). Below this it's noise, not a discovery. */
export const DISCOVERY_MIN_TIMES = 40;
/** A lesson whose last score is at/above this is "good craft" — keep it, don't treat as a gap. */
export const HEALTHY_SCORE = 7.0;

/** Words/phrases in a lesson that signal it is about a MEASURED-BUT-UNENFORCED weakness — the
 *  exact shape that converts cleanly into a deterministic guard (the grounding-gate template). */
const GUARDABLE = /\b(grounding|concrete|cite|filler|hedge|overconfident|vague|specific|empty|wall of text|preamble)\b/i;

/**
 * Mine the loop's OWN most-repeated unacted gap from its answer-quality lessons. A "discovery" is a
 * lesson seen many times whose score stays low — the loop keeps NOTICING the failure and never
 * FIXING it (the grounding gap was re-learned 52×). Returns the strongest such gap, or null.
 * @param lessons rows of { lesson, times_seen, last_overall } (e.g. topAnswerLessons(db))
 */
export function mineDiscovery(lessons = [], { minTimes = DISCOVERY_MIN_TIMES, healthyScore = HEALTHY_SCORE } = {}) {
  const stuck = detectStuckLessons(lessons, { minTimes, lane: 'answer' })
    // already-resolved lessons carry a [RESOLVED ...] tag — skip them (don't re-discover a closed gap)
    .filter((s) => !/\[resolved/i.test(s.lesson))
    // a stuck lesson with a HEALTHY last score isn't a gap — it's craft the loop keeps confirming
    .filter((s) => s.lastOverall == null || s.lastOverall < healthyScore);
  if (stuck.length === 0) return null;
  const top = stuck[0]; // detectStuckLessons sorts most-repeated first
  return {
    kind: 'discovery',
    lesson: top.lesson,
    timesSeen: top.timesSeen,
    lastScore: top.lastOverall,
    guardable: GUARDABLE.test(top.lesson),
    summary: `re-learned ×${top.timesSeen} at score ${top.lastOverall ?? '?'} without ever being acted on`,
  };
}

/**
 * Classify an innovation candidate by IMPACT → 'autonomous' (the loop may pursue) or 'escalate'
 * (fundamental → tell V3gga). Pure, conservative: errs toward ESCALATE when unsure (a wrongly-
 * escalated idea just asks a human; a wrongly-autonomous one could ship something fundamental).
 * @param candidate { kind:'discovery'|'guard'|'feature', guardable?, area?, scope?, ...}
 * @returns { mode:'autonomous'|'escalate', reasons:string[] }
 */
export function classifyInnovation(candidate = {}) {
  const reasons = [];
  const kind = candidate.kind ?? 'feature';

  // FEATURES are inventions — new capabilities, new subsystems, new UI/contracts. Always fundamental.
  if (kind === 'feature') {
    reasons.push('a new feature/capability is fundamental (new behaviour, not a reversible guard) — escalate to V3gga');
    return { mode: 'escalate', reasons };
  }
  // A DISCOVERY that maps to a deterministic, pre-ship GUARD (the grounding-gate shape) is the one
  // safe autonomous case: pure, additive, reversible, provable against the loop's own data, and it
  // changes no existing behaviour until wired. That is exactly what the loop proved it can do.
  if ((kind === 'discovery' || kind === 'guard') && candidate.guardable) {
    reasons.push('maps to a pure, additive, reversible pre-ship guard provable on the loop\'s own data — autonomous');
    return { mode: 'autonomous', reasons };
  }
  // A discovery that is NOT cleanly guardable (needs real logic changes, touches the answer path,
  // or is ambiguous) is fundamental — the loop can't safely turn it into a sound change unattended.
  reasons.push('discovery does not map to a pure guard (would need real logic/answer-path changes) — escalate');
  return { mode: 'escalate', reasons };
}

/**
 * Pull the loop's OWN labelled answers for the build/prove step: each answer with a bad/good label
 * from its excellence score (< badBelow = bad, >= goodAbove = good). Substantive answers only, so a
 * one-line reply doesn't skew the proof. Returns [] on any error (the builder then can't prove → escalates).
 */
export function labelledAnswers(db, { badBelow = 6, goodAbove = 8, minLen = 80 } = {}) {
  try {
    return db.prepare(
      `SELECT DISTINCT answer_excerpt AS answer, answer_excellence AS sc FROM results
       WHERE answer_excellence IS NOT NULL AND answer_excerpt IS NOT NULL AND length(answer_excerpt) > ?`,
    ).all(minLen)
      .filter((r) => r.sc < badBelow || r.sc >= goodAbove)
      .map((r) => ({ answer: r.answer, bad: r.sc < badBelow }));
  } catch { return []; }
}

/**
 * One step of the innovation arc: discover a gap, classify it, and — for an AUTONOMOUS candidate —
 * actually BUILD + PROVE a guard against the loop's own labelled data (escalating if it can't prove
 * out). This is the conceive→build→prove the grounding-gate did by hand, now autonomous.
 * @param db open corpus DB
 * @param deps { lessons?, examples?, build? }  injectable for tests
 * @returns { found, candidate?, mode?, reasons?, built?, guard?, scorecard?, headline }
 */
export async function planInnovation(db, deps = {}) {
  let lessons = deps.lessons;
  if (!lessons) {
    try {
      const { topAnswerLessons } = await import('./db.mjs');
      lessons = topAnswerLessons(db, 12);
    } catch { lessons = []; }
  }
  const candidate = mineDiscovery(lessons, deps.opts ?? {});
  if (!candidate) {
    return { found: false, headline: 'innovation: no unacted gap above the discovery threshold (loop healthy or already acting)' };
  }
  let { mode, reasons } = classifyInnovation(candidate);

  // AUTONOMOUS BUILD: a guardable discovery gets a real guard built + proven on the loop's own data.
  // If it proves out, the loop has autonomously CREATED working enforcement. If it can't, demote to
  // escalate — never keep an unproven guard (the anti-slop contract applied to the loop's own work).
  let built = false; let guard; let scorecard; let params;
  if (mode === 'autonomous') {
    try {
      const { buildGuardFromDiscovery } = await import('./guard-builder.mjs');
      const examples = deps.examples ?? labelledAnswers(db, deps.labelOpts ?? {});
      const r = (deps.build ?? buildGuardFromDiscovery)(candidate, examples, deps.buildOpts ?? {});
      built = r.built; guard = r.guard; scorecard = r.scorecard; params = r.params;
      if (!built) { mode = 'escalate'; reasons = [...reasons, r.reason]; }
      else reasons = [...reasons, r.reason];
    } catch (e) {
      mode = 'escalate';
      reasons = [...reasons, `build step failed (${String(e).slice(0, 60)}) — escalate`];
    }
  }

  return {
    found: true, candidate, mode, reasons, built, guard, scorecard, params,
    headline: `innovation [${mode}${built ? ' · BUILT+PROVEN' : ''}]: ${candidate.kind} — "${String(candidate.lesson).slice(0, 56)}" (${candidate.summary})`,
  };
}

/** Friend-readable render of a routed innovation plan. */
export function formatInnovation(plan) {
  if (!plan?.found) return plan?.headline ?? 'innovation: nothing to do';
  const lines = [plan.headline];
  for (const r of plan.reasons ?? []) lines.push(`  · ${r}`);
  if (plan.built) lines.push(`  → ✅ AUTONOMOUSLY BUILT + PROVEN: ${plan.scorecard?.detail ?? 'guard proves out on the loop\'s own data'}`);
  else if (plan.mode === 'escalate') lines.push('  → 🚩 flagged for V3gga (fundamental or unprovable — not built autonomously)');
  else lines.push('  → the loop may pursue this autonomously (build a guard → prove → land)');
  return lines.join('\n');
}
