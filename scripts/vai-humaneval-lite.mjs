#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import vm from 'node:vm';
import { WebSocket } from 'ws';

const DEFAULT_BASE_URL = process.env.VAI_API ?? 'http://localhost:3006';
const DEFAULT_MODEL_ID = 'vai:v0';
const DEFAULT_MODE = 'chat';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const systemPrompt = [
  'You are taking a JavaScript code generation benchmark.',
  'Return only runnable JavaScript.',
  'Do not include explanations, markdown, or prose.',
  'Define the requested function with the exact requested name.',
  'Do not read from stdin or write to stdout.',
].join(' ');

const tasks = [
  {
    id: 'sum-even-numbers',
    entry: 'sumEvenNumbers',
    prompt: 'Define a function named sumEvenNumbers(numbers) that returns the sum of all even numeric values in the input array. Ignore non-number values and odd numbers.',
    tests: [
      { args: [[1, 2, 3, 4, 5, 6]], expected: 12 },
      { args: [[2, '4', 8, null, 3, 10]], expected: 20 },
      { args: [[-2, -3, -4, 9]], expected: -6 },
      { args: [[]], expected: 0 },
    ],
  },
  {
    id: 'normalize-slug',
    entry: 'normalizeSlug',
    prompt: 'Define a function named normalizeSlug(text) that lowercases the input, replaces runs of non-alphanumeric characters with a single hyphen, and trims leading or trailing hyphens.',
    tests: [
      { args: ['Hello, World!'], expected: 'hello-world' },
      { args: ['  Multi   Space__Value  '], expected: 'multi-space-value' },
      { args: ['Already-clean'], expected: 'already-clean' },
      { args: ['$$$'], expected: '' },
    ],
  },
  {
    id: 'chunk-array',
    entry: 'chunkArray',
    prompt: 'Define a function named chunkArray(items, size) that splits the input array into chunks of the given positive size. If size is less than 1, throw an Error.',
    tests: [
      { args: [[1, 2, 3, 4, 5], 2], expected: [[1, 2], [3, 4], [5]] },
      { args: [['a', 'b', 'c'], 1], expected: [['a'], ['b'], ['c']] },
      { args: [[1, 2], 5], expected: [[1, 2]] },
      { args: [[], 3], expected: [] },
    ],
    throws: [
      { args: [[1, 2, 3], 0] },
    ],
  },
  {
    id: 'merge-intervals',
    entry: 'mergeIntervals',
    prompt: 'Define a function named mergeIntervals(intervals) that accepts an array of [start, end] integer pairs, sorts them by start, and merges overlapping intervals.',
    tests: [
      { args: [[[1, 3], [2, 6], [8, 10], [15, 18]]], expected: [[1, 6], [8, 10], [15, 18]] },
      { args: [[[5, 7], [1, 2], [2, 4]]], expected: [[1, 4], [5, 7]] },
      { args: [[[1, 4], [4, 5]]], expected: [[1, 5]] },
      { args: [[]], expected: [] },
    ],
  },
  {
    id: 'unique-by-id',
    entry: 'uniqueById',
    prompt: 'Define a function named uniqueById(rows) that returns a new array containing only the first occurrence of each id value. Preserve input order.',
    tests: [
      {
        args: [[{ id: 1, n: 'a' }, { id: 2, n: 'b' }, { id: 1, n: 'c' }]],
        expected: [{ id: 1, n: 'a' }, { id: 2, n: 'b' }],
      },
      {
        args: [[{ id: 'x', ok: true }, { id: 'x', ok: false }, { id: 'y', ok: true }]],
        expected: [{ id: 'x', ok: true }, { id: 'y', ok: true }],
      },
      {
        args: [[{ id: 3 }, { id: 4 }, { id: 4 }, { id: 5 }]],
        expected: [{ id: 3 }, { id: 4 }, { id: 5 }],
      },
      { args: [[]], expected: [] },
    ],
  },
  {
    id: 'roman-to-int',
    entry: 'romanToInt',
    prompt: 'Define a function named romanToInt(value) that converts a valid uppercase Roman numeral string into an integer.',
    tests: [
      { args: ['III'], expected: 3 },
      { args: ['LVIII'], expected: 58 },
      { args: ['MCMXCIV'], expected: 1994 },
      { args: ['XL'], expected: 40 },
    ],
  },
  {
    id: 'longest-common-prefix',
    entry: 'longestCommonPrefix',
    prompt: 'Define a function named longestCommonPrefix(words) that returns the longest shared prefix among all input strings. Return an empty string if there is no shared prefix.',
    tests: [
      { args: [['flower', 'flow', 'flight']], expected: 'fl' },
      { args: [['dog', 'racecar', 'car']], expected: '' },
      { args: [['single']], expected: 'single' },
      { args: [['interview', 'internet', 'internal']], expected: 'inter' },
    ],
  },
];

function printHelp() {
  console.log(`Usage: node scripts/vai-humaneval-lite.mjs [options]

Options:
  --base-url <url>       Runtime base URL (default: ${DEFAULT_BASE_URL})
  --model <id>           Model id to benchmark (default: ${DEFAULT_MODEL_ID})
  --mode <mode>          Conversation mode (default: ${DEFAULT_MODE})
  --task <id>            Task id to run (repeatable)
  --list-tasks           Print available task ids and exit
  --report-file <path>   Write normalized JSON report to a file
  --json                 Print normalized JSON report to stdout
  --strict               Exit non-zero if any task fails
  --help                 Show this help
`);
}

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    modelId: DEFAULT_MODEL_ID,
    mode: DEFAULT_MODE,
    taskIds: [],
    listTasks: false,
    reportFile: null,
    json: false,
    strict: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--strict') args.strict = true;
    else if (arg === '--list-tasks') args.listTasks = true;
    else if (arg === '--base-url' && next) { args.baseUrl = next; index++; }
    else if (arg === '--model' && next) { args.modelId = next; index++; }
    else if (arg === '--mode' && next) { args.mode = next; index++; }
    else if (arg === '--task' && next) { args.taskIds.push(next); index++; }
    else if (arg === '--report-file' && next) { args.reportFile = next; index++; }
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  return args;
}

function toWsUrl(baseUrl) {
  return baseUrl.replace(/^http/i, 'ws').replace(/\/$/, '');
}

async function fetchWithRetry(url, init, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await sleep(250 * attempt);
    }
  }
  throw lastError;
}

async function createConversation(baseUrl, modelId, mode, title) {
  const res = await fetchWithRetry(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId, mode, title }),
  });
  if (!res.ok) throw new Error(`create conversation failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function askChat({ baseUrl, conversationId, prompt, systemPrompt }) {
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
        systemPrompt,
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

function extractJavaScript(answer) {
  const fenced = /```(?:javascript|js|typescript|ts)?\s*([\s\S]*?)```/i.exec(answer);
  if (fenced) return fenced[1].trim();

  const start = answer.search(/\b(function|const|let|var|class)\b/);
  if (start >= 0) return answer.slice(start).trim();
  return answer.trim();
}

function buildContext(code, entry) {
  const context = {
    module: { exports: {} },
    exports: {},
    globalThis: {},
  };
  vm.createContext(context);
  const bootstrap = `${code}\n;globalThis.__benchCandidate = typeof ${entry} !== 'undefined' ? ${entry} : (module.exports && module.exports.${entry}) || (exports && exports.${entry});`;
  vm.runInContext(bootstrap, context, { timeout: 1000 });
  if (typeof context.globalThis.__benchCandidate !== 'function') {
    throw new Error(`missing function ${entry}`);
  }
  return context;
}

function runInSandbox(context, expression, value) {
  context.globalThis.__benchValue = value;
  vm.runInContext(expression, context, { timeout: 1000 });
  return context.globalThis.__benchResult;
}

function normalizeComparable(value) {
  if (Array.isArray(value)) return Array.from(value, (item) => normalizeComparable(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, normalizeComparable(nested)]),
    );
  }
  return value;
}

function evaluateTask(code, task) {
  const failures = [];
  let passedChecks = 0;
  const totalChecks = task.tests.length + (task.throws?.length ?? 0);
  let context;

  try {
    context = buildContext(code, task.entry);
  } catch (error) {
    return {
      score: 0,
      passed: false,
      failures: [error instanceof Error ? error.message : String(error)],
    };
  }

  for (const test of task.tests) {
    try {
      const actual = runInSandbox(context, 'globalThis.__benchResult = globalThis.__benchCandidate(...globalThis.__benchValue);', test.args);
      const normalizedActual = normalizeComparable(actual);
      const normalizedExpected = normalizeComparable(test.expected);
      if (!isDeepStrictEqual(normalizedActual, normalizedExpected)) {
        failures.push(`expected ${JSON.stringify(normalizedExpected)} got ${JSON.stringify(normalizedActual)}`);
      } else {
        passedChecks++;
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  for (const test of task.throws ?? []) {
    try {
      runInSandbox(context, 'globalThis.__benchResult = globalThis.__benchCandidate(...globalThis.__benchValue);', test.args);
      failures.push(`expected throw for args ${JSON.stringify(test.args)}`);
    } catch {
      passedChecks++;
    }
  }

  const score = totalChecks === 0 ? 0 : Math.round((passedChecks / totalChecks) * 100);
  return {
    score,
    passed: score === 100,
    failures,
  };
}

function buildReport({ baseUrl, modelId, mode, selectedTaskIds, results }) {
  const totalPromptTokens = results.reduce((sum, result) => sum + (result.usage.promptTokens ?? 0), 0);
  const totalCompletionTokens = results.reduce((sum, result) => sum + (result.usage.completionTokens ?? 0), 0);
  const avgScore = results.length > 0
    ? Number((results.reduce((sum, result) => sum + result.score, 0) / results.length).toFixed(1))
    : 0;
  const avgWallTimeMs = results.length > 0
    ? Number((results.reduce((sum, result) => sum + result.wallTimeMs, 0) / results.length).toFixed(1))
    : 0;
  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;

  return {
    ok: failed === 0,
    generatedAt: new Date().toISOString(),
    target: {
      baseUrl,
      modelId,
      mode,
      taskIds: selectedTaskIds,
    },
    summary: {
      totalTasks: results.length,
      passed,
      failed,
      avgScore,
      avgWallTimeMs,
      totalPromptTokens,
      totalCompletionTokens,
    },
    results,
  };
}

function printSummary(report) {
  console.log(`VAI_HUMANEVAL_LITE ${report.ok ? 'PASS' : 'FAIL'}`);
  console.log(`model=${report.target.modelId} mode=${report.target.mode} base=${report.target.baseUrl}`);
  console.log(
    `tasks=${report.summary.totalTasks} passed=${report.summary.passed} failed=${report.summary.failed} avgScore=${report.summary.avgScore} avgWallTimeMs=${report.summary.avgWallTimeMs} promptTokens=${report.summary.totalPromptTokens} completionTokens=${report.summary.totalCompletionTokens}`,
  );
  for (const result of report.results) {
    console.log(`- ${result.taskId} passed=${result.passed} score=${result.score} wallTimeMs=${result.wallTimeMs} codeLength=${result.codeLength} failures=${result.failures.join('; ') || 'none'}`);
  }
}

async function writeReportFile(path, report) {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`reportFile=${absolutePath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args.listTasks) {
    for (const task of tasks) console.log(task.id);
    return;
  }

  const selectedTasks = args.taskIds.length > 0
    ? args.taskIds.map((taskId) => {
        const task = tasks.find((entry) => entry.id === taskId);
        if (!task) throw new Error(`Unknown task '${taskId}'`);
        return task;
      })
    : tasks;

  const results = [];

  for (const task of selectedTasks) {
    const conversation = await createConversation(args.baseUrl, args.modelId, args.mode, `HumanEval Lite: ${task.id}`);
    const response = await askChat({
      baseUrl: args.baseUrl,
      conversationId: conversation.id,
      prompt: task.prompt,
      systemPrompt,
    });
    const code = extractJavaScript(response.text);
    const evaluation = evaluateTask(code, task);
    results.push({
      taskId: task.id,
      passed: evaluation.passed,
      score: evaluation.score,
      failures: evaluation.failures,
      wallTimeMs: response.wallTimeMs,
      codeLength: code.length,
      usage: response.usage,
      answerPreview: response.text.slice(0, 220),
    });
  }

  const report = buildReport({
    baseUrl: args.baseUrl,
    modelId: args.modelId,
    mode: args.mode,
    selectedTaskIds: selectedTasks.map((task) => task.id),
    results,
  });

  printSummary(report);

  if (args.reportFile) {
    await writeReportFile(args.reportFile, report);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  }

  if (args.strict && !report.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const detail = error instanceof Error
    ? `${error.message}${error.cause ? ` | cause=${String(error.cause)}` : ''}`
    : String(error);
  console.error(`VAI_HUMANEVAL_LITE_ERROR ${detail}`);
  process.exit(1);
});