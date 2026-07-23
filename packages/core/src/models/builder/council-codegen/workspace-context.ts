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
    const normalized = path.replace(/\\/g, '/').toLowerCase();
    const fileName = normalized.split('/').pop() ?? normalized;
    if (clause.includes(normalized) || clause.includes(fileName)) paths.add(normalized);
  }
  return paths.size > 0 ? paths : null;
}

const ENTRY_POINT_WEIGHTS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /(?:^|\/)src\/App\.(?:tsx|jsx|ts|js)$/i, weight: 100 },
  { pattern: /(?:^|\/)(?:src\/)?app\/page\.(?:tsx|jsx|ts|js)$/i, weight: 100 },
  { pattern: /(?:^|\/)(?:src\/)?app\/layout\.(?:tsx|jsx|ts|js)$/i, weight: 90 },
  { pattern: /(?:^|\/)src\/main\.(?:tsx|jsx|ts|js)$/i, weight: 70 },
  { pattern: /(?:^|\/)(?:src\/)?(?:app\/)?globals\.css$/i, weight: 60 },
  { pattern: /(?:^|\/)src\/styles\.(?:css|scss|sass)$/i, weight: 60 },
  { pattern: /(?:^|\/)(?:components|src\/components)\/.*\.(?:tsx|jsx)$/i, weight: 40 },
  { pattern: /(?:^|\/)index\.html$/i, weight: 35 },
];

/**
 * Rank project files for an edit prompt. Files the user literally NAMED are
 * the edit target and dominate every generic heuristic (full path > basename),
 * then framework entry points, then component files.
 */
export function pickEditFilePaths(files: readonly string[], userPrompt: string, limit = 6): string[] {
  const promptLower = userPrompt.toLowerCase();
  const onlyEditable = explicitOnlyEditablePaths(files, userPrompt);
  const scored = files
    .map((path) => {
      const normalized = path.replace(/\\/g, '/');
      if (BINARY_OR_LOCK_RE.test(normalized)
        || isSensitiveWorkspacePath(normalized)
        || isExplicitlyExcludedWorkspacePath(normalized, userPrompt)) {
        return { path: normalized, score: -1 };
      }
      if (onlyEditable
        && !onlyEditable.has(normalized.toLowerCase())
        && !isReadOnlyReferenceWorkspacePath(normalized, userPrompt)) {
        return { path: normalized, score: -1 };
      }
      let score = 0;
      const fileName = normalized.split('/').pop() ?? '';
      if (fileName.includes('.')) {
        if (promptLower.includes(normalized.toLowerCase())) score += 400;
        else if (promptLower.includes(fileName.toLowerCase())) score += 250;
      }
      for (const entry of ENTRY_POINT_WEIGHTS) {
        if (entry.pattern.test(normalized)) { score += entry.weight; break; }
      }
      return { path: normalized, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  return scored.slice(0, limit).map((entry) => entry.path);
}

export interface BuildWorkspaceEditContextInput {
  readonly workspace: WorkspaceFilePort;
  readonly projectId: string;
  readonly userPrompt: string;
  /** Max files placed in the edit prompt. Default 6. */
  readonly maxFiles?: number;
  /** Files larger than this are skipped — a 7-8B coder cannot faithfully re-emit them. Default 28k chars. */
  readonly maxCharsPerFile?: number;
  /** Read-only references are never re-emitted, so they may be larger. Default 60k chars. */
  readonly maxCharsPerReadonlyFile?: number;
}

/**
 * Resolve the designated project into a council edit context by reading the
 * real files from disk. Returns null when the project is unknown or nothing
 * readable/relevant was found (caller falls back to the legacy prompt parse).
 */
export async function buildWorkspaceEditContext(input: BuildWorkspaceEditContextInput): Promise<CouncilEditContext | null> {
  const { workspace, projectId, userPrompt } = input;
  const maxFiles = input.maxFiles ?? 6;
  const maxChars = input.maxCharsPerFile ?? 28_000;
  const maxReadonlyChars = input.maxCharsPerReadonlyFile ?? 60_000;

  const described = workspace.describe(projectId);
  if (!described) return null;

  let paths: string[];
  try {
    paths = pickEditFilePaths(await workspace.listFiles(projectId), userPrompt, maxFiles);
  } catch {
    return null;
  }
  if (paths.length === 0) return null;

  const files: CouncilEditFile[] = [];
  for (const path of paths) {
    if (isSensitiveWorkspacePath(path)) continue; // defense in depth before disk read
    const content = await workspace.readFile(projectId, path);
    if (content === null || content.length === 0) continue;
    const readonly = isReadOnlyReferenceWorkspacePath(path, userPrompt);
    if (content.length > (readonly ? maxReadonlyChars : maxChars)) continue;
    if (content.includes('\u0000')) continue;
    files.push({ path, content, ...(readonly ? { readonly: true } : {}) });
  }
  if (files.length === 0) return null;

  return {
    projectName: described.name,
    files,
    external: described.external,
  };
}
