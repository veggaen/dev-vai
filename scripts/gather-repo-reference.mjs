#!/usr/bin/env node
/**
 * gather-repo-reference — fetch FULL analysis of admired/excellent repos and persist it as
 * reference data the council improvement loop can cite as exemplars ("learn from how these
 * are built"). Pulls description, stack, topics, stars, license, and a README excerpt from
 * the GitHub API (no auth needed for public repos; set GITHUB_TOKEN to raise rate limits).
 *
 *   node scripts/gather-repo-reference.mjs
 *
 * Output: eval/reference/repo-exemplars.json
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// Repos the user named to study + admire (excellent code to learn from), and the originals.
const REPOS = [
  'pingdotgg/t3code',       // a web GUI for coding agents — closest mirror of Vai's process UI
  'pingdotgg/uploadthing',
  'pingdotgg/lawn',
  'pewdiepie-archdaemon/odysseus',
  'colinhacks/zod',         // exemplar: TS-first API design, type inference
  'honojs/hono',            // exemplar: tiny, web-standards-first framework
  'veggaen/DEV-VEGGASTARE', // the original turn the user tested
];

const headers = {
  accept: 'application/vnd.github+json',
  'user-agent': 'vai-repo-reference',
  ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) return null;
  return res.json();
}

async function analyze(slug) {
  const [owner, repo] = slug.split('/');
  const meta = await gh(`/repos/${owner}/${repo}`);
  if (!meta) return { slug, error: 'fetch failed (rate limit / private / 404)' };
  let readmeExcerpt = '';
  const readme = await gh(`/repos/${owner}/${repo}/readme`);
  if (readme?.content) {
    readmeExcerpt = Buffer.from(readme.content.replace(/\s+/g, ''), 'base64')
      .toString('utf8')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')   // strip image badges
      .slice(0, 1200)
      .trim();
  }
  const langs = await gh(`/repos/${owner}/${repo}/languages`);
  return {
    slug,
    description: meta.description ?? '',
    homepage: meta.homepage ?? '',
    primaryLanguage: meta.language ?? '',
    languages: langs ? Object.keys(langs) : [],
    topics: meta.topics ?? [],
    stars: meta.stargazers_count ?? 0,
    forks: meta.forks_count ?? 0,
    openIssues: meta.open_issues_count ?? 0,
    license: meta.license?.spdx_id ?? null,
    pushedAt: meta.pushed_at ?? null,
    archived: Boolean(meta.archived),
    readmeExcerpt,
    // What makes it worth learning from — a coarse, honest signal (not a code audit).
    qualitySignals: [
      meta.stargazers_count >= 5000 ? 'high-adoption' : meta.stargazers_count >= 500 ? 'real-traction' : 'early/personal',
      meta.license?.spdx_id ? `licensed:${meta.license.spdx_id}` : 'no-license',
      meta.topics?.length ? 'self-described-topics' : 'no-topics',
      readmeExcerpt.length > 200 ? 'documented' : 'thin-readme',
    ],
  };
}

const out = { gatheredAt: new Date().toISOString(), purpose: 'Exemplar repos for the council improvement loop to learn architecture/quality patterns from.', repos: [] };
for (const slug of REPOS) {
  process.stderr.write(`fetching ${slug}…\n`);
  out.repos.push(await analyze(slug));
}

const path = 'eval/reference/repo-exemplars.json';
await mkdir(dirname(path), { recursive: true });
await writeFile(path, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`wrote ${out.repos.length} repos -> ${path}`);
for (const r of out.repos) {
  console.log(`  ${r.slug}: ${r.error ? 'ERR ' + r.error : `${r.primaryLanguage} · ${r.stars}★ · ${(r.topics||[]).slice(0,3).join(',')}`}`);
}
