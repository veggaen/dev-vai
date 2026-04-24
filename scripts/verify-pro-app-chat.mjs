#!/usr/bin/env node
/**
 * Live verification: Builder chat → extract title= file blocks → sandbox install → dev server → HTTP check.
 *
 *   node scripts/verify-pro-app-chat.mjs
 *   node scripts/verify-pro-app-chat.mjs --text-only
 *   node scripts/verify-pro-app-chat.mjs http://127.0.0.1:3006
 *
 * Env: VAI_API (default http://127.0.0.1:3006), VAI_VERIFY_MODEL (default vai:v0)
 */

const DEFAULT_BASE = process.env.VAI_API?.trim() || 'http://127.0.0.1:3006';

function toWsUrl(baseUrl) {
  return baseUrl.replace(/^http/i, 'ws').replace(/\/$/, '');
}

function parseArgs(argv) {
  let baseUrl = DEFAULT_BASE;
  let textOnly = false;
  for (const a of argv) {
    if (a === '--text-only') textOnly = true;
    else if (/^https?:\/\//i.test(a)) baseUrl = a.replace(/\/$/, '');
  }
  return { baseUrl, textOnly };
}

/** Same rules as apps/desktop/src/lib/file-extractor.ts */
const PATH_ATTRIBUTE_REGEX = /\b(?:title|path|file|filename)=["']([^"']+)["']/i;
function normalizeExtractedPath(filePath) {
  return filePath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^(?:\.\/)+/, '')
    .replace(/\/{2,}/g, '/');
}

function extractFilesFromMarkdown(markdown) {
  const files = [];
  const regex = /```([^\r\n`]*)\r?\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const info = match[1].trim();
    const pathMatch = info.match(PATH_ATTRIBUTE_REGEX);
    if (!pathMatch) continue;
    const path = normalizeExtractedPath(pathMatch[1]);
    if (!path) continue;
    const content = match[2].trimEnd();
    const existingIdx = files.findIndex((f) => f.path === path);
    if (existingIdx >= 0) files[existingIdx] = { path, content };
    else files.push({ path, content });
  }
  return files;
}

async function fetchHealth(baseUrl) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/health`);
  if (!res.ok) throw new Error(`/health ${res.status}`);
  return res.json();
}

async function createConversation(baseUrl, modelId, mode) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelId,
      mode: mode ?? 'builder',
      title: 'verify-pro-app-chat',
    }),
  });
  if (!res.ok) throw new Error(`create conversation: ${res.status} ${await res.text()}`);
  return res.json();
}

function askOnce(baseUrl, conversationId, content, timeoutMs = 180_000) {
  const wsUrl = `${toWsUrl(baseUrl)}/api/chat`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let text = '';
    const t = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      reject(new Error('websocket timeout'));
    }, timeoutMs);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ conversationId, content }));
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.type === 'text_delta' && msg.textDelta) text += msg.textDelta;
      if (msg.type === 'done') {
        clearTimeout(t);
        ws.close();
        resolve(text);
      }
      if (msg.type === 'error') {
        clearTimeout(t);
        reject(new Error(msg.error || 'ws error'));
      }
    });
    ws.addEventListener('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

function scoreProAppAnswer(answer) {
  const hasTitleBlock = /title="[^"]+"/.test(answer);
  const hasPackageJson =
    /title="package\.json"/i.test(answer) || /```json[\s\S]*package\.json/i.test(answer);
  const hasReactish =
    /\b(jsx|tsx|react|vite)\b/i.test(answer) || /<[A-Z][a-zA-Z]*/.test(answer);
  const hasStructure =
    /\b(component|layout|sidebar|dashboard|route|export default function)\b/i.test(answer);
  const wordCount = answer.split(/\s+/).filter(Boolean).length;

  return {
    hasTitleBlock,
    hasPackageJson,
    hasReactish,
    hasStructure,
    wordCount,
    charCount: answer.length,
  };
}

async function writeSandboxFiles(baseUrl, projectId, files) {
  const res = await fetch(`${baseUrl}/api/sandbox/${projectId}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files }),
  });
  if (!res.ok) throw new Error(`write files: ${res.status} ${await res.text()}`);
  return res.json();
}

async function installSandbox(baseUrl, projectId) {
  const res = await fetch(`${baseUrl}/api/sandbox/${projectId}/install`, { method: 'POST' });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(`install failed: ${JSON.stringify(json)}`);
  }
  return json;
}

async function startSandbox(baseUrl, projectId) {
  const res = await fetch(`${baseUrl}/api/sandbox/${projectId}/start`, { method: 'POST' });
  if (!res.ok) throw new Error(`start: ${res.status} ${await res.text()}`);
  return res.json();
}

async function getSandbox(baseUrl, projectId) {
  const res = await fetch(`${baseUrl}/api/sandbox/${projectId}`);
  if (!res.ok) throw new Error(`get sandbox: ${res.status} ${await res.text()}`);
  return res.json();
}

async function waitForRunning(baseUrl, projectId, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const j = await getSandbox(baseUrl, projectId);
    if (j.status === 'failed') {
      throw new Error(`sandbox failed: ${JSON.stringify(j.logs?.slice?.(-8) ?? j)}`);
    }
    if (j.status === 'running' && j.devPort) {
      return j;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('timeout waiting for dev server (status running + devPort)');
}

async function fetchPreview(port, timeoutMs = 60_000) {
  const hosts = ['127.0.0.1', 'localhost'];
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    for (const host of hosts) {
      const url = `http://${host}:${port}/`;
      try {
        const res = await fetch(url, { redirect: 'follow' });
        const text = await res.text();
        if (res.ok && text.length >= 80) {
          return { ok: true, status: res.status, url, text };
        }
        lastErr = new Error(`HTTP ${res.status} len=${text.length}`);
      } catch (e) {
        lastErr = e;
      }
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw lastErr ?? new Error('preview fetch timeout');
}

async function main() {
  const { baseUrl, textOnly } = parseArgs(process.argv.slice(2));
  await fetchHealth(baseUrl);

  const modelId = process.env.VAI_VERIFY_MODEL?.trim() || 'vai:v0';
  const conv = await createConversation(baseUrl, modelId, 'builder');
  const conversationId = conv.id;
  const sandboxProjectId = conv.sandboxProjectId;
  if (!conversationId) {
    console.error('No conversation id:', conv);
    process.exit(1);
  }
  if (!sandboxProjectId) {
    console.error('Expected builder sandboxProjectId:', conv);
    process.exit(1);
  }

  const prompt = [
    'Build a minimal but polished SaaS-style dashboard shell for the web:',
    'React + TypeScript + Vite, left sidebar (Dashboard, Projects, Settings),',
    'top bar with a user menu placeholder, main area with three KPI stat cards and a simple data table.',
    'Neutral light theme, CSS variables, accessible landmarks.',
    'Output complete runnable files using fenced blocks with title="path/to/file" on each block.',
    'Include package.json with dependencies.',
  ].join(' ');

  console.log('verify-pro-app-chat: asking builder (this may take 1–3 min)...');
  const answer = await askOnce(baseUrl, conversationId, prompt);
  const s = scoreProAppAnswer(answer);

  console.log('\n--- text metrics ---');
  console.log(JSON.stringify(s, null, 2));

  const textPass =
    s.charCount >= 800 &&
    s.hasTitleBlock &&
    (s.hasPackageJson || s.wordCount > 120) &&
    s.hasReactish &&
    s.hasStructure;

  if (!textPass) {
    console.error('\nverify-pro-app-chat: FAIL (text criteria)');
    console.error('--- answer preview (first 2500 chars) ---\n', answer.slice(0, 2500));
    process.exit(1);
  }

  if (textOnly) {
    console.log('\nverify-pro-app-chat: PASS (text-only) — skipping sandbox run.');
    process.exit(0);
  }

  const extracted = extractFilesFromMarkdown(answer);
  console.log('\n--- extracted files ---');
  console.log(extracted.map((f) => f.path).join('\n') || '(none)');

  if (extracted.length < 2) {
    console.error('verify-pro-app-chat: FAIL — need at least 2 titled file blocks for a runnable app.');
    process.exit(1);
  }

  const hasPkg = extracted.some((f) => f.path === 'package.json' || f.path.endsWith('/package.json'));
  if (!hasPkg) {
    console.error('verify-pro-app-chat: FAIL — no package.json block.');
    process.exit(1);
  }

  console.log('\nverify-pro-app-chat: writing to sandbox', sandboxProjectId, '...');
  await writeSandboxFiles(baseUrl, sandboxProjectId, extracted);

  console.log('verify-pro-app-chat: pnpm install ...');
  await installSandbox(baseUrl, sandboxProjectId);

  console.log('verify-pro-app-chat: starting dev server ...');
  await startSandbox(baseUrl, sandboxProjectId);

  const running = await waitForRunning(baseUrl, sandboxProjectId);
  const port = running.devPort;
  console.log('verify-pro-app-chat: server reports port', port);

  let preview;
  try {
    preview = await fetchPreview(port);
  } catch (e) {
    console.error('verify-pro-app-chat: FAIL — could not load preview after dev server start:', e?.message ?? e);
    process.exit(1);
  }

  const looksLikeApp =
    /<(!doctype|html|div|body)/i.test(preview.text) ||
    /import\.meta|vite|react|root/i.test(preview.text);
  if (!looksLikeApp) {
    console.error('verify-pro-app-chat: FAIL — preview does not look like a web app shell');
    console.error(preview.text.slice(0, 500));
    process.exit(1);
  }

  console.log('\nverify-pro-app-chat: PASS — builder output applied; dev server served HTML at', preview.url);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
