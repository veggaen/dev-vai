#!/usr/bin/env node
/**
 * Friend Review Panel — live demo (in-process — run with tsx).
 *
 *   npx tsx scripts/vai-friend-review-demo.mjs
 *   npx tsx scripts/vai-friend-review-demo.mjs --models qwen2.5:7b,qwen2.5:3b
 *   npx tsx scripts/vai-friend-review-demo.mjs --json
 *
 * Stands up a panel of local Qwen reviewers (via Ollama) and has them review a
 * couple of prepared Vai drafts — one deliberately weak/off-topic, one solid —
 * then prints the consolidated "notice" Vai would receive back from its friends.
 *
 * Requires Ollama running on http://localhost:11434 with the chosen models pulled
 * (`ollama pull qwen2.5:7b`). See docs/capabilities/friend-review-panel.md.
 */
import {
  LocalOpenAICompatibleAdapter,
  createModelReviewer,
  runFriendReviewPanel,
} from '@vai/core';

function parseArgs(argv) {
  const args = { models: ['qwen2.5:7b', 'qwen2.5:3b'], baseUrl: 'http://localhost:11434', json: false, timeoutMs: 45_000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--models' && next) { args.models = next.split(',').map((m) => m.trim()).filter(Boolean); i++; }
    else if (a === '--base-url' && next) { args.baseUrl = next; i++; }
    else if (a === '--timeout' && next) { args.timeoutMs = Number(next) || args.timeoutMs; i++; }
    else if (a === '--json') args.json = true;
  }
  return args;
}

/** Build a friend reviewer backed by a local Ollama model. */
function makeLocalReviewer(modelName, baseUrl, timeoutMs) {
  const adapter = new LocalOpenAICompatibleAdapter(
    {
      id: `local:${modelName}`,
      provider: 'local',
      modelName,
      displayName: modelName,
      description: 'Ollama local model (friend reviewer)',
      contextWindow: 32768,
      maxOutputTokens: 8192,
      capabilities: {
        streaming: false, toolUse: false, vision: false, extendedThinking: false,
        embeddings: false, structuredOutput: false, systemPrompts: true, multiTurn: true,
      },
      cost: { inputPer1M: 0, outputPer1M: 0 },
      speedTier: 'medium',
      qualityTier: 'local',
    },
    { id: 'local', enabled: true, baseUrl, defaultModel: modelName },
  );
  return createModelReviewer({ adapter, timeoutMs });
}

const CASES = [
  {
    label: 'Weak draft (off-topic)',
    input: {
      prompt: 'what are good restaurants in Hommersåk, Norway?',
      draft: 'Norway is a country in Northern Europe known for its fjords and mountains. Its capital is Oslo, and it has a high standard of living.',
      modelId: 'vai:v0',
      turnKind: 'factual',
      hasEvidence: false,
      sources: [],
    },
  },
  {
    label: 'Solid draft (sound answer)',
    input: {
      prompt: 'Explain what a deadlock is in concurrent programming.',
      draft: [
        'A **deadlock** is a state where two or more threads are each waiting for a resource the other holds, so none can proceed.',
        '',
        'It needs four conditions at once (Coffman conditions): mutual exclusion, hold-and-wait, no preemption, and circular wait.',
        '',
        'Classic example: thread A locks mutex 1 then waits for mutex 2; thread B locks mutex 2 then waits for mutex 1. Neither releases. A common fix is to impose a global lock-ordering so every thread acquires locks in the same order.',
      ].join('\n'),
      modelId: 'vai:v0',
      turnKind: 'explanation',
      hasEvidence: false,
      sources: [],
    },
  },
];

function renderNotice(notice) {
  const icon = notice.outcome === 'approved' ? '✅' : notice.outcome === 'revise' ? '🟡' : '⛔';
  const lines = [];
  lines.push(`  ${icon} outcome: ${notice.outcome.toUpperCase()}  (score ${notice.score.toFixed(2)})`);
  lines.push(`  consensus: ${notice.consensus}`);
  for (const v of notice.verdicts) {
    const tag = v.error ? `⚠️  ${v.error}` : `${v.verdict} @ ${(v.confidence * 100).toFixed(0)}%`;
    lines.push(`   • ${v.reviewerName}: ${tag} — ${v.summary} (${v.durationMs}ms)`);
  }
  if (notice.topConcerns.length) {
    lines.push('  concerns from friends:');
    for (const c of notice.topConcerns) lines.push(`     - ${c}`);
  }
  if (notice.topSuggestions.length) {
    lines.push('  suggestions for better reasoning:');
    for (const s of notice.topSuggestions) lines.push(`     - ${s}`);
  }
  if (notice.requiresFreshEvidence) lines.push('  ⏱️  at least one friend wants fresh evidence before release');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Fail fast with a friendly message if Ollama is not up.
  try {
    const res = await fetch(`${args.baseUrl}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (error) {
    console.error(`[friend-review] Ollama not reachable at ${args.baseUrl} (${error?.message ?? error}).`);
    console.error('[friend-review] Start it with `ollama serve` and `ollama pull qwen2.5:7b`.');
    process.exitCode = 1;
    return;
  }

  const reviewers = args.models.map((m) => makeLocalReviewer(m, args.baseUrl, args.timeoutMs));
  console.log(`[friend-review] Panel: ${args.models.map((m) => `local:${m}`).join(', ')}\n`);

  const results = [];
  for (const testCase of CASES) {
    if (!args.json) {
      console.log(`▶ ${testCase.label}`);
      console.log(`  Q: ${testCase.input.prompt}`);
      console.log(`  draft: ${testCase.input.draft.replace(/\n/g, ' ').slice(0, 120)}…`);
    }
    const notice = await runFriendReviewPanel(reviewers, testCase.input, { timeoutMs: args.timeoutMs });
    results.push({ label: testCase.label, notice });
    if (!args.json) {
      console.log(renderNotice(notice));
      console.log('');
    }
  }

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log('[friend-review] Done. This is the notice Vai receives from its friends before replying.');
  }
}

main().catch((error) => {
  console.error('[friend-review] demo failed:', error);
  process.exitCode = 1;
});
