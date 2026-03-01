/**
 * Parses AI-generated markdown responses to extract file blocks.
 *
 * Matches code fences with a `title="path/to/file"` attribute, which is the
 * format we instruct Vai to use in Builder and Agent system prompts.
 *
 * Example input:
 * ```tsx title="src/App.tsx"
 * export function App() { return <div>Hello</div>; }
 * ```
 *
 * Returns: [{ path: 'src/App.tsx', content: '...', language: 'tsx' }]
 */

export interface ExtractedFile {
  path: string;
  content: string;
  language: string;
}

/**
 * Extract file blocks from a markdown string.
 *
 * Supports both `title="..."` and `title='...'` syntax, e.g.:
 *   ```tsx title="src/App.tsx"
 *   ```tsx title='src/App.tsx'
 */
export function extractFilesFromMarkdown(markdown: string): ExtractedFile[] {
  const files: ExtractedFile[] = [];

  // Match: ```lang title="path"\n...content...\n```
  const regex = /```(\w*)\s+title=["']([^"']+)["']\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(markdown)) !== null) {
    const language = match[1] || 'text';
    const path = match[2].trim();
    const content = match[3].trimEnd();

    // Deduplicate: later definitions of the same path win
    const existingIdx = files.findIndex((f) => f.path === path);
    if (existingIdx >= 0) {
      files[existingIdx] = { path, content, language };
    } else {
      files.push({ path, content, language });
    }
  }

  return files;
}

/**
 * Checks whether markdown contains at least one file block with a title attribute.
 */
export function hasFileBlocks(markdown: string): boolean {
  return /```\w*\s+title=["'][^"']+["']/.test(markdown);
}

/**
 * Detects if a response contains a package.json file block,
 * indicating the AI is scaffolding a new project.
 */
export function hasPackageJson(files: ExtractedFile[]): boolean {
  return files.some((f) => f.path === 'package.json' || f.path.endsWith('/package.json'));
}

/**
 * Tries to extract a project name from a package.json file block.
 */
export function extractProjectName(files: ExtractedFile[]): string | null {
  const pkg = files.find((f) => f.path === 'package.json');
  if (!pkg) return null;
  try {
    const parsed = JSON.parse(pkg.content) as { name?: string };
    return parsed.name || null;
  } catch {
    return null;
  }
}
