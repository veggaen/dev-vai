/**
 * review-branch — a FREE, LOCAL, PRIVATE AI code reviewer (Phase 3 of "use all free tools").
 * Diffs the current branch (default: council/auto-improve) against a base (default: main), sends
 * the diff to your LOCAL Ollama, and prints a structured review. PR-Agent-style, but nothing
 * leaves your machine — it talks to http://localhost:11434, the same models the council runs.
 *
 * Why local CLI and not a cloud GitHub Action: GitHub's hosted runners can't reach your
 * localhost Ollama, so a "PR-Agent → local model" action only works on a self-hosted runner.
 * Running it as a CLI on your own PC is the honest private path. Use it before asking Claude to
 * merge council/auto-improve: `pnpm review:branch`.
 *
 * Usage:
 *   pnpm review:branch                          # council/auto-improve vs main
 *   pnpm review:branch --base dev --head HEAD   # custom range
 *   pnpm review:branch --model qwen2.5:7b       # pick the reviewer model
 */

import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('--base', 'main');
const HEAD = opt('--head', 'council/auto-improve');
const MODEL = opt('--model', process.env.VAI_REVIEW_MODEL || 'qwen2.5:7b');
const OLLAMA = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MAX_DIFF = Number(opt('--max-diff-chars', '60000')); // keep the prompt within a sane window

function sh(cmd) { return execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }

async function main() {
  // Resolve the merge-base so we only review what HEAD adds on top of BASE.
  let range;
  try {
    const mb = sh(`git merge-base ${BASE} ${HEAD}`).trim();
    range = `${mb}..${HEAD}`;
  } catch {
    console.error(`Could not find a merge-base between '${BASE}' and '${HEAD}'. Are both branches present?`);
    process.exit(1);
  }

  const stat = sh(`git diff --stat ${range}`).trim();
  let diff = sh(`git diff ${range}`);
  if (!diff.trim()) { console.log(`No changes in ${range}. Nothing to review.`); return; }
  const truncated = diff.length > MAX_DIFF;
  if (truncated) diff = diff.slice(0, MAX_DIFF) + '\n…[diff truncated for prompt size]…';

  const commits = sh(`git log --oneline ${range}`).trim();

  const prompt = [
    'You are a senior staff engineer doing a focused, honest code review. Be specific and terse.',
    'Review ONLY the diff below. For each issue cite the file. Prioritise: correctness bugs,',
    'security (secrets, injection, unsafe fs/network), broken/weakened tests, and risky behaviour',
    'changes (over-broad regexes, removed guardrails). Then note anything genuinely good.',
    'End with a one-line verdict: SHIP / SHIP-WITH-NITS / NEEDS-WORK.',
    '',
    `## Commits\n${commits}`,
    '',
    `## Files\n${stat}`,
    '',
    '## Diff',
    '```diff',
    diff,
    '```',
  ].join('\n');

  process.stderr.write(`[review-branch] ${range} → model ${MODEL} @ ${OLLAMA}${truncated ? ' (diff truncated)' : ''}\n\n`);

  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, stream: false, messages: [{ role: 'user', content: prompt }], options: { temperature: 0.2 } }),
  }).catch((e) => { console.error(`Ollama unreachable at ${OLLAMA}: ${e.message}. Is Ollama running?`); process.exit(1); });

  if (!res.ok) { console.error(`Ollama error ${res.status}: ${await res.text()}`); process.exit(1); }
  const data = await res.json();
  console.log(data?.message?.content ?? '(no review returned)');
}

main().catch((e) => { console.error('review-branch failed:', e.message); process.exit(1); });
