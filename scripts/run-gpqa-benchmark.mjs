#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { WebSocket } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const baseUrl = process.env.VAI_API?.trim() || 'http://localhost:3006';
const wsUrl = baseUrl.replace(/^http/i, 'ws').replace(/\/$/, '') + '/api/chat';
const datasetRoot = join(repoRoot, 'Temporary_files', 'public-bench', 'gpqa');
const zipPath = join(datasetRoot, 'dataset.zip');
const extractRoot = join(datasetRoot, 'unzipped');
const csvPath = join(extractRoot, 'dataset', 'gpqa_diamond.csv');
const defaultReportPath = join(
  repoRoot,
  'Temporary_files',
  'benchmark-reports',
  `gpqa-diamond-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
);

const officialSystemPrompt =
  'You are taking a closed-book benchmark. Answer the following multiple choice question. ' +
  "The entire content of your response should be of the following format: 'ANSWER: $LETTER' " +
  '(without quotes) where LETTER is one of A,B,C,D.';

function parseArgs(argv) {
  const args = {
    limit: null,
    concurrency: 2,
    reportFile: defaultReportPath,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--limit' && next) {
      args.limit = Number(next);
      index += 1;
    } else if (arg === '--concurrency' && next) {
      args.concurrency = Math.max(1, Number(next));
      index += 1;
    } else if (arg === '--report-file' && next) {
      args.reportFile = resolve(repoRoot, next);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/run-gpqa-benchmark.mjs [options]

Options:
  --limit <n>          Limit number of GPQA Diamond questions
  --concurrency <n>    Parallel in-flight questions (default: 2)
  --report-file <p>    JSON report path
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return args;
}

async function ensureDataset() {
  await mkdir(datasetRoot, { recursive: true });

  if (!existsSync(zipPath)) {
    const response = await fetch('https://github.com/idavidrein/gpqa/raw/main/dataset.zip');
    if (!response.ok) throw new Error(`Failed to download GPQA zip: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(zipPath, buffer);
  }

  if (!existsSync(csvPath)) {
    const extract = spawnSync(
      'python',
      [
        '-c',
        [
          'import zipfile',
          `z = zipfile.ZipFile(r"${zipPath}")`,
          `z.extractall(r"${extractRoot}", pwd=b"deserted-untie-orchid")`,
          'print("ok")',
        ].join('; '),
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    if (extract.status !== 0) {
      throw new Error(`Failed to extract GPQA zip: ${extract.stderr || extract.stdout}`);
    }
  }
}

function loadDataset() {
  const load = spawnSync(
    'python',
    [
      '-c',
      [
        'import csv, json',
        `from pathlib import Path`,
        `path = Path(r"${csvPath}")`,
        'rows = []',
        'for row in csv.DictReader(path.open(encoding="utf-8")):',
        '    rows.append({',
        '        "id": row["Record ID"],',
        '        "domain": row["High-level domain"],',
        '        "question": row["Question"],',
        '        "choices": [row["Incorrect Answer 1"], row["Incorrect Answer 2"], row["Incorrect Answer 3"], row["Correct Answer"]],',
        '        "correct_text": row["Correct Answer"],',
        '    })',
        'print(json.dumps(rows))',
      ].join('\n'),
    ],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 32 },
  );

  if (load.status !== 0) {
    throw new Error(`Failed to load GPQA CSV: ${load.stderr || load.stdout}`);
  }

  const rawRows = JSON.parse(load.stdout);
  return rawRows.map((row, index) => {
    const letters = ['A', 'B', 'C', 'D'];
    const shuffledChoices = stableShuffle(
      row.choices.map((choice) => ({ text: choice, isCorrect: choice === row.correct_text })),
      row.id || `row-${index}`,
    );
    const correctIndex = shuffledChoices.findIndex((choice) => choice.isCorrect);
    return {
      ordinal: index + 1,
      id: row.id,
      domain: row.domain,
      question: row.question,
      choices: shuffledChoices.map((choice, choiceIndex) => ({ letter: letters[choiceIndex], text: choice.text })),
      correct: letters[correctIndex],
    };
  });
}

function stableShuffle(items, seedText) {
  const pool = [...items];
  let seed = 0;
  for (let index = 0; index < seedText.length; index += 1) {
    seed = (seed * 31 + seedText.charCodeAt(index)) >>> 0;
  }

  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(next() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }

  return pool;
}

async function createConversation(title) {
  const res = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'vai:v0', mode: 'chat', title }),
  });
  if (!res.ok) throw new Error(`create conversation failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function ask(conversationId, prompt) {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let text = '';
    let settled = false;

    const finish = (value, isError = false) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {}
      if (isError) reject(value);
      else resolve(value);
    };

    const timer = setTimeout(() => finish(new Error('timeout'), true), 90_000);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          conversationId,
          content: prompt,
          systemPrompt: officialSystemPrompt,
        }),
      );
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
        finish(text);
        return;
      }
      if (msg.type === 'error') {
        clearTimeout(timer);
        finish(new Error(msg.error || 'ws error'), true);
      }
    });

    ws.on('error', (error) => {
      clearTimeout(timer);
      finish(error, true);
    });

    ws.on('close', () => {
      clearTimeout(timer);
      if (!settled) finish(text || '[closed before done]');
    });
  });
}

async function retry(label, attempts, fn) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const transient = /timeout|ECONNRESET|fetch failed|socket hang up|network|closed before done|ws error/i.test(message);
      if (!transient || attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      console.warn(`${label} retry ${attempt}/${attempts} after transient error: ${message}`);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function extractLetter(text) {
  const match =
    text.trim().match(/^ANSWER:\s*([A-D])$/i) ||
    text.match(/^([A-D])$/im) ||
    text.match(/ANSWER:\s*([A-D])/i);
  return match ? match[1].toUpperCase() : null;
}

function buildPrompt(item) {
  return [
    item.question.trim(),
    '',
    ...item.choices.map((choice, index) => `${index + 1}. ${choice.text}`),
  ].join('\n');
}

async function runOne(item) {
  const startedAt = Date.now();
  const conversation = await retry(`conversation-${item.ordinal}`, 3, () =>
    createConversation(`gpqa-diamond-${item.ordinal}`),
  );
  const answer = await retry(`question-${item.ordinal}`, 3, () =>
    ask(conversation.id, buildPrompt(item)),
  );
  const chosen = extractLetter(answer);
  return {
    id: item.id,
    domain: item.domain,
    correct: item.correct,
    chosen,
    pass: chosen === item.correct,
    latencyMs: Date.now() - startedAt,
    formatOk: /^ANSWER:\s*[A-D]\s*$/i.test(answer.trim()),
  };
}

async function runPool(items, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;

      const result = await runOne(items[index]);
      results[index] = result;
      completed += 1;

      if (completed % 10 === 0 || completed === items.length) {
        const passed = results.filter(Boolean).filter((entry) => entry.pass).length;
        console.log(`GPQA progress ${completed}/${items.length} passed=${passed}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await ensureDataset();

  const health = await fetch(`${baseUrl}/health`);
  if (!health.ok) throw new Error(`Runtime health failed: ${health.status}`);

  const dataset = loadDataset();
  const items = args.limit ? dataset.slice(0, args.limit) : dataset;
  const startedAt = Date.now();
  const results = await runPool(items, args.concurrency);
  const passed = results.filter((result) => result.pass).length;
  const formatOk = results.filter((result) => result.formatOk).length;
  const accuracy = items.length ? passed / items.length : 0;
  const avgLatencyMs = results.length
    ? Math.round(results.reduce((sum, result) => sum + result.latencyMs, 0) / results.length)
    : 0;

  const report = {
    benchmark: 'gpqa-diamond',
    baseUrl,
    modelId: 'vai:v0',
    total: items.length,
    passed,
    accuracy,
    formatOk,
    formatAccuracy: items.length ? formatOk / items.length : 0,
    avgLatencyMs,
    elapsedMs: Date.now() - startedAt,
    results,
  };

  await mkdir(dirname(args.reportFile), { recursive: true });
  await writeFile(args.reportFile, JSON.stringify(report, null, 2), 'utf8');

  console.log(`GPQA final passed=${passed}/${items.length} accuracy=${accuracy.toFixed(3)} format=${formatOk}/${items.length}`);
  console.log(`Report: ${args.reportFile}`);
}

main().catch((error) => {
  console.error('GPQA benchmark failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
