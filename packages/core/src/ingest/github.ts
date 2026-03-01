/**
 * GitHub repository content extraction.
 *
 * Two modes:
 *   1. Server-side: fetch README and file tree from GitHub API (rate limited but no auth needed for public repos)
 *   2. Extension-side: content script captures what user sees in browser (handled by Chrome extension)
 *
 * This file handles mode 1 (server-side) + mode 2 data acceptance.
 */

import type { RawCapture } from './pipeline.js';

export interface GitHubRepoInfo {
  owner: string;
  repo: string;
  path?: string;
}

export function parseGitHubUrl(url: string): GitHubRepoInfo | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/?(.*)$/);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2].replace('.git', ''),
    path: match[3] || undefined,
  };
}

/**
 * Fetch a public GitHub repo's README and basic info.
 */
export async function fetchGitHubRepo(url: string): Promise<RawCapture> {
  const info = parseGitHubUrl(url);
  if (!info) throw new Error(`Not a valid GitHub URL: ${url}`);

  const apiBase = `https://api.github.com/repos/${info.owner}/${info.repo}`;

  // Fetch repo metadata
  const repoRes = await fetch(apiBase, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'VeggaAI/0.1',
    },
  });

  let repoData: Record<string, unknown> = {};
  if (repoRes.ok) {
    repoData = await repoRes.json() as Record<string, unknown>;
  }

  // Fetch README
  let readme = '';
  const readmeRes = await fetch(`${apiBase}/readme`, {
    headers: {
      Accept: 'application/vnd.github.v3.raw',
      'User-Agent': 'VeggaAI/0.1',
    },
  });
  if (readmeRes.ok) {
    readme = await readmeRes.text();
  }

  // Fetch top-level file tree
  let fileTree: string[] = [];
  const treeRes = await fetch(`${apiBase}/contents/`, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'VeggaAI/0.1',
    },
  });
  if (treeRes.ok) {
    const files = await treeRes.json() as Array<{ name: string; type: string; path: string }>;
    fileTree = files.map((f) => `${f.type === 'dir' ? '[dir]' : '[file]'} ${f.path}`);
  }

  const title = `${info.owner}/${info.repo}`;
  const description = (repoData.description as string) ?? '';
  const language = (repoData.language as string) ?? '';
  const stars = (repoData.stargazers_count as number) ?? 0;

  const content = [
    `# ${title}`,
    description ? `\n${description}` : '',
    language ? `\nPrimary language: ${language}` : '',
    `Stars: ${stars}`,
    fileTree.length > 0 ? `\n## File Structure\n${fileTree.join('\n')}` : '',
    readme ? `\n## README\n${readme}` : '',
  ].filter(Boolean).join('\n');

  return {
    sourceType: 'github',
    url,
    title,
    content,
    language: 'code',
    meta: {
      owner: info.owner,
      repo: info.repo,
      primaryLanguage: language,
      stars,
      fileCount: fileTree.length,
      fetchedAt: new Date().toISOString(),
    },
  };
}

/**
 * Accept GitHub content directly from the Chrome extension.
 */
export function createGitHubCapture(
  url: string,
  title: string,
  content: string,
  fileTree?: string[],
  meta?: Record<string, unknown>,
): RawCapture {
  const info = parseGitHubUrl(url);
  return {
    sourceType: 'github',
    url,
    title,
    content,
    language: 'code',
    meta: {
      owner: info?.owner,
      repo: info?.repo,
      fileTree,
      capturedBy: 'extension',
      fetchedAt: new Date().toISOString(),
      ...meta,
    },
  };
}

// ─── Deep Fetch ─────────────────────────────────────────────────

const CODE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss',
  '.json', '.yaml', '.yml', '.toml', '.md', '.mdx', '.rs', '.go', '.py',
  '.sql', '.prisma', '.graphql', '.gql',
]);
const IMPORTANT_FILES = new Set([
  'package.json', 'tsconfig.json', 'next.config.js', 'next.config.ts', 'next.config.mjs',
  'tailwind.config.js', 'tailwind.config.ts', 'vite.config.ts', 'vitest.config.ts',
  'drizzle.config.ts', 'turbo.json', 'pnpm-workspace.yaml', 'Dockerfile',
]);
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.turbo', '.cache',
  'coverage', '__pycache__', '.venv', 'target', 'vendor',
]);

function shouldInclude(path: string, size?: number): boolean {
  if (size && size > 50000) return false;
  const name = path.split('/').pop() ?? '';
  if (IMPORTANT_FILES.has(name)) return true;
  const ext = '.' + name.split('.').pop();
  if (!CODE_EXTS.has(ext)) return false;
  for (const skip of SKIP_DIRS) {
    if (path.startsWith(skip + '/') || path.includes('/' + skip + '/')) return false;
  }
  if (path.includes('.min.') || path.includes('.bundle.') || path.includes('generated')) return false;
  return true;
}

interface TreeEntry { path: string; type: 'blob' | 'tree'; size?: number }

function ghHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'VeggaAI/0.1' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}
function ghRawHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/vnd.github.v3.raw', 'User-Agent': 'VeggaAI/0.1' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/**
 * Deep-fetch a GitHub repo: recursively fetches source files and returns
 * multiple captures grouped by code area (components, server, config, etc.).
 * Used by VCUS teaching system and API route.
 */
export async function deepFetchGitHubRepo(
  url: string,
  options: { maxFiles?: number; token?: string; onProgress?: (msg: string) => void } = {},
): Promise<RawCapture[]> {
  const info = parseGitHubUrl(url);
  if (!info) throw new Error(`Not a valid GitHub URL: ${url}`);

  const { owner, repo } = info;
  const token = options.token ?? process.env.GITHUB_TOKEN ?? '';
  const maxFiles = options.maxFiles ?? 60;
  const log = options.onProgress ?? (() => {});

  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;

  // Get repo meta + default branch
  const metaRes = await fetch(apiBase, { headers: ghHeaders(token) });
  const meta = metaRes.ok ? await metaRes.json() as Record<string, unknown> : {};
  const defaultBranch = (meta.default_branch as string) ?? 'main';
  const description = (meta.description as string) ?? '';
  const stars = (meta.stargazers_count as number) ?? 0;

  // Fetch recursive tree
  let tree: TreeEntry[] = [];
  for (const ref of [defaultBranch, 'master']) {
    const treeUrl = `${apiBase}/git/trees/${ref}?recursive=1`;
    const r = await fetch(treeUrl, { headers: ghHeaders(token) });
    if (r.ok) {
      const data = await r.json() as { tree: TreeEntry[] };
      tree = data.tree;
      break;
    }
  }
  if (tree.length === 0) throw new Error(`Could not fetch tree for ${owner}/${repo}`);

  const blobs = tree.filter(e => e.type === 'blob' && shouldInclude(e.path, e.size));
  log(`📂 ${tree.length} total, ${blobs.length} relevant files`);

  // Smart file selection — prioritize diversity across packages/areas
  // 1. Important config files first
  const importantFiles = blobs.filter(b => IMPORTANT_FILES.has(b.path.split('/').pop() ?? ''));
  const codeFiles = blobs.filter(b => !IMPORTANT_FILES.has(b.path.split('/').pop() ?? ''));

  // 2. Group code files by their top-level directory (or packages/xxx)
  const dirBuckets: Record<string, TreeEntry[]> = {};
  for (const f of codeFiles) {
    const parts = f.path.split('/');
    let bucket: string;
    const pkgIdx = parts.findIndex(s => s === 'packages' || s === 'apps');
    if (pkgIdx >= 0 && parts.length > pkgIdx + 2) {
      bucket = parts.slice(0, pkgIdx + 2).join('/');
    } else {
      bucket = parts[0] ?? 'root';
    }
    if (!dirBuckets[bucket]) dirBuckets[bucket] = [];
    dirBuckets[bucket].push(f);
  }

  // 3. Round-robin from each bucket, sorted by size within each
  for (const files of Object.values(dirBuckets)) {
    files.sort((a, b) => (a.size ?? 0) - (b.size ?? 0));
  }

  const toFetch: TreeEntry[] = [...importantFiles.slice(0, Math.min(15, maxFiles))];
  const remaining = maxFiles - toFetch.length;
  const bucketKeys = Object.keys(dirBuckets);
  if (bucketKeys.length > 0) {
    const perBucket = Math.max(2, Math.ceil(remaining / bucketKeys.length));
    for (const key of bucketKeys) {
      for (const f of dirBuckets[key].slice(0, perBucket)) {
        if (toFetch.length >= maxFiles) break;
        if (!toFetch.includes(f)) toFetch.push(f);
      }
    }
    // Fill remaining with any leftover files
    if (toFetch.length < maxFiles) {
      for (const key of bucketKeys) {
        for (const f of dirBuckets[key]) {
          if (toFetch.length >= maxFiles) break;
          if (!toFetch.includes(f)) toFetch.push(f);
        }
      }
    }
  }
  log(`📥 Fetching ${toFetch.length} files...`);

  // Batch-fetch
  const files: Array<{ path: string; content: string }> = [];
  for (let i = 0; i < toFetch.length; i += 10) {
    const batch = toFetch.slice(i, i + 10);
    const results = await Promise.allSettled(
      batch.map(async (e) => {
        const r = await fetch(`${apiBase}/contents/${e.path}`, { headers: ghRawHeaders(token) });
        if (!r.ok) throw new Error(`${r.status}`);
        return { path: e.path, content: await r.text() };
      }),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') files.push(r.value);
    }
    if (i + 10 < toFetch.length) await new Promise(r => setTimeout(r, 100));
  }

  log(`✅ Downloaded ${files.length} files`);

  // Group files by area — smarter classification for monorepos
  const groups: Record<string, Array<{ path: string; content: string }>> = {};
  const addGroup = (name: string, f: { path: string; content: string }) => {
    if (!groups[name]) groups[name] = [];
    groups[name].push(f);
  };

  for (const f of files) {
    const p = f.path.toLowerCase();
    const name = p.split('/').pop() ?? '';
    const parts = p.split('/');

    // For monorepos, use package name as prefix when file is nested in packages/*/
    let pkgPrefix = '';
    const pkgIdx = parts.findIndex(s => s === 'packages' || s === 'apps');
    if (pkgIdx >= 0 && parts.length > pkgIdx + 2) {
      pkgPrefix = parts[pkgIdx + 1] + '/';
    }

    if (name.includes('config') || name === 'package.json' || name === 'tsconfig.json'
        || name.endsWith('.yaml') || name.endsWith('.toml') || name === 'turbo.json'
        || name === 'dockerfile' || name.endsWith('.lock')) {
      addGroup(pkgPrefix + 'config', f);
    } else if (p.includes('/test') || p.includes('.test.') || p.includes('.spec.')
        || p.includes('__test') || p.includes('__spec')) {
      addGroup(pkgPrefix + 'tests', f);
    } else if (p.includes('/component') || p.includes('/ui/') || p.includes('/widget')) {
      addGroup(pkgPrefix + 'components', f);
    } else if (p.includes('/page') || p.includes('/app/') || p.includes('/pages/')
        || p.includes('/route') || p.includes('/views/')) {
      addGroup(pkgPrefix + 'pages-routes', f);
    } else if (p.includes('/hook') || name.startsWith('use')) {
      addGroup(pkgPrefix + 'hooks', f);
    } else if (p.includes('/server') || p.includes('/api/') || p.includes('/trpc')
        || p.includes('router') || p.includes('/middleware') || p.includes('/procedure')
        || p.includes('/controller') || p.includes('/handler')) {
      addGroup(pkgPrefix + 'server-api', f);
    } else if (p.includes('/db') || p.includes('/schema') || p.includes('/prisma')
        || p.includes('.sql') || p.includes('/migration') || p.includes('/model')
        || p.includes('/entity') || p.includes('/drizzle')) {
      addGroup(pkgPrefix + 'database', f);
    } else if (p.includes('/lib') || p.includes('/util') || p.includes('/helper')
        || p.includes('/shared') || p.includes('/common') || p.includes('/core/')) {
      addGroup(pkgPrefix + 'lib-utils', f);
    } else if (p.includes('/type') || name.endsWith('.d.ts') || name === 'types.ts'
        || name === 'interface.ts' || name === 'interfaces.ts') {
      addGroup(pkgPrefix + 'types', f);
    } else if (p.includes('/style') || name.endsWith('.css') || name.endsWith('.scss')) {
      addGroup(pkgPrefix + 'styles', f);
    } else if (name.endsWith('.md') || name.endsWith('.mdx')) {
      addGroup(pkgPrefix + 'docs', f);
    } else if (name.endsWith('.tsx') && !p.includes('page') && !p.includes('app/')) {
      addGroup(pkgPrefix + 'components', f);
    } else {
      addGroup(pkgPrefix + 'src', f);
    }
  }

  // Build captures
  const captures: RawCapture[] = [];
  for (const [group, groupFiles] of Object.entries(groups)) {
    const fileContents = groupFiles
      .map(f => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
      .join('\n\n');
    captures.push({
      sourceType: 'github',
      url: `https://github.com/${owner}/${repo}`,
      title: `${owner}/${repo} — ${group}`,
      content: `# ${owner}/${repo} — ${group}\n> ${description}\n\n${fileContents}`,
      language: 'code',
      meta: {
        owner, repo, group, stars, deepIngest: true,
        files: groupFiles.map(f => f.path),
        fileCount: groupFiles.length,
        fetchedAt: new Date().toISOString(),
      },
    });
  }

  // Overview capture
  captures.unshift({
    sourceType: 'github',
    url: `https://github.com/${owner}/${repo}`,
    title: `${owner}/${repo} — overview`,
    content: [
      `# ${owner}/${repo}`, description, `Stars: ${stars}`,
      `\n## Structure (${files.length} files in ${Object.keys(groups).length} groups)`,
      ...Object.entries(groups).map(([g, f]) => `### ${g}: ${f.map(x => x.path).join(', ')}`),
      `\n## Full tree`, tree.filter(e => e.type === 'blob').slice(0, 200).map(e => e.path).join('\n'),
    ].filter(Boolean).join('\n'),
    language: 'code',
    meta: { owner, repo, group: 'overview', stars, deepIngest: true, totalFiles: files.length, fetchedAt: new Date().toISOString() },
  });

  return captures;
}
