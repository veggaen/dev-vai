/**
 * grader — the perpetual loop's DETERMINISTIC self-grader.
 *
 * The supervisor OBSERVEs, PROPOSEs, CONVERGEs, and INNOVATEs. What it lacked was a
 * single, evidence-bound place that GRADES the corpus the way a human reviewer does:
 *   - which failure class deserves the next unit of (scarce, one-at-a-time) GPU
 *     budget — the LOWEST pass-rate class, not the most familiar bug;
 *   - which "lessons" the loop keeps re-learning without ever acting on (meta-slop:
 *     a lesson seen 500× with a flat score is not learning);
 *   - a per-agent ADOPT / REJECT / KEEP verdict, each bound to a measured signal.
 *
 * Pure + I/O-free — every input is an already-measured primitive (db.mjs stat
 * objects), so it unit-tests without a DB, exactly like motion.mjs and speculator.mjs.
 * It never edits source and never calls a model: it only reads the corpus's own
 * numbers and tells the loop where to point its effort next.
 */

/** A class below this campaign pass-rate is a grading TARGET (weakest first). */
export const WEAK_CLASS_THRESHOLD = 0.7;
/** A lesson re-learned at least this many times with a flat score is STUCK. */
export const STUCK_LESSON_MIN_TIMES = 50;
/** Proposal hit-rate floor (matches the innovation engine's prompt-experiment gate). */
export const HITRATE_FLOOR = 0.3;
/** Council response-rate health gate (matches buildScorecard's assumption). */
export const COUNCIL_HEALTH_GATE = 0.6;

const pct = (n) => (n == null ? 'n/a' : `${Math.round(n * 100)}%`);
const trim = (s, n = 80) => { const x = String(s ?? ''); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };
const rateOf = (row) => { const t = Number(row?.total ?? 0); return t > 0 ? Number(row?.passed ?? 0) / t : 0; };

/**
 * Rank failure classes WEAKEST-FIRST so the loop spends its scarce GPU budget on the
 * lowest pass-rate class. Returns NEW objects { class, total, passed, passRate, target }
 * — `target` true only when below threshold AND actually measured (total>0), so an
 * unscored class never masquerades as a 0% emergency. Stable for equal rates.
 */
export function rankWeakestClasses(classStats = [], { threshold = WEAK_CLASS_THRESHOLD } = {}) {
  return (classStats ?? [])
    .map((row, i) => {
      const total = Number(row?.total ?? 0);
      const passRate = rateOf(row);
      return { class: row?.class, total, passed: Number(row?.passed ?? 0), passRate, target: total > 0 && passRate < threshold, _i: i };
    })
    .sort((a, b) => (a.passRate - b.passRate) || (a._i - b._i))
    .map(({ _i, ...c }) => c);
}

/**
 * Detect STUCK lessons: ones re-learned many times (times_seen high) but never
 * converted into a fix, so the score never moved. The honest grade is to flag them
 * for ACTION, not keep counting them. Returns { lesson, timesSeen, lastOverall, why },
 * most-repeated first.
 */
export function detectStuckLessons(lessons = [], { minTimes = STUCK_LESSON_MIN_TIMES, lane = null } = {}) {
  return (lessons ?? [])
    .filter((l) => Number(l?.times_seen ?? 0) >= minTimes)
    .map((l) => ({
      lesson: l.lesson,
      lane,
      timesSeen: Number(l.times_seen),
      lastOverall: l.last_overall == null ? null : Number(l.last_overall),
      why: `re-learned ×${Number(l.times_seen)} without being acted on — convert it into a queued fix, don't keep counting it`,
    }))
    .sort((a, b) => b.timesSeen - a.timesSeen);
}

/** One-line operator/dashboard summary of the grade. */
export function formatGradeHeadline({ targets = [], stuck = 0 } = {}) {
  const t = targets.length
    ? `${targets.length} weak class${targets.length > 1 ? 'es' : ''} (worst ${targets[0].class} ${pct(targets[0].passRate)})`
    : 'no weak classes';
  const s = stuck ? ` · ${stuck} stuck lesson${stuck > 1 ? 's' : ''}` : '';
  return `Grade: ${t}${s}`;
}

/**
 * Compose the full grade: weakest-first targets, stuck lessons, and per-agent
 * ADOPT/REJECT/KEEP verdicts each bound to a measured signal. Pure — takes the
 * already-measured db.mjs stat objects, returns { targets, stuckLessons, verdicts,
 * headline }. This is the automation of the manual grading pass: every verdict names
 * the responsible agent and cites the number it is grading on.
 */
export function gradeLedger({
  classStats = [],
  tasteLessons = [],
  answerLessons = [],
  proposalQuality = {},
  councilHealth = {},
  opts = {},
} = {}) {
  const targets = rankWeakestClasses(classStats, opts).filter((c) => c.target);
  const stuckTaste = detectStuckLessons(tasteLessons, { ...opts, lane: 'visual' });
  const stuckAnswer = detectStuckLessons(answerLessons, { ...opts, lane: 'answer' });
  const verdicts = [];

  if (targets.length) {
    const w = targets[0];
    verdicts.push({
      agent: 'propose-fix personas',
      verdict: 'reject',
      why: `Spend the next budget on the LOWEST pass-rate class: ${w.class} at ${pct(w.passRate)} (${w.passed}/${w.total}). Effort must follow the weakest class, not the most familiar bug.`,
    });
  }
  if (stuckTaste.length) {
    const s = stuckTaste[0];
    verdicts.push({
      agent: 'visual-rubric + stylist',
      verdict: 'reject',
      why: `Stuck lesson (×${s.timesSeen}): "${trim(s.lesson)}". Learned but never acted on — convert the top P1 flaw into a queued fix.`,
    });
  }
  if (stuckAnswer.length) {
    const s = stuckAnswer[0];
    verdicts.push({
      agent: 'answer-rubric',
      verdict: 'reject',
      why: `Stuck answer lesson (×${s.timesSeen}): "${trim(s.lesson)}". Re-learned without moving craft — make it actionable or retire it.`,
    });
  }
  if (Number(proposalQuality.total ?? 0) > 3 && Number(proposalQuality.hitRate ?? 0) < HITRATE_FLOOR) {
    verdicts.push({
      agent: 'propose-fix + consensus-fix',
      verdict: 'reject',
      why: `Proposal hit-rate ${pct(proposalQuality.hitRate)} across ${proposalQuality.total} proposed classes is below the ${pct(HITRATE_FLOOR)} bar — tighten the propose prompt with grep-grounded evidence.`,
    });
  }
  // Don't synthesize a 100% response-rate when telemetry is MISSING — that would emit a false "keep"
  // and hide a measurement gap (CodeRabbit #25). Only verdict on a real measurement; otherwise say so.
  const rr = councilHealth.responseRate;
  if (rr == null) {
    verdicts.push({ agent: 'council members', verdict: 'inconclusive', why: 'No council response-rate telemetry this window — cannot judge convening/parse health.' });
  } else {
    verdicts.push(rr >= COUNCIL_HEALTH_GATE
      ? { agent: 'council members', verdict: 'keep', why: `Council response-rate ${pct(rr)} is above the ${pct(COUNCIL_HEALTH_GATE)} health gate — convening + parse-rate healthy, no change warranted.` }
      : { agent: 'council members', verdict: 'reject', why: `Council response-rate ${pct(rr)} is below the ${pct(COUNCIL_HEALTH_GATE)} gate — members aren't answering parseably; try a different model.` });
  }

  const stuckLessons = [...stuckTaste, ...stuckAnswer];
  return { targets, stuckLessons, verdicts, headline: formatGradeHeadline({ targets, stuck: stuckLessons.length }) };
}

/** Multi-line render of a gradeLedger() report for the operator. */
export function formatGrade(report) {
  const lines = [report.headline];
  if (report.targets.length) lines.push(`  targets (weakest first): ${report.targets.slice(0, 3).map((c) => `${c.class} ${pct(c.passRate)}`).join(' · ')}`);
  for (const v of report.verdicts) lines.push(`  [${v.verdict.toUpperCase()}] ${v.agent}: ${v.why}`);
  return lines.join('\n');
}
