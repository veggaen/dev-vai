/**
 * Visible E2E for the non-trivial Agent/council edit lane.
 *
 * Opens the exact dev-lawn sandbox, creates a disposable Agent chat, asks for
 * a small component redesign (not exact search/replace), waits for council
 * stages, verifies code + pixels + concise receipt, then reverts the revision.
 */
import puppeteer from 'puppeteer';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'C:\\Users\\v3gga\\Documents\\dev-lawn';
const TARGET_REL = 'src/lib/convex.tsx';
const TARGET_ABS = join(ROOT, TARGET_REL);
const MARKER = '1. Create or select your Convex deployment.';
const PROMPT = [
  'In src/lib/convex.tsx, improve only the MissingConvexConfig setup screen.',
  'Add a short two-item checklist beneath the environment example.',
  'First item: “1. Create or select your Convex deployment.”',
  'Second item: “2. Paste its URL in the Env panel, then restart.”',
  'Keep the provider behavior, exports, and existing copy unchanged. Apply the code change and verify the App.',
].join(' ');
const APP_URL = 'http://localhost:5173/?devAuthBypass=1';
const API = 'http://localhost:3006';
const HEADERS = { 'Content-Type': 'application/json', 'x-vai-dev-auth-bypass': '1' };
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = join('Temporary_files', 'chat-council-edit-live', STAMP);
mkdirSync(OUT, { recursive: true });

const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${step}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalizeRoot = (value) => String(value ?? '').replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
const api = async (path, init) => {
  try {
    const response = await fetch(`${API}${path}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(30_000),
      ...init,
    });
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, body: null };
  }
};
const waitForHealthyUrl = async (url, timeoutMs = 120_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
    if (response?.ok) return true;
    await sleep(1500);
  }
  return false;
};
const shot = async (page, name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  📸 ${name}.png`);
};

const beforeContent = readFileSync(TARGET_ABS, 'utf-8');
if (beforeContent.includes(MARKER)) {
  console.error('Marker already exists; refusing to run a non-reversible proof.');
  process.exit(1);
}

let project = null;
for (const item of (await api('/api/sandbox')).body ?? []) {
  const detail = await api(`/api/sandbox/${item.id}`);
  if (detail.ok && normalizeRoot(detail.body?.rootDir) === normalizeRoot(ROOT)) {
    project = { ...item, ...detail.body };
    break;
  }
}
if (!project) {
  const opened = await api('/api/sandbox/open-folder', {
    method: 'POST',
    body: JSON.stringify({ path: ROOT }),
  });
  if (!opened.ok) throw new Error('Unable to open exact dev-lawn root');
  project = opened.body;
}
log('Exact dev-lawn root resolved', true, project.id);

if (!project.devPort) {
  const started = await api(`/api/sandbox/${project.id}/start`, { method: 'POST', body: '{}' });
  if (!started.ok) throw new Error('Unable to start dev-lawn');
  project.devPort = started.body.port;
}
const serving = await waitForHealthyUrl(`http://localhost:${project.devPort}`);
log('dev-lawn is serving', serving, `:${project.devPort}`);
if (!serving) process.exit(1);

const created = await api('/api/conversations', {
  method: 'POST',
  body: JSON.stringify({
    modelId: 'vai:v0',
    title: 'Council code edit proof',
    mode: 'agent',
    sandboxProjectId: project.id,
  }),
});
if (!created.ok || !created.body?.id) throw new Error('Unable to create bound Agent chat');
const conversationId = created.body.id;
log('Disposable Agent chat bound to dev-lawn', true, conversationId);

const browser = await puppeteer.launch({
  headless: false,
  slowMo: 45,
  args: ['--no-sandbox', '--window-size=1920,1080'],
  defaultViewport: null,
});

try {
  const page = await browser.newPage();
  await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 30_000 });
  await sleep(2500);

  const selected = await page.evaluate(async (id) => {
    const store = window.__vai_chat_store;
    if (!store?.getState) return false;
    await store.getState().fetchConversations();
    await store.getState().selectConversation(id);
    const state = store.getState();
    const conversation = state.conversations.find((item) => item.id === id);
    return state.activeConversationId === id
      && conversation?.mode === 'agent'
      && Boolean(conversation?.sandboxProjectId);
  }, conversationId).catch(() => false);
  log('Exact Agent chat selected', Boolean(selected));
  if (!selected) throw new Error('Wrong chat selected');
  await sleep(2500);

  const bindingVisible = await page.evaluate(() => /dev-lawn|synced project/i.test(document.body.innerText ?? ''));
  log('Composer visibly bound to dev-lawn', bindingVisible);
  await shot(page, '01-bound-agent-chat');
  if (!bindingVisible) throw new Error('Composer binding not visible');

  const composer = await page.$('textarea');
  if (!composer) throw new Error('Composer not found');
  await composer.click();
  await page.keyboard.type(PROMPT, { delay: 4 });
  await shot(page, '02-council-prompt');
  await page.keyboard.press('Enter');
  log('Non-exact edit request sent', true);

  let councilSeen = false;
  let fileChanged = false;
  for (let attempt = 0; attempt < 360; attempt += 1) {
    await sleep(1000);
    if (!councilSeen) {
      councilSeen = await page.evaluate(() => /editing dev-lawn|reviewing the edit|static checks|repair pass/i.test(document.body.innerText ?? '')).catch(() => false);
      if (councilSeen) log('Council code pipeline visible', true);
    }
    const current = await api(`/api/sandbox/${project.id}/file?path=${encodeURIComponent(TARGET_REL)}`);
    if (current.body?.content?.includes(MARKER)) {
      fileChanged = true;
      break;
    }
    if (attempt > 0 && attempt % 60 === 0) await shot(page, `timeline-${attempt}s`);
  }
  log('Council change written to the intended file', fileChanged, TARGET_REL);
  if (!fileChanged) throw new Error('Council edit did not land');

  let completion = '';
  for (let attempt = 0; attempt < 90; attempt += 1) {
    completion = await page.evaluate(() => {
      const messages = Array.from(document.querySelectorAll('[data-chat-message-role="assistant"]'));
      return messages
        .map((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? '')
        .findLast((text) => /Done\s*[—-]\s*updated dev-lawn|Updated dev-lawn/i.test(text)) ?? '';
    }).catch(() => '');
    if (completion) break;
    await sleep(1000);
  }
  log('Concise verified project receipt appeared', Boolean(completion));
  log('Receipt avoids old implementation-package blob', !/Implementation package|What happens next/i.test(completion));
  await shot(page, '03-complete-receipt');

  let rendered = false;
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const frame = page.frames().find((candidate) => candidate.url().includes(`:${project.devPort}`));
    if (frame) {
      rendered = await frame.evaluate((marker) => document.body?.innerText?.includes(marker) ?? false, MARKER).catch(() => false);
    }
    if (rendered) break;
    await sleep(1000);
  }
  log('Council change rendered in Vai App view', rendered);
  await shot(page, '04-rendered-in-vai');

  const revisions = await api(`/api/sandbox/${project.id}/revisions?limit=3`);
  const revision = revisions.body?.revisions?.find((item) => item.files?.some((file) => file.path === TARGET_REL));
  if (!revision) throw new Error('No revision recorded for council edit');
  const diff = await api(`/api/sandbox/${project.id}/revisions/${revision.id}/diff`);
  const changedPaths = diff.body?.files?.map((file) => file.path) ?? [];
  log('Revision contains only intended file', changedPaths.length === 1 && changedPaths[0] === TARGET_REL, changedPaths.join(', '));

  const reverted = await api(`/api/sandbox/${project.id}/revisions/${revision.id}/revert`, { method: 'POST', body: '{}' });
  const restored = reverted.ok && readFileSync(TARGET_ABS, 'utf-8') === beforeContent;
  log('Council edit reverted to byte-identical source', restored);

  const passed = results.filter((item) => item.ok).length;
  console.log(`\n${passed}/${results.length} steps passed. Evidence: ${OUT}`);
  if (passed !== results.length) process.exitCode = 1;
  await sleep(8000);
} finally {
  await api(`/api/conversations/${conversationId}`, { method: 'DELETE' }).catch(() => null);
  await browser.close();
}
