/**
 * Measure the VALUE of the friend-council redraft loop, in-process, against real
 * local Ollama models — independent of the live server (which currently never
 * reaches the council on flipped analysis turns; that wiring gap is the point of
 * this measurement).
 *
 * For each prompt:
 *   1. generate a real draft from the primary local model (qwen3:8b)
 *   2. run the council on it (real qwen members grading the draft)
 *   3. if the council does NOT clear it, redraft once against their reading
 *   4. print the draft, the verdict, and the redraft side-by-side
 *
 * The question this answers: does the council's redraft actually improve the
 * already-good qwen3:8b draft often enough to justify the extra model calls?
 *
 * Run: npx tsx scripts/measure-council-redraft.mts
 */
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig } from '../packages/core/src/config/index.js';
import { ModelRegistry } from '../packages/core/src/models/adapter.js';
import type { Message } from '../packages/core/src/models/adapter.js';
import { convene, toCouncilThinking } from '../packages/core/src/consensus/council.js';
import { createCouncilMember } from '../packages/core/src/consensus/member.js';
import type { CouncilRoster } from '../packages/core/src/consensus/topic-router.js';
import { buildCouncilRedraftInstruction } from '../packages/core/src/chat/service.js';
import { registerConfiguredModels } from '../packages/runtime/src/models/register-configured-models.js';

const PROMPTS = [
  'Explain how JavaScript closures work and why they are useful in real code.',
  'Compare optimistic and pessimistic locking — when would you pick each?',
  'I have a slow React list rendering thousands of rows. How should I approach fixing it?',
  'how do I make my app faster',
  'What is the difference between a process and a thread?',
];

function buildRoster(models: ModelRegistry): CouncilRoster | undefined {
  const locals = models.listByProvider('local').slice(0, 3);
  if (!locals.length) return undefined;
  const members = locals.map((adapter, i) =>
    createCouncilMember({ adapter, topic: i === 0 ? 'other' : 'reasoning', timeoutMs: 30_000 }),
  );
  return { byTopic: {}, default: members };
}

async function generate(models: ModelRegistry, modelId: string, messages: Message[]): Promise<string> {
  const adapter = models.get(modelId);
  let text = '';
  for await (const chunk of adapter.chatStream({ messages, noLearn: true })) {
    if (chunk.type === 'text_delta' && chunk.textDelta) text += chunk.textDelta;
  }
  return text.trim();
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadDotenv({ path: path.join(repoRoot, '.env') });
const config = loadConfig();
const models = new ModelRegistry();
await registerConfiguredModels(config, models);
const primaryId = models.listByProvider('local')[0]?.id;
if (!primaryId) { console.error('No local model registered — start Ollama.'); process.exit(1); }
const roster = buildRoster(models);
if (!roster) { console.error('No council roster.'); process.exit(1); }
console.log(`primary: ${primaryId} | council: ${roster.default.map((m) => m.id).join(', ')}\n`);

let reviewed = 0, asked = 0, improved = 0;
for (const prompt of PROMPTS) {
  console.log(`\n${'='.repeat(80)}\n>>> ${prompt}`);
  const baseMessages: Message[] = [{ role: 'user', content: prompt }];
  const t0 = Date.now();
  const draft = await generate(models, primaryId, baseMessages);
  const draftMs = Date.now() - t0;
  console.log(`\n— DRAFT (${draftMs}ms, ${draft.length} chars):\n${draft.slice(0, 500)}${draft.length > 500 ? '…' : ''}`);

  const tc = Date.now();
  const result = await convene(
    { prompt, draft, modelId: primaryId, turnKind: 'analysis', hasEvidence: false, sources: [] },
    roster,
    { timeoutMs: 30_000 },
  );
  const councilMs = Date.now() - tc;
  if (!result.convened) { console.log('\n— council did not convene (trivial)'); continue; }
  reviewed++;
  const c = result.consensus;
  const thinking = toCouncilThinking(result.topic, c, result.assessment);
  console.log(`\n— COUNCIL (${councilMs}ms): outcome=${c.outcome} action=${c.recommendedAction} agreement=${c.agreement.toFixed(2)} conf=${c.confidence.toFixed(2)}`);
  console.log(`  summary: ${thinking.summary}`);
  if (c.realIntent) console.log(`  realIntent: ${c.realIntent}`);
  if (c.methodLessons.length) console.log(`  methodLessons: ${c.methodLessons.join(' | ')}`);

  const wantsRedraft = c.outcome !== 'ship' &&
    (c.recommendedAction === 'reread-intent' || c.recommendedAction === 'answer-directly' || c.outcome === 'act');
  if (!wantsRedraft) { console.log('\n— council cleared the draft (no redraft).'); continue; }
  asked++;

  const instruction = buildCouncilRedraftInstruction({
    realIntent: c.realIntent,
    methodLessons: c.methodLessons,
    missingCapabilities: c.missingCapabilities,
    concerns: c.notes.flatMap((n) => n.concerns).filter(Boolean),
    recommendedAction: c.recommendedAction,
  });
  const tr = Date.now();
  const redraft = await generate(models, primaryId, [...baseMessages, { role: 'user', content: instruction }]);
  const redraftMs = Date.now() - tr;
  console.log(`\n— REDRAFT (${redraftMs}ms, ${redraft.length} chars):\n${redraft.slice(0, 500)}${redraft.length > 500 ? '…' : ''}`);

  // Re-grade and report whether the council now rates it higher.
  const second = await convene(
    { prompt, draft: redraft, modelId: primaryId, turnKind: 'analysis', hasEvidence: false, sources: [] },
    roster,
    { timeoutMs: 30_000 },
  );
  if (second.convened) {
    const s = second.consensus;
    const better = (s.outcome === 'ship' ? 2 : s.outcome === 'act' ? 1 : 0) >= (c.outcome === 'ship' ? 2 : c.outcome === 'act' ? 1 : 0);
    if (better && redraft && redraft !== draft) improved++;
    console.log(`\n— RE-GRADE: outcome=${s.outcome} action=${s.recommendedAction} agreement=${s.agreement.toFixed(2)} → ${better ? 'KEPT redraft' : 'kept original'}`);
  }
}

console.log(`\n${'='.repeat(80)}\nSUMMARY: reviewed ${reviewed}/${PROMPTS.length} | council asked redraft ${asked} | redraft kept ${improved}`);
