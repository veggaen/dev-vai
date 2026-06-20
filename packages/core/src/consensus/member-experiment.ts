/**
 * member-experiment — let a council member PROVE a claim before presenting it.
 *
 * V3gga's design: a member shouldn't just speculate, it should be able to run a small test on
 * its own idea, get a proof (pass/fail + output), and bring THAT to the council — so the panel
 * deliberates over verified claims, not guesses. This is the "run your own test suite at your
 * side before presenting" step, bounded to safe, allowlisted commands.
 *
 * Flow (one bounded round, after the member has its draft note):
 *   1. The member proposes ONE proof: a hypothesis + an allowlisted command to test it.
 *   2. We run it via {@link runCommandEvidence} (allowlist-gated, timeout, output cap).
 *   3. The verified outcome (passed / failed / blocked) is attached to the note as a
 *      ProofResult, and feeds the council's weighting: a member that PROVED its point counts
 *      for more; a member whose proof FAILED is told so and must not present the claim as fact.
 *
 * Deterministic + injectable: the command runner and the proposal parser are dependencies, so
 * this is fully unit-testable without spawning a process or calling a model.
 */

import { z } from 'zod';
import type { ModelAdapter } from '../models/adapter.js';
import { isAllowlistedCommand } from '../tools/run-evidence.js';
import type { RunEvidence } from '../tools/run-evidence.js';

/** Max wall-clock for a member's proof command — proofs must be quick. */
const PROOF_TIMEOUT_MS = 8_000;
const PROOF_PROPOSE_MAX_TOKENS = 200;

const proofProposalSchema = z.object({
  /** What the member is trying to prove, in one line. Empty string = no proof needed. */
  hypothesis: z.string().catch(''),
  /** The command to run (basename, e.g. "node" / "tsc"). */
  command: z.string().catch(''),
  /** Command args. */
  args: z.array(z.string()).catch([]),
});

export type ProofProposal = z.infer<typeof proofProposalSchema>;

export type ProofStatus = 'proved' | 'disproved' | 'blocked' | 'none';

export interface ProofResult {
  readonly hypothesis: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly status: ProofStatus;
  /** Short, bounded outcome text for the trace (stdout/stderr tail or the block reason). */
  readonly detail: string;
}

export const PROOF_INSTRUCTIONS = [
  'PROOF STEP (optional). If your verdict rests on a claim you can TEST with one quick command,',
  'propose it as STRICT JSON: {"hypothesis":"<one line>","command":"<cmd>","args":["..."]}.',
  'Only safe, read-only verification commands are allowed (e.g. node -e "...", tsc --noEmit, a test',
  'runner). If you do not need a proof, return {"hypothesis":"","command":"","args":[]}.',
  'A proof that PASSES lets you present your point as verified; a proof that FAILS means you must',
  'NOT present the claim as fact.',
].join('\n');

function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const body = fenced ? fenced[1].trim() : trimmed;
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  return first !== -1 && last > first ? body.slice(first, last + 1) : null;
}

/** Parse a member's raw proof-proposal reply. Returns null when no proof was proposed. */
export function parseProofProposal(raw: string): ProofProposal | null {
  const json = extractJson(raw);
  if (!json) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return null; }
  const result = proofProposalSchema.safeParse(parsed);
  if (!result.success) return null;
  const p = result.data;
  if (!p.command.trim() || !p.hypothesis.trim()) return null;
  return p;
}

/** Bound a stdout/stderr blob to a short trace-friendly tail. */
function tail(text: string, max = 280): string {
  const t = text.trim();
  return t.length > max ? `…${t.slice(-max)}` : t;
}

/** The command runner dependency (matches runCommandEvidence's shape; injectable for tests). */
export type ProofRunner = (
  command: string,
  args: readonly string[],
  options: { timeoutMs: number; cwd?: string },
) => Promise<RunEvidence>;

export interface RunProofOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly runner: ProofRunner;
}

/**
 * Run a proposed proof safely. Refuses (status 'blocked') anything not on the verification
 * allowlist — a member can only run the same safe commands the exec capability already permits.
 * Never throws: a spawn failure becomes a 'blocked' result so the turn is unaffected.
 */
export async function runProof(proposal: ProofProposal, opts: RunProofOptions): Promise<ProofResult> {
  const base = { hypothesis: proposal.hypothesis, command: proposal.command, args: proposal.args };
  if (!isAllowlistedCommand(proposal.command, proposal.args)) {
    return { ...base, status: 'blocked', detail: 'command not on the safe verification allowlist' };
  }
  let evidence: RunEvidence;
  try {
    evidence = await opts.runner(proposal.command, proposal.args, {
      timeoutMs: opts.timeoutMs ?? PROOF_TIMEOUT_MS,
      cwd: opts.cwd,
    });
  } catch (err) {
    return { ...base, status: 'blocked', detail: `runner error: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!evidence.ok) {
    return { ...base, status: 'blocked', detail: evidence.error ?? 'run did not complete' };
  }
  const outcomeText = tail(evidence.stderr || evidence.stdout || `exit ${evidence.exitCode}`);
  return {
    ...base,
    status: evidence.passed ? 'proved' : 'disproved',
    detail: `${evidence.passed ? 'PASS' : `FAIL (exit ${evidence.exitCode})`}: ${outcomeText}`,
  };
}

export interface GatherProofOptions {
  readonly system: string;
  readonly note: string;
  readonly maxTokens?: number;
  readonly signal?: AbortSignal;
  readonly runProofOptions: RunProofOptions;
}

/**
 * One proof round for a member: ask whether it wants to prove its note's claim, and if so run
 * the proposed command and return the verified result. Returns null when the member proposes no
 * proof (the common case). Never throws into the turn.
 */
export async function gatherMemberProof(
  adapter: ModelAdapter,
  opts: GatherProofOptions,
): Promise<ProofResult | null> {
  try {
    const response = await adapter.chat({
      messages: [
        { role: 'system', content: `${opts.system}\n\n${PROOF_INSTRUCTIONS}` },
        { role: 'user', content: `YOUR DRAFT NOTE:\n${opts.note}\n\nPropose a proof now, or {"hypothesis":"","command":"","args":[]}.` },
      ],
      temperature: 0,
      maxTokens: opts.maxTokens ?? PROOF_PROPOSE_MAX_TOKENS,
      signal: opts.signal,
    });
    const proposal = parseProofProposal(response.message.content);
    if (!proposal) return null;
    return await runProof(proposal, opts.runProofOptions);
  } catch {
    return null;
  }
}

/**
 * Trust multiplier for a member's vote based on whether it PROVED its claim. A proved point
 * counts more; a disproved one counts less (the member overreached); blocked/none are neutral.
 * Conservative bounds so a single proof can't dominate the panel.
 */
export function proofTrustWeight(status: ProofStatus | undefined): number {
  switch (status) {
    case 'proved': return 1.4;
    case 'disproved': return 0.5;
    default: return 1;
  }
}
