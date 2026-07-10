/**
 * WorkspaceTurnCoordinator — makes concurrent chats attached to the SAME local
 * workspace folder behave like colleagues on one build site instead of strangers.
 *
 * Several conversations may attach C:\...\dev-lawn at once. Each turn that arrives
 * with a `workspaceRoot` registers here; the coordinator answers two questions for
 * the council before it starts working:
 *
 *   1. Who else is working in this folder RIGHT NOW (in-flight turns)?
 *   2. What was recently done here by any chat (short journal of finished turns)?
 *
 * That snapshot is injected into the turn's system prompt so the council can
 * sequence its work (foundation before walls) and avoid clobbering a sibling
 * chat's in-progress changes.
 *
 * In-memory and process-local by design: all chat turns flow through this one
 * runtime process (the engine turn serializer already guarantees edits are
 * serialized), so no cross-process state is needed. Restart loses the journal —
 * acceptable; it is advisory context, not a lock.
 */

export interface WorkspaceColleague {
  conversationId: string;
  /** First ~140 chars of the user ask driving that turn. */
  goal: string;
  startedAt: number;
}

export interface WorkspaceJournalEntry {
  conversationId: string;
  goal: string;
  finishedAt: number;
}

export interface WorkspaceSnapshot {
  /** Other conversations with a turn currently in flight in this folder. */
  activeColleagues: WorkspaceColleague[];
  /** Most-recent-first finished turns in this folder (any conversation). */
  recentWork: WorkspaceJournalEntry[];
}

const JOURNAL_CAP = 10;
const GOAL_PREVIEW_CHARS = 140;
/** Journal entries older than this are noise, not context. */
const JOURNAL_TTL_MS = 6 * 60 * 60 * 1000;

/** Normalize a folder path so `C:\Dev\App`, `c:/dev/app/` collide correctly. */
export function normalizeWorkspaceRoot(root: string): string {
  return root.trim().replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
}

function previewGoal(content: string): string {
  const collapsed = content.replace(/\s+/g, ' ').trim();
  return collapsed.length > GOAL_PREVIEW_CHARS
    ? `${collapsed.slice(0, GOAL_PREVIEW_CHARS - 1)}…`
    : collapsed;
}

export class WorkspaceTurnCoordinator {
  private readonly active = new Map<string, Map<string, WorkspaceColleague>>();
  private readonly journal = new Map<string, WorkspaceJournalEntry[]>();

  /**
   * Register an in-flight turn and get the colleague snapshot the council should
   * see (excludes the registering conversation's own entry).
   */
  beginTurn(root: string, conversationId: string, content: string): WorkspaceSnapshot {
    const key = normalizeWorkspaceRoot(root);
    const snapshot = this.snapshot(key, conversationId);
    let turns = this.active.get(key);
    if (!turns) {
      turns = new Map();
      this.active.set(key, turns);
    }
    turns.set(conversationId, {
      conversationId,
      goal: previewGoal(content),
      startedAt: Date.now(),
    });
    return snapshot;
  }

  /** Mark the turn finished — moves it from active to the folder journal. */
  endTurn(root: string, conversationId: string): void {
    const key = normalizeWorkspaceRoot(root);
    const turns = this.active.get(key);
    const entry = turns?.get(conversationId);
    if (turns && entry) {
      turns.delete(conversationId);
      if (turns.size === 0) this.active.delete(key);
      const log = this.journal.get(key) ?? [];
      log.unshift({ conversationId, goal: entry.goal, finishedAt: Date.now() });
      this.journal.set(key, log.slice(0, JOURNAL_CAP));
    }
  }

  private snapshot(key: string, excludeConversationId: string): WorkspaceSnapshot {
    const cutoff = Date.now() - JOURNAL_TTL_MS;
    return {
      activeColleagues: [...(this.active.get(key)?.values() ?? [])]
        .filter((c) => c.conversationId !== excludeConversationId),
      recentWork: (this.journal.get(key) ?? []).filter((e) => e.finishedAt >= cutoff),
    };
  }
}

/**
 * Render the snapshot as a compact system-prompt block. Returns null when there
 * is nothing worth saying (no colleagues, no recent work) so quiet workspaces
 * pay zero prompt cost.
 */
export function buildWorkspaceColleagueNote(
  root: string,
  snapshot: WorkspaceSnapshot,
): string | null {
  if (snapshot.activeColleagues.length === 0 && snapshot.recentWork.length === 0) return null;

  const lines: string[] = [
    `[Workspace coordination — ${root}]`,
    'Other chats share this workspace. Work like colleagues on one build site: respect in-progress work, build on finished work, and sequence dependencies (foundation before walls). If your task overlaps an in-flight one, do the non-conflicting part and say what you deferred.',
  ];
  if (snapshot.activeColleagues.length > 0) {
    lines.push('Working here right now:');
    for (const c of snapshot.activeColleagues) {
      lines.push(`- chat ${c.conversationId.slice(0, 8)} → ${c.goal}`);
    }
  }
  if (snapshot.recentWork.length > 0) {
    lines.push('Recently finished here:');
    for (const e of snapshot.recentWork.slice(0, 5)) {
      lines.push(`- chat ${e.conversationId.slice(0, 8)} → ${e.goal}`);
    }
  }
  return lines.join('\n');
}
