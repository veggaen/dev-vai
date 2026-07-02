/**
 * change-worth — the WORTHINESS gate for a proposed self-improvement change.
 *
 * The existing review-gate checks SOUNDNESS ("preserves intent / minimal / no harm") and lets a
 * correct-but-trivial change through — e.g. a one-word copy tweak passes because it's sound. V3gga's
 * bar is higher: a change the loop commits must be GOOD, MEANINGFUL, USEFUL, at the highest
 * engineering quality, CONFIGURABLE, and FUTURE-PROOF. A cosmetic string edit is "correct" but not
 * WORTHY. This gate answers "is this change worth committing?" so the loop only ships excellence.
 *
 * Two layers, cheap→expensive (mirrors the loop's discipline):
 *   1. DETERMINISTIC signals (ungameable, no model): classify the change SHAPE (logic vs string vs
 *      comment vs whitespace), size, and surface — a string/comment/whitespace-only change is capped
 *      LOW on worth no matter what a model says (the anti-cosmetic floor).
 *   2. MODEL JUDGMENT (injected): a strict senior-engineer rubric scores meaningfulness /
 *      engineering-quality / configurability / future-proofness. Deterministic parse; the model call
 *      is injected so the scorer is unit-tested without a GPU.
 *
 * The verdict COMBINES both: the deterministic cap bounds the model's enthusiasm (a model can't call
 * a string tweak "impressive"), and a low model score sinks a structurally-substantive change that's
 * poorly done. Pure scoring; orchestration injects the model.
 */

import { LOOP_DEFAULTS } from './loop-config.mjs';

// A change must clear this COMBINED worth score [0..1] to be considered worthy of committing.
// Tuned strict: the whole point is to REJECT mediocre changes, not wave them through.
export const WORTH_PASS_SCORE = LOOP_DEFAULTS.worthPassScore;

// The four worth dimensions (V3gga's bar), each 0..1, weighted into the model sub-score.
export const WORTH_DIMENSIONS = ['meaningfulness', 'engineeringQuality', 'configurability', 'futureProofness'];
export const DIMENSION_WEIGHTS = LOOP_DEFAULTS.dimensionWeights;

/**
 * Classify the SHAPE of a find→replace change deterministically. Returns { kind, substantive } where
 * kind ∈ 'logic' | 'string-only' | 'comment-only' | 'whitespace-only' | 'unknown'. `substantive`
 * is false for cosmetic kinds (the anti-cosmetic floor). Pure.
 */
export function classifyChangeShape(find = '', replace = '') {
  const f = String(find); const r = String(replace);
  if (f.trim() === r.trim()) return { kind: 'whitespace-only', substantive: false };

  // Strip string/template literals + comments; if what CHANGED is only inside those, it's cosmetic.
  const codeOf = (s) => stripStringsAndComments(s);
  const fCode = codeOf(f); const rCode = codeOf(r);
  const fStr = onlyStrings(f); const rStr = onlyStrings(r);

  // The executable code is identical but a string literal changed → copy/message tweak.
  if (fCode.trim() === rCode.trim() && fStr !== rStr) return { kind: 'string-only', substantive: false };

  // The code is identical and only a comment differs → comment tweak.
  if (fCode.trim() === rCode.trim() && stripComments(f) !== stripComments(r) === false) {
    // (rare: pure comment change where codeOf already stripped comments to equal)
    return { kind: 'comment-only', substantive: false };
  }
  const fNoComment = stripComments(f).trim();
  const rNoComment = stripComments(r).trim();
  if (fNoComment === rNoComment && f !== r) return { kind: 'comment-only', substantive: false };

  // Real executable logic changed.
  return { kind: 'logic', substantive: true };
}

/** The deterministic worth CEILING for a change shape — caps a cosmetic change's total worth. */
export function shapeCeiling(shape) {
  switch (shape.kind) {
    case 'whitespace-only': return 0.05;
    case 'comment-only': return 0.25;
    case 'string-only': return 0.45;   // a copy tweak can be USEFUL but is never "impressive engineering"
    case 'logic': return 1.0;          // real logic can reach the top — the model decides how high
    default: return 0.6;
  }
}

/** Build the strict worth-rubric prompt for the model. Asks for the four dimensions + a verdict. */
export function buildWorthPrompt({ instruction, file, find, replace, why, sourceExcerpt } = {}) {
  return (
    `You are a STRICT Principal Engineer deciding whether a proposed change is WORTH committing to a\n` +
    `production codebase. The bar is HIGH: it must be genuinely meaningful, well-engineered,\n` +
    `configurable where appropriate, and future-proof. A cosmetic or trivial change is NOT worthy.\n\n` +
    `Goal of the change: ${instruction ?? '(none)'}\n` +
    `File: ${file ?? '(unknown)'}\n` +
    (sourceExcerpt ? `\nSurrounding source:\n\`\`\`\n${String(sourceExcerpt).slice(0, 1200)}\n\`\`\`\n` : '') +
    `\nProposed change:\n  FIND:    ${find}\n  REPLACE: ${replace}\n  WHY:     ${why ?? '(none)'}\n\n` +
    `Score each dimension 0.0–1.0 (be harsh; reserve >0.8 for genuinely excellent):\n` +
    `- MEANINGFULNESS: does it deliver real, useful value (not cosmetic, not busywork)?\n` +
    `- ENGINEERING: is it correct, clean, idiomatic to the surrounding code, minimal-yet-complete?\n` +
    `- CONFIGURABILITY: where relevant, is behaviour parameterised rather than hard-coded? (If N/A, judge whether hard-coding is acceptable here and score accordingly.)\n` +
    `- FUTUREPROOF: does it generalise / not paint us into a corner / age well?\n\n` +
    `Respond in EXACTLY this format, nothing else:\n` +
    `MEANINGFULNESS: <0.0-1.0>\nENGINEERING: <0.0-1.0>\nCONFIGURABILITY: <0.0-1.0>\nFUTUREPROOF: <0.0-1.0>\n` +
    `VERDICT: <worthy|marginal|not-worthy>\nCRITIQUE: <one sentence — the single biggest reason for/against>`
  );
}

/** Parse the model's worth verdict. parsed=false when the four scores can't be read. Tolerant. */
export function parseWorth(raw) {
  const s = String(raw ?? '');
  const num = (re) => { const m = s.match(re); if (!m) return null; const n = Number(m[1]); return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null; };
  const meaningfulness = num(/MEANINGFULNESS:\s*([0-9]*\.?[0-9]+)/i);
  const engineeringQuality = num(/ENGINEERING:\s*([0-9]*\.?[0-9]+)/i);
  const configurability = num(/CONFIGURABILITY:\s*([0-9]*\.?[0-9]+)/i);
  const futureProofness = num(/FUTUREPROOF:\s*([0-9]*\.?[0-9]+)/i);
  const vm = s.match(/VERDICT:\s*(worthy|marginal|not-worthy)/i);
  const cm = s.match(/CRITIQUE:\s*(.+?)(?:\n|$)/i);
  const dims = { meaningfulness, engineeringQuality, configurability, futureProofness };
  const parsed = Object.values(dims).every((v) => v != null);
  return { ...dims, verdict: vm ? vm[1].toLowerCase() : null, critique: cm ? cm[1].trim() : null, parsed };
}

/** Weighted model sub-score [0..1] from parsed dimensions. Null when unparsed. */
export function modelSubScore(parsed) {
  if (!parsed.parsed) return null;
  let sum = 0;
  for (const d of WORTH_DIMENSIONS) sum += (parsed[d] ?? 0) * DIMENSION_WEIGHTS[d];
  return Math.round(sum * 1000) / 1000;
}

/**
 * The full worth verdict, combining the deterministic shape ceiling with the model sub-score:
 *   worth = min(shapeCeiling, modelSubScore)   ← the cap: a string tweak can't exceed 0.45 however
 *                                                 much the model likes it; a badly-done logic change
 *                                                 is sunk by a low model score.
 * When the model is unparsed, fall back to the shape ceiling alone but mark indeterminate (a
 * substantive-shaped change gets the benefit of the doubt up to its ceiling; a cosmetic one is
 * still capped low). Returns { worthy, worth, shape, ceiling, model, reason }.
 */
export function worthVerdict({ shape, parsed }, { passScore = WORTH_PASS_SCORE } = {}) {
  const ceiling = shapeCeiling(shape);
  const model = modelSubScore(parsed);
  if (model == null) {
    // Indeterminate model → use the ceiling, but only pass if the shape alone clears the bar
    // (i.e. a logic change; a cosmetic one is capped below passScore and correctly fails).
    const worth = ceiling;
    return {
      worthy: worth >= passScore,
      worth,
      shape: shape.kind,
      ceiling,
      model: null,
      indeterminate: true,
      reason: `model verdict unreadable — using shape ceiling ${ceiling} for a ${shape.kind} change`,
    };
  }
  const worth = Math.min(ceiling, model);
  const capped = ceiling < model;
  return {
    worthy: worth >= passScore,
    worth: Math.round(worth * 1000) / 1000,
    shape: shape.kind,
    ceiling,
    model,
    verdict: parsed.verdict,
    critique: parsed.critique,
    reason: capped
      ? `${shape.kind} change capped at ${ceiling} (model liked it ${model} but the shape isn't substantive enough)`
      : `worth ${worth.toFixed(2)} — meaning ${fmt(parsed.meaningfulness)} · eng ${fmt(parsed.engineeringQuality)} · config ${fmt(parsed.configurability)} · future ${fmt(parsed.futureProofness)}${parsed.critique ? ` — ${parsed.critique}` : ''}`,
  };
}

/**
 * Judge a change's worth end-to-end: classify shape, prompt the (injected) model, combine. Returns
 * the worthVerdict. `generate(prompt)` is injected so this is testable without a GPU.
 */
export async function judgeChangeWorth({ instruction, file, find, replace, why, sourceExcerpt }, { generate, passScore = WORTH_PASS_SCORE } = {}) {
  const shape = classifyChangeShape(find, replace);
  // Cheap short-circuit: a whitespace-only change is never worth a model call.
  if (shape.kind === 'whitespace-only') {
    return worthVerdict({ shape, parsed: { parsed: false } }, { passScore });
  }
  let parsed = { parsed: false };
  if (typeof generate === 'function') {
    let raw = '';
    try { raw = await generate(buildWorthPrompt({ instruction, file, find, replace, why, sourceExcerpt })); }
    catch { /* model unavailable → indeterminate, handled by worthVerdict */ }
    parsed = parseWorth(raw);
  }
  return worthVerdict({ shape, parsed }, { passScore });
}

// ── pure text helpers (string/comment stripping for shape classification) ──────────────────────
function stripComments(s) {
  return String(s)
    .replace(/\/\*[\s\S]*?\*\//g, '')       // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');  // line comments (avoid eating http://)
}
function stripStringsAndComments(s) {
  return stripComments(s)
    .replace(/`(?:\\.|[^`\\])*`/g, '``')     // template literals → placeholder
    .replace(/'(?:\\.|[^'\\])*'/g, "''")     // single-quoted
    .replace(/"(?:\\.|[^"\\])*"/g, '""');    // double-quoted
}
function onlyStrings(s) {
  const matches = String(s).match(/`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g);
  return matches ? matches.join('') : '';
}
function fmt(n) { return n == null ? '?' : n.toFixed(2); }
