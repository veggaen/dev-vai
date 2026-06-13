#!/usr/bin/env node
/**
 * Base44-style live builder probe: ask Vai to build small apps over the chat
 * WebSocket (builder mode), then mechanically evaluate the generated code —
 * file blocks present, package.json, placeholder smells — and dump each app's
 * files to a directory so a real `pnpm install && build` can verify it compiles.
 *
 * Usage: node scripts/live-probe-builder.mjs [--out c:/tmp/vai-builds] [--only N]
 */

import { WebSocket } from 'ws';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';

const baseUrl = process.env.VAI_API ?? 'http://localhost:3006';
const wsUrl = `${baseUrl.replace(/^http/i, 'ws').replace(/\/$/, '')}/api/chat?devAuthBypass=1`;
const outRoot = (() => {
  const i = process.argv.indexOf('--out');
  return resolve(i >= 0 ? process.argv[i + 1] : 'c:/tmp/vai-builds');
})();
const only = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? Number(process.argv[i + 1]) : null;
})();

const BRIEFS = [
  {
    id: 'pomodoro',
    prompt: 'Build me a pomodoro timer app: 25 minute focus / 5 minute break cycles, start/pause/reset, a task list where I can add tasks and mark which one I am focusing on, and a daily completed-pomodoros counter.',
  },
  {
    id: 'recipes',
    prompt: 'Build a recipe collection app where I can add recipes with a name, ingredients list and steps, search recipes by name or ingredient, and mark favorites.',
  },
  {
    id: 'workout-log',
    prompt: 'Build a workout log dashboard: log exercises with sets, reps and weight, see my history grouped by day, and a simple bar chart of total volume per week.',
  },
];

const FILE_BLOCK_RE = /```(\w+)?[^\n]*?title="([^"]+)"[^\n]*\n([\s\S]*?)```/g;
const PLACEHOLDER_SMELLS = [
  /TODO:? implement/i,
  /lorem ipsum/i,
  /Item 1\b/,
  /placeholder/i,
  /demo shell/i,
  /builder target/i,
  /\/\/ \.\.\. rest of/i,
  /\/\* \.\.\. \*\//,
];

function askBuilder(prompt) {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(wsUrl);
    const startedAt = Date.now();
    const out = { text: '', modelId: null, fallback: null, progress: [], error: null };
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`timeout after 360s (${out.text.length} chars so far)`));
    }, 360_000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        conversationId: `builder-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        content: prompt,
        modelId: 'vai:v0',
        mode: 'builder',
        allowLearn: false,
      }));
    });
    ws.on('message', (raw) => {
      let chunk;
      try { chunk = JSON.parse(raw.toString()); } catch { return; }
      if (chunk.type === 'text_delta' && chunk.textDelta) out.text += chunk.textDelta;
      if (chunk.type === 'fallback_notice') out.fallback = chunk.fallback;
      if (chunk.type === 'progress' && chunk.progress?.label) out.progress.push(chunk.progress.label);
      if (chunk.type === 'error') {
        out.error = chunk.error;
        clearTimeout(timer); ws.close(); resolvePromise(out); return;
      }
      if (chunk.type === 'done') {
        out.modelId = chunk.modelId ?? chunk.thinking?.modelTag ?? out.modelId;
        out.elapsedMs = Date.now() - startedAt;
        clearTimeout(timer); ws.close(); resolvePromise(out);
      }
    });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

function extractFiles(text) {
  const files = [];
  for (const match of text.matchAll(FILE_BLOCK_RE)) {
    files.push({ path: match[2].trim(), content: match[3] });
  }
  return files;
}

function evaluateFiles(files, fullText) {
  const issues = [];
  const paths = files.map((f) => f.path);
  if (files.length === 0) issues.push('NO FILE BLOCKS — answer is prose, not an app');
  if (files.length > 0 && !paths.some((p) => p.endsWith('package.json'))) issues.push('missing package.json');
  const dupes = paths.filter((p, i) => paths.indexOf(p) !== i);
  if (dupes.length) issues.push(`duplicate file paths: ${[...new Set(dupes)].join(', ')}`);
  for (const f of files) {
    for (const smell of PLACEHOLDER_SMELLS) {
      if (smell.test(f.content)) { issues.push(`placeholder smell in ${f.path}: ${smell}`); break; }
    }
    if (f.content.trim().length < 10) issues.push(`near-empty file: ${f.path}`);
  }
  const pkg = files.find((f) => f.path.endsWith('package.json'));
  if (pkg) {
    try { JSON.parse(pkg.content); } catch { issues.push('package.json is not valid JSON'); }
  }
  if (/\{\{(?:template|deploy):/.test(fullText)) issues.push('emitted a template/deploy marker instead of (or alongside) real files');
  return issues;
}

await rm(outRoot, { recursive: true, force: true }).catch(() => {});
const briefs = only !== null ? [BRIEFS[only]] : BRIEFS;

for (const brief of briefs) {
  process.stdout.write(`\n=== ${brief.id}\n>>> ${brief.prompt.slice(0, 90)}…\n`);
  try {
    const r = await askBuilder(brief.prompt);
    if (r.error) { console.log(`ERROR: ${r.error}`); continue; }
    const files = extractFiles(r.text);
    const issues = evaluateFiles(files, r.text);
    console.log(`model: ${r.modelId} | ${r.elapsedMs}ms | answer ${r.text.length} chars`);
    if (r.fallback) console.log(`route: ${r.fallback.fromModelId} -> ${r.fallback.toModelId} (${r.fallback.reason})`);
    if (r.progress.length) console.log(`progress: ${r.progress.join(' | ')}`);
    console.log(`files (${files.length}): ${files.map((f) => `${f.path} (${f.content.length}b)`).join(', ') || '—'}`);
    console.log(issues.length ? `ISSUES:\n  - ${issues.join('\n  - ')}` : 'mechanical checks: PASS');

    const appDir = join(outRoot, brief.id);
    for (const f of files) {
      const target = join(appDir, f.path.replaceAll('..', '_'));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, f.content, 'utf8');
    }
    if (files.length) console.log(`written to: ${appDir}`);
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
  }
}
