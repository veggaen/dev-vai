/**
 * action-queue — the Stuck-Lesson → Queued-Fix BRIDGE.
 *
 * The grader NAMES the work (weakest classes, stuck lessons re-learned but never
 * acted on); this module turns those findings into a deterministic, prioritized
 * QUEUE of fix candidates the supervisor/PROPOSE step can consume next cycle.
 *
 * Hard contract (same as grader.mjs / motion.mjs / speculator.mjs):
 *   - pure + I/O-free: input is a gradeLedger() report, output is a plain array;
 *   - QUEUE-ONLY: it proposes candidates, it NEVER applies a fix or edits source;
 *   - deterministic: stuck lessons always outrank weak classes, so the meta-slop
 *     lesson (e.g. the ×774 visual flaw) is guaranteed the #1 action until acted on.
 *
 * Priority model (integer, higher = more urgent):
 *   stuck lesson  = STUCK_PRIORITY_BASE (1000) + timesSeen  → ×774 ⇒ 1774
 *   weak class    = round((1 - passRate) * 100)             → 40% ⇒ 60
 * Any stuck lesson (≥1050) therefore always sorts above any weak class (≤100).
 */

/** Stuck lessons start here so they always outrank weak-class proposals (≤100). */
export const STUCK_PRIORITY_BASE = 1000;

const PERSONA_BY_PREFIX = {
  routing: 'router-specialist',
  answer: 'answer-craft',
  followup: 'context-keeper',
  ui: 'visual-stylist',
  visual: 'visual-stylist',
};

/** Map a failure class (or lane) to the persona best suited to fix it. */
export function personaForClass(klass) {
  const prefix = String(klass ?? '').split('/')[0].toLowerCase();
  return PERSONA_BY_PREFIX[prefix] ?? 'generalist';
}

function trim(s, n = 80) {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * Convert a gradeLedger() report into a prioritized, queue-only action list.
 * Stuck lessons become visual-fix / answer-fix candidates (highest priority);
 * weak classes become propose-fix candidates beneath them. Pure + deterministic.
 */
export function buildActionQueue(grade = {}, { stuckBase = STUCK_PRIORITY_BASE } = {}) {
  const actions = [];

  for (const s of grade.stuckLessons ?? []) {
    const isVisual = s.lane === 'visual' || s.lane === 'ui'; // 'ui' maps to the visual persona too (CodeRabbit #25)
    actions.push({
      type: isVisual ? 'visual-fix' : 'answer-fix',
      priority: stuckBase + Number(s.timesSeen ?? 0),
      target: s.lesson,
      reason: `Stuck ${isVisual ? 'visual' : 'answer'} lesson re-learned ×${Number(s.timesSeen ?? 0)} without being acted on — turn it into one concrete fix and stop counting it.`,
      suggestedPersona: personaForClass(s.lane ?? (isVisual ? 'visual' : 'answer')),
    });
  }

  for (const c of grade.targets ?? []) {
    if (!c.target) continue;
    actions.push({
      type: 'propose-fix',
      priority: Math.round((1 - Number(c.passRate ?? 0)) * 100),
      target: c.class,
      reason: `Weakest class at ${Math.round(Number(c.passRate ?? 0) * 100)}% (${c.passed}/${c.total}) — spend the next budget here, not on the most familiar bug.`,
      suggestedPersona: personaForClass(c.class),
    });
  }

  // Highest priority first; STABLE for ties so input order (already weakest-first
  // from the grader) is preserved among equal-priority weak classes.
  return actions
    .map((a, i) => ({ a, i }))
    .sort((x, y) => y.a.priority - x.a.priority || x.i - y.i)
    .map(({ a }) => a);
}

/** One-line operator summary of the top queued action (or a clean empty note). */
export function formatTopAction(queue = []) {
  if (!queue.length) return 'queued fixes: none (no stuck lessons or weak classes)';
  const top = queue[0];
  return `next fix (#${queue.length} queued): [${top.type} p${top.priority}] ${trim(top.target)} → ${top.suggestedPersona}`;
}
