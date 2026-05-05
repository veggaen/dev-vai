#!/usr/bin/env -S npx tsx
/**
 * Vai Bench Fast — in-process scenario bench.
 *
 * Why this exists:
 *   The WS-based scripts/vai-scenario-bench.mjs requires a running runtime,
 *   pays a cold-start WS hit on the first scenario (~45s timeout window),
 *   buffers all output until the run is done, and chains turns sequentially
 *   over a network socket — slow and opaque when iterating on regex/template
 *   logic that lives in pure functions.
 *
 *   This bench skips the server entirely and runs the deterministic chat
 *   short-circuit chain (meta-router → fact-recall → constrained-code-emitter)
 *   in-process. Same pack format as the WS bench. Streams one line per
 *   scenario as it completes. Falls through to "engine-passthrough" status
 *   when no short-circuit fires — the WS bench remains the gate for those.
 *
 * Usage:
 *   npx tsx scripts/vai-bench-fast.ts                                   # all packs
 *   npx tsx scripts/vai-bench-fast.ts --pack constraint-enforcement
 *   npx tsx scripts/vai-bench-fast.ts --pack memory-and-context --pack constraint-enforcement
 *   npx tsx scripts/vai-bench-fast.ts --report-file artifacts/build-quality/fast.json
 *   npx tsx scripts/vai-bench-fast.ts --json
 *   npx tsx scripts/vai-bench-fast.ts --list
 *   npx tsx scripts/vai-bench-fast.ts --include-passthrough             # treat passthrough as fail
 *
 * Exit code is non-zero if any in-scope scenario fails its assertions.
 * Passthrough scenarios are reported but do NOT fail the run by default.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tryHandleChatMeta } from '../packages/core/src/chat/meta-router.js';
import {
  extractConversationFacts,
  tryHandleFactRecall,
  type FactsHistoryMessage,
} from '../packages/core/src/chat/conversation-facts.js';
import { tryEmitConstrainedCode } from '../packages/core/src/chat/constrained-code-emitter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PACKS_DIR = join(REPO_ROOT, 'eval', 'scenarios');

interface AssertSpec {
  minLength?: number;
  maxLength?: number;
  minWords?: number;
  maxWords?: number;
  contains?: string[];
  anyOfContains?: string[];
  notContains?: string[];
  strategyIn?: string[];
  strategyNotIn?: string[];
}

interface ScenarioMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface Scenario {
  id: string;
  systemPrompt?: string;
  messages: ScenarioMessage[];
  assert?: AssertSpec;
  pending?: string;
}

interface Pack {
  id: string;
  label?: string;
  scenarios: Scenario[];
  _file?: string;
}

interface Args {
  packIds: string[];
  reportFile: string | null;
  json: boolean;
  list: boolean;
  includePassthrough: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    packIds: [],
    reportFile: null,
    json: false,
    list: false,
    includePassthrough: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--pack') a.packIds.push(argv[++i]);
    else if (x === '--report-file') a.reportFile = argv[++i];
    else if (x === '--json') a.json = true;
    else if (x === '--list') a.list = true;
    else if (x === '--include-passthrough') a.includePassthrough = true;
    else if (x === '--help' || x === '-h') a.help = true;
  }
  return a;
}

function printHelp(): void {
  process.stdout.write(`Usage: npx tsx scripts/vai-bench-fast.ts [options]

Options:
  --pack <id>               Run a specific pack (repeatable). Default: all packs.
  --report-file <path>      Write JSON report to file
  --json                    Print JSON report to stdout
  --list                    List available packs and exit
  --include-passthrough     Treat engine-passthrough scenarios as failures
  --help, -h                Show this help
`);
}

function loadPacks(): Pack[] {
  const entries = readdirSync(PACKS_DIR, { withFileTypes: true });
  const packs: Pack[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const full = join(PACKS_DIR, entry.name);
    try {
      const pack = JSON.parse(readFileSync(full, 'utf-8')) as Pack;
      if (!pack.id || !Array.isArray(pack.scenarios)) {
        process.stderr.write(`[bench-fast] skipping malformed pack: ${entry.name}\n`);
        continue;
      }
      packs.push({ ...pack, _file: basename(entry.name) });
    } catch (err) {
      process.stderr.write(`[bench-fast] failed to parse ${entry.name}: ${(err as Error).message}\n`);
    }
  }
  packs.sort((a, b) => a.id.localeCompare(b.id));
  return packs;
}

function makeRegex(pattern: string): RegExp {
  const m = /^\/(.+)\/([gimsuy]*)$/.exec(pattern);
  if (m) return new RegExp(m[1], m[2].includes('i') ? m[2] : m[2] + 'i');
  return new RegExp(pattern, 'i');
}

interface AssertResult {
  passed: boolean;
  failures: string[];
}

function evaluateAssertions(text: string, strategy: string | null, spec: AssertSpec | undefined): AssertResult {
  const failures: string[] = [];
  if (!spec) return { passed: true, failures };
  const length = text.length;
  const words = text.trim().split(/\s+/).filter(Boolean).length;

  if (typeof spec.minLength === 'number' && length < spec.minLength) failures.push(`length ${length} < minLength ${spec.minLength}`);
  if (typeof spec.maxLength === 'number' && length > spec.maxLength) failures.push(`length ${length} > maxLength ${spec.maxLength}`);
  if (typeof spec.minWords === 'number' && words < spec.minWords) failures.push(`words ${words} < minWords ${spec.minWords}`);
  if (typeof spec.maxWords === 'number' && words > spec.maxWords) failures.push(`words ${words} > maxWords ${spec.maxWords}`);

  for (const pat of spec.contains ?? []) {
    if (!makeRegex(pat).test(text)) failures.push(`missing: ${pat}`);
  }
  if (Array.isArray(spec.anyOfContains) && spec.anyOfContains.length > 0) {
    const anyMatch = spec.anyOfContains.some((p) => makeRegex(p).test(text));
    if (!anyMatch) failures.push(`no anyOfContains matched: ${spec.anyOfContains.join(' | ')}`);
  }
  for (const pat of spec.notContains ?? []) {
    if (makeRegex(pat).test(text)) failures.push(`forbidden present: ${pat}`);
  }
  if (Array.isArray(spec.strategyIn) && spec.strategyIn.length > 0) {
    if (!strategy || !spec.strategyIn.includes(strategy)) failures.push(`strategy "${strategy ?? 'unknown'}" not in [${spec.strategyIn.join(', ')}]`);
  }
  if (Array.isArray(spec.strategyNotIn) && spec.strategyNotIn.length > 0) {
    if (strategy && spec.strategyNotIn.includes(strategy)) failures.push(`strategy "${strategy}" is in forbidden [${spec.strategyNotIn.join(', ')}]`);
  }
  return { passed: failures.length === 0, failures };
}

interface ShortCircuitOutcome {
  reply: string | null;
  intent: string | null;
  source: 'meta' | 'facts' | 'constrained-code' | null;
}

function runShortCircuit(content: string, history: FactsHistoryMessage[]): ShortCircuitOutcome {
  const meta = tryHandleChatMeta(content, history);
  if (meta) return { reply: meta.reply, intent: meta.intent, source: 'meta' };

  const fact = tryHandleFactRecall(content, history);
  if (fact) return { reply: fact.reply, intent: fact.intent, source: 'facts' };

  const facts = extractConversationFacts(history);
  const code = tryEmitConstrainedCode({ content, facts });
  if (code) return { reply: code.reply, intent: code.intent, source: 'constrained-code' };

  return { reply: null, intent: null, source: null };
}

interface ScenarioReport {
  id: string;
  status: 'pass' | 'fail' | 'passthrough' | 'pending';
  failures: string[];
  source: string | null;
  intent: string | null;
  words: number;
  length: number;
  wallTimeMs: number;
  preview: string;
  reason?: string;
}

function runScenario(scenario: Scenario): ScenarioReport {
  if (scenario.pending) {
    return {
      id: scenario.id,
      status: 'pending',
      failures: [],
      source: null,
      intent: null,
      words: 0,
      length: 0,
      wallTimeMs: 0,
      preview: '',
      reason: scenario.pending,
    };
  }

  const startedAt = Date.now();
  const allMessages = scenario.messages ?? [];
  const lastUserIdx = (() => {
    for (let i = allMessages.length - 1; i >= 0; i--) {
      if (allMessages[i].role === 'user') return i;
    }
    return -1;
  })();
  if (lastUserIdx < 0) {
    return {
      id: scenario.id,
      status: 'fail',
      failures: ['scenario has no user message'],
      source: null,
      intent: null,
      words: 0,
      length: 0,
      wallTimeMs: Date.now() - startedAt,
      preview: '',
    };
  }

  // Replay history to last-user. For each prior user turn, try the short-circuit
  // chain so the assistant slot has the same deterministic content the live
  // service would have stored. If nothing fires, inject a neutral placeholder
  // assistant turn so subsequent history-aware logic still sees a turn-pair.
  const history: FactsHistoryMessage[] = [];
  for (let i = 0; i < lastUserIdx; i++) {
    const msg = allMessages[i];
    history.push({ role: msg.role, content: msg.content });
    if (msg.role === 'user') {
      const next = allMessages[i + 1];
      if (next && next.role === 'assistant') continue; // explicit assistant follows; let it append next iter
      const out = runShortCircuit(msg.content, history);
      const replyContent = out.reply ?? '[engine-passthrough]';
      history.push({ role: 'assistant', content: replyContent });
    }
  }

  const finalContent = allMessages[lastUserIdx].content;
  history.push({ role: 'user', content: finalContent });
  const out = runShortCircuit(finalContent, history);

  const wallTimeMs = Date.now() - startedAt;

  if (!out.reply) {
    return {
      id: scenario.id,
      status: 'passthrough',
      failures: [],
      source: null,
      intent: null,
      words: 0,
      length: 0,
      wallTimeMs,
      preview: '',
      reason: 'no short-circuit fired; engine would handle this',
    };
  }

  const strategy = out.source ? `chat-${out.source}` : null;
  const result = evaluateAssertions(out.reply, strategy, scenario.assert);
  const words = out.reply.trim().split(/\s+/).filter(Boolean).length;
  return {
    id: scenario.id,
    status: result.passed ? 'pass' : 'fail',
    failures: result.failures,
    source: out.source,
    intent: out.intent,
    words,
    length: out.reply.length,
    wallTimeMs,
    preview: out.reply.slice(0, 240),
  };
}

interface PackReport {
  id: string;
  label: string | null;
  scenarios: ScenarioReport[];
  passed: number;
  failed: number;
  passthrough: number;
  pending: number;
  total: number;
}

function statusBadge(status: ScenarioReport['status']): string {
  switch (status) {
    case 'pass': return 'PASS';
    case 'fail': return 'FAIL';
    case 'passthrough': return 'PASS-THRU';
    case 'pending': return 'PEND';
  }
}

function streamScenarioLine(packId: string, r: ScenarioReport): void {
  const badge = statusBadge(r.status).padEnd(9);
  const id = r.id.padEnd(40);
  const meta =
    r.status === 'pass' || r.status === 'fail'
      ? `src=${r.source ?? '?'} intent=${r.intent ?? '?'} words=${r.words} ms=${r.wallTimeMs}`
      : r.reason ?? '';
  process.stdout.write(`  [${badge}] ${id} ${meta}\n`);
  if (r.status === 'fail') {
    for (const f of r.failures) process.stdout.write(`              - ${f}\n`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }

  const allPacks = loadPacks();
  if (args.list) {
    for (const p of allPacks) process.stdout.write(`${p.id.padEnd(30)} ${p.scenarios.length} scenarios — ${p.label ?? ''}\n`);
    return;
  }

  const selected = args.packIds.length > 0
    ? allPacks.filter((p) => args.packIds.includes(p.id))
    : allPacks;
  if (selected.length === 0) {
    process.stderr.write(`[bench-fast] no packs to run (have: ${allPacks.map((p) => p.id).join(', ')})\n`);
    process.exit(1);
  }

  const startedAt = new Date().toISOString();
  const packReports: PackReport[] = [];
  let totalPass = 0;
  let totalFail = 0;
  let totalPassthrough = 0;
  let totalPending = 0;

  for (const pack of selected) {
    if (!args.json) process.stdout.write(`\n=== ${pack.id} — ${pack.label ?? ''} ===\n`);
    const scenarioReports: ScenarioReport[] = [];
    for (const scenario of pack.scenarios) {
      const r = runScenario(scenario);
      scenarioReports.push(r);
      if (r.status === 'pass') totalPass += 1;
      else if (r.status === 'fail') totalFail += 1;
      else if (r.status === 'passthrough') totalPassthrough += 1;
      else if (r.status === 'pending') totalPending += 1;
      if (!args.json) streamScenarioLine(pack.id, r);
    }
    packReports.push({
      id: pack.id,
      label: pack.label ?? null,
      scenarios: scenarioReports,
      passed: scenarioReports.filter((s) => s.status === 'pass').length,
      failed: scenarioReports.filter((s) => s.status === 'fail').length,
      passthrough: scenarioReports.filter((s) => s.status === 'passthrough').length,
      pending: scenarioReports.filter((s) => s.status === 'pending').length,
      total: scenarioReports.length,
    });
  }

  const ok = totalFail === 0 && (!args.includePassthrough || totalPassthrough === 0);
  const report = {
    ok,
    generatedAt: startedAt,
    mode: 'in-process',
    summary: {
      totalPacks: packReports.length,
      totalScenarios: totalPass + totalFail + totalPassthrough + totalPending,
      pass: totalPass,
      fail: totalFail,
      passthrough: totalPassthrough,
      pending: totalPending,
    },
    packs: packReports,
  };

  if (args.reportFile) {
    mkdirSync(dirname(args.reportFile), { recursive: true });
    writeFileSync(args.reportFile, JSON.stringify(report, null, 2));
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(`\nVAI_BENCH_FAST ${ok ? 'PASS' : 'FAIL'}\n`);
    process.stdout.write(
      `packs=${report.summary.totalPacks} scenarios=${report.summary.totalScenarios} ` +
      `pass=${report.summary.pass} fail=${report.summary.fail} ` +
      `passthrough=${report.summary.passthrough} pending=${report.summary.pending}\n`,
    );
    if (totalPassthrough > 0 && !args.includePassthrough) {
      process.stdout.write(`(passthrough scenarios need WS bench to verify; not failing this run)\n`);
    }
  }

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`[bench-fast] fatal: ${(err as Error).stack ?? (err as Error).message ?? String(err)}\n`);
  process.exit(2);
});
