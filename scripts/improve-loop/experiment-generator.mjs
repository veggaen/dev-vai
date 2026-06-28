/**
 * experiment-generator — the INFINITE idea source for the perpetual loop.
 *
 * Why this exists (the bug V3gga caught): the innovation engine ranks a FIXED pool of
 * ~5 hard-coded experiment variants. Even with a retry cooldown, a perpetual system that
 * only ever re-tries the same five ideas isn't innovating — it's looping. A genuinely
 * perpetual self-improver needs an inexhaustible, SELF-REPLENISHING source of NEW
 * hypotheses. That is what this module provides: when the deterministic pool is exhausted,
 * it mines the loop's OWN failure data (weakest class + dominant failure reasons) and asks
 * a resident LOCAL model to propose a NOVEL experiment — grounded, not random.
 *
 * Contract (matches the rest of the loop):
 *   - Propose-only: it returns a candidate {type,hypothesis,config}; the caller records it.
 *   - Grounded: the prompt is built from real DB signals, so the idea targets a real gap.
 *   - Crash-safe: ONE serial generate on the RESIDENT model (no evict/cold-load), wrapped
 *     so a model/parse failure returns null instead of throwing into the loop.
 *   - Deduped: the generated variant carries a content hash, and the caller still runs it
 *     through hasOpenExperiment, so a re-generated identical idea is filtered like any other.
 *   - Honest fallback: if the model is down or the output is unusable, returns null and the
 *     loop falls back to the deterministic (cooldown-rotated) pool. It never fabricates.
 */
import { ollamaGenerate, residentModel } from './driver.mjs';
import { campaignClassStats, failingRowsForClass } from './db.mjs';

const GEN_MODEL = process.env.IMPROVE_GEN_MODEL ?? process.env.LOCAL_MODEL ?? 'qwen3:8b';

/** Valid experiment types the runner knows how to measure/close. Generated ideas must
 *  map onto one of these or the experiment-runner can't grade them. */
export const VALID_TYPES = new Set(['model', 'prompt', 'grading', 'seed_class']);

/** Short, stable content hash for a generated hypothesis → a unique, dedupe-able variant key. */
export function hashVariant(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return `gen-${h.toString(36)}`;
}

/**
 * Mine the corpus for the highest-leverage GAP to aim a new experiment at: the weakest
 * class by campaign pass-rate (with enough samples to trust), plus its dominant failure
 * reasons. Pure read; returns null when there isn't enough signal to ground a proposal.
 * @returns {{ klass, passRate, passed, total, reasons:string[] }|null}
 */
export function mineWeakestGap(db, { minTotal = 4 } = {}) {
  const stats = campaignClassStats(db)
    .filter((c) => Number(c.total) >= minTotal)
    .map((c) => ({ klass: c.class, passed: Number(c.passed), total: Number(c.total), passRate: Number(c.passed) / Number(c.total) }))
    .sort((a, b) => a.passRate - b.passRate);
  if (stats.length === 0) return null;
  const weakest = stats[0];
  let reasons = [];
  try {
    reasons = [...new Set(failingRowsForClass(db, weakest.klass).map((r) => r.grade_reason).filter(Boolean))].slice(0, 4);
  } catch { reasons = []; }
  return { ...weakest, reasons };
}

/** Build the generation prompt from a mined gap. Kept separate so it's unit-testable. */
export function buildGenPrompt(gap, recentVariants = []) {
  const tried = recentVariants.length
    ? `Experiment variants ALREADY tried (do NOT repeat these): ${recentVariants.join(', ')}.\n`
    : '';
  return (
    `You are a Principal Engineer designing the NEXT improvement experiment for a self-improving AI loop.\n` +
    `The loop measures pass-rate per "class" of user question. The WEAKEST class right now is:\n` +
    `  class: ${gap.klass}\n` +
    `  pass-rate: ${Math.round(gap.passRate * 100)}% (${gap.passed}/${gap.total})\n` +
    (gap.reasons.length ? `  dominant failure reasons: ${gap.reasons.map((r) => `"${r}"`).join('; ')}\n` : '') +
    `\nThe lever TYPE must be exactly one of: model | prompt | grading | seed_class.\n` +
    `  model = try a different local model · prompt = tighten the propose-fix prompt ·\n` +
    `  grading = adjust how answers are scored · seed_class = probe a new edge of this class.\n` +
    tried +
    `\nPropose ONE concrete, NOVEL experiment to raise this class's pass-rate. Output STRICT JSON only:\n` +
    `{"type":"<one of the four>","hypothesis":"<one sentence, specific and falsifiable>"}`
  );
}

/** Parse + validate the model's JSON into a candidate, or null if unusable. */
export function parseGenerated(raw, gap) {
  if (!raw) return null;
  let obj = null;
  // Tolerant: pull the first {...} block (models love to wrap JSON in prose/```).
  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { obj = JSON.parse(m[0]); } catch { return null; }
  const type = String(obj.type ?? '').trim().toLowerCase();
  const hypothesis = String(obj.hypothesis ?? '').trim();
  if (!VALID_TYPES.has(type)) return null;
  if (hypothesis.length < 15 || hypothesis.length > 400) return null;
  return {
    type,
    hypothesis,
    config: { target: 'generated', variant: hashVariant(hypothesis), klass: gap?.klass ?? null, generated: true },
  };
}

/**
 * Generate ONE novel, grounded experiment candidate — or null on any failure (model down,
 * no signal, unusable output). The caller decides whether to record it (and still dedupes
 * it via hasOpenExperiment). `opts.generate` is injectable so this unit-tests without a GPU.
 * @returns {Promise<{type,hypothesis,config}|null>}
 */
export async function generateNovelExperiment(db, { generate, recentVariants = [], minTotal = 4 } = {}) {
  const gap = mineWeakestGap(db, { minTotal });
  if (!gap) return null; // not enough signal to ground a real idea → honest null
  const prompt = buildGenPrompt(gap, recentVariants);
  const gen = generate ?? (async (p) => {
    // Resident model ONLY — if nothing is loaded, return null instead of cold-loading GEN_MODEL.
    // Falling back to a cold load reintroduces the GPU evict/churn the co-resident roster avoids
    // (CodeRabbit #25). An honest null here just means "no novel idea this cycle".
    const model = await residentModel();
    if (!model) return null;
    return ollamaGenerate(model, p, { numPredict: 160, timeoutMs: 60_000 });
  });
  let raw = '';
  try { raw = await gen(prompt); } catch { return null; }
  if (raw == null) return null;
  return parseGenerated(raw, gap);
}
