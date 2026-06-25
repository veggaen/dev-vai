/**
 * review-gate — the model SECOND-OPINION gate for prototypes (Thorsen "never ship raw model
 * output" / multi-model critique, made real inside the loop).
 *
 * The mechanical verifier (proposal-verifier) answers "does the cited line exist + is it
 * executable + unique". It cannot answer the question that actually decides quality: "is this
 * change GOOD — does it fix the class WITHOUT breaking intent, is it minimal, is there a simpler
 * way?". A correct-but-bad fix passes the mechanical gate and would commit. This gate closes that
 * hole: a throttled local model reviews the proposed diff for SOUNDNESS and can reject before commit.
 *
 * Quality-first, crash-safe (V3gga: optimize for proven quality; never blue-screen):
 *   - Picks the BEST model that SAFELY fits the current VRAM headroom (dynamic per system) —
 *     preferring one already resident (no evict/cold-load swap, the #1 timeout+BSOD source).
 *   - One serial call, VRAM-guarded before it runs. Honest-null on timeout/unavailable → the
 *     gate is SKIPPED (not failed) so infra never masquerades as a bad prototype.
 *   - The verdict parse is deterministic + unit-tested; the model call is injected for tests.
 *
 * The scorer is pure I/O-free; orchestration injects the model + VRAM probes.
 */

/** A review must clear this soundness score [0..1] to PASS the gate. Tuned strict-ish: a fix
 *  the reviewer is lukewarm on is not worth committing (better to discard and try again). */
export const REVIEW_PASS_SCORE = 0.6;

/** Preference order for the reviewer model — best DIRECT-ANSWERING judgment first. The picker
 *  walks this list and takes the first that (a) is installed AND (b) fits the safe VRAM budget,
 *  preferring resident. qwen3/qwen2.5 answer the verdict format directly and quickly. deepseek-r1
 *  is LAST despite strong reasoning: it's a <think> model that spends its whole token budget
 *  reasoning and times out before emitting the SCORE line (measured: timed out at 150s/2000tok
 *  while the loop shares the GPU). A gate must return promptly — direct answerers win here. */
export const REVIEWER_PREFERENCE = ['qwen3:8b', 'qwen2.5:7b', 'qwen2.5-coder:7b', 'qwen2.5:3b', 'deepseek-r1:8b'];

/**
 * Pick the reviewer model dynamically from what's installed + what safely fits. Quality-first
 * within the crash budget: if the resident model is in the preference list, use it (zero swap
 * cost). Otherwise take the most-preferred installed model whose footprint fits `headroomBytes`.
 * Falls back to the resident (whatever it is) so we never return null when something is loaded.
 * @param {{ installed:{name,sizeBytes}[], resident:string|null, headroomBytes:number }} env
 * @returns {{ model:string|null, swap:boolean, reason:string }}
 */
export function pickReviewer({ installed = [], resident = null, headroomBytes = 0 } = {}) {
  const byName = new Map(installed.map((m) => [m.name, m]));
  // 1. Resident model is preferred IF it's a sane reviewer (in the list) — no swap, no cold load.
  if (resident && REVIEWER_PREFERENCE.includes(resident)) {
    return { model: resident, swap: false, reason: `resident ${resident} (no swap)` };
  }
  // 2. Best-preferred installed model that FITS the safe headroom (a swap, but quality-justified).
  for (const name of REVIEWER_PREFERENCE) {
    const m = byName.get(name);
    if (m && m.sizeBytes <= headroomBytes) {
      return { model: name, swap: name !== resident, reason: `best fit ${name} (${(m.sizeBytes / 1e9).toFixed(1)}GB ≤ ${(headroomBytes / 1e9).toFixed(1)}GB headroom)` };
    }
  }
  // 3. Nothing in the preference list fits — use the resident (any) rather than force a load.
  if (resident) return { model: resident, swap: false, reason: `fallback to resident ${resident} (nothing preferred fits headroom)` };
  // 4. Smallest installed as last resort.
  const smallest = installed.slice().sort((a, b) => a.sizeBytes - b.sizeBytes)[0];
  return smallest
    ? { model: smallest.name, swap: true, reason: `last-resort smallest ${smallest.name}` }
    : { model: null, swap: false, reason: 'no models installed' };
}

/** Build the review prompt from a proposal. Asks for a STRICT, parseable verdict — score + the
 *  three soundness axes (preserves intent / minimal / no harm) + one concern. Kept short so the
 *  call is cheap. The source excerpt grounds the reviewer in the real code, not its imagination. */
export function buildReviewPrompt({ klass, hypothesis, find, replace, why, sourceExcerpt } = {}) {
  return (
    `You are a strict Principal Engineer reviewing a proposed one-line code fix BEFORE it is committed.\n` +
    `Failure class: ${klass}\n` +
    `Hypothesis: ${hypothesis}\n` +
    (sourceExcerpt ? `\nSurrounding source:\n\`\`\`\n${sourceExcerpt}\n\`\`\`\n` : '') +
    `\nProposed change:\n  FIND:    ${find}\n  REPLACE: ${replace}\n  WHY:     ${why ?? '(none given)'}\n\n` +
    `Judge it on three axes:\n` +
    `1. Does it actually address the failure class WITHOUT changing unrelated behaviour (preserves intent)?\n` +
    `2. Is it the MINIMAL change, or is there a simpler/safer way?\n` +
    `3. Could it cause obvious harm (break a guard, loosen a check, introduce a regression)?\n\n` +
    `Respond in EXACTLY this format, nothing else:\n` +
    `SCORE: <0.0-1.0>\nINTENT: <yes|no>\nMINIMAL: <yes|no>\nHARM: <none|possible>\nCONCERN: <one sentence, or "none">`
  );
}

/**
 * Parse the reviewer's response into a structured verdict. Deterministic + tolerant (models add
 * stray prose). Returns { score, intent, minimal, harm, concern, parsed }. parsed=false when no
 * SCORE could be read — caller treats that as indeterminate (skip), not a fail.
 */
export function parseReview(raw) {
  const s = String(raw ?? '');
  const num = (re) => { const m = s.match(re); return m ? Number(m[1]) : null; };
  const word = (re) => { const m = s.match(re); return m ? m[1].toLowerCase() : null; };
  let score = num(/SCORE:\s*([0-9]*\.?[0-9]+)/i);
  const intent = word(/INTENT:\s*(yes|no)/i);
  const minimal = word(/MINIMAL:\s*(yes|no)/i);
  const harm = word(/HARM:\s*(none|possible)/i);
  const cm = s.match(/CONCERN:\s*(.+?)(?:\n|$)/i);
  const concern = cm ? cm[1].trim() : null;
  if (score == null) return { score: null, intent, minimal, harm, concern, parsed: false };
  score = Math.max(0, Math.min(1, score));
  return { score, intent, minimal, harm, concern, parsed: true };
}

/**
 * Decide the gate result from a parsed verdict. PASS requires: a parseable score ≥ threshold,
 * intent preserved (not "no"), and harm not "possible". A hard "intent:no" or "harm:possible"
 * fails REGARDLESS of score — a reviewer who flags real harm overrides a generous number.
 * Indeterminate (unparseable) → pass:true with a flag, so an infra/format hiccup doesn't block a
 * mechanically-verified fix (the mechanical gate already vouched for it).
 */
export function reviewVerdict(parsed, { passScore = REVIEW_PASS_SCORE } = {}) {
  if (!parsed.parsed) return { pass: true, indeterminate: true, detail: 'review unparseable — deferring to mechanical gate' };
  if (parsed.intent === 'no') return { pass: false, detail: `reviewer: change does NOT preserve intent — ${parsed.concern ?? 'no detail'}` };
  if (parsed.harm === 'possible') return { pass: false, detail: `reviewer: possible harm — ${parsed.concern ?? 'no detail'}` };
  if (parsed.score < passScore) return { pass: false, detail: `reviewer score ${parsed.score.toFixed(2)} < ${passScore} — ${parsed.concern ?? 'lukewarm'}` };
  return { pass: true, detail: `reviewer score ${parsed.score.toFixed(2)} (intent ✓, no harm)${parsed.minimal === 'no' ? ' — note: not minimal' : ''}` };
}
