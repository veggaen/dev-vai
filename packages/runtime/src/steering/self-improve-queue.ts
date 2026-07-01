/**
 * File-backed SelfImproveQueue — the runtime side of "the Council triggers its own improvement
 * loops". When ChatService's council reaches a non-ship consensus naming a `missingCapability`, it
 * enqueues a job here; this appends it to the cross-process inbox (Temporary_files/
 * self-improve-inbox.jsonl) that the background self-improvement loop ingests and drains through the
 * gated, peer-reviewed feature-review pipeline.
 *
 * A decoupled append-only inbox (not a shared DB handle) keeps the two independent processes — the
 * runtime and the loop — from fighting over one SQLite file. The format matches
 * scripts/improve-loop/self-improve-inbox.mjs (readInbox parses exactly these fields). Best-effort:
 * a failed write must never break a chat turn.
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { SelfImproveQueue, SelfImproveJob } from '@vai/core';

/** Same path the loop's self-improve-inbox.mjs reads (repo-relative). */
export const SELF_IMPROVE_INBOX_RELATIVE = 'Temporary_files/self-improve-inbox.jsonl';

function cap(s: string | undefined, n: number): string | undefined {
  return s == null ? undefined : String(s).slice(0, n);
}

/**
 * Create the file-backed queue. `repoRoot` locates the inbox next to the loop's storage (defaults to
 * cwd, which is the repo root when the runtime is launched normally). A `maxPerTurn` guard caps how
 * many jobs one turn can emit so a pathological consensus can't flood the inbox.
 */
export function createSelfImproveQueue({ repoRoot = process.cwd(), maxPerTurn = 3 }: { repoRoot?: string; maxPerTurn?: number } = {}): SelfImproveQueue {
  const inboxPath = path.resolve(repoRoot, SELF_IMPROVE_INBOX_RELATIVE);
  let emittedThisProcess = 0;
  return {
    enqueue(job: SelfImproveJob): void {
      try {
        if (emittedThisProcess >= maxPerTurn * 1000) return; // ultra-coarse process-wide safety cap
        const dir = path.dirname(inboxPath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const line = JSON.stringify({
          missingCapability: cap(job.missingCapability, 400),
          realIntent: cap(job.realIntent, 400),
          methodLesson: cap(job.methodLesson, 400),
          prompt: cap(job.prompt, 400),
          intent: cap(job.intent, 60),
          memberId: cap(job.memberId, 60),
          at: new Date().toISOString(),
        });
        appendFileSync(inboxPath, line + '\n');
        emittedThisProcess += 1;
      } catch {
        // Advisory — never let an inbox write break the turn.
      }
    },
  };
}
