/**
 * GitHub Content Script
 *
 * Captures repository information when you browse GitHub repos.
 * Captures: repo name, description, README, file tree, code files.
 */

import { isSensitivePage, sanitizeContent } from '../lib/privacy.js';

export default defineContentScript({
  matches: ['https://github.com/*'],
  excludeMatches: [
    'https://github.com/settings/*',
    'https://github.com/login*',
    'https://github.com/signup*',
  ],
  runAt: 'document_idle',

  main() {
    if (isSensitivePage(window.location.href)) return;

    // Debounce to handle GitHub's SPA navigation
    let timeout: ReturnType<typeof setTimeout>;

    const capture = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => captureGitHubContent(), 2000);
    };

    capture();

    // GitHub uses pjax/turbo for navigation
    const observer = new MutationObserver(capture);
    observer.observe(document.body, { childList: true, subtree: true });
  },
});

let lastCapturedUrl = '';

function captureGitHubContent() {
  const url = window.location.href;
  if (url === lastCapturedUrl) return;
  lastCapturedUrl = url;

  // Determine what kind of GitHub page this is
  const pathParts = window.location.pathname.split('/').filter(Boolean);

  if (pathParts.length < 2) return; // Not a repo page

  const owner = pathParts[0];
  const repo = pathParts[1];

  // Skip non-repo pages
  if (['explore', 'topics', 'trending', 'notifications', 'new'].includes(owner)) return;

  const title = `${owner}/${repo}`;
  const parts: string[] = [`# ${title}`];

  // Repo description
  const description = document.querySelector('[itemprop="about"], .f4.my-3')?.textContent?.trim();
  if (description) parts.push(description);

  // Is this a code file view?
  if (pathParts.length > 3 && (pathParts[2] === 'blob' || pathParts[2] === 'tree')) {
    const filePath = pathParts.slice(3).join('/');
    const codeContent = document.querySelector('.blob-code-content, [data-paste-markdown-skip]')?.textContent?.trim();

    if (codeContent) {
      parts.push(`\n## File: ${filePath}`);
      parts.push(sanitizeContent(codeContent));
    }
  }

  // README on main page
  const readme = document.querySelector('#readme article, .markdown-body')?.textContent?.trim();
  if (readme && readme.length > 50) {
    parts.push('\n## README');
    parts.push(sanitizeContent(readme.slice(0, 5000)));
  }

  // File tree
  const fileLinks = document.querySelectorAll('[role="rowheader"] a, .js-navigation-open');
  if (fileLinks.length > 0) {
    const files = Array.from(fileLinks)
      .map((el) => el.textContent?.trim())
      .filter(Boolean)
      .slice(0, 50);
    if (files.length > 0) {
      parts.push('\n## Files');
      parts.push(files.join('\n'));
    }
  }

  const content = parts.join('\n');
  if (content.length < 100) return; // Not enough content

  browser.runtime.sendMessage({
    type: 'SAVE_GITHUB_REPO',
    url,
    title,
    content,
    language: 'code',
    meta: { owner, repo, path: pathParts.slice(2).join('/') || undefined },
  });

  console.log(`[VAI] Captured GitHub: ${title} (${content.length} chars)`);
}
