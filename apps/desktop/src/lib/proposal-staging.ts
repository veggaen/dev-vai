import type { FileEditProposal } from '@vai/core/browser';

/**
 * Diff review is project state, never global UI state. Prefer the conversation
 * because chats are projects in Vai; fall back to the attached folder/sandbox
 * only for pre-conversation IDE sessions.
 */
export function proposalStorageScope(input: {
  conversationId?: string | null;
  localRoot?: string | null;
  sandboxProjectId?: string | null;
}): string | null {
  const conversationId = input.conversationId?.trim();
  if (conversationId) return `conversation:${conversationId}`;

  const localRoot = input.localRoot?.trim().replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
  if (localRoot) return `workspace:${localRoot}`;

  const sandboxProjectId = input.sandboxProjectId?.trim();
  return sandboxProjectId ? `sandbox:${sandboxProjectId}` : null;
}

/**
 * Proposal ids are content-addressed. Replaying the same assistant artifact must
 * not render or apply the same change twice, even when a turn is retried after
 * reconnecting to the runtime.
 */
export function mergeUniqueProposals(
  existing: readonly FileEditProposal[],
  incoming: readonly FileEditProposal[],
): FileEditProposal[] {
  const byId = new Map<string, FileEditProposal>();
  // Rejected proposals are a completed review decision, not active work. Drop
  // them when the next artifact arrives so the panel does not grow forever and
  // a later, independently reviewed retry can be considered cleanly.
  for (const proposal of existing) {
    if (proposal.status !== 'rejected') byId.set(proposal.id, proposal);
  }
  for (const proposal of incoming) {
    if (!byId.has(proposal.id)) byId.set(proposal.id, proposal);
  }
  return [...byId.values()];
}
