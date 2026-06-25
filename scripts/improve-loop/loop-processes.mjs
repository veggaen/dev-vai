/**
 * loop-processes — the live loop's phases, expressed as gated PROCESSES for the engine.
 *
 * The old supervisor ran every phase every cycle in fixed order. Here each phase becomes a
 * Process { id, when, cost, value, run } so the engine RUNS IT ONLY WHEN IT'S WORTH THE COMPUTE.
 * The phases delegate to the SAME working code (run.mjs child, innovation/experiment imports) —
 * we are changing WHEN/whether they run, not WHAT they do.
 *
 * cost is in compute units ≈ model calls (the scarce GPU resource the BSOD rule protects).
 * when()/value() are CHEAP + PURE: they read only the pre-computed ctx snapshot, never call a
 * model or scan the DB (that work is done once in buildLoopContext, not per-guard).
 *
 * Edge cases handled deliberately (see inline): cold-start (no data) must still observe; a
 * heavy process must never run when another is mid-flight (serial budget); a process that
 * produced nothing must not be counted as progress; every run reports a {produced} count so
 * the health metric can attribute motion.
 */
import {
  campaignClassStats, getLoopState, setLoopState, bumpLoopState, recordKnowledge,
} from './db.mjs';

/**
 * Read a cheap, real STATE SNAPSHOT once per cycle. The processes' when()/value() read ONLY
 * this object, so guards stay O(1) and side-effect-free. Heavy reads (class stats) happen once
 * here, not per-process. `motion` is the analyzeMotion result the caller already computes.
 */
export function buildLoopContext(db, { motion, cycle } = {}) {
  const classStats = safe(() => campaignClassStats(db), []);
  const failingClasses = classStats.filter((c) => Number(c.total) >= 4 && Number(c.passed) / Number(c.total) < 0.85);
  const worst = failingClasses.slice().sort((a, b) => (a.passed / a.total) - (b.passed / b.total))[0] ?? null;
  return {
    db,
    cycle: cycle ?? 0,
    motion: motion ?? { state: 'cold-start' },
    motionState: motion?.state ?? 'cold-start',
    passRate: motion?.passRate?.current ?? null,
    classStats,
    failingClassCount: failingClasses.length,
    worstClass: worst ? worst.class : null,
    worstPassRate: worst ? worst.passed / worst.total : null,
    cyclesSinceObserve: getLoopState(db, 'cyclesSinceObserve', 99),
    cyclesSinceVisual: getLoopState(db, 'cyclesSinceVisual', 99),
    cyclesSinceCapability: getLoopState(db, 'cyclesSinceCapability', 99),
    // openExperiment is read by the innovate/experiment processes' guards.
    hasData: classStats.some((c) => Number(c.total) >= 4),
  };
}
const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };

/**
 * Build the process registry inputs. `deps` injects the side-effecting runners so this is
 * unit-testable without spawning children or calling models:
 *   deps.runChild(script, args) → Promise<exitCode>   (heavy, spawns a model-using child)
 *   deps.closeExperiment(db)    → outcome              (cheap, imported)
 *   deps.planExperiment(db)     → plan                 (cheap, imported)
 *   deps.generateNovel(db, sc)  → id|null              (1 model call, only on exhaustion)
 *   deps.bus(db, base)          → string for run.mjs args
 * Returns an array of process declarations for createRegistry().
 */
export function defineLoopProcesses(deps = {}) {
  const {
    runChild = async () => 0,
    closeExperiment = () => ({ ran: false }),
    planExperiment = () => ({ recorded: false }),
    generateNovel = async () => null,
    runArgs = () => [],
    autoApply = false,
    // runPrototypeFor(ctx) → { adopted, valued, attribution } | null. Injected so the prototype
    // process is unit-testable without spawning propose-fix or sampling real quality. null when
    // there's no safe hypothesis to prototype this cycle.
    runPrototypeFor = async () => null,
    anyOpen = () => false,
  } = deps;

  return [
    {
      id: 'observe',
      description: 'run prompts through Vai + grade (grows the corpus, refreshes motion)',
      // Always eligible — observation is how the loop SEES; on cold-start it's the only way to
      // get data. Value is high when stale (no recent run) or when we have no data at all.
      when: () => true,
      cost: () => 8, // a batch of WS turns; the heaviest regular phase
      value: (ctx) => (!ctx.hasData ? 0.95 : ctx.cyclesSinceObserve > 1 ? 0.7 : 0.3),
      run: async (ctx) => {
        const code = await runChild('scripts/improve-loop/run.mjs', runArgs(ctx));
        setLoopState(ctx.db, 'cyclesSinceObserve', 0);
        return { produced: code === 0 ? 1 : 0, exitCode: code };
      },
    },
    {
      id: 'propose',
      description: 'localize a fix for the weakest failing class (verified, propose-only)',
      // Only worth it when there's a real failing class to fix. Cheap (1 model call).
      when: (ctx) => ctx.failingClassCount > 0 && !!ctx.worstClass,
      cost: () => 1,
      value: (ctx) => (ctx.worstPassRate != null ? 0.9 * (1 - ctx.worstPassRate) + 0.1 : 0),
      run: async (ctx) => {
        const code = await runChild('scripts/improve-loop/propose-fix.mjs', ['--class', ctx.worstClass]);
        if (autoApply) {
          await runChild('scripts/improve-loop/consensus-fix.mjs', ['--class', ctx.worstClass]);
          await runChild('scripts/improve-loop/apply-consensus.mjs', []);
        }
        return { produced: code === 0 ? 1 : 0, klass: ctx.worstClass };
      },
    },
    {
      id: 'close-experiment',
      description: 'adopt/discard the open experiment against post-queue runs (outcome feedback)',
      // Cheap, no model — pure corpus read. Only when something is open to close.
      when: (ctx) => safe(() => deps.anyOpen?.(ctx.db) ?? false, false),
      cost: () => 0,
      value: () => 0.6, // closing the loop on a past experiment is always worth its ~0 cost
      run: (ctx) => {
        const o = closeExperiment(ctx.db);
        return { produced: o.ran ? 1 : 0, adopted: !!o.adopted, abandoned: !!o.abandoned, evidence: o.evidence };
      },
    },
    {
      id: 'innovate',
      description: 'queue the next experiment (regression/stall/idle-speculation; or generate novel)',
      // Cheap (record only; generation is 1 call and only on exhaustion). Eligible once we have
      // data to read motion from. YIELDS TO PROTOTYPE: if there's a real fixable class, EXECUTING
      // a fix (prototype) beats QUEUING an experiment — and innovate opening an experiment would
      // block prototype via the one-change-at-a-time guard, starving the loop of real work (the
      // "perpetual but inactive" failure). So innovate only fires when prototype has nothing to do.
      when: (ctx) => ctx.hasData && !(ctx.failingClassCount > 0 && !!ctx.worstClass && !safe(() => anyOpen(ctx.db), false)),
      cost: (ctx) => (ctx.motionState === 'stalling' || ctx.motionState === 'regressing' ? 0.2 : 0.1),
      value: (ctx) => (ctx.motionState === 'regressing' ? 0.8 : ctx.motionState === 'stalling' ? 0.6 : 0.2),
      run: async (ctx) => {
        const plan = planExperiment(ctx.db);
        if (plan.recorded) return { produced: 1, trigger: plan.trigger, experimentId: plan.experimentId };
        if (plan.exhausted) {
          const id = await generateNovel(ctx.db, plan.scorecard);
          return { produced: id ? 1 : 0, generated: !!id, experimentId: id ?? null };
        }
        return { produced: 0, skip: plan.skipReason };
      },
    },
    {
      id: 'prototype',
      description: 'build the smallest verified artifact for the weakest class, value it (Δquality/compute), adopt only on positive measured delta',
      // The execution arm of the five-questions loop. Eligible only when (1) there's a real
      // failing class to fix (a safe, grounded hypothesis source), and (2) NO experiment is open
      // — one controlled change at a time, same discipline as innovate. Cost ≈ propose-fix call
      // + a quality re-sample; value scales with how weak the target class is (more to gain).
      when: (ctx) => ctx.failingClassCount > 0 && !!ctx.worstClass && !safe(() => anyOpen(ctx.db), false),
      cost: () => 2,
      value: (ctx) => (ctx.worstPassRate != null ? 0.9 * (1 - ctx.worstPassRate) + 0.15 : 0),
      run: async (ctx) => {
        const r = await runPrototypeFor(ctx);
        if (!r) return { produced: 0, skip: 'no prototype hypothesis this cycle' };
        return {
          produced: r.adopted ? 1 : 0,
          adopted: r.adopted,
          value: r.valued?.value ?? 0,
          verdict: r.valued?.verdict ?? null,
          attribution: r.attribution ?? null,
        };
      },
    },
    {
      id: 'visual',
      description: 'eyes/hands taste probe (no-video) — periodic, expensive',
      // Periodic: only worth the GPU when it's been a while. The cadence is value-driven, not a
      // hardcoded `cycle % N` — the engine decides if its density beats the alternatives.
      // PRECONDITION: requires observed data first. A taste probe has nothing to ground against
      // before the loop has observed anything, and on a cold/fresh DB cyclesSinceVisual defaults
      // high (99) — without this gate visual out-densities observe and STARVES the bootstrap step
      // (the cold-start "must still observe" invariant). So visual yields until there's data.
      when: (ctx) => ctx.hasData && ctx.cyclesSinceVisual >= 3,
      cost: () => 3,
      value: (ctx) => Math.min(0.6, 0.1 + 0.08 * ctx.cyclesSinceVisual),
      run: async (ctx) => {
        const code = await runChild('scripts/improve-loop/operator.mjs', ['visual', '--no-video']);
        setLoopState(ctx.db, 'cyclesSinceVisual', 0);
        return { produced: code === 0 ? 1 : 0 };
      },
    },
    {
      id: 'capability',
      description: 'generative capability council → backlog (feature-level proposals)',
      // The most expensive process. Only when long overdue, so it never crowds out cheaper,
      // higher-density work. This is where "spend the move well" matters most.
      when: (ctx) => ctx.cyclesSinceCapability >= 8,
      cost: () => 12,
      value: (ctx) => Math.min(0.7, 0.2 + 0.05 * ctx.cyclesSinceCapability),
      run: async (ctx) => {
        const code = await runChild('scripts/improve-loop/capability-engine.mjs', []);
        setLoopState(ctx.db, 'cyclesSinceCapability', 0);
        return { produced: code === 0 ? 1 : 0 };
      },
    },
  ];
}

/** After a cycle, advance the periodic counters for processes that did NOT run this cycle, so
 *  their cyclesSince* grows and they eventually become eligible again. ran = ids that ran. */
export function advanceCycleCounters(db, ran = []) {
  if (!ran.includes('observe')) bumpLoopState(db, 'cyclesSinceObserve', 1);
  if (!ran.includes('visual')) bumpLoopState(db, 'cyclesSinceVisual', 1);
  if (!ran.includes('capability')) bumpLoopState(db, 'cyclesSinceCapability', 1);
}
