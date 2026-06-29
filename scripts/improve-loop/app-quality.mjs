/**
 * app-quality — grade an answer with the SAME quality gate the live app ships through.
 *
 * THE MISALIGNMENT this fixes (found while grading "are results good?"): the loop graded answer
 * quality with its OWN crude rubric (answer-rubric.mjs: count concrete anchors), while the live app
 * decides what to ship using a far richer gate — evaluateChatAnswerQuality (topic retention,
 * actionability, comparison shape, honesty calibration, drift, grounding-anchor coverage), wired +
 * enforced in service.ts. So the loop was optimizing a metric THE APP DOESN'T USE — "improving"
 * rubric scores while the app's real quality bar never moved, and re-"discovering" a grounding gap
 * 79× that was an artifact of the crude rubric. Grading with the app's own gate aligns the loop with
 * what actually ships: the loop now optimizes the real thing, and loop↔app agree on "good".
 *
 * Imports the COMPILED gate (packages/core/dist) so a plain .mjs can call the app's .ts logic.
 * Honest-degradation: if the dist isn't built, returns null and callers fall back to the rubric —
 * never throws into the loop.
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

// fileURLToPath handles Windows drive letters + percent-encoding correctly (CodeRabbit #25: the
// hand-rolled pathname.replace broke on spaces/encoded chars).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = resolve(ROOT, 'packages/core/dist/chat/chat-answer-quality.js');

let _gate = null;
/** Lazy-load the compiled app quality gate. Returns the fn or null (dist missing/old). */
async function loadGate() {
  if (_gate) return _gate; // cache only a SUCCESSFUL load
  try {
    // Don't permanently memoize a "dist missing" result — the dist may be built later in the same
    // long-running loop (CodeRabbit #25). Re-check existsSync each call until the gate loads.
    if (!existsSync(DIST)) return null;
    const mod = await import(pathToFileURL(DIST).href);
    _gate = typeof mod.evaluateChatAnswerQuality === 'function' ? mod.evaluateChatAnswerQuality : null;
  } catch { _gate = null; }
  return _gate;
}

/** True when the app's real gate is available (dist built). Lets a caller decide to use it. */
export async function appQualityAvailable() {
  return (await loadGate()) != null;
}

/**
 * Grade an answer with the app's real gate. Returns { verdict:'pass'|'warn'|'fail', score, missing }
 * or null when the gate isn't available (caller falls back to the rubric). `prompt` matters — the
 * gate's topic/actionability checks read it — so pass the real prompt, not a placeholder.
 */
export async function gradeWithAppGate(prompt, response, opts = {}) {
  const gate = await loadGate();
  if (!gate) return null;
  try {
    const r = gate({ prompt: String(prompt ?? ''), response: String(response ?? ''), strategy: opts.strategy });
    return {
      verdict: r.verdict,
      score: r.score,
      // The labels of what the answer FAILED — the actionable, app-aligned lesson (e.g. "actionable
      // next move", "real comparison", "honest calibration") instead of the rubric's generic "ground it".
      missing: (r.missing ?? []).map((m) => m.label),
    };
  } catch { return null; }
}

/** Map the app verdict to a 0..10 excellence number so it slots into the loop's existing series. */
export function appVerdictToScore(verdict, score) {
  if (verdict === 'pass') return Math.max(8, Math.round((score ?? 1) * 10));
  if (verdict === 'warn') return 6;
  return Math.min(4, Math.round((score ?? 0) * 10)); // fail
}
