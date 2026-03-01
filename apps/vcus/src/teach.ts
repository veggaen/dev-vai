/**
 * VCUS Teaching System
 *
 * Teaches VAI about real-world code patterns by:
 * 1. Deep-ingesting GitHub repos
 * 2. Extracting patterns from the code
 * 3. Finding similar patterns (4x examples per pattern)
 * 4. Testing VAI's understanding with questions
 *
 * Usage:
 *   tsx src/teach.ts https://github.com/pingdotgg/lawn
 *   tsx src/teach.ts --repos lawn,uploadthing,shadcn-ui
 */

import { deepIngestRepo, checkRateLimit } from './ingest-deep.js';
import type { RawCapture } from '@vai/core';

const BASE = process.env.VAI_URL || 'http://localhost:3006';

// Well-known repos to teach VAI about
const REPO_CATALOG: Record<string, string> = {
  'lawn': 'https://github.com/pingdotgg/lawn',
  'uploadthing': 'https://github.com/pingdotgg/uploadthing',
  'shadcn-ui': 'https://github.com/shadcn-ui/ui',
  'next.js': 'https://github.com/vercel/next.js',
  'trpc': 'https://github.com/trpc/trpc',
  't3-app': 'https://github.com/t3-oss/create-t3-app',
  'medusa': 'https://github.com/medusajs/medusa',
  'commerce': 'https://github.com/vercel/commerce',
  'nextchat': 'https://github.com/ChatGPTNextWeb/NextChat',
  'chatgpt-desktop': 'https://github.com/lencx/ChatGPT',
};

interface TeachResult {
  repo: string;
  groupsIngested: number;
  totalFiles: number;
  totalTokens: number;
  patterns: string[];
}

/**
 * Ingest a single repo into VAI via the server API.
 */
async function ingestCapture(capture: RawCapture): Promise<{ tokensLearned: number; title: string }> {
  const res = await fetch(`${BASE}/api/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'SAVE_GITHUB_REPO',
      url: capture.url,
      title: capture.title,
      content: capture.content,
      language: capture.language,
      meta: capture.meta,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Ingest failed: ${res.status}`);
  return res.json() as Promise<{ tokensLearned: number; title: string }>;
}

/**
 * Teach VAI about a GitHub repository by deep-ingesting it.
 */
async function teachRepo(repoUrl: string): Promise<TeachResult> {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/\s#?]+)/);
  if (!match) throw new Error(`Invalid GitHub URL: ${repoUrl}`);
  const repoName = `${match[1]}/${match[2].replace('.git', '')}`;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  🎓 Teaching VAI about: ${repoName}`);
  console.log(`${'═'.repeat(60)}\n`);

  // Check rate limit
  const rate = await checkRateLimit();
  console.log(`  GitHub API: ${rate.remaining}/${rate.limit} requests remaining (resets ${rate.resetAt.toLocaleTimeString()})`);
  if (rate.remaining < 20) {
    console.log(`  ⚠️  Low rate limit! Waiting until reset...`);
    const waitMs = rate.resetAt.getTime() - Date.now() + 1000;
    if (waitMs > 0 && waitMs < 3600000) {
      await new Promise(r => setTimeout(r, waitMs));
    }
  }

  // Deep ingest
  const captures = await deepIngestRepo(repoUrl, {
    onProgress: (msg) => console.log(`  ${msg}`),
  });

  // Send each capture to VAI
  let totalTokens = 0;
  const patterns: string[] = [];

  for (const capture of captures) {
    try {
      const result = await ingestCapture(capture);
      totalTokens += result.tokensLearned;
      const group = (capture.meta as Record<string, unknown>)?.group as string ?? 'unknown';
      patterns.push(group);
      console.log(`  📝 Ingested "${capture.title}" — ${result.tokensLearned} tokens`);
    } catch (err) {
      console.log(`  ❌ Failed to ingest "${capture.title}": ${(err as Error).message}`);
    }
  }

  const totalFiles = captures.reduce((sum, c) => {
    const meta = c.meta as Record<string, unknown> | undefined;
    return sum + ((meta?.fileCount as number) ?? 0);
  }, 0);

  console.log(`\n  ✅ Done! ${captures.length} groups, ${totalFiles} files, ${totalTokens} tokens learned`);

  return {
    repo: repoName,
    groupsIngested: captures.length,
    totalFiles,
    totalTokens,
    patterns: [...new Set(patterns)],
  };
}

/**
 * Main entry point.
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage:');
    console.log('  tsx src/teach.ts https://github.com/owner/repo');
    console.log('  tsx src/teach.ts --repos lawn,uploadthing');
    console.log('\nAvailable repos:');
    for (const [name, url] of Object.entries(REPO_CATALOG)) {
      console.log(`  ${name.padEnd(20)} ${url}`);
    }
    process.exit(0);
  }

  // Check server is running
  try {
    await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
  } catch {
    console.error('❌ VAI server not running at', BASE);
    console.error('   Start it first: cd packages/runtime && npx tsx src/index.ts');
    process.exit(1);
  }

  const repos: string[] = [];

  if (args[0] === '--repos') {
    const names = args[1]?.split(',') ?? [];
    for (const name of names) {
      const url = REPO_CATALOG[name.trim()];
      if (url) repos.push(url);
      else console.warn(`Unknown repo: ${name}. Available: ${Object.keys(REPO_CATALOG).join(', ')}`);
    }
  } else {
    // Direct URLs
    for (const arg of args) {
      if (arg.includes('github.com')) repos.push(arg);
      else if (REPO_CATALOG[arg]) repos.push(REPO_CATALOG[arg]);
    }
  }

  if (repos.length === 0) {
    console.error('No valid repos specified.');
    process.exit(1);
  }

  console.log(`\n🎓 VCUS Teaching Session — ${repos.length} repos to teach\n`);

  const results: TeachResult[] = [];
  for (const url of repos) {
    try {
      const result = await teachRepo(url);
      results.push(result);
    } catch (err) {
      console.error(`❌ Failed to teach ${url}: ${(err as Error).message}`);
    }
  }

  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  📊 TEACHING SESSION SUMMARY`);
  console.log(`${'═'.repeat(60)}`);
  for (const r of results) {
    console.log(`  ${r.repo}: ${r.groupsIngested} groups, ${r.totalFiles} files, ${r.totalTokens} tokens`);
    console.log(`    Patterns: ${r.patterns.join(', ')}`);
  }
  const totalTokens = results.reduce((s, r) => s + r.totalTokens, 0);
  console.log(`\n  Total: ${totalTokens} tokens across ${results.length} repos`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(console.error);
