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

const PATH_ATTRIBUTE_REGEX = /\b(?:title|path|file|filename)=["']([^"']+)["']/i;
function normalizeExtractedPath(filePath: string): string {
  return filePath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^(?:\.\/)+/, '')
    .replace(/\/{2,}/g, '/');
}

/**
 * Extract file blocks from a markdown string.
 *
 * Supports `title`, `path`, `file`, and `filename` attributes with either
 * single or double quotes, and normalizes common path variants like `./src/App.tsx`
 * or `\\src\\App.tsx`.
 */
export function extractFilesFromMarkdown(markdown: string): ExtractedFile[] {
  const files: ExtractedFile[] = [];

  // Match a fenced code block, then parse the info string separately.
  const regex = /```([^\r\n`]*)\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(markdown)) !== null) {
    const info = match[1].trim();
    const pathMatch = info.match(PATH_ATTRIBUTE_REGEX);
    if (!pathMatch) continue;

    const firstToken = info.split(/\s+/, 1)[0] ?? '';
    const language = firstToken && !firstToken.includes('=') ? firstToken : 'text';
    const path = normalizeExtractedPath(pathMatch[1]);
    if (!path) continue;

    const content = match[2].trimEnd();

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
 * Removes fenced code blocks that target concrete file paths via title/path/file attributes.
 * Plain code examples without a file path are preserved.
 */
export function stripFileBlocksFromMarkdown(markdown: string): string {
  const keptParts: string[] = [];
  const regex = /```([^\r\n`]*)\r?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(markdown)) !== null) {
    const info = match[1].trim();
    const hasPathAttribute = PATH_ATTRIBUTE_REGEX.test(info);
    PATH_ATTRIBUTE_REGEX.lastIndex = 0;

    if (!hasPathAttribute) {
      continue;
    }

    keptParts.push(markdown.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;
  }

  keptParts.push(markdown.slice(lastIndex));

  return keptParts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Checks whether markdown contains at least one recognized file block.
 */
export function hasFileBlocks(markdown: string): boolean {
  return extractFilesFromMarkdown(markdown).length > 0;
}

/**
 * Detects if a response contains a package.json file block,
 * indicating the AI is scaffolding a new project.
 */
export function hasPackageJson(files: ExtractedFile[]): boolean {
  return files.some((f) => {
    const path = normalizeExtractedPath(f.path);
    return path === 'package.json' || path.endsWith('/package.json');
  });
}

/**
 * Tries to extract a project name from a package.json file block.
 */
export function extractProjectName(files: ExtractedFile[]): string | null {
  const pkg = files.find((f) => normalizeExtractedPath(f.path) === 'package.json');
  if (!pkg) return null;
  try {
    const parsed = JSON.parse(pkg.content) as { name?: string };
    return parsed.name || null;
  } catch {
    return null;
  }
}

export function ensureViteReactEntrypoint(files: ExtractedFile[]): ExtractedFile[] {
  const hasMainTsx = files.some((file) => normalizeExtractedPath(file.path) === 'src/main.tsx');
  if (hasMainTsx) {
    return files;
  }

  const jsxEntrypoint = files.find((file) => {
    const path = normalizeExtractedPath(file.path);
    return path === 'src/main.jsx' || path === 'src/main.js';
  });

  if (!jsxEntrypoint) {
    return files;
  }

  return [
    ...files,
    {
      path: 'src/main.tsx',
      content: jsxEntrypoint.content,
      language: 'tsx',
    },
  ];
}
