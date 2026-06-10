#!/usr/bin/env node
/**
 * Visible, scenario-driven conversation audit for Vai.
 *
 * Opens fresh chats in the real desktop web UI, sends multi-turn control
 * prompts, audits every assistant reply before advancing, expands the latest
 * Thinking panel, and saves screenshots plus a trace ledger.
 *
 * Usage:
 *   node scripts/vai-visual-conversation-audit.mjs --limit 3 --seed thorsen-r1
 *   node scripts/vai-visual-conversation-audit.mjs --generated 12
 *   node scripts/vai-visual-conversation-audit.mjs --adversarial 16
 *   node scripts/vai-visual-conversation-audit.mjs --holdout 16
 *   node scripts/vai-visual-conversation-audit.mjs --realistic 20
 *   node scripts/vai-visual-conversation-audit.mjs --headless --limit 6
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { buildAdversarialAuditWave } from './lib/vai-adversarial-audit-wave.mjs';
import { buildGeneratedAuditWave, randomAuditSeed } from './lib/vai-generated-audit-wave.mjs';
import { buildNovelHoldoutWave } from './lib/vai-novel-holdout-wave.mjs';
import { buildFactualKnowledgeWave } from './lib/vai-factual-knowledge-wave.mjs';
import { buildConversationalQualityWave } from './lib/vai-conversational-quality-wave.mjs';
import { buildCodeActionWave } from './lib/vai-code-action-wave.mjs';
import { buildRealisticMutationWave } from './lib/vai-realistic-mutation-wave.mjs';
import { humanizeText } from './lib/vai-humanizer.mjs';
import {
  aggregateQualityAxes,
  dimensionsFor,
  gradeAuditTurn,
} from './lib/vai-generated-audit-grader.mjs';

const ROOT = process.cwd();
const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function hasArg(name) {
  return args.includes(name);
}

const APP_URL = argValue('--app', process.env.VAI_APP_URL || 'http://localhost:5173/?devAuthBypass=1');
const API_URL = argValue('--api', process.env.VAI_API_URL || 'http://127.0.0.1:3006').replace(/\/$/, '');
const SCENARIO_PATH = path.resolve(ROOT, argValue('--scenarios', 'eval/conversation-audit/scenarios.json'));
const OUT_ROOT = path.resolve(ROOT, argValue('--out', 'Temporary_files/conversation-audit'));
const SEED = argValue('--seed', randomAuditSeed());
const LIMIT = Number.parseInt(argValue('--limit', '4'), 10);
const GENERATED_COUNT = Number.parseInt(argValue('--generated', '0'), 10);
const ADVERSARIAL_COUNT = Number.parseInt(argValue('--adversarial', '0'), 10);
const HOLDOUT_COUNT = Number.parseInt(argValue('--holdout', '0'), 10);
const FACTUAL_COUNT = Number.parseInt(argValue('--factual', '0'), 10);
const CONVERSATIONAL_COUNT = Number.parseInt(argValue('--conversational', '0'), 10);
const CODE_ACTION_COUNT = Number.parseInt(argValue('--code-action', '0'), 10);
const REALISTIC_COUNT = Number.parseInt(argValue('--realistic', '0'), 10);
const PAUSE_MS = Number.parseInt(argValue('--pause-ms', hasArg('--headless') ? '0' : '1200'), 10);
const TURN_TIMEOUT_MS = Number.parseInt(argValue('--turn-timeout-ms', '45000'), 10);
const HEADLESS = hasArg('--headless');
const HUMANIZE = hasArg('--humanize');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.join(OUT_ROOT, STAMP);

function hashSeed(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomFromSeed(seed) {
  let state = hashSeed(seed);
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, seed) {
  const copy = [...items];
  const random = randomFromSeed(seed);
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function slug(value) {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function waitUntil(label, fn, timeoutMs = 120_000, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await fn();
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}${lastValue ? `: ${JSON.stringify(lastValue).slice(0, 600)}` : ''}`);
}

async function patchBootstrap(runtimeUrl) {
  const response = await fetch(`${runtimeUrl}/api/platform/bootstrap`);
  if (!response.ok) throw new Error(`Bootstrap failed: ${response.status}`);
  const payload = await response.json();
  payload.auth = {
    ...payload.auth,
    enabled: false,
    authenticated: true,
    user: { id: 'visual-audit', email: 'audit@test.local', name: 'Visual Audit' },
  };
  return JSON.stringify(payload);
}

async function getState(page) {
  return page.evaluate(() => {
    const store = window.__vai_chat_store?.getState?.();
    return {
      streaming: Boolean(store?.isStreaming),
      activeConversationId: store?.activeConversationId || null,
      activeConversationMode: store?.conversations?.find?.((conversation) => conversation.id === store?.activeConversationId)?.mode || null,
      conversationCount: store?.conversations?.length ?? 0,
      messages: Array.isArray(store?.messages)
        ? store.messages.map((message) => ({
          id: String(message.id || ''),
          role: String(message.role || ''),
          content: String(message.content || ''),
          turnKind: message.turnKind || null,
          sourcePresentation: message.sourcePresentation || null,
          confidence: typeof message.confidence === 'number' ? message.confidence : null,
          sources: Array.isArray(message.sources) ? message.sources : [],
          fallback: message.fallback || null,
          thinking: message.thinking || null,
          researchTrace: message.researchTrace || null,
        }))
        : [],
    };
  });
}

async function openFreshConversation(page) {
  const newChat = page.getByRole('button', { name: /new chat/i });
  if (await newChat.count() > 0) {
    await newChat.first().click();
  } else {
    await page.evaluate(() => window.__vai_chat_store?.getState?.().startNewChat?.());
  }
  await waitUntil('fresh empty chat', async () => {
    const state = await getState(page);
    return !state.streaming && state.activeConversationId === null && state.messages.length === 0;
  }, 30_000, 250);
}

async function expandLatestThinking(page) {
  const assistant = page.locator('[data-chat-message-role="assistant"]').last();
  const panel = assistant.locator('[data-testid="thinking-panel"]');
  if (await panel.count() === 0) return false;
  const button = panel.getByRole('button').first();
  if ((await button.getAttribute('aria-expanded')) !== 'true') {
    await button.click();
  }
  return true;
}

async function sendAndAudit(page, scenario, turn, scenarioIndex, turnIndex, previousCanaries) {
  const before = await getState(page);
  const beforeAssistantIds = new Set(before.messages.filter((message) => message.role === 'assistant').map((message) => message.id));
  const textarea = page.locator('textarea').first();
  await textarea.waitFor({ timeout: 30_000 });
  const sentPrompt = HUMANIZE && !turn.noHumanize
    ? humanizeText(turn.prompt, `${SEED}:${scenario.id}:${turnIndex}`, { isFirstTurn: turnIndex === 0 })
    : turn.prompt;
  await textarea.fill(sentPrompt);
  await textarea.press('Enter');

  let latest;
  try {
    latest = await waitUntil(`assistant reply for ${scenario.id} turn ${turnIndex + 1}`, async () => {
      const state = await getState(page);
      const fresh = state.messages.filter((message) => (
        message.role === 'assistant' &&
        message.content.trim().length > 0 &&
        !beforeAssistantIds.has(message.id)
      ));
      if (!state.streaming && fresh.length > 0) {
        return { state, assistant: fresh.at(-1) };
      }
      return null;
    }, TURN_TIMEOUT_MS, 600);
  } catch (error) {
    const stalled = await getState(page).catch(() => ({
      streaming: true,
      activeConversationId: null,
      messages: [],
    }));
    const shot = path.join(
      OUT,
      `${String(scenarioIndex + 1).padStart(2, '0')}-${slug(scenario.id)}-turn-${String(turnIndex + 1).padStart(2, '0')}-timeout.png`,
    );
    await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
    console.log(`\n[${scenario.id} T${turnIndex + 1}] FLAG - turn-timeout:${TURN_TIMEOUT_MS}ms`);
    return {
      prompt: turn.prompt,
      dimensions: dimensionsFor(scenario, turn),
      rubric: turn.rubric ?? null,
      assistant: null,
      grade: {
        passed: false,
        failures: [`turn-timeout:${TURN_TIMEOUT_MS}ms`],
        warnings: stalled.streaming ? ['runtime-still-streaming'] : [],
        metrics: {
          chars: 0,
          words: 0,
          traceSteps: 0,
          processTraceSteps: 0,
          sourceCount: 0,
          hasResearchTrace: false,
          confidence: null,
        },
      },
      screenshot: shot,
      activeConversationId: stalled.activeConversationId,
      activeConversationMode: stalled.activeConversationMode ?? null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  await expandLatestThinking(page);
  if (PAUSE_MS > 0) await page.waitForTimeout(PAUSE_MS);

  const shot = path.join(
    OUT,
    `${String(scenarioIndex + 1).padStart(2, '0')}-${slug(scenario.id)}-turn-${String(turnIndex + 1).padStart(2, '0')}.png`,
  );
  await page.screenshot({ path: shot, fullPage: true });
  const grade = gradeAuditTurn({ assistant: latest.assistant, turn, previousCanaries });

  console.log(`\n[${scenario.id} T${turnIndex + 1}] ${sentPrompt}`);
  console.log(`vai [${latest.assistant.thinking?.intent ?? 'no-intent'} / ${latest.assistant.thinking?.strategy ?? 'no-strategy'}]: ${normalize(latest.assistant.content).slice(0, 260)}`);
  console.log(`${grade.passed ? 'PASS' : 'FLAG'}${grade.failures.length ? ` - ${grade.failures.join(', ')}` : ''}${grade.warnings.length ? ` | warnings: ${grade.warnings.join(', ')}` : ''}`);

  return {
    prompt: sentPrompt,
    dimensions: dimensionsFor(scenario, turn),
    rubric: turn.rubric ?? null,
    assistant: latest.assistant,
    grade,
    screenshot: shot,
    activeConversationId: latest.state.activeConversationId,
    activeConversationMode: latest.state.activeConversationMode,
  };
}

function markdownReport(report) {
  const lines = [
    '# Vai Visual Conversation Audit',
    '',
    `- Created: \`${report.createdAt}\``,
    `- Seed: \`${report.seed}\``,
    `- Mode: \`${report.generation.mode}\``,
    `- Scenarios: ${report.summary.scenarios}`,
    `- Turns: ${report.summary.turns}`,
    `- Passed turns: ${report.summary.passedTurns}`,
    `- Flagged turns: ${report.summary.flaggedTurns}`,
    '',
    '## Quality Axes',
    '',
  ];
  for (const [axis, result] of Object.entries(report.qualityAxes)) {
    const score = result.score === null ? 'not scored' : `${Math.round(result.score * 100)}%`;
    lines.push(`- **${axis}**: ${score} (${result.passed}/${result.checks} checks, ${result.perfectTurns}/${result.turnsScored} perfect turns)`);
    for (const failure of result.failures.slice(0, 5)) {
      lines.push(`  - \`${failure.failure}\`: ${failure.count}`);
    }
  }
  lines.push(
    '',
    '## Dimension Clusters',
    '',
  );
  if (report.dimensionClusters.length === 0) {
    lines.push('- None');
  } else {
    for (const cluster of report.dimensionClusters) lines.push(`- \`${cluster.dimension}\`: ${cluster.count}`);
  }
  lines.push(
    '',
    '## Audit Clusters',
    '',
  );
  if (report.auditClusters.length === 0) {
    lines.push('- None');
  } else {
    for (const cluster of report.auditClusters) lines.push(`- \`${cluster.category}\`: ${cluster.count}`);
  }
  lines.push(
    '',
    '## Failure Clusters',
    '',
  );
  if (report.failureClusters.length === 0) {
    lines.push('- None');
  } else {
    for (const cluster of report.failureClusters) lines.push(`- \`${cluster.failure}\`: ${cluster.count}`);
  }
  lines.push('', '## Scenarios', '');
  for (const scenario of report.scenarios) {
    lines.push(`### ${scenario.id}`);
    lines.push('');
    lines.push(`- Label: ${scenario.label}`);
    lines.push(`- Conversation: \`${scenario.conversationId ?? 'unknown'}\``);
    for (const [index, turn] of scenario.turns.entries()) {
      lines.push(`- Turn ${index + 1}: ${turn.grade.passed ? 'PASS' : `FLAG (${turn.grade.failures.join(', ')})`}`);
      lines.push(`  - Prompt: ${turn.prompt}`);
      lines.push(`  - Trace: \`${turn.assistant?.thinking?.intent ?? 'missing'} / ${turn.assistant?.thinking?.strategy ?? 'missing'}\``);
      lines.push(`  - Conversation mode: \`${turn.activeConversationMode ?? 'unknown'}\``);
      lines.push(`  - Rubric: \`${turn.rubric?.id ?? 'legacy-assertions'}\``);
      lines.push(`  - Process checkpoints: ${turn.grade.metrics.processTraceSteps}`);
      lines.push(`  - Screenshot: \`${path.relative(ROOT, turn.screenshot).replaceAll('\\', '/')}\``);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const config = REALISTIC_COUNT > 0
    ? buildRealisticMutationWave(REALISTIC_COUNT, SEED)
    : CONVERSATIONAL_COUNT > 0
    ? buildConversationalQualityWave(CONVERSATIONAL_COUNT, SEED)
    : CODE_ACTION_COUNT > 0
    ? buildCodeActionWave(CODE_ACTION_COUNT, SEED)
    : FACTUAL_COUNT > 0
    ? buildFactualKnowledgeWave(FACTUAL_COUNT, SEED)
    : HOLDOUT_COUNT > 0
    ? buildNovelHoldoutWave(HOLDOUT_COUNT, SEED)
    : ADVERSARIAL_COUNT > 0
      ? buildAdversarialAuditWave(ADVERSARIAL_COUNT, SEED)
      : GENERATED_COUNT > 0
        ? buildGeneratedAuditWave(GENERATED_COUNT, SEED)
        : JSON.parse(await fs.readFile(SCENARIO_PATH, 'utf8'));
  const chosen = GENERATED_COUNT > 0 || ADVERSARIAL_COUNT > 0 || HOLDOUT_COUNT > 0 || REALISTIC_COUNT > 0 || FACTUAL_COUNT > 0 || CONVERSATIONAL_COUNT > 0 || CODE_ACTION_COUNT > 0
    ? config.scenarios
    : shuffled(config.scenarios, SEED).slice(0, Math.max(1, LIMIT));
  const patchedBootstrap = await patchBootstrap(API_URL);
  const browser = await chromium.launch({ headless: HEADLESS, slowMo: HEADLESS ? 0 : 180 });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  const report = {
    version: config.version,
    createdAt: new Date().toISOString(),
    seed: SEED,
    appUrl: APP_URL,
    apiUrl: API_URL,
    generation: config.generation ?? { mode: 'fixed-regression-corpus', seed: SEED },
    scenarios: [],
    dimensionClusters: [],
    auditClusters: [],
    failureClusters: [],
    qualityAxes: {},
    summary: null,
  };
  const previousCanaries = [];
  let runtimeStalled = false;

  try {
    await page.route('**/api/platform/bootstrap', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: patchedBootstrap,
    }));
    await page.route('**/api/auth/me', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authenticated: true, user: { id: 'visual-audit', email: 'audit@test.local', name: 'Visual Audit' } }),
    }));
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitUntil('chat store', () => page.evaluate('Boolean(window.__vai_chat_store?.getState)'), 30_000, 300);

    for (const [scenarioIndex, scenario] of chosen.entries()) {
      await openFreshConversation(page);
      console.log(`\n===== Scenario ${scenarioIndex + 1}/${chosen.length}: ${scenario.id} =====`);
      const scenarioResult = {
        id: scenario.id,
        label: scenario.label,
        canary: scenario.canary,
        generated: scenario.generated ?? null,
        conversationId: null,
        turns: [],
      };
      report.scenarios.push(scenarioResult);

      for (const [turnIndex, turn] of scenario.turns.entries()) {
        const result = await sendAndAudit(page, scenario, turn, scenarioIndex, turnIndex, previousCanaries);
        scenarioResult.turns.push(result);
        scenarioResult.conversationId = result.activeConversationId ?? scenarioResult.conversationId;
        if (result.grade.failures.some((failure) => failure.startsWith('turn-timeout:'))) {
          scenarioResult.aborted = true;
          runtimeStalled = true;
          break;
        }
        // Adaptive human follow-up: if the opening answer was wrong and the
        // human "knows" the answer, push back once and re-grade. A good model
        // self-corrects; a bad one doubles down.
        if (!result.grade.passed && turn.recovery && !result.grade.failures.some((f) => f.startsWith('turn-timeout:'))) {
          console.log(`  ↳ human pushes back (knew the answer)`);
          const recoveryTurn = { ...turn.recovery, isRecovery: true };
          const recovery = await sendAndAudit(page, scenario, recoveryTurn, scenarioIndex, turnIndex + 1, previousCanaries);
          recovery.recoveryFor = scenario.turns[turnIndex]?.rubric?.id ?? null;
          scenarioResult.turns.push(recovery);
          if (recovery.grade.failures.some((failure) => failure.startsWith('turn-timeout:'))) {
            scenarioResult.aborted = true;
            runtimeStalled = true;
            break;
          }
        }
      }
      if (typeof scenario.canary === 'string' && scenario.canary.length > 0) {
        previousCanaries.push(scenario.canary);
      }
      if (runtimeStalled) break;
    }
  } finally {
    const allTurns = report.scenarios.flatMap((scenario) => scenario.turns);
    const clusterCounts = new Map();
    const dimensionCounts = new Map();
    const auditCounts = new Map();
    for (const turn of allTurns) {
      for (const failure of turn.grade.failures) {
        clusterCounts.set(failure, (clusterCounts.get(failure) ?? 0) + 1);
        const category = failure.split(':', 1)[0];
        auditCounts.set(category, (auditCounts.get(category) ?? 0) + 1);
      }
      if (!turn.grade.passed) {
        for (const dimension of turn.dimensions) {
          dimensionCounts.set(dimension, (dimensionCounts.get(dimension) ?? 0) + 1);
        }
      }
    }
    report.dimensionClusters = [...dimensionCounts.entries()]
      .map(([dimension, count]) => ({ dimension, count }))
      .sort((left, right) => right.count - left.count || left.dimension.localeCompare(right.dimension));
    report.auditClusters = [...auditCounts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category));
    report.failureClusters = [...clusterCounts.entries()]
      .map(([failure, count]) => ({ failure, count }))
      .sort((left, right) => right.count - left.count || left.failure.localeCompare(right.failure));
    report.qualityAxes = aggregateQualityAxes(allTurns.map((turn) => turn.grade));
    report.summary = {
      scenarios: report.scenarios.length,
      turns: allTurns.length,
      passedTurns: allTurns.filter((turn) => turn.grade.passed).length,
      flaggedTurns: allTurns.filter((turn) => !turn.grade.passed).length,
    };
    await fs.writeFile(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    await fs.writeFile(path.join(OUT, 'report.md'), markdownReport(report));
    if (!HEADLESS && PAUSE_MS > 0) await page.waitForTimeout(PAUSE_MS);
    await browser.close().catch(() => undefined);
  }

  console.log(`\n===== ${report.summary.passedTurns}/${report.summary.turns} turns passed =====`);
  console.log(`Report: ${path.join(OUT, 'report.md')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
