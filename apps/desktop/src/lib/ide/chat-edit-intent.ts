/**
 * Chat → workspace edit routing. When a conversation has a LOCAL folder attached
 * and the user names a real file with an edit-shaped ask ("change X in docs/setup.md"),
 * the desktop routes the work to the IDE council (which reads the real file and
 * produces reviewable diffs) instead of the server chat council (which has no
 * local-disk access and would honestly report "file not found").
 *
 * Deliberately conservative: BOTH signals required — an edit verb AND a
 * path-looking token that resolves to an existing file in the attached tree.
 * Ambiguity falls through to normal chat, never the other way around.
 */

const EDIT_VERB = /\b(change|edit|replace|rename|update|rewrite|fix|modify|set|make|swap|correct)\b/i;

/** Path-ish tokens: `docs/setup.md`, `src\App.tsx`, `README.md` … */
const PATH_TOKEN = /[\w.-]+(?:[\\/][\w.-]+)*\.[a-z0-9]{1,8}/gi;

export interface WorkspaceEditIntent {
  rel: string;
  task: string;
}

export function resolveWorkspaceEditIntent(
  message: string,
  workspaceFiles: ReadonlySet<string>,
): WorkspaceEditIntent | null {
  if (!EDIT_VERB.test(message)) return null;
  const tokens = message.match(PATH_TOKEN) ?? [];
  for (const token of tokens) {
    const normalized = token.replace(/\\/g, '/').replace(/^\.\//, '');
    // Exact match first, then unique basename match (user may say just "setup.md").
    if (workspaceFiles.has(normalized)) return { rel: normalized, task: message };
    const base = normalized.split('/').pop() ?? normalized;
    const matches = [...workspaceFiles].filter((f) => f.endsWith(`/${base}`) || f === base);
    if (matches.length === 1) return { rel: matches[0], task: message };
  }
  return null;
}
