import type { CouncilEditContext, CouncilEditFile } from './types.js';

/**
 * Server-side workspace edit context — the council reads REAL files from the
 * designated project folder at turn time instead of trusting prompt-embedded
 * snapshots assembled by the client.
 *
 * Why this exists (live failure chain it replaces): the desktop picked 3 files
 * by heuristic → pasted them into an English system prompt → core re-parsed
 * that English → the council edited only what survived the trip. When the
 * heuristic missed the file the user NAMED, the model never saw it and drifted
 * into generating an unrelated app. Resolving the project server-side makes
 * that whole failure class structurally impossible.
 */

/** Minimal port the runtime implements over its SandboxManager. */
export interface WorkspaceFilePort {
  describe(projectId: string): {
    name: string;
    external: boolean;
    framework?: string | null;
    devPort?: number | null;
  } | null;
  listFiles(projectId: string): Promise<string[]>;
  readFile(projectId: string, path: string): Promise<string | null>;
  searchFiles?(projectId: string, options: {
    query: string;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    regex?: boolean;
    maxResults?: number;
  }): Promise<{
    files: Array<{ path: string; matches: Array<{ line: number; column: number; matchText: string; preview: string }> }>;
    totalMatches: number;
    filesScanned: number;
    truncated: boolean;
  }>;
}

const BINARY_OR_LOCK_RE = /\.(png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp[34]|wav|ogg|webm|zip|gz|tar|pdf|exe|dll|wasm|node|db|sqlite|lockb)$|(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i;

/** Secret-bearing files never enter any model context, even when named. */
export function isSensitiveWorkspacePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  const name = normalized.split('/').pop() ?? normalized;
  return /(?:^|\/)\.env(?:\..*)?$/i.test(normalized)
    || /(?:^|\/)(?:\.npmrc|\.yarnrc|\.netrc|credentials|credentials\.json|secrets?(?:\.[^/]*)?|private[-_.]?key(?:\.[^/]*)?)$/i.test(normalized)
    || /\.(?:pem|p12|pfx|jks|keystore)$/i.test(name)
    || /(?:^|\/)(?:\.ssh|\.aws|\.azure|\.config\/gcloud)(?:\/|$)/i.test(normalized);
}

/** A literal filename in a "do not touch" clause is a boundary, not a target. */
export function isExplicitlyExcludedWorkspacePath(path: string, userPrompt: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  const fileName = normalized.split('/').pop() ?? normalized;
  const prompt = userPrompt.toLowerCase();
  for (const mention of new Set([normalized, fileName])) {
    let from = 0;
    while (mention && from < prompt.length) {
      const index = prompt.indexOf(mention, from);
      if (index < 0) break;
      const lead = prompt.slice(Math.max(0, index - 90), index);
      const tail = prompt.slice(index + mention.length, index + mention.length + 40);
      if (/(?:do\s+not|don't|must\s+not|never|without)\s+(?:(?:modify|change|touch|edit|rewrite|alter|including|reading)\s+)?[^;:\n]{0,85}$/i.test(lead)
        || (/(?:leave|keep)\s+[^;:\n]{0,55}$/i.test(lead) && /^[^;:\n]{0,24}\b(?:unchanged|untouched)\b/i.test(tail))) {
        return true;
      }
      from = index + mention.length;
    }
  }
  return false;
}

/** A named "read-only reference" is context for the change, never an edit target. */
export function isReadOnlyReferenceWorkspacePath(path: string, userPrompt: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  const fileName = normalized.split('/').pop() ?? normalized;
  const prompt = userPrompt.toLowerCase();
  for (const mention of new Set([normalized, fileName])) {
    let from = 0;
    while (mention && from < prompt.length) {
      const index = prompt.indexOf(mention, from);
      if (index < 0) break;
      const beforeMention = prompt.slice(0, index);
      const previousBoundary = Math.max(
        beforeMention.lastIndexOf(';'),
        beforeMention.lastIndexOf('\n'),
        beforeMention.lastIndexOf('. '),
      );
      const afterMention = prompt.slice(index + mention.length);
      const nextBoundaries = [afterMention.indexOf(';'), afterMention.indexOf('\n'), afterMention.indexOf('. ')]
        .filter((boundary) => boundary >= 0);
      const nextBoundary = nextBoundaries.length > 0 ? Math.min(...nextBoundaries) : afterMention.length;
      const clause = prompt.slice(previousBoundary + 1, index + mention.length + nextBoundary);
      const mentionStart = index - (previousBoundary + 1);
      const mentionEnd = mentionStart + mention.length;
      const after = clause.slice(mentionEnd);
      if (/\b(?:read[- ]only|reference[- ]only|context[- ]only)\b/.test(after)
        || /\bas\s+(?:a\s+)?(?:read[- ]only\s+)?reference\b/.test(after)) {
        return true;
      }
      from = index + mention.length;
    }
  }
  return false;
}

function explicitOnlyEditablePaths(files: readonly string[], userPrompt: string): Set<string> | null {
  const match = userPrompt.match(
    /\b(?:the\s+)?only\s+(?:existing\s+)?editable\s+files?\s+(?:is|are|:)\s+([^;\n]+)/i,
  );
  if (!match?.[1]) return null;
  const clause = match[1].toLowerCase();
  const paths = new Set<string>();
  for (const path of files) {
    const normalized =