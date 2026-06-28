import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots', 'builder-dashboard-e2e');
const BASE_URL = 'http://localhost:5173';
const RUNTIME_URL = 'http://localhost:3006';

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

let shotIndex = 0;
async function screenshot(page, name) {
  const filename = `${String(++shotIndex).padStart(2, '0')}-${name}.png`;
  const fullPath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: fullPath, fullPage: false });
  console.log(`  screenshot: ${filename}`);
}

async function fetchBootstrap() {
  const response = await fetch(`${RUNTIME_URL}/api/platform/bootstrap`);
  const data = await response.json();
  data.auth = {
    ...data.auth,
    enabled: false,
    authenticated: true,
    user: { id: 'pw-builder', email: 'builder@test.local', name: 'Builder QA' },
  };
  return JSON.stringify(data);
}

async function api(pathname, { retries = 10, delayMs = 1000 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(`${RUNTIME_URL}${pathname}`);
      if (!response.ok) {
        throw new Error(`API ${pathname} failed with ${response.status}`);
      }
      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt === retries - 1) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError ?? new Error(`API ${pathname} failed`);
}

async function ensureAppReady(page) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await page.getByRole('button', { name: 'Retry' }).isVisible().catch(() => false)) {
      await page.getByRole('button', { name: 'Retry' }).click();
      await page.waitForTimeout(1500);
      continue;
    }

    if (await page.getByRole('button', { name: 'Check again now' }).isVisible().catch(() => false)) {
      await page.getByRole('button', { name: 'Check again now' }).click();
      await page.waitForTimeout(1500);
      continue;
    }

    const textbox = page.getByRole('textbox').first();
    if (await textbox.isVisible().catch(() => false)) return textbox;
    await page.waitForTimeout(1500);
  }

  throw new Error('App never reached a ready chat state');
}

async function sendPrompt(page, prompt) {
  const textbox = page.getByRole('textbox').first();
  await textbox.click();
  await textbox.fill(prompt);
  await page.keyboard.press('Enter');
}

async function selectBuilderMode(page) {
  const modeTrigger = page.locator('button[title^="Mode:"]').first();
  await modeTrigger.waitFor({ timeout: 30000 });

  const currentTitle = await modeTrigger.getAttribute('title');
  if (currentTitle?.includes('Mode: Builder')) return;

  await modeTrigger.click();
  await page.getByRole('option', { name: /^Builder\b/ }).click();
  await page.locator('button[title*="Mode: Builder"]').waitFor({ timeout: 30000 });
}

async function waitForPreviewFrame(page) {
  await page.waitForSelector('iframe', { timeout: 120000 });
  const frame = page.frameLocator('iframe');
  await frame.getByText('Analytics Dashboard').waitFor({ timeout: 120000 });
  return frame;
}

async function findCurrentConversation() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const conversations = await api('/api/conversations?limit=10');
    const match = conversations.find((conversation) => (
      typeof conversation.title === 'string'
      && conversation.title.startsWith('Build a React analytics dashboard')
      && conversation.sandboxProjectId
    ));
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Could not find the dashboard builder conversation');
}

async function listSandboxFiles(projectId) {
  const payload = await api(`/api/sandbox/${projectId}/files`);
  return Array.isArray(payload.files) ? payload.files : [];
}

async function findRunningBuilderSandbox() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const sandboxes = await api('/api/sandbox');
    const match = [...sandboxes]
      .reverse()
      .find((sandbox) => sandbox.name === 'builder-app' && sandbox.devPort);
    if (match) return match.id;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Could not find the active running builder sandbox');
}

async function resolveReadbackSandboxId() {
  const conversation = await findCurrentConversation();
  if (conversation?.sandboxProjectId) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const linkedFiles = await listSandboxFiles(conversation.sandboxProjectId).catch(() => []);
      if (linkedFiles.length > 0) {
        return conversation.sandboxProjectId;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    console.warn(`Linked sandbox ${conversation.sandboxProjectId} was empty; falling back to the active running builder sandbox`);
  }
  return findRunningBuilderSandbox();
}

function isReadableSourcePath(filePath) {
  return !filePath.includes('node_modules/')
    && !filePath.includes('pnpm-lock.yaml')
    && /\.(?:css|html|js|jsx|json|ts|tsx)$/i.test(filePath);
}

async function readSandboxSourceBundle(projectId) {
  const paths = (await listSandboxFiles(projectId))
    .filter((filePath) => typeof filePath === 'string' && isReadableSourcePath(filePath));
  const parts = await Promise.all(paths.map(async (filePath) => {
    const file = await api(`/api/sandbox/${projectId}/file?path=${encodeURIComponent(filePath)}`);
    return `\n/* ${filePath} */\n${String(file.content ?? '')}`;
  }));
  return parts.join('\n');
}

async function waitForSandboxSource(projectId, predicate, description, timeoutMs = 60000) {
  const startedAt = Date.now();
  let lastSource = '';

  while (Date.now() - startedAt < timeoutMs) {
    lastSource = await readSandboxSourceBundle(projectId).catch(() => '');
    if (lastSource && predicate(lastSource)) {
      return lastSource;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const snippet = lastSource.replace(/\s+/g, ' ').slice(0, 500);
  throw new Error(`Sandbox readback did not satisfy ${description}. Last source: ${snippet}`);
}

async function main() {
  const bootstrapBody = await fetchBootstrap();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.on('console', (message) => {
    const text = message.text();
    if (text.includes('[auto-sandbox]') || text.includes('[chat]')) {
      console.log(`[browser] ${text}`);
    }
  });

  await page.route('**/api/platform/bootstrap', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: bootstrapBody });
  });

  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: true,
        user: { id: 'pw-builder', email: 'builder@test.local', name: 'Builder QA' },
      }),
    });
  });

  try {
    console.log('Opening app...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 120000 });
    await ensureAppReady(page);
    await selectBuilderMode(page);
    await screenshot(page, 'ready');

    console.log('Building dashboard...');
    await sendPrompt(page, 'Build a React analytics dashboard with charts and a traffic sources pie chart.');
    await page.locator('button[title*="Mode: Builder"]').waitFor({ timeout: 120000 });

    const initialFrame = await waitForPreviewFrame(page);
    const readbackSandboxId = await resolveReadbackSandboxId();
    const initialSource = await readSandboxSourceBundle(readbackSandboxId);
    await screenshot(page, 'dashboard-before-edit');

    console.log('Applying purple + teal edit...');
    await sendPrompt(page, 'Change the color scheme to purple and teal.');
    const themedSource = await waitForSandboxSource(
      readbackSandboxId,
      (source) => (
        source !== initialSource
        && /#8b5cf6|\b(?:purple|violet)\b/i.test(source)
        && /#14b8a6|\b(?:teal|cyan)\b/i.test(source)
      ),
      'a changed purple/teal themed source bundle',
      120000,
    );
    await initialFrame.getByText('Traffic Sources').waitFor({ timeout: 120000 });
    await page.waitForTimeout(1500);
    await screenshot(page, 'dashboard-after-theme');

    console.log('Applying date range filter edit...');
    await sendPrompt(page, 'Add a date range filter row above the charts.');
    await waitForSandboxSource(
      readbackSandboxId,
      (source) => source !== themedSource && source.includes('Last 30 days') && source.includes('Last 90 days'),
      'date range filter controls',
      120000,
    );
    await initialFrame.getByText('Last 30 days').waitFor({ timeout: 120000 });
    await initialFrame.getByText('Last 90 days').waitFor({ timeout: 120000 });
    await screenshot(page, 'dashboard-after-date-filter');

    const badResponseCount = await page.getByText(/temporal\.plaindate|readme\./i).count();
    if (badResponseCount > 0) {
      throw new Error('Detected junk retrieval text in builder follow-up response');
    }

    console.log('PASS: build -> theme edit -> date filter edit');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
});
