#!/usr/bin/env node
/**
 * Vai Scenario Bench — deterministic chat-pattern coverage.
 *
 * Reads declarative scenario packs from eval/scenarios/*.json and runs each
 * scenario against the live runtime (WS /api/chat). The unit-mode counterpart
 * is packages/core/__tests__/scenarios.test.ts — same packs, in-process VaiEngine.
 *
 * Pack format (JSON):
 *   {
 *     "id": "ambiguous-requests",
 *     "label": "Human label",
 *     "scenarios": [
 *       {
 *         "id": "fix-that-bug",
 *         "messages": [{ "role": "user", "content": "fix that bug" }],
 *         "systemPrompt": "optional",
 *         "mode": "chat|builder|plan|debate|agent",
 *         "assert": {
 *           "minLength": 40,
 *           "maxLength": 4000,
 *           "minWords": 10,
 *           "maxWords": 1500,
 *           "contains":      ["regex-string", ...],   // ALL must match (case-insensitive)
 *           "anyOfContains": ["regex-string", ...],   // at least one must match
 *           "notContains":   ["regex-string", ...],   // NONE may match
 *           "strategyIn":    ["short-topic-local", ...],
 *           "strategyNotIn": ["fallback"]
 *         }
 *       }
 *     ]
 *   }
 *
 * Usage:
 *   node scripts/vai-scenario-bench.mjs                         # run all packs against http://127.0.0.1:3006
 *   node scripts/vai-scenario-bench.mjs --pack ambiguous-requests
 *   node scripts/vai-scenario-bench.mjs --pack ambiguous-requests --pack error-diagnosis
 *   node scripts/vai-scenario-bench.mjs --base-url http://127.0.0.1:3006
 *   node scripts/vai-scenario-bench.mjs --report-file artifacts/scenarios.json
 *   node scripts/vai-scenario-bench.mjs --json                  # stdout JSON report
 *   node scripts/vai-scenario-bench.mjs --list                  # list pack ids
 *
 * Exit code is non-zero if any scenario fails its assertions.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import wsPkg from 'ws';
const WebSocket = wsPkg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PACKS_DIR = join(REPO_ROOT, 'eval', 'scenarios');

const DEFAULT_BASE_URL = process.env.VAI_API?.trim() || 'http://127.0.0.1:3006';
const DEFAULT_MODEL_ID = process.env.VAI_VERIFY_MODEL?.trim() || 'vai:v0';

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    modelId: DEFAULT_MODEL_ID,
    packIds: [],
    reportFile: null,
    json: false,
    list: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base-url') args.baseUrl = argv[++i];
    else if (a === '--model') args.modelId = argv[++i];
    else if (a === '--pack') args.packIds.push(argv[++i]);
    else if (a === '--report-file') args.reportFile = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--list') args.list = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/vai-scenario-bench.mjs [options]

Options:
  --base-url <url>       Runtime base URL (default: ${DEFAULT_BASE_URL})
  --model <id>           Model id (default: ${DEFAULT_MODEL_ID})
  --pack <id>            Run a specific pack (repeatable). Default: all packs.
  --report-file <path>   Write JSON report to file
  --json                 Print JSON report to stdout
  --list                 List available packs and exit
  --help, -h             Show this help
`);
}

function loadPacks() {
  const entries = readdirSync(PACKS_DIR, { withFileTypes: true });
  const packs = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const full = join(PACKS_DIR, entry.name);
    try {
      const pack = JSON.parse(readFileSync(full, 'utf-8'));
      if (!pack.id || !Array.isArray(pack.scenarios)) {
        console.warn(`[scenario-bench] skipping malformed pack: ${entry.name}`);
        continue;
      }
      packs.push({ ...pack, _file: basename(entry.name) });
    } catch (err) {
      console.warn(`[scenario-bench] failed to parse ${entry.name}: ${err.message}`);
    }
  }
  packs.sort((a, b) => a.id.localeCompare(b.id));
  return packs;
}

function toWsUrl(url) {
  return url.replace(/^http/i, 'ws').replace(/\/$/, '');
}

async function createConversation(baseUrl, modelId, mode, title) {
  const res = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ modelId, mode, title }),
  });
  if (!res.ok) throw new Error(`createConversation failed (${res.status}): ${await res.text()}`);
  return await res.json();
}

async function askChat({ baseUrl, conversationId, prompt, systemPrompt }) {
  const wsUrl = `${toWsUrl(baseUrl)}/api/chat`;
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let text = '';
    let strategy;
    let confidence;
    let sources = [];
    let followUps = [];
    const startedAt = Date.now();
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch {}
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(
      () => finish({ text: text || '[timeout]', strategy, confidence, sources, followUps, wallTimeMs: Date.now() - startedAt, timedOut: true }),
      45000,
    );

    ws.on('open', () => {
      ws.send(JSON.stringify({
        conversationId,
        content: prompt,
        ...(systemPrompt ? { systemPrompt } : {}),
      }));
    });
    ws.on('message', (buf) => {
      try {
        const msg = JSON.parse(buf.toString());
        if (msg.type === 'text_delta' && msg.textDelta) text += msg.textDelta;
        else if (msg.type === 'token' && msg.token) text += msg.token;
        else if (msg.type === 'sources') {
          if (Array.isArray(msg.sources)) sources = msg.sources;
          if (Array.isArray(msg.followUps)) followUps = msg.followUps;
          if (typeof msg.confidence === 'number') confidence = msg.confidence;
        }
        else if (msg.type === 'done') {
          if (msg.meta?.strategy) strategy = msg.meta.strategy;
          if (typeof msg.meta?.confidence === 'number') confidence = msg.meta.confidence;
          finish({ text, strategy, confidence, sources, followUps, wallTimeMs: Date.now() - startedAt, timedOut: false });
        }
        else if (msg.type === 'error') {
          finish({ text: text || `[error: ${msg.error ?? 'unknown'}]`, strategy, confidence, sources, followUps, wallTimeMs: Date.now() - startedAt, timedOut: false, error: msg.error });
        }
      } catch { /* ignore non-JSON frames */ }
    });
    ws.on('error', (err) => finish({ text: text || `[ws-error: ${err.message}]`, strategy, confidence, sources, followUps, wallTimeMs: Date.now() - startedAt, timedOut: false, error: err.message }));
    ws.on('close', () => finish({ text, strategy, confidence, sources, followUps, wallTimeMs: Date.now() - startedAt, timedOut: false }));
  });
}

function makeRegex(pattern) {
  const m = /^\/(.+)\/([gimsuy]*)$/.exec(pattern);
  if (m) return new RegExp(m[1], m[2].includes('i') ? m[2] : m[2] + 'i');
  return new RegExp(pattern, 'i');
}

function evaluateAssertions(text, strategy, assertSpec) {
  const failures = [];
  if (!assertSpec) return { passed: true, failures };

  const length = text.length;
  const words = text.trim().split(/\s+/).filter(Boolean).length;

  if (typeof assertSpec.minLength === 'number' && length < assertSpec.minLength) failures.push(`length ${length} < minLength ${assertSpec.minLength}`);
  if (typeof assertSpec.maxLength === 'number' && length > assertSpec.maxLength) failures.push(`length ${length} > maxLength ${assertSpec.maxLength}`);
  if (typeof assertSpec.minWords === 'number' && words < assertSpec.minWords) failures.push(`words ${words} < minWords ${assertSpec.minWords}`);
  if (typeof assertSpec.maxWords === 'number' && words > assertSpec.maxWords) failures.push(`words ${words} > maxWords ${assertSpec.maxWords}`);

  for (const pat of assertSpec.contains ?? []) {
    if (!makeRegex(pat).test(text)) failures.push(`missing: ${pat}`);
  }
  if (Array.isArray(assertSpec.anyOfContains) && assertSpec.anyOfContains.length > 0) {
    const anyMatch = assertSpec.anyOfContains.some((p) => makeRegex(p).test(text));
    if (!anyMatch) failures.push(`no anyOfContains matched: ${assertSpec.anyOfContains.join(' | ')}`);
  }
  for (const pat of assertSpec.notContains ?? []) {
    if (makeRegex(pat).test(text)) failures.push(`forbidden present: ${pat}`);
  }

  if (Array.isArray(assertSpec.strategyIn) && assertSpec.strategyIn.length > 0) {
    if (!strategy || !assertSpec.strategyIn.includes(strategy)) failures.push(`strategy "${strategy ?? 'unknown'}" not in [${assertSpec.strategyIn.join(', ')}]`);
  }
  if (Array.isArray(assertSpec.strategyNotIn) && assertSpec.strategyNotIn.length > 0) {
    if (strategy && assertSpec.strategyNotIn.includes(strategy)) failures.push(`strategy "${strategy}" is in forbidden [${assertSpec.strategyNotIn.join(', ')}]`);
  }

  return { passed: failures.length === 0, failures };
}

async function runScenario({ baseUrl, modelId, scenario }) {
  const mode = scenario.mode ?? 'chat';
  const conv = await createConversation(baseUrl, modelId, mode, `scenario ${scenario.id}`);

  // Replay all but the last message as prior turns so history-dependent asserts work.
  const allMessages = scenario.messages ?? [];
  const lastUser = [...allMessages].reverse().find((m) => m.role === 'user');
  if (!lastUser) throw new Error(`scenario ${scenario.id}: no user message`);

  for (const msg of allMessages) {
    if (msg === lastUser) break;
    if (msg.role !== 'user') continue;
    await askChat({ baseUrl, conversationId: conv.id, prompt: msg.content, systemPrompt: scenario.systemPrompt });
  }

  const response = await askChat({
    baseUrl,
    conversationId: conv.id,
    prompt: lastUser.content,
    systemPrompt: scenario.systemPrompt,
  });

  const result = evaluateAssertions(response.text, response.strategy, scenario.assert);
  return {
    id: scenario.id,
    passed: result.passed,
    failures: result.failures,
    strategy: response.strategy,
    confidence: response.confidence,
    wallTimeMs: response.wallTimeMs,
    words: response.text.trim().split(/\s+/).filter(Boolean).length,
    length: response.text.length,
    timedOut: response.timedOut ?? false,
    answerPreview: response.text.slice(0, 240),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }

  const allPacks = loadPacks();
  if (args.list) {
    for (const p of allPacks) console.log(`${p.id.padEnd(30)} ${p.scenarios.length} scenarios — ${p.label ?? ''}`);
    return;
  }

  const selected = args.packIds.length > 0
    ? allPacks.filter((p) => args.packIds.includes(p.id))
    : allPacks;
  if (selected.length === 0) {
    console.error(`[scenario-bench] no packs to run (have: ${allPacks.map((p) => p.id).join(', ')})`);
    process.exit(1);
  }

  const startedAt = new Date().toISOString();
  const packReports = [];
  let totalScenarios = 0;
  let totalPassed = 0;

  for (const pack of selected) {
    const scenarioReports = [];
    for (const scenario of pack.scenarios) {
      totalScenarios += 1;
      try {
        const r = await runScenario({ baseUrl: args.baseUrl, modelId: args.modelId, scenario });
        scenarioReports.push(r);
        if (r.passed) totalPassed += 1;
      } catch (err) {
        scenarioReports.push({
          id: scenario.id,
          passed: false,
          failures: [`runner error: ${err.message}`],
          strategy: null,
          confidence: null,
          wallTimeMs: null,
          words: 0,
          length: 0,
          timedOut: false,
          answerPreview: '',
        });
      }
    }
    packReports.push({
      id: pack.id,
      label: pack.label ?? null,
      passed: scenarioReports.every((s) => s.passed),
      total: scenarioReports.length,
      passedCount: scenarioReports.filter((s) => s.passed).length,
      scenarios: scenarioReports,
    });
  }

  const report = {
    ok: totalPassed === totalScenarios,
    generatedAt: startedAt,
    target: { baseUrl: args.baseUrl, modelId: args.modelId },
    summary: { totalPacks: packReports.length, totalScenarios, totalPassed, totalFailed: totalScenarios - totalPassed },
    packs: packReports,
  };

  if (args.reportFile) {
    mkdirSync(dirname(args.reportFile), { recursive: true });
    writeFileSync(args.reportFile, JSON.stringify(report, null, 2));
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`VAI_SCENARIO_BENCH ${report.ok ? 'PASS' : 'FAIL'}`);
    console.log(`target=${args.baseUrl} model=${args.modelId}`);
    console.log(`packs=${report.summary.totalPacks} scenarios=${report.summary.totalScenarios} passed=${report.summary.totalPassed} failed=${report.summary.totalFailed}`);
    for (const p of packReports) {
      console.log(`\n[${p.passed ? 'PASS' : 'FAIL'}] ${p.id} ${p.passedCount}/${p.total} — ${p.label ?? ''}`);
      for (const s of p.scenarios) {
        const status = s.passed ? 'PASS' : 'FAIL';
        console.log(`  · ${status} ${s.id.padEnd(36)} strategy=${s.strategy ?? '?'} words=${s.words} ms=${s.wallTimeMs ?? '?'}`);
        if (!s.passed) for (const f of s.failures) console.log(`      - ${f}`);
      }
    }
  }

  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`[scenario-bench] fatal: ${err.stack ?? err.message ?? err}`);
  process.exit(2);
});
