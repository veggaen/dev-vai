/**
 * Deep GitHub Repository Ingestion
 *
 * Unlike the basic fetchGitHubRepo which only gets README + top-level tree,
 * this recursively fetches actual source code files from a GitHub repo.
 *
 * Strategy:
 * 1. Fetch repo tree recursively via GitHub API
 * 2. Filter to important files (src, components, lib, etc.)
 * 3. Download each file's content
 * 4. Group files by pattern (components, hooks, utils, config, etc.)
 * 5. Ingest each group as a separate source for VAI to learn
 *
 * Rate limits: GitHub unauthenticated = 60 req/hr. With token = 5000 req/hr.
 * We use conditional requests + batching to stay within limits.
 */

import type { RawCapture } from '@vai/core';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const UA = 'VeggaAI/0.1';

interface TreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

interface RepoFile {
  path: string;
  content: string;
  size: number;
  language: string;
}

interface PatternGroup {
  name: string;
  description: string;
  files: RepoFile[];
}

// File extensions we care about for learning code patterns
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.css', '.scss', '.less',
  '.json', '.yaml', '.yml', '.toml',
  '.md', '.mdx',
  '.rs', '.go', '.py',
  '.sql',
  '.prisma',
  '.graphql', '.gql',
  '.env.example',
  '.dockerfile', '.dockerignore',
]);

// Files always worth reading regardless of location
const IMPORTANT_FILES = new Set([
  'package.json', 'tsconfig.json', 'next.config.js', 'next.config.ts', 'next.config.mjs',
  'tailwind.config.js', 'tailwind.config.ts', 'postcss.config.js', 'postcss.config.mjs',
  'vite.config.ts', 'vite.config.js', 'vitest.config.ts',
  'drizzle.config.ts', 'prisma/schema.prisma',
  '.env.example', 'turbo.json', 'pnpm-workspace.yaml',
  'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  'Cargo.toml', 'go.mod', 'pyproject.toml', 'requirements.txt',
  'trpc.ts', 'router.ts', 'middleware.ts',
]);

// Directories to skip
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.turbo',
  '.cache', 'coverage', '__pycache__', '.venv', 'target',
  '.github/workflows', 'vendor', 'public/assets',
]);

// Max file size (50KB) — skip huge generated files
const MAX_FILE_SIZE = 50_000;

// Max files per repo to prevent API exhaustion
const MAX_FILES = 80;

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': UA,
  };
  if (GITHUB_TOKEN) h.Authorization = `Bearer ${GITHUB_TOKEN}`;
  return h;
}

function rawHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github.v3.raw',
    'User-Agent': UA,
  };
  if (GITHUB_TOKEN) h.Authorization = `Bearer ${GITHUB_TOKEN}`;
  return h;
}

function shouldIncludeFile(path: string, size?: number): boolean {
  if (size && size > MAX_FILE_SIZE) return false;

  const filename = path.split('/').pop() ?? '';
  if (IMPORTANT_FILES.has(filename) || IMPORTANT_FILES.has(path)) return true;

  // Check extension
  const ext = '.' + filename.split('.').pop();
  if (!CODE_EXTENSIONS.has(ext) && !filename.endsWith('.config.js') && !filename.endsWith('.config.ts')) return false;

  // Skip directories
  for (const skip of SKIP_DIRS) {
    if (path.startsWith(skip + '/') || path.includes('/' + skip + '/')) return false;
  }

  // Skip generated/vendored files
  if (path.includes('.min.') || path.includes('.bundle.') || path.includes('generated')) return false;
  if (filename.startsWith('.') && !filename.startsWith('.env')) return false;

  return true;
}

function detectLanguage(path: string): string {
  const ext = '.' + path.split('.').pop();
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
    '.mjs': 'javascript', '.cjs': 'javascript',
    '.css': 'css', '.scss': 'scss', '.less': 'css',
    '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
    '.md': 'markdown', '.mdx': 'mdx',
    '.rs': 'rust', '.go': 'go', '.py': 'python', '.sql': 'sql',
    '.prisma': 'prisma', '.graphql': 'graphql', '.gql': 'graphql',
  };
  return map[ext] ?? 'text';
}

/**
 * Classify files into pattern groups for structured learning.
 */
function classifyFiles(files: RepoFile[]): PatternGroup[] {
  const groups: Record<string, PatternGroup> = {};

  const addToGroup = (name: string, description: string, file: RepoFile) => {
    if (!groups[name]) groups[name] = { name, description, files: [] };
    groups[name].files.push(file);
  };

  for (const f of files) {
    const p = f.path.toLowerCase();
    const filename = p.split('/').pop() ?? '';

    // Config files
    if (filename.includes('config') || filename === 'package.json' || filename === 'tsconfig.json'
        || filename === 'turbo.json' || filename.endsWith('.yaml') || filename.endsWith('.toml')
        || filename === 'pnpm-workspace.yaml') {
      addToGroup('config', 'Project configuration, build tools, and package setup', f);
    }
    // Components
    else if (p.includes('/component') || p.includes('/ui/') || (f.language === 'typescript' && filename.endsWith('.tsx') && !p.includes('page') && !p.includes('layout') && !p.includes('app/'))) {
      addToGroup('components', 'React/UI components — the building blocks of the interface', f);
    }
    // Pages / Routes
    else if (p.includes('/page') || p.includes('/route') || p.includes('/app/') || p.includes('/pages/')) {
      addToGroup('pages-routes', 'Page components and API routes — the app\'s routing structure', f);
    }
    // Hooks
    else if (p.includes('/hook') || filename.startsWith('use')) {
      addToGroup('hooks', 'Custom React hooks — reusable stateful logic', f);
    }
    // Server / API / tRPC
    else if (p.includes('/server') || p.includes('/api/') || p.includes('/trpc') || p.includes('router')) {
      addToGroup('server-api', 'Server-side code, API endpoints, tRPC routers', f);
    }
    // Database / Schema
    else if (p.includes('/db') || p.includes('/schema') || p.includes('/prisma') || p.includes('/drizzle') || p.includes('.sql')) {
      addToGroup('database', 'Database schemas, migrations, and data access layer', f);
    }
    // Lib / Utils
    else if (p.includes('/lib') || p.includes('/util') || p.includes('/helper') || p.includes('/shared')) {
      addToGroup('lib-utils', 'Shared utilities, helper functions, and library code', f);
    }
    // Types
    else if (p.includes('/type') || filename.endsWith('.d.ts') || filename === 'types.ts') {
      addToGroup('types', 'TypeScript type definitions and interfaces', f);
    }
    // Tests
    else if (p.includes('/test') || p.includes('/__test') || p.includes('.test.') || p.includes('.spec.')) {
      addToGroup('tests', 'Test files — testing patterns and assertions', f);
    }
    // Styles
    else if (f.language === 'css' || f.language === 'scss' || p.includes('/style')) {
      addToGroup('styles', 'Styling — CSS, Tailwind, and design tokens', f);
    }
    // Middleware
    else if (p.includes('middleware')) {
      addToGroup('middleware', 'Middleware — request processing, auth, etc.', f);
    }
    // Documentation
    else if (f.language === 'markdown' || f.language === 'mdx') {
      addToGroup('docs', 'Documentation and README files', f);
    }
    // Everything else
    else {
      addToGroup('other', 'Other source files', f);
    }
  }

  return Object.values(groups);
}

/**
 * Fetch full recursive tree of a GitHub repo.
 */
async function fetchTree(owner: string, repo: string, branch = 'main'): Promise<TreeEntry[]> {
  // Try main first, then master
  for (const ref of [branch, 'master']) {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`;
    const res = await fetch(url, { headers: headers() });
    if (res.ok) {
      const data = await res.json() as { tree: TreeEntry[]; truncated: boolean };
      if (data.truncated) {
        console.warn(`[VCUS] Tree for ${owner}/${repo} was truncated — very large repo`);
      }
      return data.tree;
    }
  }
  throw new Error(`Could not fetch tree for ${owner}/${repo}`);
}

/**
 * Fetch a single file's content from GitHub.
 */
async function fetchFile(owner: string, repo: string, path: string): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const res = await fetch(url, { headers: rawHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  return res.text();
}

/**
 * Deep-ingest a GitHub repository.
 * Returns an array of RawCapture objects, one per pattern group.
 */
export async function deepIngestRepo(
  repoUrl: string,
  options: { maxFiles?: number; branch?: string; onProgress?: (msg: string) => void } = {},
): Promise<RawCapture[]> {
  const maxFiles = options.maxFiles ?? MAX_FILES;
  const log = options.onProgress ?? console.log;

  // Parse URL
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/\s#?]+)/);
  if (!match) throw new Error(`Invalid GitHub URL: ${repoUrl}`);
  const owner = match[1];
  const repo = match[2].replace('.git', '');

  log(`📦 Fetching tree for ${owner}/${repo}...`);

  // Get repo metadata
  const metaRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: headers() });
  const meta = metaRes.ok ? await metaRes.json() as Record<string, unknown> : {};
  const description = (meta.description as string) ?? '';
  const stars = (meta.stargazers_count as number) ?? 0;
  const defaultBranch = (meta.default_branch as string) ?? 'main';

  // Fetch recursive tree
  const tree = await fetchTree(owner, repo, options.branch ?? defaultBranch);
  const blobs = tree.filter(e => e.type === 'blob' && shouldIncludeFile(e.path, e.size));

  log(`📂 Found ${tree.length} total entries, ${blobs.length} relevant files`);

  // Prioritize: config first, then components, then pages, then rest
  const sorted = blobs.sort((a, b) => {
    const aName = a.path.split('/').pop() ?? '';
    const bName = b.path.split('/').pop() ?? '';
    const aImportant = IMPORTANT_FILES.has(aName) ? 0 : 1;
    const bImportant = IMPORTANT_FILES.has(bName) ? 0 : 1;
    if (aImportant !== bImportant) return aImportant - bImportant;
    const aSize = a.size ?? 0;
    const bSize = b.size ?? 0;
    return aSize - bSize; // smaller files first (more focused)
  });

  const toFetch = sorted.slice(0, maxFiles);
  log(`📥 Downloading ${toFetch.length} files...`);

  // Fetch files in batches of 10 with rate limiting
  const files: RepoFile[] = [];
  const batchSize = 10;
  for (let i = 0; i < toFetch.length; i += batchSize) {
    const batch = toFetch.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (entry) => {
        const content = await fetchFile(owner, repo, entry.path);
        return {
          path: entry.path,
          content,
          size: content.length,
          language: detectLanguage(entry.path),
        };
      }),
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        files.push(r.value);
      }
    }

    if (i + batchSize < toFetch.length) {
      // Rate limit: 100ms between batches
      await new Promise(r => setTimeout(r, 100));
    }

    if ((i + batchSize) % 30 < batchSize) {
      log(`  ${Math.min(i + batchSize, toFetch.length)}/${toFetch.length} files downloaded`);
    }
  }

  log(`✅ Downloaded ${files.length} files, classifying into pattern groups...`);

  // Classify into groups
  const groups = classifyFiles(files);
  log(`📊 ${groups.length} pattern groups: ${groups.map(g => `${g.name}(${g.files.length})`).join(', ')}`);

  // Build captures — one per group
  const captures: RawCapture[] = [];

  for (const group of groups) {
    const fileContents = group.files.map(f => {
      return `### ${f.path}\n\`\`\`${f.language}\n${f.content}\n\`\`\``;
    }).join('\n\n');

    const content = [
      `# ${owner}/${repo} — ${group.name}`,
      description ? `> ${description}` : '',
      `\n${group.description}`,
      `\nFiles in this group (${group.files.length}):`,
      group.files.map(f => `- ${f.path} (${f.size} bytes)`).join('\n'),
      `\n---\n`,
      fileContents,
    ].filter(Boolean).join('\n');

    captures.push({
      sourceType: 'github' as const,
      url: `https://github.com/${owner}/${repo}`,
      title: `${owner}/${repo} — ${group.name}`,
      content,
      language: 'code',
      meta: {
        owner,
        repo,
        group: group.name,
        groupDescription: group.description,
        fileCount: group.files.length,
        files: group.files.map(f => f.path),
        stars,
        primaryLanguage: (meta.language as string) ?? '',
        deepIngest: true,
        fetchedAt: new Date().toISOString(),
      },
    });
  }

  // Also add an overview capture
  const overviewContent = [
    `# ${owner}/${repo}`,
    description ? `\n> ${description}` : '',
    `\nStars: ${stars} | Language: ${(meta.language as string) ?? 'N/A'}`,
    `\n## Architecture Overview`,
    `\nThis repository has ${files.length} source files organized into ${groups.length} groups:`,
    ...groups.map(g => `\n### ${g.name} (${g.files.length} files)\n${g.description}\nFiles: ${g.files.map(f => f.path).join(', ')}`),
    `\n## File Tree`,
    tree.filter(e => e.type === 'blob').slice(0, 200).map(e => e.path).join('\n'),
  ].filter(Boolean).join('\n');

  captures.unshift({
    sourceType: 'github' as const,
    url: `https://github.com/${owner}/${repo}`,
    title: `${owner}/${repo} — overview`,
    content: overviewContent,
    language: 'code',
    meta: {
      owner,
      repo,
      group: 'overview',
      stars,
      primaryLanguage: (meta.language as string) ?? '',
      totalFiles: files.length,
      groups: groups.map(g => ({ name: g.name, count: g.files.length })),
      deepIngest: true,
      fetchedAt: new Date().toISOString(),
    },
  });

  log(`🎓 Created ${captures.length} learning captures for VAI`);
  return captures;
}

/**
 * Check GitHub API rate limit.
 */
export async function checkRateLimit(): Promise<{ remaining: number; limit: number; resetAt: Date }> {
  const res = await fetch('https://api.github.com/rate_limit', { headers: headers() });
  const data = await res.json() as { resources: { core: { remaining: number; limit: number; reset: number } } };
  return {
    remaining: data.resources.core.remaining,
    limit: data.resources.core.limit,
    resetAt: new Date(data.resources.core.reset * 1000),
  };
}
