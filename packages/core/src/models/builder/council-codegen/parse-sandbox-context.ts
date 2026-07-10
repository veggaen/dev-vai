import type { CouncilEditContext } from './types.js';

/**
 * Parse the desktop's active-sandbox system prompt into an edit context.
 *
 * The desktop composes (see apps/desktop ChatWindow):
 *
 *   ACTIVE SANDBOX PROJECT: "name"
 *   …
 *   CURRENT FILE SNAPSHOTS:
 *   FILE: src/App.tsx
 *   ```tsx
 *   …content…
 *   ```
 *
 * Files that end with the desktop's truncation marker are dropped — an edit
 * regenerates COMPLETE files, and regenerating from a cut-off snapshot would
 * silently amputate the running app.
 */

const PROJECT_NAME = /ACTIVE SANDBOX PROJECT:\s*"([^"\r\n]+)"/i;
const EXTERNAL_MARKER = /EXTERNAL local project folder/i;
const SNAPSHOT_FILE = /FILE:\s*([^\r\n`]+)\r?\n```[^\r\n`]*\r?\n([\s\S]*?)```/g;
const TRUNCATION_MARKER = '/* truncated for prompt context */';

export function parseActiveSandboxContext(systemPrompt: string | undefined): CouncilEditContext | null {
  if (!systemPrompt) return null;
  const nameMatch = PROJECT_NAME.exec(systemPrompt);
  if (!nameMatch) return null;

  const files: Array<{ path: string; content: string }> = [];
  for (const match of systemPrompt.matchAll(SNAPSHOT_FILE)) {
    const path = (match[1] ?? '').trim();
    const content = (match[2] ?? '').trim();
    if (!path || !content) continue;
    if (content.endsWith(TRUNCATION_MARKER)) continue;
    files.push({ path, content });
  }

  return {
    projectName: nameMatch[1].trim(),
    files,
    external: EXTERNAL_MARKER.test(systemPrompt),
  };
}
