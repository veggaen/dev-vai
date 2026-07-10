/**
 * LIVE PROOF: chat → council edits real project code → HMR → pixels change.
 *
 * Creates a disposable Agent conversation bound to the exact mpm-frontend
 * sandbox id. It is deleted after the proof so chat history stays clean.
 * The prompt quotes visible text and names NO file — the content-search context
 * enrichment must find app/page.tsx by itself, and the council edit must patch it.
 * Afterwards the change is reverted via the revisions API.
 */
import puppeteer from 'puppeteer';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const APP_URL = 'http://localhost:5173/?devAuthBypass=1';
const API = 'http://localhost:3006';
const HEADERS = { 'Content-Type': 'application/json', 'x-vai-dev-auth-bypass': '1' };
const TARGET_FILE = 'C:\\Users\\v3gga\\Documents\\DEV_MPM\\mpm-frontend\\app\\page.tsx';
const OLD_TEXT = 'an on-chain token launch you can inspect.';
const NEW_TEXT = 'an on-chain launch you can verify.';
const PROMPT = `Change the "${OLD_TEXT}" text to "${NEW_TEXT}". Keep everything else exactly the same.`;

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = join('Temporary_files', 'chat-edit-live', STAMP);
mkdirSync(OUT, { recursive: true });

const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok });
  console.log(`${ok ? '✓' : '✗'} ${step}${detail ? ` — ${detail}` : ''}`);
};
const shot = async (page, name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  📸 ${name}.png`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitForHealthyUrl = async (url, timeoutMs = 100_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) }).catch(() => null);
    if (response?.ok) return response;
    await sleep(1500);
  }
  return null;
};
const api = async (path, init) => {
  const res = await fetch(`${API}${path}`, { headers: HEADERS, ...init });
  return { ok: res.ok, body: await res.json().catch(() => null) };
};

// ── STRICT PRECONDITIONS — never send an edit into the wrong workspace ──
// 1. The project must resolve by ROOT DIRECTORY (names can collide).
const MPM_ROOT = 'C:\\Users\\v3gga\\Documents\\DEV_MPM\\mpm-frontend';
const normalizeRoot = (value) => String(value ?? '').replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
let project = null;
{
  const list = await api('/api/sandbox');
  for (const p of list.body ?? []) {
    const detail = await api(`/api/sandbox/${p.id}`);
    if (detail.ok && normalizeRoot(detail.body?.rootDir) === normalizeRoot(MPM_ROOT)) {
      project = { ...p, ...detail.body };
      break;
    }
  }
}
if (!project) {
  // Not registered in this runtime life — open it explicitly by path (silent, no UI).
  const opened = await api('/api/sandbox/open-folder', { method: 'POST', body: JSON.stringify({ path: MPM_ROOT }) });
  if (!opened.ok) { console.error('Could not open mpm-frontend:', opened.body?.error); process.exit(1); }
  project = opened.body;
}
log('Project resolved by root', true, `${project.id} (${MPM_ROOT})`);

// 2. Dev server must be RUNNING before any edit — start it if needed.
if (!project.devPort) {
  const started = await api(`/api/sandbox/${project.id}/start`, { method: 'POST', body: '{}' });
  if (!started.ok) { console.error('Dev server failed to start'); process.exit(1); }
  project.devPort = started.body.port;
  await sleep(15_000); // first compile
}
const health = await waitForHealthyUrl(`http://localhost:${project.devPort}`);
if (!health?.ok) { console.error(`App not serving on :${project.devPort} — aborting before any message is sent`); process.exit(1); }
log('Dev server serving', true, `:${project.devPort}`);

// 3. The file must contain the text we intend to change.
const baseVersion = project.version ?? 0;
if (!readFileSync(TARGET_FILE, 'utf-8').includes(OLD_TEXT)) {
  console.error('Original text not found on disk — aborting');
  process.exit(1);
}
log('Original text on disk', true);

// Create one disposable Agent chat bound to this exact sandbox id. The browser
// selects it through Dev-Vai's real store before a single keystroke.
const createdConversation = await api('/api/conversations', {
  method: 'POST',
  body: JSON.stringify({
    modelId: 'vai:v0',
    title: 'Chat to software proof',
    mode: 'agent',
    sandboxProjectId: project.id,
  }),
});
if (!createdConversation.ok || !createdConversation.body?.id) {
  console.error('Could not create the bound Agent proof chat');
  process.exit(1);
}
const proofConversationId = createdConversation.body.id;
log('Disposable Agent chat bound to exact project id', true, `${proofConversationId} -> ${project.id}`);

const browser = await puppeteer.launch({
  headless: false,
  slowMo: 40,
  args: ['--no-sandbox', '--window-size=1920,1080'],
  defaultViewport: null,
});

try {
  const page = await browser.newPage();
  await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 30_000 });
  await sleep(2500);

  // 4. Select the conversation BOUND to this project (newest first in sidebar).
  //    Fresh sessions start with the sidebar collapsed to the icon rail —
  //    expand it first (chat icon), then poll for the conversation list.
  const sidebarOpen = async () => page.evaluate(() => /New Chat|SESSIONS/i.test(document.body.innerText ?? ''));
  if (!(await sidebarOpen())) {
    await page.evaluate(() => {
      // Rail icons live on the far left — click candidates until one opens the list.
      const railButtons = Array.from(document.querySelectorAll('button'))
        .filter((b) => { const r = b.getBoundingClientRect(); return r.left < 60 && r.top < 300 && r.width > 0; });
      railButtons[1]?.click(); // chats icon is the second rail item
    }).catch(() => {});
    await sleep(1200);
    if (!(await sidebarOpen())) {
      await page.evaluate(() => {
        const railButtons = Array.from(document.querySelectorAll('button'))
          .filter((b) => { const r = b.getBoundingClientRect(); return r.left < 60 && r.width > 0; });
        for (const btn of railButtons.slice(0, 4)) btn.click();
      }).catch(() => {});
      await sleep(1200);
    }
  }
  log('Sidebar expanded', await sidebarOpen());

  const selectedExactChat = await page.evaluate(async (conversationId) => {
    const store = window.__vai_chat_store;
    if (!store?.getState) return false;
    await store.getState().fetchConversations();
    await store.getState().selectConversation(conversationId);
    const state = store.getState();
    const conversation = state.conversations.find((item) => item.id === conversationId);
    return state.activeConversationId === conversationId
      && Boolean(conversation?.sandboxProjectId)
      && conversation?.mode === 'agent';
  }, proofConversationId).catch(() => false);
  log('Exact project-bound Agent chat selected', Boolean(selectedExactChat));
  if (!selectedExactChat) throw new Error('Dev-Vai did not select the exact bound Agent chat');
  await sleep(2500);

  // 5. The COMPOSER must visibly confirm the project binding before typing —
  //    the "synced project" chip / project name near the input is the contract
  //    that this turn will carry sandbox context.
  let bindingVisible = false;
  for (let i = 0; i < 20; i += 1) {
    bindingVisible = await page.evaluate(() => {
      const composerArea = document.querySelector('textarea')?.closest('div[class*="rounded"]')?.parentElement;
      const scope = composerArea ?? document.body;
      return /mpm-frontend|synced project/i.test(scope.textContent ?? '');
    }).catch(() => false);
    if (bindingVisible) break;
    await sleep(1000);
  }
  log('Composer shows project binding', bindingVisible);
  await shot(page, '01-conversation-open');
  if (!bindingVisible) throw new Error('Composer never showed the project binding — refusing to send into an unbound chat');

  const composer = await page.$('textarea');
  if (!composer) throw new Error('composer not found');
  await composer.click();
  await page.keyboard.type(PROMPT, { delay: 6 });
  await shot(page, '02-prompt');
  await page.keyboard.press('Enter');
  log('Prompt sent (quoted text, NO file named)', true);

  // Watch for Vai's edit pipeline doing real work + the file changing on disk.
  let fileChanged = false;
  let editPipelineSeen = false;
  for (let i = 0; i < 480; i += 1) {
    await sleep(1000);
    if (!editPipelineSeen) {
      editPipelineSeen = await page.evaluate(() =>
        Array.from(document.querySelectorAll('*')).some((el) =>
          /editing app\/page\.tsx|exact, reversible text edit|targeted updates/i.test(el.textContent?.slice(0, 200) ?? '')
          && el.children.length === 0,
        )).catch(() => false);
      if (editPipelineSeen) log('Vai edit pipeline visibly working', true);
    }
    try {
      if (readFileSync(TARGET_FILE, 'utf-8').includes(NEW_TEXT)) { fileChanged = true; break; }
    } catch { /* transient read */ }
    if (i > 0 && i % 45 === 0) { await shot(page, `timeline-${i}s`); }
    if (i === 120) console.log('  …2min, still waiting');
    if (i === 300) console.log('  …5min, still waiting');
  }
  log('page.tsx changed on disk by the council', fileChanged);
  await shot(page, '03-after-turn');

  // What did Vai SAY? Capture the last assistant message text for the report.
  let assistantText = '';
  for (let attempt = 0; attempt < 75; attempt += 1) {
    assistantText = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('[data-chat-message-role="assistant"]'));
      const texts = nodes.map((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? '').filter(Boolean);
      return texts.findLast((text) => /Complete\s*[—-]\s*updated app\/page\.tsx/i.test(text)) ?? '';
    }).catch(() => '');
    if (assistantText) break;
    await sleep(1000);
  }
  log('Concise completion response appeared', Boolean(assistantText));
  log('Completion response avoids the old package blob', !/Implementation package|What happens next/i.test(assistantText));
  log('Completion response agrees with live preview proof', !/stopped responding|preview needs attention/i.test(assistantText));
  await shot(page, '03b-completion-response');
  console.log(`\n💬 Vai's response (tail): ${assistantText.slice(0, 400)}\n`);

  if (fileChanged) {
    // What code was written? Fetch the recorded revision diff.
    const revs = await api(`/api/sandbox/${project.id}/revisions?limit=1`);
    const lastRev = revs.body?.revisions?.[0];
    if (lastRev) {
      const diff = await api(`/api/sandbox/${project.id}/revisions/${lastRev.id}/diff`);
      const files = diff.body?.files ?? [];
      console.log(`📝 Code written: ${files.map((f) => `${f.path} (+${f.added}/−${f.removed})`).join(', ') || '(no diff recorded)'}`);
    }

    // HMR pixel proof straight from the running app — re-fetch devPort, the
    // server may have been (re)started by attachProject after the runtime reboot.
    const fresh = await api(`/api/sandbox/${project.id}`);
    const livePort = fresh.body?.devPort ?? project.devPort;
    log('Dev server port resolved', Boolean(livePort), `:${livePort}`);
    await sleep(9000);
    const proofPage = await browser.newPage();
    const errs = [];
    proofPage.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
    await proofPage.goto(`http://localhost:${livePort}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await sleep(15_000);
    const rendered = await proofPage.evaluate(() => (document.body?.innerText ?? '').replace(/\s+/g, ' '));
    log('NEW text rendered in the live app', rendered.includes(NEW_TEXT));
    log('No page errors after edit', errs.length === 0, errs.join(' | '));
    await proofPage.screenshot({ path: join(OUT, '04-pixels-after-edit.png') });
    console.log('  📸 04-pixels-after-edit.png');
    await proofPage.close();

    // Visual confirmation INSIDE Vai's app window: the preview iframe must
    // show the new text too — this is what v3gga actually looks at.
    let appWindowVerified = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const previewFrame = page.frames().find((f) => f.url().includes(`:${livePort}`));
      if (previewFrame) {
        const frameText = await previewFrame.evaluate(() => (document.body?.innerText ?? '').replace(/\s+/g, ' ')).catch(() => '');
        if (frameText.includes(NEW_TEXT)) {
          appWindowVerified = true;
          break;
        }
      }
      await sleep(1000);
    }
    log('NEW text visible in Vai app-window preview', appWindowVerified);
    await shot(page, '05-vai-window-after-edit');

    // Revert so the user's project is left untouched.
    if (lastRev) {
      const revert = await api(`/api/sandbox/${project.id}/revisions/${lastRev.id}/revert`, { method: 'POST', body: '{}' });
      const restored = readFileSync(TARGET_FILE, 'utf-8').includes(OLD_TEXT);
      log('Reverted — original text restored on disk', revert.ok && restored);
    } else {
      log('Revert', false, 'no revision recorded');
    }
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} steps passed. Evidence: ${OUT}`);
  await sleep(8000);
} finally {
  await api(`/api/conversations/${proofConversationId}`, { method: 'DELETE' }).catch(() => null);
  await browser.close();
}
