/**
 * Capability — deep git, answered DETERMINISTICALLY from attached evidence.
 *
 * "What changed in my repo?", "who wrote this line?", "what's the recent history?",
 * "how far ahead is my branch?" are questions git answers exactly — so Vai must answer
 * them WITHOUT a model call, from real {@link GitEvidence} gathered before dispatch.
 * This capability is the second instance of the live-context discipline (after
 * {@link liveContextCapability}): it composes its answer only from attached evidence,
 * and its `verify` refuses to release any claim — any SHA, file path or blamed line —
 * that does not bind to a real evidence id. A confident git answer with no backing
 * evidence FAILS verify and the dispatcher falls through, exactly as the kernel intends.
 *
 * The explicit contract (the four fields the brief requires):
 *   - CAN DO:   diff (what changed), blame (who wrote a line), log (recent history),
 *               branch state (ahead/behind) — read-only.
 *   - EVIDENCE: the typed {@link GitEvidence}; `verify().boundEvidence` lists the exact
 *               item ids the answer was bound to.
 *   - COST:     `latency`/`cost` derived from the evidence's measured `durationMs`;
 *               `risk` is low and documented — every git command run was read-only.
 *   - VERIFIED: `verify` binds every surfaced id and refuses on any unbound claim.
 *
 * It deliberately does NOT gather git itself (resolve is synchronous and pure). The
 * caller runs {@link gatherGitEvidence} before dispatch and attaches the result to
 * `ctx.evidence.git` — the same pattern web-evidence and live-context already use.
 */

import type { Resolution, ScoreResult, TurnContext } from '../turn-pipeline.js';
import {
  scoreFromBreakdown,
  type Capability,
  type ScoreBreakdown,
  type VerificationResult,
} from '../capability-kernel.js';
import { gitEvidenceIds, hasGitEvidence, type GitEvidence } from '../../tools/git-evidence.js';

/** Phrasings that indicate a deterministic git question, by sub-kind. */
const DIFF_RE = /\b(what(?:'s| has| did)?\s+chang|what'?s? (?:new|different)|uncommitted|unstaged|staged|working (?:tree|copy|dir)|modified files?|my (?:changes|diff)|the diff|git diff|git status)/i;
const BLAME_RE = /\b(who (?:wrote|made|changed|added|last (?:touched|edited))|\bblame\b|last (?:modified|edited) by|authored? (?:this|line))/i;
const LOG_RE = /\b(recent (?:commits?|history|changes)|commit history|last \d+ commits?|git log|what(?:'ve| have)? i (?:committed|been working on)|latest commits?)/i;
const BRANCH_RE = /\b(which branch|what branch|current branch|ahead (?:of|or) behind|how far (?:ahead|behind)|branch (?:status|state)|am i (?:ahead|behind))/i;

interface GitQueryShape {
  readonly wantsDiff: boolean;
  readonly wantsBlame: boolean;
  readonly wantsLog: boolean;
  readonly wantsBranch: boolean;
  readonly any: boolean;
}

/** Classify what git facet(s) the turn is asking about. Pure string inspection. */
export function classifyGitQuery(text: string): GitQueryShape {
  const t = text ?? '';
  const wantsDiff = DIFF_RE.test(t);
  const wantsBlame = BLAME_RE.test(t);
  const wantsLog = LOG_RE.test(t);
  const wantsBranch = BRANCH_RE.test(t);
  return { wantsDiff, wantsBlame, wantsLog, wantsBranch, any: wantsDiff || wantsBlame || wantsLog || wantsBranch };
}

/** Marker prefix so the answer is identifiable as evidence-grounded git output. */
const GROUNDED_MARKER = '**Git evidence';
/** Honest "no evidence" reply marker — always safe to release (it declines). */
const NO_EVIDENCE_MARKER = 'no git evidence was gathered';

function describeChange(status: string): string {
  switch (status) {
    case 'added': return 'added';
    case 'deleted': return 'deleted';
    case 'renamed': return 'renamed';
    case 'copied': return 'copied';
    case 'modified': return 'modified';
    default: return 'changed';
  }
}

/** Compose a structured, human-readable answer from git evidence for the asked facets. */
function composeAnswer(evidence: GitEvidence, shape: GitQueryShape): { text: string; bound: string[] } {
  const bound: string[] = [];
  const lines: string[] = [`${GROUNDED_MARKER} (captured ${evidence.gatheredAt}, ${evidence.durationMs}ms):**`, ''];

  // When the turn is generic ("what's going on in git"), report whatever we have.
  const showDiff = shape.wantsDiff || (!shape.any);
  const showLog = shape.wantsLog || (!shape.any);
  const showBranch = shape.wantsBranch || (!shape.any);

  if (showBranch && evidence.branch) {
    const b = evidence.branch;
    bound.push(b.id);
    const pos =
      b.upstream && (b.ahead != null || b.behind != null)
        ? ` — ${b.ahead ?? 0} ahead, ${b.behind ?? 0} behind \`${b.upstream}\``
        : b.upstream ? ` (tracking \`${b.upstream}\`)` : ' (no upstream configured)';
    lines.push(`- **Branch:** \`${b.current}\`${pos}`);
  }

  if (showDiff && evidence.changedFiles.length > 0) {
    lines.push(`- **Changed files (${evidence.changedFiles.length}):**`);
    for (const f of evidence.changedFiles) {
      bound.push(f.id);
      const counts = f.additions == null || f.deletions == null ? 'binary' : `+${f.additions}/-${f.deletions}`;
      lines.push(`  - \`${f.path}\` — ${describeChange(f.status)}${f.staged ? ' (staged)' : ''}, ${counts}`);
    }
  }

  if (shape.wantsBlame && evidence.blame.length > 0) {
    // Report the distinct authors/commits responsible, with line spans.
    lines.push(`- **Blame (${evidence.blame[0].path}):**`);
    for (const bl of evidence.blame.slice(0, 12)) {
      bound.push(bl.id);
      lines.push(`  - line ${bl.line}: \`${bl.sha}\` by ${bl.author} — ${bl.content}`);
    }
  }

  if (showLog && evidence.log.length > 0) {
    lines.push(`- **Recent commits (${evidence.log.length}):**`);
    for (const c of evidence.log) {
      bound.push(c.id);
      lines.push(`  - \`${c.sha}\` ${c.subject} — ${c.author}`);
    }
  }

  return { text: lines.join('\n'), bound };
}

/**
 * How "thick" the attached evidence is for the asked facets, 0..1 — drives the
 * `evidence` term in the score so a git turn with rich attached diff/log outranks
 * one where nothing was gathered.
 */
function evidenceDensity(evidence: GitEvidence | undefined, shape: GitQueryShape): number {
  if (!hasGitEvidence(evidence)) return 0;
  let have = 0;
  let want = 0;
  const facets: Array<[boolean, number]> = [
    [shape.wantsDiff, evidence.changedFiles.length + evidence.hunks.length],
    [shape.wantsBlame, evidence.blame.length],
    [shape.wantsLog, evidence.log.length],
    [shape.wantsBranch, evidence.branch ? 1 : 0],
  ];
  for (const [wanted, count] of facets) {
    if (!wanted) continue;
    want += 1;
    if (count > 0) have += 1;
  }
  if (want === 0) {
    // Generic git question — any evidence at all counts.
    return Math.min(1, (evidence.changedFiles.length + evidence.log.length + (evidence.branch ? 1 : 0)) / 3);
  }
  return have / want;
}

/** Map measured gather time to a 0..1 latency penalty (5s+ → full penalty). */
function latencyPenalty(durationMs: number | undefined): number {
  if (!durationMs || durationMs <= 0) return 0.02;
  return Math.min(1, durationMs / 5_000);
}

export const gitCapability: Capability = {
  name: 'git',

  score(ctx: TurnContext): ScoreResult {
    const breakdown = this.estimate(ctx);
    if (breakdown === null) return null;
    return { score: scoreFromBreakdown(breakdown), reason: breakdown.reason };
  },

  estimate(ctx: TurnContext): ScoreBreakdown | null {
    const shape = classifyGitQuery(ctx.understood || ctx.content);
    if (!shape.any) return null;
    const git = ctx.evidence?.git;
    const density = evidenceDensity(git, shape);
    return {
      // Strong phrasing match — these regexes are git-specific, not single-keyword.
      intentFit: 0.9,
      // The product is grounded git facts; with no attached evidence this stays low
      // and the resolve/verify gate keeps the capability from answering on a guess.
      evidence: density,
      // No learned history wired yet — neutral. (Learning loop will set this.)
      history: 0.5,
      // Cost/latency from the measured gather (read-only git is fast).
      latency: latencyPenalty(git?.durationMs),
      cost: 0.02,
      // Read-only: no command mutates the repo. Low intrinsic risk; verify still gates.
      risk: 0.05,
      reason: 'Deterministic git question — answer only from attached read-only git evidence.',
    };
  },

  resolve(ctx: TurnContext): Resolution | null {
    const shape = classifyGitQuery(ctx.understood || ctx.content);
    if (!shape.any) return null;
    const git: GitEvidence | undefined = ctx.evidence?.git;
    const gatherError = git?.error;

    // Honest decline when nothing was gathered or git failed — released as a safe,
    // non-fabricating answer (it explicitly states it has no evidence).
    if (!hasGitEvidence(git)) {
      const why = gatherError ? ` (${gatherError})` : '';
      return {
        text: `I can answer that from git, but ${NO_EVIDENCE_MARKER} for this turn${why}. Re-ask in a git repository and I'll read the real diff/blame/log.`,
        turnKind: 'analysis',
        confidence: 0.55,
        strategy: 'git',
      } as Resolution;
    }

    const { text } = composeAnswer(git, shape);
    return {
      text,
      turnKind: 'analysis',
      confidence: 0.97,
      strategy: 'git',
    } as Resolution;
  },

  /**
   * Bind every surfaced git id to a real evidence item. The composed answer cites
   * SHAs (`\`abc1234\``), file paths and blamed line ids; verify recomputes the set
   * of ids the evidence actually contains and refuses if the answer references a
   * commit SHA that is NOT in that set — the structural guard against a fabricated
   * commit. The honest "no evidence" decline is always releasable.
   */
  verify(resolution: Resolution, ctx: TurnContext): VerificationResult {
    const text = resolution.text ?? '';
    if (text.includes(NO_EVIDENCE_MARKER)) {
      return { ok: true, reason: 'Honest no-evidence decline — no git claim made.' };
    }
    const git = ctx.evidence?.git;
    if (!hasGitEvidence(git)) {
      return { ok: false, reason: 'Git answer composed but no evidence is attached — refusing to release.' };
    }

    const ids = gitEvidenceIds(git);
    const validShas = new Set<string>();
    for (const c of git.log) validShas.add(c.sha);
    for (const b of git.blame) validShas.add(b.sha);

    // Every backtick-quoted 7–12 hex token in the answer must be a real SHA we saw.
    // This catches a hallucinated commit id even if the rest of the text is grounded.
    const shaTokens = text.match(/`([0-9a-f]{7,12})`/g) ?? [];
    for (const tok of shaTokens) {
      const sha = tok.replace(/`/g, '');
      if (!validShas.has(sha)) {
        return { ok: false, reason: `Answer cites SHA ${sha} not present in gathered git evidence — refusing to release.` };
      }
    }

    // The grounded answer must actually be the evidence-marked composition (not some
    // other text claiming git authority), and must bind at least one real id.
    if (!text.startsWith(GROUNDED_MARKER)) {
      return { ok: false, reason: 'Git answer lacks the evidence header — not a grounded composition.' };
    }
    const citedShas = new Set(shaTokens.map((t) => t.replace(/`/g, '')));
    const bound = [...ids].filter((id) => {
      // commit ids ARE `git:commit:<sha>` — bind when that sha is cited.
      if (id.startsWith('git:commit:')) return citedShas.has(id.slice('git:commit:'.length));
      // blame ids are `git:blame:<path>:<line>`; bind via the item's sha appearing in the answer.
      if (id.startsWith('git:blame:')) {
        const bl = git.blame.find((b) => b.id === id);
        return bl ? citedShas.has(bl.sha) : false;
      }
      if (id.startsWith('git:file:')) return text.includes('`' + id.slice('git:file:'.length) + '`');
      if (id.startsWith('git:branch:')) return text.includes('`' + id.slice('git:branch:'.length) + '`');
      return false;
    });
    if (bound.length === 0) {
      return { ok: false, reason: 'Grounded git answer bound to zero evidence ids — refusing to release.' };
    }
    return { ok: true, boundEvidence: bound, reason: `Bound to ${bound.length} git evidence item(s).` };
  },
};
