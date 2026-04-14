/**
 * vai-browser-test.mjs — End-to-end Vai test
 *
 * 1. Creates a builder conversation via API
 * 2. Asks Vai to build a Next.js todo app
 * 3. Extracts file blocks from response, writes to sandbox, installs, starts
 * 4. Polls until dev server is running
 * 5. Opens Chromium — shows live preview
 * 6. Interacts with the app (add/complete/delete todos)
 * 7. Asks Vai to iterate (add priority + count)
 * 8. Writes updated files, waits for hot reload
 * 9. Screenshots at every step
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(__dirname, '..', 'test-screenshots');
mkdirSync(SHOTS_DIR, { recursive: true });

const RUNTIME = 'http://localhost:3006';
const WS_RUNTIME = 'ws://localhost:3006';
const VAI_UI = 'http://localhost:5173';

// ── File extractor ─────────────────────────────────────────────────────────
const PATH_ATTR_RE = /\b(?:title|path|file|filename)=["']([^"']+)["']/i;
function extractFiles(markdown) {
  const files = [];
  const re = /```([^\r\n`]*)\r?\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    const info = m[1].trim();
    const pathMatch = info.match(PATH_ATTR_RE);
    if (!pathMatch) continue;
    const path = pathMatch[1].trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '');
    if (!path) continue;
    const content = m[2].trimEnd();
    const idx = files.findIndex(f => f.path === path);
    if (idx >= 0) files[idx] = { path, content };
    else files.push({ path, content });
  }
  return files;
}

// ── Helpers ────────────────────────────────────────────────────────────────
let shotIndex = 0;
async function shot(page, label) {
  const file = join(SHOTS_DIR, `${String(shotIndex++).padStart(2, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  📸 ${label}`);
  return file;
}

const wait = ms => new Promise(r => setTimeout(r, ms));

async function api(path, opts = {}) {
  const headers = opts.body
    ? { 'Content-Type': 'application/json', ...(opts.headers ?? {}) }
    : { ...(opts.headers ?? {}) };
  const res = await fetch(`${RUNTIME}${path}`, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function askVai(conversationId, content) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_RUNTIME}/api/chat`);
    let fullText = '';
    const timeout = setTimeout(() => { ws.close(); reject(new Error('Vai timeout 120s')); }, 120_000);
    ws.on('open', () => ws.send(JSON.stringify({ conversationId, content })));
    ws.on('message', raw => {
      const c = JSON.parse(raw.toString());
      if (c.type === 'text_delta') { process.stdout.write(c.textDelta ?? ''); fullText += c.textDelta ?? ''; }
      if (c.type === 'done') { clearTimeout(timeout); ws.close(); resolve(fullText); }
      if (c.type === 'error') { clearTimeout(timeout); ws.close(); reject(new Error(c.error)); }
    });
    ws.on('error', e => { clearTimeout(timeout); reject(e); });
  });
}

function parseTemplateAction(text) {
  const m = text.match(/\{\{template:([^:]+):([^}]+)\}\}/);
  return m ? { stackId: m[1], tier: m[2].trim() } : null;
}

async function deployStack(stackId, tier, name) {
  console.log(`  Deploying ${stackId}/${tier} as "${name}"...`);
  const res = await fetch(`${RUNTIME}/api/sandbox/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stackId, tier, name }),
  });
  if (!res.ok) throw new Error(`Deploy ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let projectId = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    for (const line of buf.split('\n').slice(0, -1)) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        const icon = ev.type === 'done' ? '✅' : ev.type === 'error' ? '❌' : '·';
        console.log(`  ${icon} ${ev.step ?? ''} ${ev.message ?? ev.error ?? ''}`);
        if (ev.projectId) projectId = ev.projectId;
      } catch { }
    }
    buf = buf.split('\n').slice(-1)[0] ?? '';
  }
  return projectId;
}

async function pollSandbox(projectId, maxMs = 240_000) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < maxMs) {
    const data = await api(`/api/sandbox/${projectId}`).catch(() => null);
    if (!data) { await wait(2000); continue; }
    if (data.status !== last) {
      console.log(`  [${data.status}] port: ${data.devPort ?? '—'}`);
      if (data.devStderr?.length) console.log(`  [stderr] ${data.devStderr.slice(-2).join(' | ')}`);
      last = data.status;
    }
    if (data.status === 'running' && data.devPort) return data;
    if (data.status === 'failed') return data;
    await wait(2000);
  }
  return null;
}

// ── Model picker ──────────────────────────────────────────────────────────
async function pickBestModel() {
  const models = await api('/api/models').catch(() => []);
  const PREFER = [
    'anthropic:claude-sonnet-4-6',
    'anthropic:claude-sonnet-4-20250514',
    'anthropic:claude-opus-4-6',
    'openai:gpt-4o',
    'google:gemini-2.5-flash',
    'vai:v0',
  ];
  for (const id of PREFER) {
    if (models.some(m => m.id === id)) return id;
  }
  return models[0]?.id ?? 'vai:v0';
}

// ── Main ────────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n' + '═'.repeat(60));
  console.log('  Vai End-to-End Browser Test');
  console.log('═'.repeat(60) + '\n');

  // 0. Pick best model
  console.log('0️⃣  Detecting best available model...');
  const modelId = await pickBestModel();
  console.log(`  Using: ${modelId}\n`);

  // 1. Create builder conversation
  console.log('1️⃣  Creating builder conversation...');
  const conv = await api('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ modelId, mode: 'builder' }),
  });
  console.log(`  conv: ${conv.id}\n`);

  // 2. Ask Vai
  console.log('2️⃣  Asking Vai to build a Next.js todo app...');
  console.log('─'.repeat(60));
  const response1 = await askVai(
    conv.id,
    `Build a Next.js 14 App Router todo app.

Features:
- Add todos (text input + Enter or button)
- Mark complete (checkbox — strikethrough style)
- Delete todos (× button)
- Tailwind CSS, clean modern UI

Output ALL files using title="path/to/file" in the code fence info string, like:
\`\`\`tsx title="src/app/page.tsx"
...code...
\`\`\`

Required files (use "use client" directive on the page):
1. title="package.json" — Next.js 14 + tailwindcss + postcss
2. title="src/app/layout.tsx"
3. title="src/app/globals.css" — tailwind directives
4. title="src/app/page.tsx" — the full todo app with useState, add/complete/delete
5. title="tailwind.config.ts"
6. title="postcss.config.js"

DO NOT emit template actions. Output the actual file contents now.`,
  );
  console.log('\n' + '─'.repeat(60) + '\n');

  // 3. Parse + deploy
  console.log('3️⃣  Parsing response and setting up sandbox...');
  let projectId = null;

  const templateAction = parseTemplateAction(response1);
  const files = extractFiles(response1);

  console.log(`  Template action: ${templateAction ? `${templateAction.stackId}/${templateAction.tier}` : 'none'}`);
  console.log(`  File blocks: ${files.length}`);
  files.forEach(f => console.log(`    - ${f.path}`));

  if (templateAction && files.length === 0) {
    // Vai only gave a template — scaffold base then ask for files
    const stackId = templateAction.stackId === 'nextjs' ? 'nextjs' : templateAction.stackId;
    const tier = templateAction.tier.toLowerCase().includes('fresh') || templateAction.tier.toLowerCase().includes('basic') ? 'basic' : 'basic';
    projectId = await deployStack(stackId, tier, 'todo-nextjs');
    if (!projectId) {
      const sandboxes = await api('/api/sandbox');
      projectId = sandboxes.at(-1)?.id;
    }
    // Now ask Vai specifically for the todo app files
    console.log('\n  Template scaffolded — asking Vai for todo app code...');
    console.log('─'.repeat(60));
    const response1b = await askVai(
      conv.id,
      'Now write the actual todo app. Replace src/app/page.tsx (or app/page.tsx) with a full working todo list component: add/complete/delete todos with Tailwind styling. Output only the changed files with title= attributes.',
    );
    console.log('\n' + '─'.repeat(60));
    const extraFiles = extractFiles(response1b);
    console.log(`  Got ${extraFiles.length} files from follow-up`);
    if (extraFiles.length > 0 && projectId) {
      await api(`/api/sandbox/${projectId}/files`, {
        method: 'POST',
        body: JSON.stringify({ files: extraFiles.map(f => ({ path: f.path, content: f.content })) }),
      });
      console.log('  Files written — restarting dev server...');
      await api(`/api/sandbox/${projectId}/stop`, { method: 'POST' }).catch(() => {});
      await wait(1000);
      await api(`/api/sandbox/${projectId}/start`, { method: 'POST' }).catch(e => console.log('  start err:', e.message));
    }
  } else if (files.length > 0) {
    // Vai gave us files directly
    const proj = await api('/api/sandbox', { method: 'POST', body: JSON.stringify({ name: 'todo-app' }) });
    projectId = proj.id;
    console.log(`  Created sandbox: ${projectId}`);

    await api(`/api/sandbox/${projectId}/files`, {
      method: 'POST',
      body: JSON.stringify({ files: files.map(f => ({ path: f.path, content: f.content })) }),
    });
    console.log(`  Wrote ${files.length} files`);

    console.log('  Installing dependencies...');
    const installRes = await api(`/api/sandbox/${projectId}/install`, { method: 'POST' });
    console.log(`  Install: ${installRes.success ? '✅' : '❌'}`);

    console.log('  Starting dev server...');
    const startRes = await api(`/api/sandbox/${projectId}/start`, { method: 'POST' });
    console.log(`  Dev server spawned on port ${startRes.port}`);
  }

  // 4. Poll for running
  let sandboxState = null;
  if (projectId) {
    console.log(`\n4️⃣  Polling sandbox ${projectId}...`);
    sandboxState = await pollSandbox(projectId);
    console.log(`\n  → ${sandboxState?.status} | port: ${sandboxState?.devPort ?? '—'}`);
  }

  // 5. Open browser
  console.log('\n5️⃣  Launching Chromium...');
  const browser = await chromium.launch({
    headless: false,
    slowMo: 80,
    args: ['--window-size=1400,900', '--window-position=0,0'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const uiPage = await ctx.newPage();
  await uiPage.goto(VAI_UI, { waitUntil: 'domcontentloaded' });
  await wait(1500);
  await shot(uiPage, '01-vai-ui');

  if (sandboxState?.status === 'running' && sandboxState?.devPort) {
    const port = sandboxState.devPort;

    // 6. Preview
    console.log(`\n6️⃣  Opening preview at http://localhost:${port}...`);
    const previewPage = await ctx.newPage();
    await previewPage.goto(`http://localhost:${port}`, { waitUntil: 'networkidle', timeout: 20000 })
      .catch(e => console.log('  load:', e.message));
    await wait(2000);
    await shot(previewPage, '02-app-loaded');

    // 7. Interact
    console.log('\n7️⃣  Interacting with the app...');
    const inputSel = 'input[type="text"], input[placeholder*="todo" i], input[placeholder*="add" i], input[placeholder*="task" i]';
    const addInput = previewPage.locator(inputSel).first();
    const hasInput = await addInput.isVisible({ timeout: 4000 }).catch(() => false);

    if (hasInput) {
      await addInput.fill('Buy groceries');
      await previewPage.keyboard.press('Enter');
      await wait(600);
      await addInput.fill('Read a book');
      await previewPage.keyboard.press('Enter');
      await wait(600);
      await addInput.fill('Go for a run');
      await previewPage.keyboard.press('Enter');
      await wait(800);
      await shot(previewPage, '03-three-todos');

      // Try marking first todo done
      const firstCb = previewPage.locator('input[type="checkbox"]').first();
      if (await firstCb.isVisible({ timeout: 2000 }).catch(() => false)) {
        await firstCb.click();
        await wait(600);
        await shot(previewPage, '04-todo-completed');
      }

      // Try delete
      const deleteBtn = previewPage.locator('button').filter({ hasText: /delete|remove|×|✕/i }).first();
      if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await deleteBtn.click();
        await wait(600);
        await shot(previewPage, '05-todo-deleted');
      }
    } else {
      console.log('  No text input found — capturing page structure');
      await shot(previewPage, '03-app-ui');
    }

    // 8. Iterate
    console.log('\n8️⃣  Asking Vai to add priority levels + remaining count...');
    console.log('─'.repeat(60));
    const response2 = await askVai(
      conv.id,
      'Add two improvements: (1) A priority selector per todo — Low/Medium/High — with green/yellow/red color badge. (2) A header showing "X todos remaining". Output only the files that changed with title= attributes.',
    );
    console.log('\n' + '─'.repeat(60));

    const updatedFiles = extractFiles(response2);
    console.log(`  Got ${updatedFiles.length} updated file(s)`);
    updatedFiles.forEach(f => console.log(`    - ${f.path}`));

    if (updatedFiles.length > 0 && projectId) {
      await api(`/api/sandbox/${projectId}/files`, {
        method: 'POST',
        body: JSON.stringify({ files: updatedFiles.map(f => ({ path: f.path, content: f.content })) }),
      });
      console.log('  Files written — waiting for hot reload...');
      await wait(5000);
      await previewPage.reload({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
      await wait(2000);
      await shot(previewPage, '06-after-iteration');

      // Re-add todos to test new priority UI
      const addInput2 = previewPage.locator(inputSel).first();
      if (await addInput2.isVisible({ timeout: 3000 }).catch(() => false)) {
        await addInput2.fill('Test priority feature');
        await previewPage.keyboard.press('Enter');
        await wait(1000);
        await shot(previewPage, '07-iteration-working');
      }
    } else {
      console.log('  No file blocks in iteration response — checking if template action');
      if (parseTemplateAction(response2)) console.log('  (Vai suggested a new template — skipping)');
      await shot(previewPage, '06-no-iteration-files');
    }

    await wait(2000);
    await shot(previewPage, '08-final-state');

    console.log('\n' + '═'.repeat(60));
    console.log('✅ Test complete!');
    console.log(`  Live app:      http://localhost:${port}`);
    console.log(`  Screenshots:   ${SHOTS_DIR}`);
    console.log('═'.repeat(60));
  } else {
    console.log(`\n⚠️  Sandbox not running (${sandboxState?.status ?? 'unknown'})`);
    if (sandboxState?.devStderr?.length) {
      console.log('Dev stderr:\n' + sandboxState.devStderr.join('\n'));
    }
    await shot(uiPage, '02-failed');
  }

  await uiPage.bringToFront();
  await shot(uiPage, '09-vai-ui-final');

  console.log('\n  Keeping browser open 60s...');
  await wait(60000);
  await browser.close();
})().catch(err => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
