/**
 * Visible real-project proof: observed Next runtime issue -> Vai Agent/Council
 * repair -> production gate -> rendered MPM app.
 *
 * The edit is kept only when Council writes the intended wallet setup files and
 * Dev-Vai's production lane passes. On failure, the recorded revision is reverted.
 */
import puppeteer from 'puppeteer';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'C:\\Users\\v3gga\\Documents\\DEV_MPM\\mpm-frontend';
const TARGETS = ['lib/AppKitProvider.tsx', 'lib/appkit.ts'];
const APP_URL = 'http://localhost:5173/?devAuthBypass=1';
const API = 'http://localhost:3006';
const HEADERS = { 'Content-Type': 'application/json', 'x-vai-dev-auth-bypass': '1' };
const PROMPT = [
  'Repair the observed runtime issue in lib/AppKitProvider.tsx and lib/appkit.ts only.',
  'The Next issue overlay reports Runtime TypeError "Failed to fetch" at createAppKit in AppKitProvider.useEffect.',
  'Network evidence also shows lib/appkit.ts generates https://mainnet.infura.io/v3/undefined because browser code reads server-only Infura environment variables.',
  'Refactor these two files so client code never exposes or depends on server-only RPC secrets, never produces undefined RPC URLs, and optional AppKit analytics or network failures do not become uncaught page errors.',
  'Keep wallet/connect behavior available when the network is reachable, keep Sepolia as the default, and do not touch contract or participation logic.',
  'Use safe public/default transports as the client fallback. Apply the changes now and run the static validation available to Council. Summarize the files and proof briefly.',
].join(' ');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join('Temporary_files', 'mpm-runtime-repair-e2e', stamp);
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${step}${detail ? ` — ${detail}` : ''}`);
};
const shot = async (page, name) => {
  const path = join(outDir, `${name}.png`);
  await page.screenshot({ path });
  console.log(`  📸 ${path}`);
};
const api = async (path, init = {}) => {
  const response = await fetch(`${API}${path}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(300_000),
    ...init,
  });
  return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
};
const normalizeRoot = (value) => String(value ?? '').replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();

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
  if (!opened.ok) throw new Error(`Unable to open MPM: ${opened.body?.error ?? opened.status}`);
  project = opened.body;
}
log('Exact MPM root resolved', true, `${project.id} · ${ROOT}`);

if (!project.devPort) {
  const started = await api(`/api/sandbox/${project.id}/start`, { method: 'POST', body: '{}' });
  if (!started.ok) throw new Error('Unable to start MPM before repair');
  project.devPort = started.body.port;
}
log('MPM dev process available', true, `:${project.devPort}`);

const beforeFiles = new Map(TARGETS.map((path) => [path, readFileSync(join(ROOT, path), 'utf-8')]));
const beforeRevisionsResponse = await api(`/api/sandbox/${project.id}/revisions?limit=20`);
const beforeRevisionIds = new Set((beforeRevisionsResponse.body?.revisions ?? []).map((item) => item.id));

const created = await api('/api/conversations', {
  method: 'POST',
  body: JSON.stringify({
    modelId: 'vai:v0',
    title: 'MPM runtime repair via Vai',
    mode: 'agent',
    sandboxProjectId: project.id,
  }),
});
if (!created.ok || !created.body?.id) throw new Error('Unable to create project-bound repair chat');
const conversationId = created.body.id;
log('Project-bound Agent chat created', true, conversationId);

let appliedRevision = null;
let success = false;
const browser = await puppeteer.launch({
  headless: false,
  slowMo: 15,
  args: ['--no-sandbox', '--window-size=1920,1080'],
  defaultViewport: null,
});

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 30_000 });
  await sleep(1800);

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
  log('Exact project-bound Agent chat selected', selected);
  if (!selected) throw new Error('Repair chat could not be selected');
  await sleep(1800);

  const bindingVisible = await page.evaluate(() => /mpm-frontend|synced project/i.test(document.body.innerText ?? ''));
  log('Composer visibly bound to MPM', bindingVisible);
  if (!bindingVisible) throw new Error('Project binding was not visible');
  await shot(page, '01-bound-repair-chat');

  const composer = await page.$('textarea');
  if (!composer) throw new Error('Composer not found');
  await composer.click();
  await page.keyboard.type(PROMPT, { delay: 1 });
  await shot(page, '02-runtime-evidence-prompt');
  await page.keyboard.press('Enter');
  log('Runtime repair sent through visible chat', true);

  let councilVisible = false;
  let terminalAnswer = '';
  for (let attempt = 0; attempt < 360; attempt += 1) {
    await sleep(1000);
    if (!councilVisible) {
      councilVisible = await page.evaluate(() => /Workspace: mpm-frontend|reviewing the edit|static checks|repair pass/i.test(document.body.innerText ?? '')).catch(() => false);
      if (councilVisible) log('Council edit pipeline visible', true);
    }
    const revisions = await api(`/api/sandbox/${project.id}/revisions?limit=20`);
    appliedRevision = (revisions.body?.revisions ?? []).find((item) => !beforeRevisionIds.has(item.id)) ?? null;
    if (appliedRevision) break;
    const conversationMessages = await api(`/api/conversations/${conversationId}/messages`);
    terminalAnswer = [...(conversationMessages.body ?? [])]
      .reverse()
      .find((message) => message.role === 'assistant')?.content ?? '';
    if (terminalAnswer) {
      log('Vai completed without a project revision', false, terminalAnswer.slice(0, 240));
      await shot(page, '03-terminal-no-change');
      break;
    }
    if (attempt > 0 && attempt % 60 === 0) await shot(page, `waiting-${attempt}s`);
  }
  log('Council recorded a reversible project revision', Boolean(appliedRevision), appliedRevision?.id ?? 'none');
  if (!appliedRevision) throw new Error('Council did not apply a revision');

  const diff = await api(`/api/sandbox/${project.id}/revisions/${appliedRevision.id}/diff`);
  const changedPaths = (diff.body?.files ?? []).map((file) => file.path).sort();
  const intendedOnly = changedPaths.length > 0 && changedPaths.every((path) => TARGETS.includes(path));
  log('Revision stayed inside wallet setup files', intendedOnly, changedPaths.join(', '));
  if (!intendedOnly) throw new Error(`Unexpected files changed: ${changedPaths.join(', ')}`);

  const repairedProvider = readFileSync(join(ROOT, 'lib/AppKitProvider.tsx'), 'utf-8');
  const repairedAdapter = readFileSync(join(ROOT, 'lib/appkit.ts'), 'utf-8');
  const removedServerOnlyClientSecrets = !/process\.env\.(?:INFURA|INFURAMAIN|INFURAHOLESKY)\b/.test(repairedAdapter);
  const removedUndefinedRpcConstruction = !/infura\.io\/v3\/\$\{process\.env\./.test(repairedAdapter);
  const optionalAnalyticsCannotThrow = !/analytics\s*:\s*true\b/.test(repairedProvider);
  const behavioralRepairPresent = removedServerOnlyClientSecrets
    && removedUndefinedRpcConstruction
    && optionalAnalyticsCannotThrow;
  log(
    'Repair removes the observed runtime signatures',
    behavioralRepairPresent,
    `server-only client env=${removedServerOnlyClientSecrets ? 'gone' : 'present'}, undefined RPC=${removedUndefinedRpcConstruction ? 'gone' : 'possible'}, analytics=${optionalAnalyticsCannotThrow ? 'disabled/guarded' : 'still enabled'}`,
  );
  if (!behavioralRepairPresent) throw new Error('Council changed files without fixing the observed runtime signatures');

  // Wait for the concise receipt before running the heavier production gate.
  let receipt = '';
  for (let attempt = 0; attempt < 180; attempt += 1) {
    receipt = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="project-update-receipt"]'))
      .map((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .findLast((text) => text.length > 0 && text.length < 800) ?? '').catch(() => '');
    if (receipt) break;
    await sleep(1000);
  }
  log('Concise repair receipt appeared', Boolean(receipt), receipt.slice(0, 240));
  await shot(page, '03-council-repair-complete');

  // Use the real IDE lane control so Next is stopped safely before build.
  const prodClicked = await page.evaluate(() => {
    const candidate = Array.from(document.querySelectorAll('[role="radio"], button')).find((element) =>
      (element.textContent ?? '').trim() === 'Prod');
    if (!candidate) return false;
    candidate.click();
    return true;
  });
  log('Prod lane requested in the IDE', prodClicked);
  if (!prodClicked) throw new Error('Prod lane control not found');

  let productionReady = false;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await sleep(1000);
    productionReady = await page.evaluate(() => /production lane ready on port/i.test(document.body.innerText ?? '')).catch(() => false);
    const productionFailed = await page.evaluate(() => /production switch failed|lint failed|build failed/i.test(document.body.innerText ?? '')).catch(() => false);
    if (productionReady || productionFailed) break;
    if (attempt > 0 && attempt % 60 === 0) await shot(page, `production-${attempt}s`);
  }
  log('Lint/build/production lane passed', productionReady);
  if (!productionReady) throw new Error('Production gate did not pass');
  await sleep(2500);

  const renderedText = await page.evaluate(() => {
    const iframe = Array.from(document.querySelectorAll('iframe')).find((frame) => /localhost:\d+/.test(frame.src));
    return iframe?.src ?? '';
  });
  log('Production App iframe is mounted', Boolean(renderedText), renderedText);
  await shot(page, '04-production-proof');

  success = true;
  const passed = results.filter((item) => item.ok).length;
  console.log(`\n${passed}/${results.length} checks passed. Evidence: ${outDir}`);
  await sleep(8000);
} finally {
  if (!success && appliedRevision) {
    const reverted = await api(`/api/sandbox/${project.id}/revisions/${appliedRevision.id}/revert`, { method: 'POST', body: '{}' }).catch(() => ({ ok: false }));
    const restored = reverted.ok && TARGETS.every((path) => readFileSync(join(ROOT, path), 'utf-8') === beforeFiles.get(path));
    log('Failed repair reverted byte-for-byte', restored);
  }
  await browser.close();
}

if (!success) process.exitCode = 1;
