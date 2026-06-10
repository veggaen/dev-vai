#!/usr/bin/env node
/**
 * Live local-model escalation + verification trace (Master.md §12.5.3).
 *
 * Drives the REAL `ChatService` orchestrator in-process with:
 *   - vai:v0  = the real deterministic `VaiEngine`
 *   - local:<model> = a real Ollama model via `LocalOpenAICompatibleAdapter`
 *
 * For each prompt it captures the full chunk trace — turn_kind, the decline /
 * low-confidence decision, the `fallback_notice` (from → to → reason), the
 * local model's generated text, and the post-generation `verification` verdict —
 * proving the orchestrator lever works against a live generative module, not a
 * stub. This is the in-process live trace; the desktop Playwright lane is the
 * heavier visual variant (needs `pnpm dev`).
 *
 * Usage:
 *   node scripts/vai-live-escalation-trace.mjs --model qwen2.5:3b
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const TSX_BIN = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');

if (!process.env.__VAI_TRACE_TSX__ && existsSync(TSX_BIN)) {
  const { spawnSync } = await import('node:child_process');
  const scriptPath = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const result = spawnSync(TSX_BIN, [scriptPath, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, __VAI_TRACE_TSX__: '1' },
    shell: true,
  });
  process.exit(result.status ?? 1);
}

function arg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const MODEL = arg('model', 'qwen2.5:3b');
const BASE_URL = arg('base-url', process.env.LOCAL_MODEL_URL || 'http://localhost:11434');
const LOCAL_ID = `local:${MODEL}`;

const { VaiEngine } = await import(pathToFileURL(join(ROOT, 'packages', 'core', 'src', 'models', 'vai-engine.ts')).href);
const { LocalOpenAICompatibleAdapter } = await import(pathToFileURL(join(ROOT, 'packages', 'core', 'src', 'models', 'provider-adapters.ts')).href);
const { ModelRegistry } = await import(pathToFileURL(join(ROOT, 'packages', 'core', 'src', 'models', 'adapter.ts')).href);
const { ChatService } = await import(pathToFileURL(join(ROOT, 'packages', 'core', 'src', 'chat', 'service.ts')).href);
const { createDb } = await import(pathToFileURL(join(ROOT, 'packages', 'core', 'src', 'db', 'client.ts')).href);
const { evaluateBuilderRequestSatisfaction } = await import(pathToFileURL(join(ROOT, 'packages', 'core', 'src', 'chat', 'builder-satisfaction.ts')).href);

const localProfile = {
  id: LOCAL_ID,
  provider: 'local',
  modelName: MODEL,
  displayName: `Local ${MODEL}`,
  description: 'Ollama-compatible local model endpoint',
  contextWindow: 32768,
  maxOutputTokens: 2048,
  capabilities: {
    streaming: false, toolUse: false, vision: false, extendedThinking: false,
    embeddings: false, structuredOutput: false, systemPrompts: true, multiTurn: true,
  },
  cost: { inputPer1M: 0, outputPer1M: 0 },
  speedTier: 'medium',
  qualityTier: 'local',
};
const localProvider = { id: 'local', enabled: true, baseUrl: BASE_URL, defaultModel: MODEL };

const registry = new ModelRegistry();
registry.register(new VaiEngine());
registry.register(new LocalOpenAICompatibleAdapter(localProfile, localProvider));

const svc = new ChatService(createDb(':memory:'), registry, {
  vaiFallbackChain: ['vai:v0', LOCAL_ID],
  verification: { requireEvidenceForFactualClaims: true },
});

const PROMPTS = [
  // novel-decline / confident-wrong (article-hijack) — should escalate, must NOT leak confident-wrong
  { cat: 'confident-wrong', mode: 'chat', label: 'zorblax-flimsy', text: "what's your honest take on the Zorblax-7 concurrency model in the Flimsy programming language?" },
  { cat: 'confident-wrong', mode: 'chat', label: 'glorptax-actor', text: 'explain the actor model in the Glorptax-9 runtime and how its supervision trees differ.' },
  { cat: 'confident-wrong', mode: 'chat', label: 'quibblr-orm', text: 'how does the Quibblr ORM handle migrations compared to its query planner?' },
  // knowledge controls — must NOT escalate (precision)
  { cat: 'knowledge', mode: 'chat', label: 'capital-france', text: 'what is the capital of France?' },
  { cat: 'knowledge', mode: 'chat', label: 'capital-japan', text: 'what is the capital of Japan?' },
  { cat: 'knowledge', mode: 'chat', label: 'tcp-vs-udp', text: 'in one line, what is the main difference between TCP and UDP?' },
  // low-confidence / honest-read reasoning — should escalate to the local model
  { cat: 'reasoning', mode: 'chat', label: 'denormalize', text: 'i half-remember a rule about when to denormalize a database. give me your honest read even if unsure.' },
  { cat: 'reasoning', mode: 'chat', label: 'cap-theorem', text: "i'm fuzzy on CAP theorem tradeoffs for a chat app. honest read?" },
  { cat: 'reasoning', mode: 'chat', label: 'index-choice', text: 'not sure when a composite index beats two single-column indexes. your honest take?' },
  // builder — generic scaffold should escalate; we measure whether the fallback satisfies the request
  { cat: 'builder', mode: 'builder', label: 'html-counter', text: 'Build a tiny single-file HTML counter app with a + button, a - button, and a live count display.' },
  { cat: 'builder', mode: 'builder', label: 'shopping-list', text: 'Build a shared shopping list app with household members, grouped items, and an activity feed.' },
  { cat: 'builder', mode: 'builder', label: 'pomodoro', text: 'Build a focus planner with pomodoro sessions, a task list, and a streak counter.' },
  { cat: 'builder', mode: 'builder', label: 'kanban', text: 'Build a kanban board with three columns (todo, doing, done) and draggable cards.' },
  // casual / on-topic — must NOT escalate (precision)
  { cat: 'casual', mode: 'chat', label: 'next-step', text: 'i keep bouncing between ideas and never finishing. help me pick the next concrete step.' },
  { cat: 'casual', mode: 'chat', label: 'rust-concurrency', text: 'how does Rust handle concurrency safely, briefly?' },
  { cat: 'casual', mode: 'chat', label: 'debounce', text: 'how do i make my search input handler less janky?' },
];

function trunc(s, n) { return s.length > n ? `${s.slice(0, n)}…` : s; }

async function run() {
  const report = { createdAt: new Date().toISOString(), model: LOCAL_ID, baseUrl: BASE_URL, turns: [] };
  console.log(`\n=== Live escalation trace — vai:v0 → ${LOCAL_ID} (${BASE_URL}) ===\n`);

  for (const p of PROMPTS) {
    const convId = svc.createConversation('vai:v0', p.label, p.mode);
    const chunks = [];
    const startedAt = Date.now();
    try {
      for await (const chunk of svc.sendMessage(convId, p.text)) chunks.push(chunk);
    } catch (err) {
      console.log(`[${p.label}] ERROR: ${err instanceof Error ? err.message : String(err)}`);
      report.turns.push({ label: p.label, error: String(err) });
      continue;
    }
    const ms = Date.now() - startedAt;
    const turnKind = chunks.find((c) => c.type === 'turn_kind')?.turnKind ?? null;
    const fb = chunks.find((c) => c.type === 'fallback_notice')?.fallback ?? null;
    const verif = chunks.find((c) => c.type === 'verification')?.verification ?? null;
    const thinking = [...chunks].reverse().find((c) => c.type === 'done')?.thinking ?? null;
    const text = chunks.filter((c) => c.type === 'text_delta').map((c) => c.textDelta).join('');
    const persisted = svc.getMessages(convId).at(-1);

    const builderSat = p.cat === 'builder'
      ? evaluateBuilderRequestSatisfaction(p.text, text)
      : null;

    console.log(`──[${p.cat}/${p.label}] (${p.mode}, ${ms}ms)`);
    console.log(`   user: ${trunc(p.text, 100)}`);
    console.log(`   escalated: ${fb ? `YES → ${fb.toModelId} (${fb.reason})` : 'no'}  | answeredBy: ${persisted?.modelId}`);
    console.log(`   verification: ${verif ? `${verif.action}${verif.grounding ? `/${verif.grounding}` : ''} [${verif.reasons.join(', ')}]` : 'none'}`);
    console.log(`   trace: ${thinking ? `${thinking.intent} / ${thinking.strategy}` : 'missing'}`);
    if (builderSat) console.log(`   builder-satisfaction: ${builderSat.satisfied ? 'SATISFIED' : 'unsatisfied'} (coverage ${(builderSat.coverage * 100).toFixed(0)}%, files=${builderSat.hasFileBlocks})`);
    console.log(`   text: ${trunc(text.replace(/\s+/g, ' '), 200)}\n`);

    report.turns.push({
      cat: p.cat, label: p.label, mode: p.mode, ms, turnKind,
      escalation: fb, verification: verif,
      thinking, answeredBy: persisted?.modelId, builderSatisfaction: builderSat, text,
    });
  }

  // ── Category metrics (before/after deltas reported in the synthesis) ──
  const byCat = (cat) => report.turns.filter((t) => t.cat === cat);
  const rate = (n, d) => (d ? `${n}/${d} (${Math.round((n / d) * 100)}%)` : '0/0');
  const builders = byCat('builder');
  const buildersEscalated = builders.filter((t) => t.escalation).length;
  const buildersSatisfied = builders.filter((t) => t.builderSatisfaction?.satisfied).length;
  const cw = byCat('confident-wrong');
  const cwEscalatedOrCalibrated = cw.filter((t) => t.escalation || t.verification?.action === 'calibrate').length;
  const knowledge = byCat('knowledge');
  const knowledgeNotEscalated = knowledge.filter((t) => !t.escalation).length;
  const casual = byCat('casual');
  const casualNotEscalated = casual.filter((t) => !t.escalation).length;

  report.metrics = {
    totalTurns: report.turns.length,
    escalated: report.turns.filter((t) => t.escalation).length,
    builder: { total: builders.length, escalated: buildersEscalated, satisfiedFinal: buildersSatisfied },
    confidentWrong: { total: cw.length, handled: cwEscalatedOrCalibrated },
    precision: { knowledgeKept: knowledgeNotEscalated, knowledgeTotal: knowledge.length, casualKept: casualNotEscalated, casualTotal: casual.length },
    verificationFired: report.turns.filter((t) => t.verification).length,
    thinkingAttached: report.turns.filter((t) => t.thinking).length,
  };

  const outDir = join(ROOT, 'artifacts', 'live-escalation');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `trace-${report.createdAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log('=== Live dogfood wave summary ===');
  console.log(`escalated overall:        ${rate(report.metrics.escalated, report.metrics.totalTurns)}`);
  console.log(`builder escalated:        ${rate(buildersEscalated, builders.length)}  (scaffolds no longer ship as "done")`);
  console.log(`builder satisfied (final):${rate(buildersSatisfied, builders.length)}`);
  console.log(`confident-wrong handled:  ${rate(cwEscalatedOrCalibrated, cw.length)}  (escalated or calibrated — not leaked)`);
  console.log(`precision knowledge kept: ${rate(knowledgeNotEscalated, knowledge.length)}  | casual kept: ${rate(casualNotEscalated, casual.length)}`);
  console.log(`verification fired:       ${rate(report.metrics.verificationFired, report.metrics.totalTurns)}`);
  console.log(`thinking trace attached:  ${rate(report.metrics.thinkingAttached, report.metrics.totalTurns)}`);
  console.log(`Trace: ${outFile}`);
}

await run();
process.exit(0);
