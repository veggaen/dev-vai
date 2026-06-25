/**
 * model-router — make WEAK models strong by routing one problem through MANY of them and voting.
 *
 * The improve-loop ran a single model (qwen3:8b) wearing persona hats. But diversity of MODELS
 * beats diversity of prompts: one model's truncated regex is another model's clean line. So this
 * routes the SAME task through several installed models, each VRAM-mounted SERIALLY (the BSOD rule:
 * one heavy model at a time, never two), collects their answers, and lets them vote — including the
 * meta-question "which model would YOU trust here?" and "whose answer is best?".
 *
 * VRAM SAFETY (mount/remount): before each model runs we ensure headroom under the budget, then run,
 * then let ollama evict it (keep_alive). We never hold two models resident. Pure orchestration with
 * injected deps (generate / vram / installed / wait), so it unit-tests without a GPU.
 */

/** A code-specialized model is a far better fix-localiser than a general model of the same size —
 *  it emits correct syntax and is much less likely to truncate an edit. Rank these FIRST. */
export function isCoderModel(name = '') {
  return /coder|code-?llama|starcoder|deepseek-?coder|codestral|codeqwen/i.test(name);
}

/** Choose the roster: installed models that individually fit the VRAM budget, capped at `max`.
 *  Ordering: CODER models first (best at code edits), then biggest-first (a bigger general model
 *  is usually a better localiser). Excludes the embedded Vai runtime model so we never evict the
 *  live app's model out from under it. */
export function pickRoster(installed, { budgetBytes, max = 3, exclude = [] } = {}) {
  const ex = new Set(exclude);
  return (installed || [])
    .filter((m) => m && m.name && !ex.has(m.name))
    .filter((m) => !budgetBytes || !m.sizeBytes || m.sizeBytes <= budgetBytes)
    .sort((a, b) =>
      (Number(isCoderModel(b.name)) - Number(isCoderModel(a.name))) || // coder models first
      ((b.sizeBytes ?? 0) - (a.sizeBytes ?? 0)))                       // then biggest-first
    .slice(0, max)
    .map((m) => m.name);
}

/**
 * Mount one model with VRAM headroom, run `fn(model)`, and return its result — serial + guarded.
 * deps: { waitForHeadroom(budget), generate(model, prompt, opts) }. `fn` receives a bound generate.
 */
export async function withModelMounted(model, deps, fn) {
  const { waitForHeadroom, budgetBytes } = deps;
  if (waitForHeadroom) await waitForHeadroom(budgetBytes).catch(() => {});
  // The model is mounted lazily by the first generate call; ollama evicts it after keep_alive.
  return fn(model);
}

/**
 * Route a single problem through the roster and collect one answer per model. Serial: never two
 * models resident. Each entry: { model, ok, answer, ms, error }. Failures are captured, not thrown,
 * so one slow/broken model never sinks the round.
 *
 * deps: { roster:string[], generate(model,prompt,opts), waitForHeadroom?, budgetBytes?, parse?(raw),
 *         timeoutMs?, numPredict? }
 */
export async function routeThroughModels(prompt, deps) {
  const { roster, generate, waitForHeadroom, budgetBytes, parse = (x) => x, timeoutMs = 120_000, numPredict = 320 } = deps;
  const out = [];
  for (const model of roster) {
    const t0 = Date.now();
    try {
      const raw = await withModelMounted(model, { waitForHeadroom, budgetBytes },
        (m) => generate(m, prompt, { timeoutMs, numPredict }));
      out.push({ model, ok: true, answer: parse(raw), raw, ms: Date.now() - t0, error: null });
    } catch (e) {
      out.push({ model, ok: false, answer: null, raw: '', ms: Date.now() - t0, error: String(e).slice(0, 160) });
    }
  }
  return out;
}

/**
 * Tally agreement across model answers using a caller-supplied `keyOf(answer)` (e.g. the normalised
 * find+replace). Returns groups sorted by support desc; the winner is the answer the MOST DIVERSE
 * set of models independently produced — cross-model agreement is far stronger evidence than one
 * model repeating itself. Ties broken by larger models' support (rosterRank, lower = bigger/earlier).
 */
export function tallyConsensus(results, keyOf, { rosterRank = () => 0 } = {}) {
  const groups = new Map();
  for (const r of results) {
    if (!r.ok || r.answer == null) continue;
    const k = keyOf(r.answer);
    if (k == null || k === '') continue;
    if (!groups.has(k)) groups.set(k, { key: k, models: [], answers: [] });
    const g = groups.get(k);
    if (!g.models.includes(r.model)) g.models.push(r.model);
    g.answers.push(r.answer);
  }
  const ranked = [...groups.values()].sort((a, b) =>
    (b.models.length - a.models.length) ||
    (Math.min(...a.models.map(rosterRank)) - Math.min(...b.models.map(rosterRank))));
  return {
    winner: ranked[0] ?? null,
    groups: ranked,
    distinctModels: new Set(results.filter((r) => r.ok).map((r) => r.model)).size,
  };
}

/** Build the meta-vote prompt: ask a model which CANDIDATE answer is best and why. Used for the
 *  "who has the best solution?" round when there's no clear cross-model majority. */
export function buildBestAnswerVote(problem, candidates) {
  const list = candidates.map((c, i) => `[${i + 1}] (from ${c.model}) ${c.summary}`).join('\n');
  return (
    `You are judging proposed fixes from several AI models for this problem:\n${problem}\n\n` +
    `CANDIDATES:\n${list}\n\n` +
    `Reply with STRICT JSON: {"best": <number>, "why": "<one sentence>"}. Pick the candidate most ` +
    `likely to be correct AND complete (a truncated or partial code edit is WRONG). Only the number.`
  );
}

/** Parse a best-answer vote ("{best:N}"); returns a 1-based index or null. */
export function parseBestVote(raw, n) {
  try {
    const m = /\{[\s\S]*\}/.exec(String(raw));
    const j = JSON.parse(m ? m[0] : String(raw));
    const b = Number(j.best);
    if (Number.isInteger(b) && b >= 1 && b <= n) return { best: b, why: String(j.why ?? '').slice(0, 200) };
  } catch { /* fallthrough */ }
  return null;
}
