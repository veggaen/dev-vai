/**
 * Innovation Engine — managed experiments for the perpetual improvement loop.
 *
 * The reactive loop (observe→propose→converge→apply) fixes KNOWN failure classes.
 * This is the meta-layer: when the loop's own MOTION goes flat (motion.mjs reports
 * 'stalling' — both the pass-rate and answer-excellence gradients have plateaued),
 * grinding the same lane is meta-slop. The honest move is to try something NEW —
 * a different model, a tighter prompt, a stricter grader, a fresh seed class — and
 * MEASURE whether it actually beat the baseline.
 *
 * planNextExperiment() closes that meta-loop: it reads the cross-run series, asks
 * motion.mjs whether the loop is spinning, builds a deterministic scorecard from
 * real DB signals, lets suggestExperiment pick the highest-leverage experiment,
 * and (only when stalled, and only if an identical one isn't already queued)
 * RECORDS it for the human/architect to run. It never executes the experiment —
 * same propose-only contract as the rest of the loop.
 */
import { analyzeMotion } from './motion.mjs';
import { speculate } from './speculator.mjs';
import {
  campaignTrend,
  answerExcellenceTrend,
  proposalQualityStats,
  councilResponseRate,
  lowExcellenceCount,
} from './db.mjs';

/** Which cross-run gradient an experiment of this type is trying to move — so the
 *  runner measures the RIGHT metric for outcome feedback. Grading experiments aim
 *  at answer-craft; everything else (model/prompt/seed_class) aims at pass-rate. */
export function targetMetric(type) {
  return type === 'grading' ? 'excellence' : 'passRate';
}

/** Adoption bars: a treatment must beat its baseline by at least this much to be
 *  ADOPTED (else discarded). Pass-rate is 0..1 (+2pp); excellence is 0..10 (+0.2). */
export const ADOPT_THRESHOLD = 0.02;
export const ADOPT_THRESHOLD_EXCELLENCE = 0.2;

/**
 * Minimum graded prompts a run must contain to count as a MOTION sample.
 *
 * Why this exists (measured, not guessed): the corpus had runs of 1, 3, 41, 8 prompts
 * intermixed. A 1/1 or 3/3 run trivially scores 100%, and a `--seeds-only --limit 1`
 * probe is a 100% outlier too. Treating every run as one equal point made the pass-rate
 * series oscillate 0.25↔1.00 on sample-size noise, so analyzeMotion read it as forever
 * `improving`/`warming` and NEVER `stalling` — which is the only state that triggers
 * INNOVATE. Net effect: experiments=0 forever; the loop was blind to its own real trend
 * (which, once the noise is filtered, is actually REGRESSING). A run needs a real sample
 * before its rate is signal, not noise. 8 ≈ one prompt per seed class.
 */
export const MIN_MOTION_SAMPLE = 8;

/** Start a new experiment. Returns the experiment id. */
export function startExperiment(db, { type, hypothesis, config, baselineScore }) {
  ensureExperimentTable(db);
  const info = db.prepare(
    `INSERT INTO experiments (type, hypothesis, config, baseline_score, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(type, hypothesis, JSON.stringify(config), baselineScore ?? null, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

/** Record the result of a completed experiment. */
export function finishExperiment(db, experimentId, { experimentScore, delta, adopted, evidence }) {
  db.prepare(
    `UPDATE experiments SET experiment_score = ?, delta = ?, adopted = ?, evidence = ? WHERE id = ?`,
  ).run(experimentScore, delta, adopted ? 1 : 0, evidence, experimentId);
}

/** Get recent experiments, newest first. */
export function experimentHistory(db, limit = 15) {
  ensureExperimentTable(db);
  try {
    return db.prepare('SELECT * FROM experiments ORDER BY id DESC LIMIT ?').all(limit);
  } catch { return []; }
}

/** Get the best-performing experiment of a given type. */
export function bestExperiment(db, type) {
  ensureExperimentTable(db);
  try {
    return db.prepare(
      'SELECT * FROM experiments WHERE type = ? AND adopted = 1 ORDER BY delta DESC LIMIT 1',
    ).get(type) ?? null;
  } catch { return null; }
}

/**
 * Build the deterministic scorecard suggestExperiment reads. Pure: every input is
 * an already-measured primitive (motion verdicts + DB stat objects), so it unit-tests
 * without I/O. `motion` is the analyzeMotion() result; the rest are db.mjs stats.
 */
export function buildScorecard({ motion = {}, proposal = {}, council = {}, excellence = {} } = {}) {
  const passRate = motion.passRate ?? {};
  const ex = motion.excellence ?? {};
  return {
    motion,
    state: motion.state ?? 'cold-start',
    passRate: { current: passRate.current ?? 0, slope: passRate.slope ?? 0, verdict: passRate.verdict ?? 'flat' },
    excellence: { current: ex.current ?? null, slope: ex.slope ?? 0, verdict: ex.verdict ?? 'flat' },
    proposalQuality: { hitRate: proposal.hitRate ?? 0, total: proposal.total ?? 0 },
    councilHealth: { responseRate: council.responseRate ?? 1 },
    // slop here = weak-craft answers; the count drives the grading fallback branch.
    slopScore: { score: excellence.low ?? 0, graded: excellence.graded ?? 0 },
  };
}

/**
 * Rank the candidate experiments best-first. Returns an ORDERED list (never empty)
 * so planNextExperiment can fall through to the next-best when the top pick is a
 * known dead end (already queued or tried-and-rejected). Without this fall-through,
 * a stall whose best experiment is already tried would skip the whole cycle and the
 * loop would spin forever — the exact meta-slop the motion meter exists to kill.
 */
export function rankExperiments(scorecard) {
  // TOP PRIORITY: motion-aware branches. A stall is the explicit trigger to innovate,
  // and WHICH gradient is flat tells us WHAT to change first — but we always return
  // the OTHER stall levers as fall-backs so a deduped top pick doesn't waste the cycle.
  const motion = scorecard.motion;
  const stalled = scorecard.state === 'stalling' || motion?.stagnation?.stalled;

  const grading = {
    type: 'grading',
    hypothesis: 'Pass-rate is maxed but answer-excellence has plateaued — raise the excellence bar (stricter answer rubric / craft-focused prompt) to open a new gradient to climb.',
    config: { target: 'answer-rubric', variant: 'raise-excellence-bar' },
  };
  const model = {
    type: 'model',
    hypothesis: 'Both gradients flat across the window — the current model has plateaued; try a different council model to break the stall.',
    config: { target: 'council-member', variant: 'qwen2.5-coder:7b' },
  };
  const prompt = {
    type: 'prompt',
    hypothesis: 'Loop is spinning with one gradient still soft — tighten the proposal prompt (more grep-grounded evidence) to break the stall.',
    config: { target: 'propose-fix', variant: 'tighter-grounding' },
  };
  const explore = {
    type: 'seed_class',
    hypothesis: 'Explore edge cases in existing strong classes',
    config: { target: 'seeds', variant: 'adversarial' },
  };

  // A REGRESSION is a stronger innovate trigger than a stall: the loop isn't just
  // spinning, it's getting WORSE on a real-sample gradient. Without this branch a
  // regressing loop fell through to the generic non-stall ranking and was NEVER
  // recorded (planNextExperiment only records on stalling) — so a declining loop
  // generated zero corrective experiments. WHICH gradient regressed picks the lever.
  if (scorecard.state === 'regressing') {
    const passRegressing = (motion?.passRate?.verdict ?? 'flat') === 'regressing';
    const regress = {
      type: passRegressing ? 'prompt' : 'grading',
      hypothesis: passRegressing
        ? `Pass-rate is REGRESSING (now ${Math.round((motion?.passRate?.current ?? 0) * 100)}%) — a recent change or corpus drift is hurting reads; tighten the proposal prompt and re-verify against the failing rows before generating more work.`
        : `Answer-excellence is REGRESSING (now ${(motion?.excellence?.current ?? 0).toFixed(1)}/10) — craft is sliding; raise the excellence bar and re-grade.`,
      config: { target: passRegressing ? 'propose-fix' : 'answer-rubric', variant: 'arrest-regression' },
    };
    return [regress, model, prompt, grading, explore];
  }

  if (stalled) {
    const exFlat = (motion?.excellence?.verdict ?? 'flat') === 'flat';
    const passFlat = (motion?.passRate?.verdict ?? 'flat') === 'flat';
    const passHigh = (motion?.passRate?.current ?? 0) >= 0.85;
    let ranked;
    if (passHigh && exFlat) ranked = [grading, model, prompt];
    else if (passFlat && exFlat) ranked = [model, grading, prompt];
    else ranked = [prompt, model, grading];
    return [...ranked, explore];
  }

  const ranked = [];
  if (scorecard.proposalQuality.hitRate < 0.3 && scorecard.proposalQuality.total > 3) {
    ranked.push({
      type: 'prompt',
      hypothesis: 'Tighter proposal prompt with file-level grep evidence may improve hit rate',
      config: { target: 'propose-fix', variant: 'grep-grounded' },
    });
  }
  if (scorecard.councilHealth.responseRate < 0.6) {
    ranked.push({
      type: 'model',
      hypothesis: 'A different model may produce more parseable council responses',
      config: { target: 'council-member', variant: 'qwen2.5-coder:7b' },
    });
  }
  if (scorecard.passRate.current > 0.85) {
    ranked.push({
      type: 'seed_class',
      hypothesis: 'Add a new failure class to cover untested behavior',
      config: { target: 'seeds', variant: 'conversational-followup' },
    });
  }
  if (scorecard.slopScore.score > 15) {
    ranked.push({
      type: 'grading',
      hypothesis: 'Stricter vague-answer threshold may reduce slop false negatives',
      config: { target: 'brain', variant: 'strict-vague-threshold' },
    });
  }
  ranked.push(explore);
  return ranked;
}

/** The single best experiment (the head of the ranked list). Kept for callers and
 *  previews that only want the top pick. */
export function suggestExperiment(scorecard) {
  return rankExperiments(scorecard)[0];
}

/**
 * How many MEASURED experiments must close after a rejected one before that same
 * variant becomes eligible to retry. This is what makes the FINITE hard-coded candidate
 * pool self-replenishing IN TIME: a permanent ban ("tried once, never again") meant that
 * once each of the ~6 variants was rejected, the loop produced ZERO experiments forever —
 * the slow second death of the experiment arc. But the codebase MOVES; an idea that
 * failed N cycles ago (against different source) deserves a fresh trial once the world
 * has changed enough. 0 = always re-eligible (no cooldown); large = effectively permanent.
 *
 * MUST stay below the deterministic candidate-pool size (~5) or the pool can deadlock:
 * if cooldown ≥ pool size, the oldest-rejected variant never accrues enough post-rejection
 * closures to become eligible, and every candidate stays blocked forever. 3 lets the pool
 * rotate while still giving each idea a few cycles of rest before a retry. (The generated-
 * candidate fallback is the real INFINITE source; this just keeps the base pool alive.)
 */
export const RETRY_COOLDOWN = 3;

/**
 * Anti-repetition WITH cooldown re-eligibility. A perpetual loop's worst meta-failure is
 * re-proposing the same dead end forever (re-trying every cycle) — but its SECOND-worst is
 * banning every idea forever (never re-trying anything), which exhausts a finite pool and
 * kills the arc. This balances both:
 *   - An OPEN experiment of this variant always blocks (don't stack duplicates).
 *   - A REJECTED one blocks only while it is still within RETRY_COOLDOWN — measured by how
 *     many other experiments have CLOSED since it was rejected (a cycle proxy that needs no
 *     clock). Past the cooldown it becomes eligible again, so the pool replenishes in time.
 * Pass { cooldown: 0 } to restore the old permanent-ban behaviour (used where retrying is
 * genuinely never wanted).
 */
export function hasOpenExperiment(db, { type, config } = {}, { cooldown = RETRY_COOLDOWN } = {}) {
  if (!type) return false;
  ensureExperimentTable(db);
  const variant = config?.variant ?? null;
  try {
    const sameVariant = (cfg) => {
      try { return (JSON.parse(cfg)?.variant ?? null) === variant; } catch { return false; }
    };
    // OPEN of this variant ⇒ always blocks.
    const open = db.prepare('SELECT config FROM experiments WHERE type = ? AND delta IS NULL').all(type);
    if (open.some((r) => sameVariant(r.config))) return true;
    // REJECTED of this variant ⇒ blocks only if still inside the cooldown window. We find
    // the most-recent rejected row for the variant, then count how many experiments have
    // closed (delta NOT NULL) with a HIGHER id — i.e. cycles elapsed since that rejection.
    const rejected = db
      .prepare('SELECT id, config FROM experiments WHERE type = ? AND adopted = 0 AND delta IS NOT NULL ORDER BY id DESC')
      .all(type)
      .filter((r) => sameVariant(r.config));
    if (rejected.length === 0) return false;
    if (cooldown <= 0) return false; // cooldown disabled ⇒ rejected never blocks (always retry)
    const lastRejectedId = rejected[0].id;
    const closedSince = db
      .prepare('SELECT COUNT(*) c FROM experiments WHERE delta IS NOT NULL AND id > ?')
      .get(lastRejectedId).c;
    return closedSince < cooldown; // still cooling down ⇒ block; past it ⇒ eligible again
  } catch { return false; }
}

/**
 * Is ANY experiment currently open (delta IS NULL = queued, not yet measured)? The
 * idle-speculation path uses this to avoid stacking exploratory experiments: when the
 * loop is healthy we probe ahead only if nothing is already pending close-out, so the
 * experiment-runner can adopt/discard the open one before we queue the next.
 */
export function anyOpenExperiment(db) {
  ensureExperimentTable(db);
  try {
    return db.prepare('SELECT 1 FROM experiments WHERE delta IS NULL LIMIT 1').get() != null;
  } catch { return false; }
}

/**
 * The meta-loop: read the cross-run series, ask motion.mjs whether the loop is
 * spinning, build the scorecard, pick the next experiment — and, only when STALLED
 * and only if an identical one isn't already queued, RECORD it (propose-only).
 *
 * @param db open corpus DB
 * @param {{ record?: boolean }} opts  record=true persists the experiment (supervisor);
 *   record=false is a read-only preview (operator status).
 * @returns {{ motion, scorecard, suggestion, recorded, experimentId, skipReason }}
 */
export function planNextExperiment(db, { record = false } = {}) {
  // Sample-size gate (MIN_MOTION_SAMPLE): only runs with a real prompt count feed the
  // motion series. This is what lets the loop SEE a stall/regression instead of drowning
  // in 100% noise from 1- and 3-prompt probe runs (see MIN_MOTION_SAMPLE rationale).
  const passSeries = campaignTrend(db)
    .filter((r) => Number(r.total) >= MIN_MOTION_SAMPLE)
    .map((r) => Number(r.passed) / Number(r.total));
  const excellenceSeries = answerExcellenceTrend(db)
    .filter((r) => Number(r.n) >= MIN_MOTION_SAMPLE && r.avg != null)
    .map((r) => Number(r.avg));

  const motion = analyzeMotion({ passRate: passSeries, excellence: excellenceSeries });
  const scorecard = buildScorecard({
    motion,
    proposal: proposalQualityStats(db),
    council: councilResponseRate(db),
    excellence: lowExcellenceCount(db),
  });
  // Heuristic base order, then re-rank by the evidence-bound EV prior (history of
  // adopted experiments). No history ⇒ stable ⇒ base order preserved.
  const ranked = speculate(db, rankExperiments(scorecard));

  const result = { motion, scorecard, suggestion: ranked[0], recorded: false, experimentId: null, skipReason: null, trigger: null };

  // TRIGGER POLICY — when does the loop record a new experiment?
  //   1. regressing — getting WORSE on a real-sample gradient. The strongest signal:
  //      always innovate to arrest it.
  //   2. stalling   — spinning, both gradients flat. Innovate to break the plateau.
  //   3. idle-speculation — the user's "when there's nothing to do, speculate" ask
  //      (think many steps ahead, Magnus-Carlsen style). Fire ONLY when the loop is
  //      healthy AND nothing is pending (no open experiment, no fresh proposals to
  //      run), so we probe ahead instead of idling — but never crowd out real work.
  const stalled = motion.state === 'stalling' || motion.stagnation?.stalled;
  const regressing = motion.state === 'regressing';

  // ONE open experiment at a time — for EVERY trigger. An experiment is a controlled
  // A/B: queue it, let the experiment-runner accumulate runs and adopt/discard it, THEN
  // queue the next. Stacking experiments would confound their measurements (which change
  // moved the metric?) and let a regressing loop pile up dozens of un-closed arms. So if
  // anything is already pending close-out, wait — regardless of how loud the trigger is.
  if (anyOpenExperiment(db)) {
    result.skipReason = `${motion.state}; an experiment is already open (close it before queuing the next)`;
    return result;
  }
  if (stalled || regressing) {
    result.trigger = regressing ? 'regression' : 'stall';
  } else if (motion.state === 'improving' || motion.state === 'warming') {
    // Idle-speculation: the loop is HEALTHY and nothing is pending — think ahead instead
    // of idling. Requires real motion data (cold-start = too few samples to speculate
    // meaningfully → keep observing, don't burn GPU on a guess).
    result.trigger = 'idle-speculation';
  } else {
    result.skipReason = `not actionable (${motion.state})`;
    return result;
  }

  // Skip-already-tried: fall through the ranked candidates to the first that ISN'T a
  // known dead end (open, or rejected-within-cooldown). A stall whose top pick is already
  // queued must try the next-best, not waste the cycle. When EVERY deterministic candidate
  // is blocked we set `exhausted` so the caller can fall back to the GENERATED idea source
  // (experiment-generator) — the infinite, self-replenishing pool. Without that fallback an
  // exhausted pool would mean zero experiments until the cooldown rotates one back in.
  const fresh = ranked.find((e) => !hasOpenExperiment(db, e));
  if (!fresh) {
    result.exhausted = true;
    result.skipReason = 'deterministic pool exhausted (caller may generate a novel candidate)';
    return result;
  }
  result.suggestion = fresh;
  if (!record) { result.skipReason = 'preview only'; return result; }

  result.experimentId = recordCandidate(db, fresh, scorecard);
  result.recorded = true;
  return result;
}

/**
 * Record a candidate experiment with a baseline in the TARGET metric's own units (so the
 * runner compares like-for-like: grading vs excellence, everything else vs pass-rate).
 * Shared by the deterministic path and the generated-candidate fallback. Returns the id.
 */
export function recordCandidate(db, candidate, scorecard) {
  const metric = targetMetric(candidate.type);
  const baselineScore = metric === 'excellence'
    ? (scorecard.excellence.current ?? scorecard.passRate.current)
    : scorecard.passRate.current;
  return startExperiment(db, {
    type: candidate.type,
    hypothesis: candidate.hypothesis,
    config: candidate.config,
    baselineScore,
  });
}

/** One-line summary. delta is rendered in the experiment's native units: pass-rate
 *  as a percentage-point move, excellence as a /10 craft move. */
export function formatExperiment(exp) {
  let status = 'in progress';
  if (exp.delta != null) {
    const arrow = exp.delta > 0 ? '↑' : exp.delta < 0 ? '↓' : '→';
    const shown = targetMetric(exp.type) === 'excellence'
      ? `${(exp.delta).toFixed(2)}/10`
      : `${(exp.delta * 100).toFixed(1)}%`;
    status = `${arrow} delta=${shown}${exp.adopted ? ' ADOPTED' : ''}`;
  }
  return `[${exp.type}] ${exp.hypothesis ?? ''} — ${status}`;
}

function ensureExperimentTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS experiments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    hypothesis TEXT,
    config TEXT,
    baseline_score REAL,
    experiment_score REAL,
    delta REAL,
    adopted INTEGER DEFAULT 0,
    evidence TEXT,
    created_at TEXT NOT NULL
  )`);
}
