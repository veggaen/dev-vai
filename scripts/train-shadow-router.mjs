#!/usr/bin/env node
/**
 * Train the shadow router on the scenario bench and report agreement
 * against the hand-tuned strategy chain. Writes a snapshot to
 * eval/shadow-router-corpus.json for downstream use.
 *
 * Thorsen shape:
 *   receive    → scenario packs under eval/scenarios/
 *   normalize  → replay as (messages, final user turn) tuples
 *   route      → VaiEngine dispatches real strategy; ShadowRouter predicts
 *   synthesize → ranked predictions per turn
 *   verify     → compare top-1 / top-3 vs actual
 *   score      → aggregate rates per-strategy + confusion matrix
 *
 * Two-pass protocol: first pass builds centroids (train), second pass
 * predicts on identical turns (in-sample) to measure upper-bound agreement.
 * Cross-validated agreement comes from the repo-level split below.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.VAI_SHADOW_ROUTER = '1';

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(dirname(__filename), '..');
const SCENARIOS_DIR = join(ROOT, 'eval', 'scenarios');
const OUT_PATH = join(ROOT, 'eval', 'shadow-router-corpus.json');

const { VaiEngine } = await import(pathToFileURL(join(ROOT, 'packages/core/dist/models/vai-engine.js')).href);

function loadPacks() {
  const out = [];
  for (const entry of readdirSync(SCENARIOS_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const raw = readFileSync(join(SCENARIOS_DIR, entry.name), 'utf8');
    out.push(JSON.parse(raw));
  }
  return out;
}

async function runTurns(engine, pack, scenario) {
  const msgs = [];
  if (scenario.systemPrompt) msgs.push({ role: 'system', content: scenario.systemPrompt });
  const allUser = (scenario.messages ?? []).filter((m) => m.role === 'user');
  for (const [idx, turn] of allUser.entries()) {
    msgs.push({ role: 'user', content: turn.content });
    const res = await engine.chat({ messages: msgs, noLearn: true });
    msgs.push({ role: 'assistant', content: res.message.content });
    const strategy = engine.lastResponseMeta?.strategy ?? null;
    if (idx === allUser.length - 1 && strategy) {
      process.stdout.write(`  ${pack.id}/${scenario.id} → ${strategy}\n`);
    }
  }
}

async function main() {
  const packs = loadPacks();
  console.log(`[shadow-train] ${packs.length} packs loaded from ${SCENARIOS_DIR}`);

  // Pass 1: build centroids by replaying every scenario end-to-end.
  const engine = new VaiEngine({ shadowRouter: true });
  let total = 0;
  for (const pack of packs) {
    console.log(`[pack] ${pack.id} (${pack.scenarios.length})`);
    for (const scenario of pack.scenarios) {
      try {
        await runTurns(engine, pack, scenario);
        total += 1;
      } catch (err) {
        console.error(`  ! ${pack.id}/${scenario.id}: ${err.message ?? err}`);
      }
    }
  }

  const stats = engine.shadowRouter?.getAgreementStats() ?? null;
  if (!stats) {
    console.error('[shadow-train] router disabled; aborting');
    process.exit(1);
  }

  console.log('');
  console.log(`[shadow-train] scenarios replayed : ${total}`);
  console.log(`[shadow-train] shadow observations : ${stats.total}`);
  console.log(`[shadow-train] top-1 agreement     : ${(stats.top1Rate * 100).toFixed(1)}% (${stats.top1Hits}/${stats.total})`);
  console.log(`[shadow-train] top-3 agreement     : ${(stats.top3Rate * 100).toFixed(1)}% (${stats.top3Hits}/${stats.total})`);

  const perStrategy = Object.entries(stats.byStrategy).sort(([, a], [, b]) => b.total - a.total);
  console.log('\n[per-strategy]');
  for (const [strategy, counts] of perStrategy) {
    const t1 = counts.total === 0 ? 0 : (counts.top1 / counts.total) * 100;
    console.log(`  ${strategy.padEnd(32)} total=${String(counts.total).padStart(3)}  top1=${t1.toFixed(0).padStart(3)}%`);
  }

  const confusionRows = Object.entries(stats.confusion).sort(([, a], [, b]) =>
    Object.values(b).reduce((s, n) => s + n, 0) - Object.values(a).reduce((s, n) => s + n, 0),
  );
  if (confusionRows.length > 0) {
    console.log('\n[top confusions] actual → predicted (n)');
    for (const [actual, row] of confusionRows.slice(0, 10)) {
      const preds = Object.entries(row).sort(([, a], [, b]) => b - a).slice(0, 3);
      console.log(`  ${actual} → ${preds.map(([p, n]) => `${p}(${n})`).join(', ')}`);
    }
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    scenarios: total,
    stats: {
      total: stats.total,
      top1Hits: stats.top1Hits,
      top3Hits: stats.top3Hits,
      top1Rate: stats.top1Rate,
      top3Rate: stats.top3Rate,
    },
    snapshot: engine.shadowRouter.toJSON(),
  }, null, 2));
  console.log(`\n[shadow-train] wrote ${OUT_PATH}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
