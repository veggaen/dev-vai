import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const APP_URL = process.env.VAI_APP_URL || 'http://localhost:5173';
const API_BASES = ['http://localhost:3006', 'http://127.0.0.1:3006'];
const SCREENSHOT_DIR = path.resolve('screenshots', 'real-chrome-deploy-e2e');
const TARGET_STACK_LABEL = process.env.VAI_DEPLOY_STACK_LABEL || 'PERN';
const TARGET_TIER_LABEL = process.env.VAI_DEPLOY_TIER_LABEL || 'Basic SPA';
const FINAL_HOLD_MS = Number(process.env.VAI_REAL_CHROME_HOLD_MS || 30000);
const DEPLOY_TIMEOUT_MS = Number(process.env.VAI_DEPLOY_TIMEOUT_MS || 420000);
const CHROME_USER_DATA_ROOT = process.env.CHROME_USER_DATA_ROOT || path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
const CHROME_PROFILE_DIR = process.env.CHROME_PROFILE_DIR || 'Default';

let resolvedApiBase = null;

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function copyIfPresent(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) return;
  try {
    fs.cpSync(sourcePath, targetPath, {
      recursive: true,
      force: true,
      errorOnExist: false,
      filter: (entry) => !/\\(?:Cache|Code Cache|GPUCache|GrShaderCache|GraphiteDawnCache|DawnCache|ShaderCache|Crashpad|Service Worker\\CacheStorage|blob_storage|Network\\Cookies(?:-journal)?)(?:\\|$)/i.test(entry),
    });
  } catch {
    // Ignore locked profile artifacts.
  }
}

function createChromeProfileSnapshot() {
  if (!CHROME_USER_DATA_ROOT || !fs.existsSync(CHROME_USER_DATA_ROOT)) {
    return null;
  }

  const profileSource = path.join(CHROME_USER_DATA_ROOT, CHROME_PROFILE_DIR);
  if (!fs.existsSync(profileSource)) {
    return null;
  }

  const snapshotRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vai-chrome-deploy-'));
  copyIfPresent(path.join(CHROME_USER_DATA_ROOT, 'Local State'), path.join(snapshotRoot, 'Local State'));
  copyIfPresent(path.join(CHROME_USER_DATA_ROOT, 'First Run'), path.join(snapshotRoot, 'First Run'));
  copyIfPresent(profileSource, path.join(snapshotRoot, CHROME_PROFILE_DIR));
  return snapshotRoot;
}

async function launchVisibleContext() {
  const launchArgs = ['--no-sandbox', '--start-maximized', '--window-size=1920,1080'];
  const profileSnapshot = createChromeProfileSnapshot();

  if (profileSnapshot) {
    console.log(`[deploy-demo] using Chrome profile snapshot -> ${profileSnapshot}`);
    try {
      return await chromium.launchPersistentContext(profileSnapshot, {
        channel: 'chrome',
        headless: false,
        slowMo: 140,
        viewport: { width: 1920, height: 1080 },
        colorScheme: 'dark',
        args: [...launchArgs, `--profile-directory=${CHROME_PROFILE_DIR}`],
      });
    } catch (error) {
      console.warn(`[deploy-demo] Chrome profile snapshot launch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    slowMo: 140,
    args: launchArgs,
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: 'dark' });
  context.__vaiBrowser = browser;
  return context;
}

async function waitForRuntime(pathname = '/api/platform/bootstrap', timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const base of API_BASES) {
      try {
        const response = await fetch(`${base}${pathname}`);
        if (!response.ok) continue;
        resolvedApiBase = base;
        return;
      } catch {
        // Keep retrying.
      }
    }
    await sleep(1500);
  }
  throw new Error(`Runtime did not become ready for ${pathname}`);
}

async function apiJson(pathname) {
  const bases = resolvedApiBase ? [resolvedApiBase, ...API_BASES.filter((base) => base !== resolvedApiBase)] : API_BASES;
  for (const base of bases) {
    try {
      const response = await fetch(`${base}${pathname}`);
      if (!response.ok) continue;
      resolvedApiBase = base;
      return response.json();
    } catch {
      // Try next base.
    }
  }
  throw new Error(`Could not reach runtime for ${pathname}`);
}

async function installAuthRoutes(context) {
  await context.route('**/api/platform/bootstrap', async (route) => {
    const response = await fetch(route.request().url());
    const data = await response.json().catch(() => ({}));
    const auth = data && typeof data === 'object' ? data.auth ?? {} : {};
    const body = {
      ...data,
      auth: {
        ...auth,
        enabled: false,
        authenticated: true,
        user: auth.user ?? { id: 'visual-demo', email: 'visual-demo@vegga.local', name: 'Visual Demo' },
      },
    };

    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  await context.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        enabled: true,
        providers: { google: { enabled: true } },
        authenticated: true,
        user: { id: 'visual-demo', email: 'visual-demo@vegga.local', name: 'Visual Demo', avatarUrl: null },
        companionClient: null,
      }),
    });
  });
}

async function captureStep(page, name, label) {
  const screenshotPath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`[deploy-demo] screenshot saved: ${screenshotPath} (${label})`);
}

async function injectVisualInputOverlay(page) {
  await page.evaluate(() => {
    if (document.getElementById('vai-demo-cursor')) return;

    const cursor = document.createElement('div');
    cursor.id = 'vai-demo-cursor';
    Object.assign(cursor.style, {
      position: 'fixed',
      left: '-100px',
      top: '-100px',
      width: '18px',
      height: '18px',
      borderRadius: '999px',
      background: 'radial-gradient(circle, rgba(56,189,248,0.95) 0%, rgba(56,189,248,0.3) 55%, rgba(56,189,248,0) 72%)',
      boxShadow: '0 0 0 1px rgba(255,255,255,0.22), 0 0 18px rgba(56,189,248,0.5)',
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none',
      zIndex: '2147483647',
      transition: 'left 120ms linear, top 120ms linear',
    });
    document.body.appendChild(cursor);

    const label = document.createElement('div');
    label.id = 'vai-demo-keys';
    Object.assign(label.style, {
      position: 'fixed',
      right: '18px',
      bottom: '18px',
      display: 'flex',
      gap: '8px',
      alignItems: 'center',
      minHeight: '38px',
      padding: '8px 12px',
      borderRadius: '14px',
      background: 'rgba(9, 13, 24, 0.84)',
      border: '1px solid rgba(255,255,255,0.14)',
      color: '#f8fafc',
      font: '600 13px/1.2 Inter, system-ui, sans-serif',
      pointerEvents: 'none',
      zIndex: '2147483647',
      boxShadow: '0 10px 40px rgba(0,0,0,0.35)',
      opacity: '0',
      transform: 'translateY(8px)',
      transition: 'opacity 140ms ease, transform 140ms ease',
    });
    label.innerHTML = '<span style="opacity:.7">Input</span><strong id="vai-demo-keys-text">idle</strong>';
    document.body.appendChild(label);

    const setKeys = (text) => {
      const strong = document.getElementById('vai-demo-keys-text');
      const panel = document.getElementById('vai-demo-keys');
      if (!strong || !panel) return;
      strong.textContent = text;
      panel.style.opacity = '1';
      panel.style.transform = 'translateY(0)';
      clearTimeout(window.__vaiDemoKeysTimeout);
      window.__vaiDemoKeysTimeout = setTimeout(() => {
        panel.style.opacity = '0';
        panel.style.transform = 'translateY(8px)';
      }, 900);
    };

    document.addEventListener('mousemove', (event) => {
      cursor.style.left = `${event.clientX}px`;
      cursor.style.top = `${event.clientY}px`;
    }, true);

    document.addEventListener('keydown', (event) => {
      const parts = [];
      if (event.ctrlKey) parts.push('Ctrl');
      if (event.altKey) parts.push('Alt');
      if (event.shiftKey) parts.push('Shift');
      if (event.metaKey) parts.push('Meta');
      const key = event.key === ' ' ? 'Space' : event.key;
      if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) parts.push(key);
      setKeys(parts.join(' + ') || key);
    }, true);

    document.addEventListener('mousedown', () => setKeys('Mouse click'), true);
  });
}

async function moveToLocator(page, locator, label) {
  await locator.scrollIntoViewIfNeeded();
  await locator.waitFor({ state: 'visible', timeout: 15000 });
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error(`No bounding box available for ${label}`);
  }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 18 });
  await page.waitForTimeout(250);
}

async function hoverLocator(page, locator, label) {
  await moveToLocator(page, locator, label);
  console.log(`[deploy-demo] hover ${label}`);
  await page.waitForTimeout(700);
}

async function clickLocator(page, locator, label) {
  await moveToLocator(page, locator, label);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  console.log(`[deploy-demo] click ${label}`);
  await page.waitForTimeout(1200);
}

async function pressShortcut(page, shortcut, label) {
  console.log(`[deploy-demo] shortcut ${label}`);
  await page.keyboard.press(shortcut);
  await page.waitForTimeout(900);
}

async function ensureTemplateGalleryVisible(page) {
  await pressShortcut(page, 'Control+1', 'Ctrl+1 -> Chat mode');

  const heading = page.getByText('Deploy a Stack').first();
  if (await heading.isVisible().catch(() => false)) {
    return;
  }

  await pressShortcut(page, 'Control+b', 'Ctrl+B -> Show preview');
  if (await heading.isVisible().catch(() => false)) {
    return;
  }

  await page.waitForTimeout(1200);
  await heading.waitFor({ state: 'visible', timeout: 15000 });
}

async function waitForDeployResult(page) {
  const deadline = Date.now() + DEPLOY_TIMEOUT_MS;
  let lastShotAt = 0;

  while (Date.now() < deadline) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const previewFrame = page.locator('iframe[title="App Preview"]').first();
    const previewVisible = await previewFrame.isVisible().catch(() => false);

    if (/Deploy Issue|Build Failed/i.test(bodyText)) {
      throw new Error('Deploy UI entered a failed state');
    }

    if (previewVisible) {
      const previewUrl = await previewFrame.getAttribute('src');
      if (previewUrl) {
        return previewUrl;
      }
    }

    const runningProject = await apiJson('/api/sandbox')
      .then((projects) => Array.isArray(projects)
        ? projects.find((project) => project && typeof project === 'object' && project.status === 'running' && project.devPort)
        : null)
      .catch(() => null);

    if (runningProject?.devPort) {
      return `http://localhost:${runningProject.devPort}`;
    }

    const shouldCapture = Date.now() - lastShotAt >= 12000;
    if (shouldCapture) {
      lastShotAt = Date.now();
      const progressName = `deploy-progress-${String(Math.floor((DEPLOY_TIMEOUT_MS - (deadline - Date.now())) / 1000)).padStart(3, '0')}s`;
      await captureStep(page, progressName, 'Deploy in progress');
    }

    await page.waitForTimeout(2000);
  }

  throw new Error(`Timed out waiting for deploy preview after ${DEPLOY_TIMEOUT_MS}ms`);
}

async function exercisePreview(previewPage) {
  await injectVisualInputOverlay(previewPage);
  await previewPage.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await previewPage.waitForTimeout(2500);
  await captureStep(previewPage, '07-preview-opened', 'Generated app opened directly');

  const candidate = previewPage.locator('button:visible, a:visible, [role="button"]:visible').filter({ hasText: /sign in|get started|dashboard|home|products|features|continue|login/i }).first();
  if (await candidate.isVisible().catch(() => false)) {
    await hoverLocator(previewPage, candidate, 'Generated app CTA');
    await captureStep(previewPage, '08-preview-cta-hover', 'Generated app CTA hover');
    await clickLocator(previewPage, candidate, 'Generated app CTA');
    await captureStep(previewPage, '09-preview-cta-click', 'Generated app CTA click');
    await previewPage.waitForTimeout(1500);
    return;
  }

  const fallback = previewPage.locator('button:visible, a:visible, [role="button"]:visible').first();
  if (await fallback.isVisible().catch(() => false)) {
    await hoverLocator(previewPage, fallback, 'Generated app first interactive');
    await captureStep(previewPage, '08-preview-first-hover', 'Generated app first interactive hover');
  }
}

async function main() {
  console.log('============================================================');
  console.log('  VeggaAI real Chrome deploy demo');
  console.log(`  Stack: ${TARGET_STACK_LABEL}`);
  console.log(`  Tier:  ${TARGET_TIER_LABEL}`);
  console.log('============================================================');

  await waitForRuntime();

  const context = await launchVisibleContext();
  await installAuthRoutes(context);

  const consoleErrors = [];
  const page = context.pages()[0] ?? await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await injectVisualInputOverlay(page);
  await page.waitForTimeout(2500);
  await captureStep(page, '01-app-loaded', 'Desktop shell loaded');

  await ensureTemplateGalleryVisible(page);
  await captureStep(page, '02-gallery-visible', 'Template gallery visible');

  const stackCard = page.getByRole('button', { name: new RegExp(TARGET_STACK_LABEL, 'i') }).first();
  await hoverLocator(page, stackCard, `${TARGET_STACK_LABEL} stack card`);
  await captureStep(page, '03-stack-hover', 'Stack hover');
  await clickLocator(page, stackCard, `${TARGET_STACK_LABEL} stack card`);
  await captureStep(page, '04-stack-selected', 'Stack selected');

  const tierButton = page.getByRole('button', { name: new RegExp(TARGET_TIER_LABEL, 'i') }).first();
  await hoverLocator(page, tierButton, `${TARGET_TIER_LABEL} tier`);
  await captureStep(page, '05-tier-hover', 'Tier hover');
  await clickLocator(page, tierButton, `${TARGET_TIER_LABEL} tier`);
  await captureStep(page, '06-tier-selected', 'Tier selected');

  const deployButton = page.getByRole('button', { name: new RegExp(`Deploy\\s+${TARGET_TIER_LABEL}`, 'i') }).first();
  await clickLocator(page, deployButton, `Deploy ${TARGET_TIER_LABEL}`);
  await captureStep(page, '06b-deploy-started', 'Deploy started');

  const previewUrl = await waitForDeployResult(page);
  await captureStep(page, '07-preview-ready-in-shell', 'Preview ready in desktop shell');

  const previewPage = await context.newPage();
  await previewPage.goto(previewUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await exercisePreview(previewPage);

  const shellBody = await page.locator('body').innerText().catch(() => '');
  const previewBody = await previewPage.locator('body').innerText().catch(() => '');

  console.log(JSON.stringify({
    ok: true,
    previewUrl,
    screenshotDir: SCREENSHOT_DIR,
    shellHasScaffoldStep: /Scaffolding project|Creating app/i.test(shellBody),
    shellHasBuildStep: /Building application|Opening live preview/i.test(shellBody),
    previewTextSample: previewBody.slice(0, 200),
    consoleErrors,
  }, null, 2));

  console.log(`[deploy-demo] holding browser open for ${FINAL_HOLD_MS}ms`);
  await sleep(FINAL_HOLD_MS);
  await context.close();
}

main().catch(async (error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    screenshotDir: SCREENSHOT_DIR,
  }, null, 2));
  process.exitCode = 1;
});