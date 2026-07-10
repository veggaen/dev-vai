import type { ConversationSummary } from '@vai/api-types/responses';

/**
 * Pick the conversation that most recently worked on a sandbox project.
 *
 * Conversation lists are not an ordering contract. Using Array.find here made
 * reopening a project depend on API/list order, so an old failed Council turn
 * could replace the user's latest project chat. Keep the policy deterministic
 * and shared by every "open project" surface.
 */
export function pickLatestProjectConversation(
  conversations: readonly ConversationSummary[],
  sandboxProjectId: string,
): ConversationSummary | null {
  let latest: ConversationSummary | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;

  for (const conversation of conversations) {
    if (conversation.sandboxProjectId !== sandboxProjectId) continue;
    const updatedTime = Date.parse(conversation.updatedAt);
    const comparableTime = Number.isFinite(updatedTime) ? updatedTime : Number.NEGATIVE_INFINITY;
    if (!latest || comparableTime > latestTime) {
      latest = conversation;
      latestTime = comparableTime;
    }
  }

  return latest;
}
