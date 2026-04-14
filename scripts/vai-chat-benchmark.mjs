#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { WebSocket } from 'ws';

const DEFAULT_BASE_URL = process.env.VAI_API ?? 'http://localhost:3006';
const DEFAULT_MODEL_ID = 'vai:v0';
const DEFAULT_MODE = 'chat';

const groundedSystemPrompt = [
  'You are writing a grounded technical memo for developers.',
  'Use short section headings and stay on the requested topic.',
  'Do not switch into shell, git alias, or command tutorial mode unless the prompt is explicitly about commands.',
  'Here, context means relevant repository files, tests, and docs, not React Context or frontend context providers.',
  'Do not return search-result boilerplate, cookie notices, or "I couldn\'t find a strong match" fallback text.',
  'If exact internals are unknown, give the best supportable engineering sketch instead of refusing or drifting.',
  'Separate supportable observations from inference or recommendations.',
  'Say when something is uncertain.',
].join(' ');

const smellPatterns = [
  /I couldn't find a strong match/i,
  /cookie preferences/i,
  /typescript world as public/i,
  /^\*\*Vite\*\* is a fast frontend build tool/i,
  /alias\.init|git config-?\s*global/i,
  /React Context|createContext|useContext/i,
];

const cases = [
  {
    id: 'dockable-workbench',
    prompt: 'I want a fully draggable, resizable, dockable panel system like VSCode for chat, plans, sources, and debug panels. Give me the real architecture, not fake 150 LOC magic.',
    required: [/layout as a tree|split nodes|tab groups/i, /pointer events|drag/i],
    minWords: 80,
  },
  {
    id: 'governance-entitlement',
    prompt: 'What should happen if an invited team member can view plans but does not have billing entitlement to launch a sandbox?',
    required: [/entitlement/i, /view plans/i, /launch a sandbox/i, /request approval|seat upgrade|owner|admin/i],
    minWords: 60,
  },
  {
    id: 'conflict-one-click-vs-review',
    prompt: 'I want one-click generation, but I also want strong approval and review gates before previews and deploys. Design the policy clearly.',
    required: [/approval/i, /preview/i, /deploy/i, /policy|review/i],
    minWords: 60,
  },
  {
    id: 'predictive-context-prefetch',
    prompt: 'A repo-native code assistant can proactively load likely files, tests, or docs before the developer asks. Explain this feature in plain language. Use the headings: Idea, Inputs, Guardrails. Mention recent edits, open files, or cursor position, cache or warmed context, fallback retrieval when the guess is wrong, and wrong predictions or misses. You may call this predictive prefetch, but focus on the behavior.',
    required: [/idea/i, /inputs/i, /guardrails/i, /predictive prefetch|prefetch|proactively load|load ahead|warmed context/i, /recent edits|open files|cursor position/i, /cache|warmed context|context/i, /fallback retrieval|fallback search|fallback/i, /wrong predictions|misses|bad predictions/i],
    minWords: 70,
  },
  {
    id: 'forgeindex-prototype',
    prompt: 'Design a repo-native prediction engine for a large monorepo that warms likely files, tests, and docs before the next question. By context here, mean code or doc retrieval context, not React Context. Use the headings: Signals, Prediction loop, Guardrails, Rollout. Mention recent edits or repo history, a prefetch queue or cache, fallback retrieval when predictions miss, and one metric such as cache hit rate or time to useful context.',
    required: [/signals/i, /prediction loop/i, /guardrails/i, /rollout/i, /recent edits|repo history/i, /prefetch queue|cache|warm/i, /fallback retrieval|fallback/i, /cache hit rate|time to useful context|metric/i],
    minWords: 85,
  },
  {
    id: 'predictive-prefetch-deep-memo',
    prompt: 'Design predictive context prefetch for a repo-native code assistant. Use the headings: Inputs, Signals, Prediction loop, Working set, Guardrails, Metrics, Rollout, Failure modes. Mention recent edits or repo history, warmed context or cache state, fallback retrieval when predictions miss, and stale or wrong warmed context as a risk.',
    required: [/inputs/i, /signals/i, /prediction loop/i, /working set/i, /guardrails/i, /metrics/i, /rollout/i, /failure modes/i, /recent edits|repo history/i, /warmed context|cache/i, /fallback retrieval|fallback/i, /stale|wrong warmed context|wrong guesses|miss/i],
    minWords: 120,
    expectedHeadings: ['Inputs', 'Signals', 'Prediction loop', 'Working set', 'Guardrails', 'Metrics', 'Rollout', 'Failure modes'],
    requestOverrides: {
      profile: 'strict',
      responseDepth: 'deep-design-memo',
    },
  },
  {
    id: 'answer-engine-deep-memo',
    prompt: 'Give a grounded design memo for a layered answer engine for developer research. Use the headings: Retrieval, Ranking, Synthesis, Verification, Guardrails, Failure modes, Rollout. Mention query rewriting, hybrid retrieval, reranking, citations or evidence spans, explicit uncertainty, and shadow evaluation before wider rollout.',
    required: [/retrieval/i, /ranking/i, /synthesis/i, /verification/i, /guardrails/i, /failure modes/i, /rollout/i, /query rewriting|rewrite/i, /hybrid retrieval/i, /rerank/i, /citations|evidence/i, /uncertainty/i, /shadow/i],
    minWords: 120,
    expectedHeadings: ['Retrieval', 'Ranking', 'Synthesis', 'Verification', 'Guardrails', 'Failure modes', 'Rollout'],
    requestOverrides: {
      profile: 'strict',
      responseDepth: 'deep-design-memo',
    },
  },
  {
    id: 'repo-native-architecture-deep-memo',
    prompt: 'Design a repo-native context engine for a large monorepo. Use the headings: Signals, Retrieval or prediction loop, Working set, Guardrails, Metrics, Rollout, Failure modes. Mention active files or recent edits, branch freshness, bounded evidence packets, fallback retrieval when the first pass is weak, and stale indexes or ranking collapse as risks.',
    required: [/signals/i, /retrieval or prediction loop/i, /working set/i, /guardrails/i, /metrics/i, /rollout/i, /failure modes/i, /active files|recent edits/i, /branch freshness|freshness/i, /bounded evidence packets|evidence packets|working set/i, /fallback retrieval|fallback/i, /stale indexes|ranking collapse|stale/i],
    minWords: 120,
    expectedHeadings: ['Signals', 'Retrieval or prediction loop', 'Working set', 'Guardrails', 'Metrics', 'Rollout', 'Failure modes'],
    requestOverrides: {
      profile: 'strict',
      responseDepth: 'deep-design-memo',
    },
  },
];

function printHelp() {
  console.log(`Usage: node scripts/vai-chat-benchmark.mjs [options]

Options:
  --base-url <url>       Runtime base URL (default: ${DEFAULT_BASE_URL})
  --model <id>           Model id to benchmark (default: ${DEFAULT_MODEL_ID})
  --mode <mode>          Conversation mode (default: ${DEFAULT_MODE})
  --case <id>            Benchmark case id (repeatable)
  --grounded             Send a grounded system prompt through /api/chat
  --strict               Fail if any case still has review notes/failures
  --report-file <path>   Write normalized JSON report to a file
  --json                 Print normalized JSON report to stdout
  --list-cases           Print available case ids and exit
  --help                 Show this help
`);
}

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    modelId: DEFAULT_MODEL_ID,
    mode: DEFAULT_MODE,
    caseIds: [],
    grounded: false,
    strict: false,
    reportFile: null,
    json: false,
    listCases: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--grounded') args.grounded = true;
    else if (arg === '--strict') args.strict = true;
    else if (arg === '--list-cases') args.listCases = true;
    else if (arg === '--base-url' && next) { args.baseUrl = next; index++; }
    else if (arg === '--model' && next) { args.modelId = next; index++; }
    else if (arg === '--mode' && next) { args.mode = next; index++; }
    else if (arg === '--case' && next) { args.caseIds.push(next); index++; }
    else if (arg === '--report-file' && next) { args.reportFile = next; index++; }
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  return args;
}

function toWsUrl(baseUrl) {
  return baseUrl.replace(/^http/i, 'ws').replace(/\/$/, '');
}

async function createConversation(baseUrl, modelId, mode, title) {
  const res = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId, mode, title }),
  });
  if (!res.ok) throw new Error(`create conversation failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function askChat({ baseUrl, conversationId, prompt, systemPrompt, promptRewriteOverrides }) {
  const wsUrl = `${toWsUrl(baseUrl)}/api/chat`;
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let text = '';
    let usage = { promptTokens: 0, completionTokens: 0 };
    const startedAt = Date.now();
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch {}
      resolve(value);
    };

    const timer = setTimeout(() => finish({ text: text || '[timeout]', usage, wallTimeMs: Date.now() - startedAt }), 45000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        conversationId,
        content: prompt,
        ...(systemPrompt ? { systemPrompt } : {}),
        ...(promptRewriteOverrides ?? {}),
      }));
    });

    ws.on('message', (buffer) => {
      const msg = JSON.parse(buffer.toString());
      if (msg.type === 'text_delta' && msg.textDelta) {
        text += msg.textDelta;
        return;
      }
      if (msg.type === 'token' && msg.token) {
        text += msg.token;
        return;
      }
      if (msg.type === 'done') {
        clearTimeout(timer);
        usage = msg.usage ?? usage;
        finish({ text, usage, wallTimeMs: Date.now() - startedAt });
        return;
      }
      if (msg.type === 'error') {
        clearTimeout(timer);
        reject(new Error(msg.error || 'unknown websocket error'));
      }
    });

    ws.on('close', () => {
      clearTimeout(timer);
      finish({ text: text || '[closed before done]', usage, wallTimeMs: Date.now() - startedAt });
    });
    ws.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function extractHeadings(text) {
  const headings = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const boldHeading = /^\*\*(.+?)\*\*$/.exec(trimmed);
    if (boldHeading) {
      headings.push(boldHeading[1].trim());
      continue;
    }

    const markdownHeading = /^#{1,6}\s+(.+?)\s*$/.exec(trimmed);
    if (markdownHeading) {
      headings.push(markdownHeading[1].trim());
    }
  }
  return headings;
}

function scoreCase(answer, testCase) {
  let score = 100;
  const failures = [];
  const actualHeadings = extractHeadings(answer);

  for (const pattern of smellPatterns) {
    if (pattern.test(answer)) {
      score -= 35;
      failures.push(`smell:${pattern}`);
    }
  }
  for (const pattern of testCase.required) {
    if (!pattern.test(answer)) {
      score -= 12;
      failures.push(`missing:${pattern}`);
    }
  }
  const wordCount = countWords(answer);
  if (wordCount < testCase.minWords) {
    score -= 15;
    failures.push(`minWords:${testCase.minWords} (got ${wordCount})`);
  }

  if (testCase.expectedHeadings) {
    const missingHeadings = testCase.expectedHeadings.filter((heading) => !actualHeadings.includes(heading));
    const unexpectedHeadings = actualHeadings.filter((heading) => !testCase.expectedHeadings.includes(heading));
    const exactHeadingMatch = actualHeadings.length === testCase.expectedHeadings.length
      && testCase.expectedHeadings.every((heading, index) => actualHeadings[index] === heading);

    if (missingHeadings.length > 0) {
      score -= 8;
      failures.push(`missingHeadings:${missingHeadings.join(' | ')}`);
    }
    if (unexpectedHeadings.length > 0) {
      score -= 8;
      failures.push(`unexpectedHeadings:${unexpectedHeadings.join(' | ')}`);
    }
    if (missingHeadings.length === 0 && unexpectedHeadings.length === 0 && !exactHeadingMatch) {
      score -= 8;
      failures.push(`headingOrder:${actualHeadings.join(' -> ')}`);
    }
  }

  const finalScore = Math.max(0, score);
  return {
    score: finalScore,
    passed: finalScore >= 85,
    needsReview: failures.length > 0,
    failures,
    wordCount,
    actualHeadings,
  };
}

function buildReport(args, results) {
  const passed = results.filter((result) => result.passed).length;
  const needsReview = results.filter((result) => result.needsReview).length;
  const avgScore = results.length > 0
    ? Number((results.reduce((sum, result) => sum + result.score, 0) / results.length).toFixed(1))
    : 0;
  const ok = args.strict ? passed === results.length && needsReview === 0 : passed === results.length;
  return {
    ok,
    generatedAt: new Date().toISOString(),
    target: {
      baseUrl: args.baseUrl,
      modelId: args.modelId,
      mode: args.mode,
      grounded: args.grounded,
      strict: args.strict,
      caseIds: results.map((result) => result.caseId),
    },
    summary: {
      totalCases: results.length,
      passed,
      failed: results.length - passed,
      needsReview,
      avgScore,
    },
    cases: results,
  };
}

async function writeReportFile(path, report) {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`reportFile=${absolutePath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  if (args.listCases) {
    console.log(JSON.stringify({ cases: cases.map(({ id }) => id) }, null, 2));
    return;
  }

  const selectedCases = args.caseIds.length > 0
    ? args.caseIds.map((caseId) => {
      const testCase = cases.find((entry) => entry.id === caseId);
      if (!testCase) throw new Error(`Unknown benchmark case '${caseId}'`);
      return testCase;
    })
    : cases;

  const results = [];
  for (const testCase of selectedCases) {
    const conversation = await createConversation(args.baseUrl, args.modelId, args.mode, `chat-bench ${testCase.id}`);
    const response = await askChat({
      baseUrl: args.baseUrl,
      conversationId: conversation.id,
      prompt: testCase.prompt,
      systemPrompt: args.grounded ? groundedSystemPrompt : undefined,
      promptRewriteOverrides: testCase.requestOverrides,
    });
    const scored = scoreCase(response.text, testCase);
    results.push({
      caseId: testCase.id,
      requestOverrides: testCase.requestOverrides ?? null,
      passed: scored.passed,
      needsReview: scored.needsReview,
      score: scored.score,
      failures: scored.failures,
      expectedHeadings: testCase.expectedHeadings ?? null,
      actualHeadings: scored.actualHeadings,
      wordCount: scored.wordCount,
      wallTimeMs: response.wallTimeMs,
      usage: response.usage,
      responsePreview: response.text.slice(0, 240),
      answer: response.text,
    });
  }

  const report = buildReport(args, results);
  console.log(`VAI_CHAT_BENCH ${report.ok ? 'PASS' : 'FAIL'}`);
  console.log(`model=${report.target.modelId} mode=${report.target.mode} grounded=${report.target.grounded} strict=${report.target.strict} base=${report.target.baseUrl}`);
  console.log(`cases=${report.summary.totalCases} passed=${report.summary.passed} failed=${report.summary.failed} needsReview=${report.summary.needsReview} avgScore=${report.summary.avgScore}`);
  for (const result of report.cases.filter((entry) => !entry.passed || entry.needsReview)) {
    console.log(`- ${result.caseId} passed=${result.passed} needsReview=${result.needsReview} score=${result.score} failures=${result.failures.join(', ') || 'none'}`);
  }

  if (args.reportFile) {
    await writeReportFile(args.reportFile, report);
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  }

  process.exitCode = report.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(`VAI_CHAT_BENCH_ERROR ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});