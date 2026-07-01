/**
 * SelfImproveQueue port — the seam by which the Council TRIGGERS its own improvement loops.
 *
 * When the council reaches a non-ship consensus that names a `missingCapability` (Vai's CODE is
 * missing something needed to answer well), ChatService emits a self-improvement JOB through this
 * port. The RUNTIME supplies the concrete implementation (it writes to the self-improvement loop's
 * corpus, which the background loop later drains through the gated feature-review pipeline).
 *
 * This mirrors the existing `GuidanceStore` injection: ChatService owns WHEN to enqueue; the host
 * owns WHERE it goes. The member TRIGGERS (emits intent, like a vote) but never BYPASSES — the
 * gated, peer-reviewed pipeline does the actual code change on a protected branch.
 *
 * Pure decision logic (what's worth enqueuing) lives here so it's unit-testable without a DB.
 */

import { classifyQuestionIntent } from './question-intent.js';

/** One self-improvement job the council wants built (advisory — the loop gates + reviews it). */
export interface SelfImproveJob {
  /** The capability the council said Vai was missing (the core of the instruction). */
  readonly missingCapability: string;
  /** What the user actually wanted (context for the builder). */
  readonly realIntent?: string;
  /** How to handle this class next time (the council's method lesson). */
  readonly methodLesson?: string;
  /** The originating user prompt (salient tokens key the dedup + shelf checks). */
  readonly prompt: string;
  /** The classified intent of the prompt (advisory routing hint). */
  readonly intent?: string;
  /** Which council member raised it (attribution). */
  readonly memberId?: string;
}

/** The injected port. The runtime implements enqueue() to persist into the loop's queue table. */
export interface SelfImproveQueue {
  /** Enqueue a job. Best-effort; must never throw into the turn. Returns whether it was accepted. */
  enqueue(job: SelfImproveJob): void;
}

/**
 * Minimal shape of a council consensus this module reads (kept structural so it doesn't couple to
 * the full CouncilConsensus type — only the fields we need).
 */
export interface CouncilConsensusLike {
  readonly outcome?: string;
  readonly missingCapabilities?: readonly string[];
  readonly methodLessons?: readonly string[];
  readonly realIntent?: string;
}

// A missingCapability must be this substantive to be worth a build job — filters "none"/vague noise.
const MIN_CAPABILITY_LEN = 8;
const VAGUE = /^(none|n\/?a|unknown|nothing|unclear|more context|better answer|improve|be better)\.?$/i;

/** Is a single missingCapability string actionable (not empty / vague / boilerplate)? Pure. */
export function isActionableCapability(cap: string | undefined | null): boolean {
  const c = String(cap ?? '').trim();
  return c.length >= MIN_CAPABILITY_LEN && !VAGUE.test(c);
}

/**
 * Decide which self-improvement jobs (if any) a council consensus warrants. ONLY fires on a
 * non-ship outcome (a shipped answer needs no code change), and only for actionable capabilities.
 * De-duplicates capabilities that are textually identical within the same consensus. Pure — returns
 * the jobs; the caller enqueues them through the port. Returns [] when nothing is warranted.
 */
export function jobsFromConsensus(
  consensus: CouncilConsensusLike,
  prompt: string,
  { memberId }: { memberId?: string } = {},
): SelfImproveJob[] {
  if (!consensus || consensus.outcome === 'ship') return [];
  const caps = (consensus.missingCapabilities ?? []).map((c) => String(c).trim()).filter(isActionableCapability);
  if (caps.length === 0) return [];
  const seen = new Set<string>();
  const jobs: SelfImproveJob[] = [];
  const methodLesson = (consensus.methodLessons ?? [])[0];
  const intent = classifyQuestionIntent(prompt);
  for (const cap of caps) {
    const key = cap.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    jobs.push({
      missingCapability: cap,
      realIntent: consensus.realIntent,
      methodLesson,
      prompt,
      intent,
      memberId,
    });
  }
  return jobs;
}
