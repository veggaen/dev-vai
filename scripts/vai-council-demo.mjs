#!/usr/bin/env node
/**
 * SCIS Consensus Council — live demo (run with tsx).
 *
 *   npx tsx scripts/vai-council-demo.mjs
 *   npx tsx scripts/vai-council-demo.mjs --json
 *
 * Convenes a topic-routed council of local Qwen models on Vai's failed
 * pb-Hommersåk turn, reaches an ephemeral consensus, and prints the block the
 * thinking panel would show. Requires Ollama with qwen2.5:7b / qwen2.5:3b.
 * See docs/capabilities/scis-consensus-council.md.
 */
import {
  LocalOpenAICompatibleAdapter,
  createCouncilMember,
  routeTopic,
  selectMembers,
  runCouncil,
  toCouncilThinking,
} from '@vai/core';

const BASE = 'http://localhost:11434';
const JSON_OUT = process.argv.includes('--json');

function localAdapter(modelName) {
  return new LocalOpenAICompatibleAdapter(
    {
      id: `local:${modelName}`, provider: 'local', modelName, displayName: modelName,
      description: 'Ollama local council member', contextWindow: 32768, maxOutputTokens: 8192,
      capabilities: { streaming: false, toolUse: false, vision: false, extendedThinking: false, embeddings: false, structuredOutput: false, systemPrompts: true, multiTurn: true },
      cost: { inputPer1M: 0, outputPer1M: 0 }, speedTier: 'medium', qualityTier: 'local',
    },
    { id: 'local', enabled: true, baseUrl: BASE, defaultModel: modelName },
  );
}

// Topic-routed roster: the local-business specialist plus an always-on generalist.
const roster = {
  byTopic: {
    local: [createCouncilMember({ adapter: localAdapter('qwen2.5:7b'), topic: 'local', displayName: 'Qwen 2.5 7B (local specialist)', timeoutMs: 45_000 })],
    code: [createCouncilMember({ adapter: localAdapter('qwen2.5:7b'), topic: 'code', displayName: 'Qwen 2.5 7B (code)', timeoutMs: 45_000 })],
  },
  default: [createCouncilMember({ adapter: localAdapter('qwen2.5:3b'), topic: 'other', displayName: 'Qwen 2.5 3B (generalist)', timeoutMs: 45_000 })],
};

const INPUT = {
  prompt: 'can you give me number for pb hommersåk?',
  draft: "I'm sorry, but \"pb hommersåk\" doesn't provide enough context for me to determine which number you're looking for. Could you please specify what \"pb hommersåk\" refers to?",
  modelId: 'local:qwen2.5:7b',
  turnKind: 'other',
  hasEvidence: false,
  sources: [],
  draftConfidence: 0.2,
};

function render(topic, c) {
  const icon = c.outcome === 'ship' ? '✅' : c.outcome === 'act' ? '🛠️' : '⤴️';
  const lines = [];
  lines.push(`  topic: ${topic}`);
  lines.push(`  ${icon} consensus: ${c.outcome.toUpperCase()}  ·  ${Math.round(c.agreement * 100)}% agree  ·  conf ${c.confidence.toFixed(2)}`);
  lines.push(`  ${c.summary}`);
  if (c.realIntent) lines.push(`  real intent: ${c.realIntent}`);
  lines.push(`  recommended action: ${c.recommendedAction}${c.searchQuery ? `  →  search "${c.searchQuery}"` : ''}`);
  for (const n of c.notes) {
    const tag = n.error ? `⚠️ ${n.error}` : `${n.verdict} @ ${(n.confidence * 100).toFixed(0)}% → ${n.suggestedAction}`;
    lines.push(`   • ${n.memberName} [${n.topic}]: ${tag} (${n.durationMs}ms)`);
    if (!n.error && n.methodLesson) lines.push(`       lesson: ${n.methodLesson}`);
  }
  if (c.missingCapabilities.length) lines.push(`  missing capability: ${c.missingCapabilities.join('; ')}`);
  return lines.join('\n');
}

async function main() {
  try {
    const res = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (e) {
    console.error(`[council] Ollama not reachable at ${BASE} (${e?.message ?? e}). Run \`ollama serve\`.`);
    process.exitCode = 1; return;
  }

  const topic = routeTopic(INPUT.prompt);
  const members = selectMembers(topic, roster);
  console.log(`▶ Vai's failed turn: "${INPUT.prompt}"`);
  console.log(`  Vai drafted (and punted): "${INPUT.draft.slice(0, 90)}…"`);
  console.log(`  routed topic: ${topic} → council: ${members.map((m) => m.id).join(', ')}\n`);

  const consensus = await runCouncil(members, INPUT, { timeoutMs: 45_000 });
  const ui = toCouncilThinking(topic, consensus);

  if (JSON_OUT) {
    console.log(JSON.stringify({ topic, consensus, thinkingBlock: ui }, null, 2));
    return;
  }
  console.log(render(topic, consensus));
  console.log('');
  if (consensus.outcome === 'act' && /search/.test(consensus.recommendedAction)) {
    console.log(`  ⇒ Next: Vai runs his OWN search for "${consensus.searchQuery}" and grounds the number.`);
    console.log('     (The council pointed; Vai fetches. No member fact reaches the user.)');
  }
}

main().catch((e) => { console.error('[council] demo failed:', e); process.exitCode = 1; });
