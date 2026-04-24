import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots', 'preview-persistence');
const BASE_URL = 'http://localhost:5173';
const RUNTIME_URL = 'http://localhost:3006';
const TEST_SEED = Date.now();
const BUILD_TITLE = `build-preview-${TEST_SEED}`;
const PLAIN_TITLE = `blank-preview-${TEST_SEED}`;
const PROJECT_NAME = `preview-restore-${TEST_SEED}`;

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

let shot = 0;
const checks = [];

function log(message) {
  console.log(message);
}

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function screenshot(page, name) {
  shot += 1;
  const filename = `${String(shot).padStart(2, '0')}-${name}.png`;
  const filePath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: filePath, fullPage: false });
  log(`  screenshot ${filename}`);
}

async function api(pathname, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (init.body !== undefined && headers['Content-Type'] === undefined) {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(`${RUNTIME_URL}${pathname}`, {
    ...init,
    headers,
  });
}

async function waitForHttp(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // wait and retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function ensureRuntime() {
  const ok = await waitForHttp(`${RUNTIME_URL}/health`, 15000);
  if (!ok) throw new Error('Runtime server is not reachable on port 3006');
}

async function ensureSandboxProject() {
  log('Seeding sandbox project...');
  const createRes = await api('/api/sandbox/from-template', {
    method: 'POST',
    body: JSON.stringify({ templateId: 'vanilla', name: PROJECT_NAME }),
  });

  if (!createRes.ok) {
    throw new Error(`Sandbox template creation failed: ${createRes.status}`);
  }

  const created = await createRes.json();
  const sandboxProjectId = created.id;

  if (!created.depsInstalled) {
    const installRes = await api(`/api/sandbox/${sandboxProjectId}/install`, { method: 'POST' });
    if (!installRes.ok) {
      throw new Error(`Sandbox install failed: ${installRes.status}`);
    }
  }

  const startRes = await api(`/api/sandbox/${sandboxProjectId}/start`, { method: 'POST' });
  if (!startRes.ok) {
    throw new Error(`Sandbox start failed: ${startRes.status}`);
  }

  const started = await startRes.json();
  const devPort = started.port;
  const healthy = await waitForHttp(`http://localhost:${devPort}`, 60000);
  if (!healthy) {
    throw new Error(`Sandbox preview never became reachable on port ${devPort}`);
  }

  const detailsRes = await api(`/api/sandbox/${sandboxProjectId}`);
  if (!detailsRes.ok) {
    throw new Error(`Sandbox details failed: ${detailsRes.status}`);
  }

  const details = await detailsRes.json();
  return { sandboxProjectId, devPort, persistentProjectId: details.persistentProjectId ?? null };
}

async function createConversation(title, mode) {
  const res = await api('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ title, mode }),
  });
  if (!res.ok) {
    throw new Error(`Conversation creation failed: ${res.status}`);
  }
  const body = await res.json();
  return body.id;
}

async function patchConversation(conversationId, payload) {
  const res = await api(`/api/conversations/${conversationId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Conversation patch failed: ${res.status}`);
  }
  return res.json();
}

async function moveTo(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
  await page.waitForTimeout(250);
}

async function click(page, locator, label) {
  await moveTo(page, locator);
  log(`  click ${label}`);
  await locator.click();
  await page.waitForTimeout(700);
}

function conversationRow(page, title) {
  return page.locator(`xpath=//div[contains(@class,"cursor-pointer")][.//*[contains(normalize-space(), "${title}")]]`).first();
}

async function main() {
  log('=== Preview Persistence Visual Test ===');
  await ensureRuntime();

  const patchedBootstrap = JSON.stringify({
    auth: {
      enabled: false,
      authenticated: true,
      user: { id: 'pw-test', email: 'test@test.com', name: 'Playwright Tester' },
    },
  });

  const { sandboxProjectId, devPort } = await ensureSandboxProject();
  check('Sandbox preview started', Boolean(devPort), `port ${devPort}`);

  const buildConversationId = await createConversation(BUILD_TITLE, 'builder');
  await patchConversation(buildConversationId, { sandboxProjectId });

  const plainConversationId = await createConversation(PLAIN_TITLE, 'chat');
  await patchConversation(plainConversationId, { sandboxProjectId: null });
  check('Seed conversations created', Boolean(buildConversationId && plainConversationId));

  const browser = await chromium.launch({
    headless: false,
    slowMo: 60,
    args: ['--no-sandbox', '--start-maximized', '--window-size=1920,1080'],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  await page.route('**/api/platform/bootstrap', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: patchedBootstrap });
  });

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: true,
        user: { id: 'pw-test', email: 'test@test.com', name: 'Playwright Tester' },
      }),
    });
  });

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2500);
    await screenshot(page, 'initial-load');

    const chatHistoryButton = page.locator('button[title*="Chat History"]').first();
    await click(page, chatHistoryButton, 'Chat History');

    const buildConversation = conversationRow(page, BUILD_TITLE);
    await buildConversation.waitFor({ state: 'visible', timeout: 15000 });
    await click(page, buildConversation, 'build conversation');

    const previewFrame = page.locator('iframe[title="App Preview"]');
    await previewFrame.waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(2000);
    check('Build conversation reopens preview', await previewFrame.isVisible());
    await screenshot(page, 'build-conversation-preview-open');

    const filesButton = page.locator('button[title="Show files (Ctrl+E)"]').first();
    if (await filesButton.count()) {
      await click(page, filesButton, 'show files');
      check('Files toggle available in preview toolbar', true);
      await screenshot(page, 'files-open');
    }

    const consoleButton = page.locator('button[title="Show console (Ctrl+J)"]').first();
    if (await consoleButton.count()) {
      await click(page, consoleButton, 'show console');
      check('Console toggle available in preview toolbar', true);
      await screenshot(page, 'console-open');
    }

    await click(page, chatHistoryButton, 'Chat History');
    const plainConversation = conversationRow(page, PLAIN_TITLE);
    await plainConversation.waitFor({ state: 'visible', timeout: 15000 });
    await click(page, plainConversation, 'plain conversation');

    await page.waitForTimeout(1500);
    const showPreviewButton = page.locator('button[title="Show preview (Ctrl+B)"]').first();
    const previewStillVisible = await previewFrame.isVisible().catch(() => false);
    check('Plain conversation collapses preview', !previewStillVisible && await showPreviewButton.isVisible());
    await screenshot(page, 'plain-conversation-preview-hidden');

    const projectsButton = page.locator('button[title*="Projects"]').first();
    await click(page, projectsButton, 'Projects');

    const projectCard = page.getByText(PROJECT_NAME, { exact: true }).first();
    await projectCard.waitFor({ state: 'visible', timeout: 15000 });
    await click(page, projectCard, 'project card');

    await previewFrame.waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(2000);
    check('Projects panel reopens preview', await previewFrame.isVisible());
    await screenshot(page, 'project-reopen-preview');

    const urlBadge = page.getByText(`localhost:${devPort}`).first();
    check('Preview toolbar shows live port', await urlBadge.isVisible().catch(() => false), `expected localhost:${devPort}`);

    log('\nSummary');
    for (const item of checks) {
      log(`  ${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
    }

    const failed = checks.filter((item) => !item.ok);
    if (failed.length > 0) {
      throw new Error(`Preview persistence visual test failed: ${failed.map((item) => item.name).join(', ')}`);
    }

    log(`\nScreenshots saved to ${SCREENSHOT_DIR}`);
    await page.waitForTimeout(3000);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});