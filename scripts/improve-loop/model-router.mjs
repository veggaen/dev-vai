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

/** A reasoning model (deepseek-r1, qwq) is strong at open-ended JUDGEMENT but bad/slow at the
 *  grep→read→emit-exact-JSON tool-loop (it reasons in prose and times out). Use it where it shines. */
export function isReasoner(name = '') {
  return /r1\b|deepseek-?r1|qwq|thinking|reason/i.test(name);
}

/**
 * Assign each model a ROLE by its strength — "use everyone where they're good", configurable.
 *   propose: runs the fix tool-loop (coders + general models; fast, code-fluent)
 *   judge:   votes on candidates / critiques (reasoning models; their strength)
 *   both:    capable of either (general models default here)
 * Defaults to ALL installed models seated (per V3gga: "default to all"), each in its best role.
 * `override` lets the UI force a role per model, e.g. { 'deepseek-r1:8b': 'propose' }.
 */
export function assignRoles(models, { override = {} } = {}) {
  return (models || []).map((name) => {
    if (override[name]) return { name, role: override[name], reason: 'ui-override' };
    if (isReasoner(name)) return { name, role: 'judge', reason: 'reasoning model — strong at judging, slow at the tool-loop' };
    if (isCoderModel(name)) return { name, role: 'propose', reason: 'code-specialized — best fix localiser' };
    return { name, role: 'both', reason: 'general model — can propose or judge' };
  });
}

/** The models that should run the fix tool-loop (role propose|both). */
export function proposers(roleAssignments) {
  return roleAssignments.filter((r) => r.role === 'propose' || r.role === 'both').map((r) => r.name);
}
/** The models that should judge/vote on candidates (role judge|both). */
export function judges(roleAssignments) {
  return roleAssignments.filter((r) => r.role === 'judge' || r.role === 'both').map((r) => r.name);
}

/** Choose the roster: models whose sizes SUM within the VRAM budget so they CO-RESIDE, capped at
 *  `max`. Ordering: CODER models first (best at code edits), then biggest-first.
 *
 *  CO-RESIDENCY (the efficiency fix): the old code filtered each model INDIVIDUALLY (each ≤budget)
 *  then took `max` — so on an 8.5GB budget it picked 3×~5GB models that cannot co-reside. Every
 *  persona then evicted + cold-loaded the next 5GB model from disk; under the 90s persona timeout
 *  the cold loads failed → "no proposal" → the council STALLED for minutes burning timeouts (the
 *  measured 25-min-no-progress symptom). Greedy-pack within budget so the chosen models all stay
 *  loaded at once — no swap thrash. Always keep ≥1 model (one strong model beats three that thrash).
 *  Excludes the embedded Vai runtime model so we never evict the live app's model. */
export function pickRoster(installed, { budgetBytes, max = 3, exclude = [] } = {}) {
  const ex = new Set(exclude);
  const ranked = (installed || [])
    .filter((m) => m && m.name && !ex.has(m.name))
    .filter((m) => !budgetBytes || !m.sizeBytes || m.sizeBytes <= budgetBytes)
    .sort((a, b) =>
      (Number(isCoderModel(b.name)) - Number(isCoderModel(a.name))) || // coder models first
      ((b.sizeBytes ?? 0) - (a.sizeBytes ?? 0)));                      // then biggest-first
  if (!budgetBytes) return ranked.slice(0, max).map((m) => m.name);
  const chosen = [];
  let used = 0;
  for (const m of ranked) {
    if (chosen.length >= max) break;
    const size = Number(m.sizeBytes ?? 0);
    // Always take the first (best) model; take subsequent ones only if they still fit alongside.
    if (chosen.length === 0 || used + size <= budgetBytes) {
      chosen.push(m.name);
      used += size;
    }
  }
  return chosen;
}

/**
 * Mount one model with VRAM headroom, run `fn(model)`, and return its result — serial + guarded.
 * deps: { waitForHeadroom(budget), generate(model, prompt, opts) }. `fn` receives a bound generate.
 */
export async function withModelMounted(model, deps, fn) {
  const { waitForHeadroom, budgetBytes } = deps;
  if (waitForHeadroom) {
    // waitForHeadroom resolves with the CURRENT vram after its deadline (it doesn't throw). If it's
    // still over budget, ABORT instead of mounting anyway — mounting a model with no headroom is the
    // VRAM/BSOD hazard the guard exists to prevent (CodeRabbit #25).
    const vram = await waitForHeadroom(budgetBytes).catch(() => null);
    if (budgetBytes && typeof vram === 'number' && vram > budgetBytes) {
      throw new Error(`no VRAM headroom for ${model}: ${(vram / 1e9).toFixed(1)}GB > budget ${(budgetBytes / 1e9).toFixed(1)}GB`);
    }
  }
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
    `Reply with STRICT JSON only: {"best": <number>, "why": "<one sentence>"}. Pick the candidate most ` +
    `likely to be correct AND complete (a truncated or partial code edit is WRONG). Output ONLY that JSON object.`
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
