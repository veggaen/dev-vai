/**
 * parity-bench — measure whether Vai is AT PAR with the external model (the user's #5),
 * and gate the self-improvement loop (#7) on a FAIR judge instead of the model's self-rating.
 *
 * The loop the user wants — "run until Vai is at par with the LLM" — is only safe if the
 * judge is trustworthy. If the model both produces an answer AND grades it, the loop
 * optimizes Vai to imitate the model's verbosity, making it WORSE at the grounded, terse,
 * verifiable answers that are its actual edge. So this harness judges every task with the
 * deterministic, blind, evidence-grounded {@link judgeAnswers} — Vai can win on its own
 * terms, and the at-par metric is real.
 *
 * For each task it has a Vai answer and a model answer (the caller produces both — Vai
 * deterministically, the model via its adapter), judges them BLIND, and aggregates:
 *   - vaiWinRate   : fraction where Vai's answer won
 *   - atParRate    : fraction within the tie band (Vai is as good as the model)
 *   - modelWinRate : fraction where the model genuinely won — the ONLY tasks the loop
 *                    should target, because here the model really did better on grounded,
 *                    on-task, honest criteria (not just on fluency).
 *
 * "Vai is at par" = (vaiWinRate + atParRate) ≥ a target (default 0.9). The loop continues
 * ONLY while modelWinRate is above its floor — and crucially, the tasks to improve are the
 * specific modelWins, with the judge's rationale telling you WHY the model won (more
 * groundedness? better task-fit?). That is a safe, directed loop, not a vibes race.
 */

import { judgeAnswers, type JudgeCandidate, type JudgeOptions, type JudgeVerdict } from './answer-judge.js';

/** One benchmark task: the prompt plus the two answers to compare. */
export interface ParityTask {
  readonly id: string;
  readonly prompt: string;
  /** Vai's deterministic answer (with its evidence bindings / verify result). */
  readonly vai: Omit<JudgeCandidate, 'id'>;
  /** The external model's answer. */
  readonly model: Omit<JudgeCandidate, 'id'>;
}

/** Per-task outcome with the blind verdict and who actually produced the winner. */
export interface ParityTaskResult {
  readonly id: string;
  readonly prompt: string;
  /** 'vai' | 'model' | 'par' — resolved from the BLIND verdict by mapping ids back. */
  readonly outcome: 'vai' | 'model' | 'par';
  readonly verdict: JudgeVerdict;
  /** Why the winner won (the judge's rationale) — directs the improvement loop. */
  readonly rationale: string;
}

export interface ParityReport {
  readonly tasks: number;
  readonly vaiWins: number;
  readonly modelWins: number;
  readonly atPar: number;
  readonly vaiWinRate: number;
  readonly atParRate: number;
  readonly modelWinRate: number;
  /** (vaiWinRate + atParRate) — the headline "Vai is as good or better" rate. */
  readonly parityRate: number;
  /** True when parityRate ≥ the target — Vai is at par overall. */
  readonly atParOverall: boolean;
  /** The specific tasks the model genuinely won — the loop's TODO list, with reasons. */
  readonly modelWonTasks: readonly ParityTaskResult[];
  readonly results: readonly ParityTaskResult[];
}

export interface ParityBenchOptions extends JudgeOptions {
  /** parityRate at/above which Vai counts as "at par overall". Default 0.9. */
  readonly parityTarget?: number;
}

/**
 * Run the parity benchmark. Pure: the caller has already produced both answers; this only
 * judges and aggregates. Blindness is enforced by labeling candidates with neutral ids
 * ('c0'/'c1') in a fixed order so the judge cannot infer roles, then mapping back.
 */
export function runParityBench(tasks: readonly ParityTask[], options: ParityBenchOptions = {}): ParityReport {
  const parityTarget = options.parityTarget ?? 0.9;
  const results: ParityTaskResult[] = [];

  for (const task of tasks) {
    // Neutral, role-free ids. We always pass [vai, model] in the same slot order, but the
    // judge is order-INDEPENDENT (proven in its tests), so this leaks no role signal.
    const vaiCand: JudgeCandidate = { ...task.vai, id: 'c0' };
    const modelCand: JudgeCandidate = { ...task.model, id: 'c1' };
    const verdict = judgeAnswers([vaiCand, modelCand], { prompt: task.prompt }, options);

    let outcome: ParityTaskResult['outcome'];
    if (verdict.atPar || verdict.winnerId === null) outcome = 'par';
    else outcome = verdict.winnerId === 'c0' ? 'vai' : 'model';

    results.push({ id: task.id, prompt: task.prompt, outcome, verdict, rationale: verdict.rationale });
  }

  const vaiWins = results.filter((r) => r.outcome === 'vai').length;
  const modelWins = results.filter((r) => r.outcome === 'model').length;
  const atPar = results.filter((r) => r.outcome === 'par').length;
  const n = Math.max(1, results.length);
  const vaiWinRate = vaiWins / n;
  const atParRate = atPar / n;
  const modelWinRate = modelWins / n;
  const parityRate = vaiWinRate + atParRate;

  return {
    tasks: results.length,
    vaiWins,
    modelWins,
    atPar,
    vaiWinRate,
    atParRate,
    modelWinRate,
    parityRate,
    atParOverall: parityRate >= parityTarget,
    modelWonTasks: results.filter((r) => r.outcome === 'model'),
    results,
  };
}

/**
 * Decide whether the self-improvement loop should keep going. It continues ONLY while the
 * model genuinely wins tasks AND we are below the parity target — and it returns the exact
 * tasks to target next (the model wins), so the loop is directed by real, judged gaps rather
 * than by chasing the model's style. When parity is reached, it stops: Vai is at par.
 */
export function shouldContinueParityLoop(report: ParityReport): {
  readonly continue: boolean;
  readonly reason: string;
  readonly targets: readonly ParityTaskResult[];
} {
  if (report.atParOverall) {
    return { continue: false, reason: `at par: ${(report.parityRate * 100).toFixed(0)}% (Vai wins or ties)`, targets: [] };
  }
  if (report.modelWonTasks.length === 0) {
    return { continue: false, reason: 'no genuine model wins to close — gap is noise/ties', targets: [] };
  }
  return {
    continue: true,
    reason: `model genuinely wins ${report.modelWins}/${report.tasks} — close these`,
    targets: report.modelWonTasks,
  };
}

/** Render a parity report as a compact, human-readable summary. */
export function describeParityReport(report: ParityReport): string {
  const lines = [
    `Parity over ${report.tasks} task(s):`,
    `  Vai wins:   ${report.vaiWins} (${(report.vaiWinRate * 100).toFixed(0)}%)`,
    `  At par:     ${report.atPar} (${(report.atParRate * 100).toFixed(0)}%)`,
    `  Model wins: ${report.modelWins} (${(report.modelWinRate * 100).toFixed(0)}%)`,
    `  Parity rate: ${(report.parityRate * 100).toFixed(0)}% ${report.atParOverall ? '✓ AT PAR' : '✗ below target'}`,
  ];
  if (report.modelWonTasks.length > 0) {
    lines.push('  Model won (close these):');
    for (const t of report.modelWonTasks) lines.push(`    - ${t.id}: ${t.rationale}`);
  }
  return lines.join('\n');
}
