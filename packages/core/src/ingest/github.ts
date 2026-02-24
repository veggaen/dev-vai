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
