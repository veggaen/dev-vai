/**
 * process-engine — the missing CORE that makes the loop perpetual by METHODOLOGY, not data.
 *
 * The old supervisor ran a HARDCODED sequence every cycle (observe→propose→…→innovate),
 * spending compute on every step whether or not it was worth it. That is not perpetual — it
 * is a fixed pipeline on a timer. A perpetual self-making system must instead CHOOSE, each
 * cycle, which process is worth running NOW given the state and the goal, and skip the rest.
 *
 * The asset here is the SET of processes + the SELECTION POLICY — not a growing data store.
 * Each Process is a first-class unit that declares:
 *   - id        unique name
 *   - when(ctx) cheap, pure guard: is this even eligible right now? (no model, no GPU)
 *   - cost(ctx) estimated compute units it will spend (model calls ≈ GPU; the scarce thing)
 *   - value(ctx) estimated payoff in [0,1+] if it runs and succeeds (cheap heuristic)
 *   - run(ctx)  the actual work (may itself call selectAndRun → dynamic, arbitrary depth)
 *
 * The evaluator picks by EXPECTED VALUE PER UNIT COMPUTE (value / cost), the Carlsen move:
 * not "what can I do" but "what is the highest-leverage move per scarce resource". A process
 * is run only if eligible AND its density clears a floor AND the cycle's compute budget allows
 * it. This is where "use less compute" comes from — structurally, by construction.
 *
 * Pure + I/O-free: processes carry their own side effects in run(); the engine only decides
 * and sequences. Fully unit-testable with in-memory fake processes.
 */

/** Minimum value-per-compute a process must clear to be worth running. Below this, skipping
 *  and saving the compute is the better move (the anti-waste floor). */
export const DENSITY_FLOOR = 0.05;

/** Validate + normalise a process declaration. Throws on a malformed one (fail fast — a bad
 *  process in the registry is a programming error, not a runtime condition to swallow). */
export function defineProcess(p) {
  if (!p || typeof p.id !== 'string' || !p.id) throw new Error('process needs a string id');
  if (typeof p.run !== 'function') throw new Error(`process ${p.id} needs a run()`);
  return {
    id: p.id,
    description: p.description ?? '',
    when: typeof p.when === 'function' ? p.when : () => true,
    cost: typeof p.cost === 'function' ? p.cost : () => Number(p.cost ?? 1),
    value: typeof p.value === 'function' ? p.value : () => Number(p.value ?? 0.5),
    run: p.run,
  };
}

/** A registry is just an id→process map with insertion order preserved for stable tie-breaks. */
export function createRegistry(processes = []) {
  const map = new Map();
  for (const p of processes) {
    const np = defineProcess(p);
    if (map.has(np.id)) throw new Error(`duplicate process id: ${np.id}`);
    map.set(np.id, np);
  }
  return map;
}

/** Minimum effective cost for density. Every process consumes at least a cycle slot, so no process
 *  is truly "free" — flooring here stops a ~0-cost bookkeeping step from scoring near-infinite density
 *  and winning every cycle (the meta-slop starvation bug). 0.25 ≈ a quarter of a cheap model call. */
export const MIN_COST = 0.25;

/**
 * Score every process against the context. Returns ALL of them (eligible or not) with their
 * decision math, ordered best-density-first among the eligible, so a caller/dashboard can SEE
 * why each ran or was skipped. density = value / max(cost, MIN_COST). Pure — calls when/cost/value,
 * never run(). when()/cost()/value() are expected to be cheap and side-effect-free.
 */
export function scoreProcesses(registry, ctx = {}) {
  const scored = [];
  let order = 0;
  for (const p of registry.values()) {
    const i = order++;
    let eligible = false; let cost = 1; let value = 0; let density = 0; let reason = '';
    try { eligible = !!p.when(ctx); } catch (e) { eligible = false; reason = `when() threw: ${String(e).slice(0, 40)}`; }
    if (eligible) {
      try { cost = Math.max(Number(p.cost(ctx)) || 0, 0); } catch { cost = 1; }
      try { value = Math.max(Number(p.value(ctx)) || 0, 0); } catch { value = 0; }
      // MIN_COST floor: a near-zero cost must NOT mean near-infinite density. With a 1e-6 floor a
      // "free" bookkeeping process scored ~600000 density and won EVERY cycle, starving observe/
      // prototype — the loop ran forever doing nothing (meta-slop). A real minimum (every process
      // still consumes a turn/slot) keeps density a fair value-per-real-effort comparison.
      density = value / Math.max(cost, MIN_COST);
      reason = `density ${density.toFixed(3)} (value ${value.toFixed(2)} / cost ${cost})`;
    } else if (!reason) {
      reason = 'not eligible (when=false)';
    }
    scored.push({ id: p.id, eligible, cost, value, density, reason, _i: i });
  }
  // Eligible first, then by density desc, then registry order (stable, explainable).
  scored.sort((a, b) =>
    (Number(b.eligible) - Number(a.eligible)) ||
    (b.density - a.density) ||
    (a._i - b._i));
  return scored.map(({ _i, ...s }) => s);
}

/**
 * Pick the processes to run THIS cycle: eligible, density ≥ floor, greedily filling the
 * compute budget best-density-first. Returns the chosen ids in run order + the full scorecard
 * (for transparency). budget is in the same units as cost() (≈ model calls). budget=Infinity
 * runs everything eligible above the floor; a finite budget is the compute cap per cycle.
 */
export function plan(registry, ctx = {}, { budget = Infinity, floor = DENSITY_FLOOR } = {}) {
  const scorecard = scoreProcesses(registry, ctx);
  const chosen = [];
  let spent = 0;
  // Re-entrancy guard: a process already on the active call stack must not re-select itself
  // (an always-eligible process that composes sub-processes would otherwise recurse on itself
  // until the depth cap — wasted compute, not composition). ctx._active is the stack set.
  const active = ctx._active instanceof Set ? ctx._active : null;
  for (const s of scorecard) {
    if (!s.eligible) break;          // eligible are sorted first; once we hit one, we're done
    if (active && active.has(s.id)) continue; // already running upstack → don't re-enter
    if (s.density < floor) continue; // not worth the compute right now → skip (the anti-waste move)
    if (spent + s.cost > budget) continue; // would blow the cycle budget → skip, try a cheaper one
    chosen.push(s.id);
    spent += s.cost;
  }
  return { chosen, spent, budget, scorecard };
}

/**
 * Evaluate, then RUN the chosen processes for one cycle. Each run() gets ctx plus a `depth`
 * and a `selectAndRun` it can call to compose sub-processes (dynamic, arbitrary-depth chains —
 * the "12 layers or more" requirement). Records a per-process outcome { id, ok, ms, result,
 * error } so the caller can measure realised value-per-compute and improve the policy.
 *
 * Crash-safe by contract: a process's run() rejection is caught and recorded, never aborts the
 * cycle (one bad process must not stop the perpetual loop). Strictly serial — one run() at a
 * time — honouring the single-GPU / BSOD rule.
 */
export async function runCycle(registry, ctx = {}, opts = {}) {
  const { budget = Infinity, floor = DENSITY_FLOOR, depth = 0, maxDepth = 12, onEvent } = opts;
  const emit = (e) => { try { onEvent?.({ depth, ...e }); } catch {} };

  if (depth > maxDepth) return { ran: [], outcomes: [], plan: null, halted: 'max-depth' };

  // The active-stack set (processes currently running upstack) — created once at the top and
  // carried down so re-entrancy is prevented at every depth, not just the first.
  const active = ctx._active instanceof Set ? ctx._active : new Set();

  const planned = plan(registry, { ...ctx, _active: active }, { budget, floor });
  emit({ type: 'plan', chosen: planned.chosen, spent: planned.spent, budget, scorecard: planned.scorecard });

  const outcomes = [];
  for (const id of planned.chosen) {
    const p = registry.get(id);
    const startedAt = Date.now();
    emit({ type: 'run:start', id });
    active.add(id);
    // selectAndRun carries the active set so a composed sub-cycle can't re-enter THIS process.
    const selectAndRun = (subCtx = ctx, subOpts = {}) =>
      runCycle(registry, { ...subCtx, _active: active }, { budget, floor, ...subOpts, depth: depth + 1, maxDepth, onEvent });
    try {
      const result = await p.run({ ...ctx, depth, selectAndRun });
      const outcome = { id, ok: true, ms: Date.now() - startedAt, result };
      outcomes.push(outcome);
      emit({ type: 'run:done', ...outcome });
    } catch (error) {
      const outcome = { id, ok: false, ms: Date.now() - startedAt, error: String(error).slice(0, 200) };
      outcomes.push(outcome);
      emit({ type: 'run:error', ...outcome });
    } finally {
      active.delete(id); // off the stack — eligible again for a LATER cycle, just not re-entrant now
    }
  }
  return { ran: planned.chosen, outcomes, plan: planned, halted: null };
}
