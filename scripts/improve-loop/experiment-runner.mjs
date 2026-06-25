/**
 * experiment-runner — closes the meta-loop. planNextExperiment QUEUES an experiment
 * when the loop stalls (a hypothesis + a baseline in the target metric's units). This
 * module CLOSES it: once at least one fresh run has accumulated SINCE the experiment
 * was queued, it measures the target metric now (the "treatment"), compares it to the
 * stored baseline, and ADOPTS or DISCARDS the experiment via finishExperiment.
 *
 * That is the difference between "the loop wrote down what to try" (open-loop) and
 * "the loop proved whether it worked" (closed-loop outcome feedback). It is the piece
 * that lets the perpetual loop LEARN what is effective instead of guessing forever.
 *
 * Honest by construction:
 *   - It never declares a result without post-queue evidence (≥1 new run).
 *   - The measurement is deterministic (reads the corpus series), and injectable
 *     (`opts.measure`) so the orchestration unit-tests without live services.
 *   - It records the discard too — a tried-and-rejected experiment is what
 *     hasOpenExperiment() reads to stop the loop re-proposing the same dead end.
 */
import { campaignTrend, answerExcellenceTrend } from './db.mjs';
import {
  finishExperiment,
  targetMetric,
  ADOPT_THRESHOLD,
  ADOPT_THRESHOLD_EXCELLENCE,
  MIN_MOTION_SAMPLE,
} from './innovation-engine.mjs';

/** Abandon an experiment after this many runs have STARTED since it was queued without ever
 *  yielding a measurable motion sample. The deadlock guard for the one-open-at-a-time policy:
 *  an experiment that can never be measured must not block the arc forever. Generous (the
 *  normal case closes in 1-2 runs) so we only abandon genuinely stuck arms. */
export const STALE_RUNS = 8;

/** How many runs have been STARTED strictly after an ISO timestamp (the staleness clock).
 *  Counts ALL runs, not just motion-qualifying ones, so a stream of tiny probe runs still
 *  ages an experiment toward abandonment instead of trapping it. */
export function countRunsSince(db, sinceIso) {
  try {
    return db.prepare('SELECT COUNT(*) c FROM runs WHERE started_at > ?').get(sinceIso ?? '').c;
  } catch { return 0; }
}

/** The oldest still-open (unfinished) experiment, or null. FIFO so the loop closes
 *  what it queued earliest before opening new questions. */
export function nextOpenExperiment(db) {
  try {
    return db.prepare('SELECT * FROM experiments WHERE delta IS NULL ORDER BY id ASC LIMIT 1').get() ?? null;
  } catch { return null; }
}

/**
 * Current value of a cross-run metric + how many runs carry it strictly AFTER a
 * timestamp (the post-queue evidence gate). ISO timestamps compare lexically.
 *
 * Uses the SAME sample-size filter (MIN_MOTION_SAMPLE) the baseline was measured under,
 * so baseline-vs-treatment is a like-for-like A/B. Mixing a filtered baseline with an
 * unfiltered treatment would let a tiny 100% post-queue probe fake an adoption — the
 * exact noise the filter exists to remove. samplesSince also counts only REAL runs, so
 * the evidence gate ("≥1 post-queue run") isn't satisfied by a throwaway 1-prompt probe.
 * @returns {{ value: number|null, samplesSince: number }}
 */
export function measureCorpusMetric(db, metric, sinceIso) {
  const since = sinceIso ?? '';
  if (metric === 'excellence') {
    const rows = answerExcellenceTrend(db).filter((r) => Number(r.n) >= MIN_MOTION_SAMPLE && r.avg != null);
    const series = rows.map((r) => Number(r.avg));
    const after = rows.filter((r) => String(r.started_at) > since).length;
    return { value: series.length ? series[series.length - 1] : null, samplesSince: after };
  }
  const rows = campaignTrend(db).filter((r) => Number(r.total) >= MIN_MOTION_SAMPLE);
  const series = rows.map((r) => Number(r.passed) / Number(r.total));
  const after = rows.filter((r) => String(r.started_at) > since).length;
  return { value: series.length ? series[series.length - 1] : null, samplesSince: after };
}

/**
 * Run (close out) one queued experiment.
 * @param db open corpus DB
 * @param exp an experiments row (from nextOpenExperiment)
 * @param {{ measure?: (metric,exp)=>({value,samplesSince}), adoptThreshold?, adoptThresholdExcellence? }} opts
 * @returns {{ ran, experimentId, reason?, metric?, baseline?, treatment?, delta?, adopted?, evidence? }}
 */
export function runExperiment(db, exp, opts = {}) {
  if (!exp || exp.id == null) return { ran: false, experimentId: null, reason: 'no experiment' };
  const metric = targetMetric(exp.type);

  // PERPETUALITY SAFETY VALVE. An experiment that can NEVER be measured (null baseline) would
  // stay open forever — and a single permanently-open experiment deadlocks the whole arc via
  // the one-open-at-a-time guard (no new experiment can ever be queued). So we don't just
  // refuse it: we ABANDON it (close it, adopted=0) so it stops blocking. A discard for an
  // unmeasurable arm is the honest outcome — there's no evidence to adopt on.
  if (exp.baseline_score == null) {
    finishExperiment(db, exp.id, { experimentScore: null, delta: 0, adopted: false, evidence: 'abandoned: no baseline recorded (unmeasurable)' });
    return { ran: true, experimentId: exp.id, adopted: false, abandoned: true, reason: 'abandoned: no baseline' };
  }

  const measure = opts.measure ?? ((m) => measureCorpusMetric(db, m, exp.created_at));
  const m = measure(metric, exp) ?? { value: null, samplesSince: 0 };
  if (m.samplesSince < 1 || m.value == null) {
    // Legitimately waiting (the next real run will provide the post-queue sample) — UNLESS
    // it has gone stale: many runs have STARTED since it was queued yet none produced a
    // qualifying motion sample. Left open, a stale experiment deadlocks the one-open guard
    // forever, so past STALE_RUNS we abandon it to keep the arc moving (perpetuality > a
    // single unmeasurable arm). Age is counted in runs started, not the filtered samples,
    // so a corpus that only ever runs tiny probes can't trap an experiment indefinitely.
    const runsSince = opts.runsSince ?? countRunsSince(db, exp.created_at);
    const staleLimit = opts.staleRuns ?? STALE_RUNS;
    if (runsSince >= staleLimit) {
      finishExperiment(db, exp.id, { experimentScore: null, delta: 0, adopted: false, evidence: `abandoned: stale after ${runsSince} runs with no measurable ${metric} sample` });
      return { ran: true, experimentId: exp.id, adopted: false, abandoned: true, reason: 'abandoned: stale' };
    }
    return { ran: false, experimentId: exp.id, reason: m.samplesSince < 1 ? 'no post-queue run yet' : `no ${metric} data to measure` };
  }

  const baseline = Number(exp.baseline_score);
  const treatment = Number(m.value);
  const delta = treatment - baseline;
  const thr = metric === 'excellence'
    ? (opts.adoptThresholdExcellence ?? ADOPT_THRESHOLD_EXCELLENCE)
    : (opts.adoptThreshold ?? ADOPT_THRESHOLD);
  const adopted = delta >= thr;

  const fmt = (n) => (metric === 'excellence' ? n.toFixed(2) : `${(n * 100).toFixed(1)}%`);
  const evidence =
    `metric=${metric} baseline=${fmt(baseline)} treatment=${fmt(treatment)} ` +
    `delta=${metric === 'excellence' ? delta.toFixed(2) : `${(delta * 100).toFixed(1)}pp`} ` +
    `thr=${metric === 'excellence' ? thr : `${thr * 100}pp`} → ${adopted ? 'ADOPT' : 'discard'} ` +
    `(${m.samplesSince} post-queue run${m.samplesSince === 1 ? '' : 's'})`;

  finishExperiment(db, exp.id, { experimentScore: treatment, delta, adopted, evidence });
  return { ran: true, experimentId: exp.id, metric, baseline, treatment, delta, adopted, evidence };
}

/** Convenience for the supervisor: close out the next open experiment if any. */
export function runNextExperiment(db, opts = {}) {
  const exp = nextOpenExperiment(db);
  if (!exp) return { ran: false, experimentId: null, reason: 'no open experiment' };
  return runExperiment(db, exp, opts);
}
