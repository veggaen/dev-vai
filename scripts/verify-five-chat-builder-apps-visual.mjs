#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_AUTH_BYPASS_HEADERS = { 'x-vai-dev-auth-bypass': '1' };

const APP_SPECS = [
  {
    slug: 'notes-dashboard',
    label: 'Notes Dashboard',
    prompt: 'Build a simple notes dashboard app I can preview.',
    expectedHeading: 'Notes Dashboard',
    previewContract: {
      requiredLabels: ['Notes Dashboard', 'Quick capture', 'Pinned context'],
      minSections: 3,
      minButtons: 4,
    },
    verifyResponse: (content) => /Notes Dashboard|Save note/i.test(content),
    interact: async (page) => {
      const title = `Release checklist ${Date.now()}`;
      await page.getByPlaceholder('Note title').fill(title);
      await page.getByPlaceholder('Capture the next decision, reminder, or reference while it is still sharp.').fill('Verify the preview, keep the layout clean, and ship the next pass.');
      await page.getByRole('button', { name: 'Save note' }).click();
      await page.getByText(title, { exact: true }).waitFor({ timeout: 15000 });
      return `saved note: ${title}`;
    },
  },
  {
    slug: 'social-hub',
    label: 'Social Hub',
    prompt: 'Build a social blogging app I can preview.',
    expectedHeading: 'Social Hub',
    previewContract: {
      requiredLabels: ['Social Hub', 'Write a Post', 'Blog Feed'],
      minSections: 2,
      minButtons: 1,
    },
    verifyResponse: (content) => /Social Hub|Publish Post|Blog Feed/i.test(content),
    interact: async (page) => {
      const title = `Builder pulse ${Date.now()}`;
      await page.getByPlaceholder('Post title').fill(title);
      await page.getByPlaceholder('What are you publishing today?').fill('The feed should update immediately when a new post is published.');
      await page.getByRole('button', { name: 'Publish Post' }).click();
      await page.getByText(title, { exact: true }).waitFor({ timeout: 15000 });
      return `published post: ${title}`;
    },
  },
  {
    slug: 'ops-control-center',
    label: 'Ops Control Center',
    prompt: 'Build an internal ops dashboard app I can preview.',
    expectedHeading: 'Ops Control Center',
    previewContract: {
      requiredLabels: ['Ops Control Center', 'Approval Queue', 'Live Activity'],
      minSections: 3,
      minButtons: 4,
    },
    verifyResponse: (content) => /Ops Control Center|Approval Queue|Live Activity/i.test(content),
    interact: async (page) => {
      const approveButtons = page.getByRole('button', { name: 'Approve item' });
      const before = await approveButtons.count();
      if (before < 1) throw new Error('Ops preview had no approval button');
      await approveButtons.first().click();
      await page.waitForFunction((expected) => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.filter((button) => button.textContent?.trim() === 'Approve item').length === expected;
      }, before - 1, { timeout: 15000 });
      return `approved queue item: ${before} -> ${before - 1}`;
    },
  },
  {
    slug: 'saas-control-center',
    label: 'SaaS Control Center',
    prompt: 'Build a premium SaaS workspace with auth, billing, settings, audit logs, and chat I can preview.',
    expectedHeading: 'SaaS Control Center',
    previewContract: {
      requiredLabels: ['SaaS Control Center', 'Audit Log', 'Workspace Chat'],
      minSections: 4,
      minButtons: 4,
    },
    verifyResponse: (content) => /SaaS Control Center|Workspace Chat|Audit Log/i.test(content),
    interact: async (page) => {
      const message = `Billing follow-up ${Date.now()}`;
      await page.getByPlaceholder('Share a billing, auth, or support update').fill(message);
      await page.getByRole('button', { name: 'Send update' }).click();
      await page.getByText(message, { exact: true }).waitFor({ timeout: 15000 });
      return `sent workspace update: ${message}`;
    },
  },
  {
    slug: 'shared-shopping-list',
    label: 'Shared Shopping List',
    prompt: 'Build the first runnable version now. Create a compact but polished shared shopping app for a household or roommates. It can use a small React + Vite workspace if needed, but keep the product focus on real shopping use instead of scaffolding talk. Use Tailwind CSS v4 styling and framer-motion for subtle motion, seed mock data for members, items, aisle or category groupings, and activity messages, and make the UI clean, dark, modern, and phone-friendly. The preview must visibly include the heading Shared Shopping List plus separate sections labeled Household and Activity Chat. Do not use a starter template, monorepo starter, or generic scaffold copy unless I explicitly asked for one. Prefer the smallest real app that satisfies the product ask.',
    expectedHeading: 'Shared Shopping List',
    previewContract: {
      requiredLabels: ['Shared Shopping List', 'Household', 'Activity Chat', 'Store Run'],
      minSections: 4,
      minButtons: 1,
    },
    verifyResponse: (content) => /Shared Shopping List|Household|Activity Chat/i.test(content),
    interact: async (page) => {
      const item = `Limes ${Date.now()}`;
      await page.getByPlaceholder('Quick-add milk, limes, detergent...').fill(item);
      await page.getByRole('button', { name: 'Quick-add item' }).click();
      await page.getByText(item, { exact: true }).waitFor({ timeout: 15000 });
      return `added shopping item: ${item}`;
    },
  },
];

function parseArgs(argv) {
  const options = {
    baseUrl: 'http://localhost:5173?devAuthBypass=1',
    runtimeUrl: process.env.VAI_API?.trim() || 'http://127.0.0.1:3006',
    outputDir: '',
    keepProjects: false,
    widths: [375, 768, 1280, 1920],
    timeoutMs: 180000,
    lighthouse: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--base-url' && next) {
      options.baseUrl = next;
      index++;
      continue;
    }
    if (arg === '--runtime-url' && next) {
      options.runtimeUrl = next;
      index++;
      continue;
    }
    if (arg === '--output-dir' && next) {
      options.outputDir = next;
      index++;
      continue;
    }
    if (arg === '--keep-projects') {
      options.keepProjects = true;
      continue;
    }
    if (arg === '--widths' && next) {
      options.widths = next
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isFinite(value) && value >= 320);
      index++;
      continue;
    }
    if (arg === '--timeout-ms' && next) {
      options.timeoutMs = Number.parseInt(next, 10) || options.timeoutMs;
      index++;
      continue;
    }
    if (arg === '--lighthouse') {
      options.lighthouse = true;
    }
  }

  return options;
}

function buildOutputDir(customDir) {
  if (customDir) return customDir;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(__dirname, '..', 'screenshots', 'five-chat-builder-apps', stamp);
}

function ensureLocalDevAuthBypassUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if ((url.hostname === 'localhost' || url.hostname === '127.0.0.1') && !url.searchParams.has('devAuthBypass')) {
      url.searchParams.set('devAuthBypass', '1');
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function log(message) {
  console.log(message);
}

async function apiJson(runtimeUrl, relativePath, init) {
  const response = await fetch(`${runtimeUrl.replace(/\/$/, '')}${relativePath}`, {
    ...init,
    headers: {
      ...DEV_AUTH_BYPASS_HEADERS,
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${relativePath} -> ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function patchBootstrap(runtimeUrl) {
  const response = await fetch(`${runtimeUrl.replace(/\/$/, '')}/api/platform/bootstrap`);
  if (!response.ok) {
    throw new Error(`Bootstrap failed: ${response.status}`);
  }
  const payload = await response.json();
  payload.auth = {
    ...payload.auth,
    enabled: false,
    authenticated: true,
    user: { id: 'five-app-visual-driver', email: 'visual@test.local', name: 'Visual Driver' },
  };
  return JSON.stringify(payload);
}

async function screenshot(page, outputDir, name) {
  const filePath = path.join(outputDir, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  log(`  screenshot: ${path.basename(filePath)}`);
}

async function waitForAssistantResponse(page, previousCount, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const selector = '[data-chat-message-role="assistant"]';
  while (Date.now() < deadline) {
    const count = await page.locator(selector).count();
    if (count > previousCount) {
      const target = page.locator(selector).nth(count - 1);
      const text = (await target.textContent())?.replace(/\s+/g, ' ').trim() ?? '';
      if (text.length > 30) {
        return { count, text };
      }
    }
    await page.waitForTimeout(400);
  }
  throw new Error('Timed out waiting for assistant response');
}

async function waitForNewConversation(runtimeUrl, knownIds, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const conversations = await apiJson(runtimeUrl, '/api/conversations?limit=20');
    const next = conversations.find((conversation) => !knownIds.has(conversation.id));
    if (next) return next;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for a new conversation');
}

async function waitForConversationSandboxId(runtimeUrl, conversationId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const conversations = await apiJson(runtimeUrl, '/api/conversations?limit=50');
    const conversation = conversations.find((entry) => entry.id === conversationId);
    if (conversation?.sandboxProjectId) {
      return conversation.sandboxProjectId;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for conversation sandbox binding');
}

async function waitForNewSandbox(runtimeUrl, knownIds, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sandboxes = await apiJson(runtimeUrl, '/api/sandbox');
    const next = sandboxes.find((sandbox) => !knownIds.has(sandbox.id));
    if (next) return next;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for a new sandbox');
}

async function waitForAssistantMessage(runtimeUrl, conversationId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await apiJson(runtimeUrl, `/api/conversations/${conversationId}/messages`);
    const assistant = [...messages].reverse().find((message) => message.role === 'assistant' && message.content?.trim().length > 0);
    if (assistant) return assistant;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for assistant message payload');
}

function extractProjectUpdateArtifact(content) {
  const match = content.match(/\[vai-artifact\]\s*([\s\S]*?)\s*\[\/vai-artifact\]/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

async function waitForProjectUpdateArtifact(runtimeUrl, conversationId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await apiJson(runtimeUrl, `/api/conversations/${conversationId}/messages`);
    const assistant = [...messages].reverse().find((message) => message.role === 'assistant' && /\[vai-artifact\]/i.test(message.content ?? ''));
    const artifact = assistant ? extractProjectUpdateArtifact(assistant.content) : null;
    if (artifact?.liveUrl || artifact?.port) {
      return artifact;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for project update artifact');
}

async function waitForSandboxRunning(runtimeUrl, sandboxId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sandbox = await apiJson(runtimeUrl, `/api/sandbox/${sandboxId}`);
    if (sandbox.status === 'failed') {
      throw new Error(`Sandbox failed: ${JSON.stringify((sandbox.logs ?? []).slice(-8))}`);
    }
    if (sandbox.status === 'running' && sandbox.devPort) {
      return sandbox;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Timed out waiting for sandbox to reach running state');
}

async function deleteSandbox(runtimeUrl, sandboxId) {
  try {
    await fetch(`${runtimeUrl.replace(/\/$/, '')}/api/sandbox/${sandboxId}`, {
      method: 'DELETE',
      headers: DEV_AUTH_BYPASS_HEADERS,
    });
  } catch {}
}

async function deleteConversation(runtimeUrl, conversationId) {
  try {
    await fetch(`${runtimeUrl.replace(/\/$/, '')}/api/conversations/${conversationId}`, {
      method: 'DELETE',
      headers: DEV_AUTH_BYPASS_HEADERS,
    });
  } catch {}
}

async function startFreshBuilderChat(page) {
  const newChatButton = page.getByRole('button', { name: /new chat/i }).first();
  let ready = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await newChatButton.isVisible().catch(() => false)) {
      ready = true;
      break;
    }
    await page.keyboard.press('Control+S');
    await page.waitForTimeout(350);
  }
  if (!ready) {
    await newChatButton.waitFor({ timeout: 5000 });
  }
  await newChatButton.click();
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+3');
  await page.waitForTimeout(500);
  const textarea = page.locator('textarea').first();
  await textarea.waitFor({ timeout: 30000 });
  await textarea.click();
  return textarea;
}

async function capturePreviewResponsiveShots(page, outputDir, slug, widths) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width <= 768 ? 980 : 1180 });
    await page.waitForTimeout(400);
    await screenshot(page, outputDir, `${slug}-preview-${width}`);
  }
}

async function resolvePreviewUrl(previewUrl) {
  const candidates = Array.from(new Set([
    previewUrl,
    previewUrl.includes('127.0.0.1') ? previewUrl.replace('127.0.0.1', 'localhost') : previewUrl.replace('localhost', '127.0.0.1'),
  ]));

  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate, { redirect: 'follow' });
        if (response.ok) return candidate;
        lastError = new Error(`HTTP ${response.status} from ${candidate}`);
      } catch (error) {
        lastError = error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  throw lastError ?? new Error('Preview was not reachable');
}

function isIgnorableConsoleError(message) {
  return /Failed to load resource: the server responded with a status of 404 \(Not Found\)/i.test(message)
    || /favicon\.ico/i.test(message);
}

async function verifyPreviewContract(page, spec) {
  const contract = spec.previewContract;
  if (!contract) return;

  for (const label of contract.requiredLabels ?? []) {
    await page.getByText(label, { exact: true }).first().waitFor({ timeout: 20000 });
  }

  const audit = await page.evaluate(() => {
    const parseRadius = (value) => {
      const numeric = Number.parseFloat(value || '0');
      return Number.isFinite(numeric) ? numeric : 0;
    };

    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return rect.width > 0
        && rect.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number.parseFloat(style.opacity || '1') !== 0;
    };

    const surfaces = Array.from(document.body.querySelectorAll('*'))
      .filter((element) => isVisible(element))
      .map((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const radius = Math.max(
          parseRadius(style.borderTopLeftRadius),
          parseRadius(style.borderTopRightRadius),
          parseRadius(style.borderBottomRightRadius),
          parseRadius(style.borderBottomLeftRadius),
        );
        const hasBackground = style.backgroundImage !== 'none'
          || (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent');
        const hasBorder = parseRadius(style.borderTopWidth) > 0
          || parseRadius(style.borderRightWidth) > 0
          || parseRadius(style.borderBottomWidth) > 0
          || parseRadius(style.borderLeftWidth) > 0;
        const hasShadow = style.boxShadow !== 'none';
        if (rect.width < 120 || rect.height < 60 || !(hasBackground || hasBorder || hasShadow)) {
          return null;
        }
        return {
          radius: Math.round(radius),
        };
      })
      .filter(Boolean);

    const radiusCounts = new Map();
    for (const surface of surfaces) {
      radiusCounts.set(surface.radius, (radiusCounts.get(surface.radius) || 0) + 1);
    }

    const links = Array.from(document.querySelectorAll('a[href]'));
    const routeLinks = links.filter((link) => {
      const href = link.getAttribute('href') || '';
      return href.startsWith('/') && !href.startsWith('//');
    });
    const largeRoundedCount = surfaces.filter((surface) => surface.radius >= 18).length;

    return {
      sectionCount: document.querySelectorAll('section').length,
      regionCount: document.querySelectorAll('section, article, nav, aside, form').length,
      buttonCount: document.querySelectorAll('button').length,
      imageCount: document.querySelectorAll('img').length,
      formCount: document.querySelectorAll('form').length,
      inputCount: document.querySelectorAll('input, textarea, select').length,
      linkCount: links.length,
      routeLinkCount: routeLinks.length,
      surfaceCount: surfaces.length,
      largeRoundedCount,
      largeRoundedRatio: surfaces.length > 0 ? Number((largeRoundedCount / surfaces.length).toFixed(3)) : 0,
      maxRadius: surfaces.length > 0 ? Math.max(...surfaces.map((surface) => surface.radius)) : 0,
      radiusHistogram: [...radiusCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 8)
        .map(([radius, count]) => ({ radius, count })),
      scrollHeight: Math.round(document.documentElement.scrollHeight),
    };
  });

  if ((contract.minSections ?? 0) > audit.regionCount) {
    throw new Error(`${spec.label} preview only rendered ${audit.regionCount} structural regions`);
  }
  if ((contract.minButtons ?? 0) > audit.buttonCount) {
    throw new Error(`${spec.label} preview only rendered ${audit.buttonCount} buttons`);
  }

  return audit;
}

function buildStyleWarnings(audit) {
  const warnings = [];
  if (audit.surfaceCount >= 8 && audit.largeRoundedRatio >= 0.55) {
    warnings.push('rounded-box-density-high');
  }
  if (audit.maxRadius >= 28 && audit.largeRoundedCount >= 6) {
    warnings.push('large-radius-overuse');
  }
  return warnings;
}

function runLighthouseAudit(previewUrl, outputDir, slug, enabled) {
  if (!enabled) return null;

  const reportPath = path.join(outputDir, `${slug}-lighthouse.json`);
  const result = spawnSync('npx', [
    '--yes',
    'lighthouse',
    previewUrl,
    '--quiet',
    '--chrome-flags=--headless=new --no-sandbox',
    '--only-categories=performance',
    '--only-categories=accessibility',
    '--only-categories=best-practices',
    '--output=json',
    `--output-path=${reportPath}`,
  ], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 240000,
    windowsHide: true,
  });

  if (result.error || result.status !== 0 || !fs.existsSync(reportPath)) {
    return {
      error: result.error?.message ?? result.stderr?.trim() ?? result.stdout?.trim() ?? 'lighthouse failed',
    };
  }

  try {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    return {
      performance: report.categories?.performance?.score ?? null,
      accessibility: report.categories?.accessibility?.score ?? null,
      bestPractices: report.categories?.['best-practices']?.score ?? null,
      reportPath,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function verifyPreview(spec, context, outputDir, previewUrl, widths, lighthouseEnabled) {
  const previewPage = await context.newPage();
  await previewPage.setViewportSize({ width: 1440, height: 1180 });
  const pageErrors = [];
  const consoleErrors = [];

  previewPage.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  previewPage.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const resolvedPreviewUrl = await resolvePreviewUrl(previewUrl);
  await previewPage.goto(resolvedPreviewUrl, { waitUntil: 'networkidle', timeout: 120000 });
  await previewPage.getByText(spec.expectedHeading, { exact: true }).first().waitFor({ timeout: 20000 });
  const previewAudit = await verifyPreviewContract(previewPage, spec);
  await screenshot(previewPage, outputDir, `${spec.slug}-preview-loaded`);
  const interactionNote = await spec.interact(previewPage);
  await previewPage.waitForTimeout(500);
  await screenshot(previewPage, outputDir, `${spec.slug}-preview-interacted`);
  await capturePreviewResponsiveShots(previewPage, outputDir, spec.slug, widths);

  if (pageErrors.length > 0) {
    throw new Error(`${spec.label} preview threw page errors: ${pageErrors.join(' | ')}`);
  }
  const significantConsoleErrors = consoleErrors.filter((message) => !isIgnorableConsoleError(message));
  if (significantConsoleErrors.length > 0) {
    throw new Error(`${spec.label} preview logged console errors: ${significantConsoleErrors.join(' | ')}`);
  }

  const styleWarnings = previewAudit ? buildStyleWarnings(previewAudit) : [];
  const lighthouse = runLighthouseAudit(resolvedPreviewUrl, outputDir, spec.slug, lighthouseEnabled);
  if (styleWarnings.length > 0) {
    log(`  style warnings: ${styleWarnings.join(', ')}`);
  }
  if (lighthouse?.error) {
    log(`  lighthouse warning: ${lighthouse.error}`);
  }

  await previewPage.close();
  return {
    interactionNote,
    previewAudit,
    styleWarnings,
    lighthouse,
    resolvedPreviewUrl,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputDir = buildOutputDir(options.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });
  const baseUrl = ensureLocalDevAuthBypassUrl(options.baseUrl);

  const runtimeHealth = await fetch(`${options.runtimeUrl.replace(/\/$/, '')}/health`).catch(() => null);
  if (!runtimeHealth?.ok) {
    throw new Error(`Runtime is not reachable at ${options.runtimeUrl}`);
  }
  const candidateAppUrls = Array.from(new Set([
    baseUrl,
    baseUrl.includes('localhost') ? baseUrl.replace('localhost', '127.0.0.1') : baseUrl.replace('127.0.0.1', 'localhost'),
  ]));
  let resolvedBaseUrl = null;
  for (const candidate of candidateAppUrls) {
    const appHealth = await fetch(candidate).catch(() => null);
    if (appHealth?.ok) {
      resolvedBaseUrl = candidate;
      break;
    }
  }
  if (!resolvedBaseUrl) {
    throw new Error(`Desktop web shell is not reachable at ${candidateAppUrls.join(' or ')}`);
  }

  const patchedBootstrap = await patchBootstrap(options.runtimeUrl);
  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
    args: ['--no-sandbox', '--start-maximized', '--window-size=1920,1080'],
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const createdSandboxes = [];
  const createdConversations = [];

  await page.route('**/api/platform/bootstrap', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: patchedBootstrap,
  }));
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: true, user: { id: 'five-app-visual-driver', email: 'visual@test.local', name: 'Visual Driver' } }),
  }));

  const summary = [];
  const beforeSandboxIds = new Set((await apiJson(options.runtimeUrl, '/api/sandbox')).map((sandbox) => sandbox.id));
  const beforeConversationIds = new Set((await apiJson(options.runtimeUrl, '/api/conversations?limit=50')).map((conversation) => conversation.id));

  try {
    await page.goto(resolvedBaseUrl, { waitUntil: 'networkidle', timeout: options.timeoutMs });
    await page.locator('textarea').first().waitFor({ timeout: options.timeoutMs });
    await page.waitForTimeout(1000);
    await screenshot(page, outputDir, 'suite-initial-load');

    for (const spec of APP_SPECS) {
      log(`\n[verify-five-apps] ${spec.label}`);
      await page.goto(resolvedBaseUrl, { waitUntil: 'networkidle', timeout: options.timeoutMs });
      await page.locator('textarea').first().waitFor({ timeout: options.timeoutMs });
      await page.waitForTimeout(800);
      const knownConversationIds = new Set((await apiJson(options.runtimeUrl, '/api/conversations?limit=50')).map((conversation) => conversation.id));
      const textarea = page.locator('textarea').first();
      await textarea.click();
      await textarea.fill(spec.prompt);
      await screenshot(page, outputDir, `${spec.slug}-prompt-typed`);
      const assistantCountBefore = await page.locator('[data-chat-message-role="assistant"]').count();
      const sendButton = page.locator('button[title="Send message (Enter)"]').first();
      await sendButton.waitFor({ timeout: options.timeoutMs });
      await sendButton.click();

      const newConversation = await waitForNewConversation(options.runtimeUrl, knownConversationIds, options.timeoutMs);
      createdConversations.push(newConversation.id);
      const sandboxId = newConversation.sandboxProjectId
        ?? await waitForConversationSandboxId(options.runtimeUrl, newConversation.id, options.timeoutMs);
      createdSandboxes.push(sandboxId);

      const responsePreview = await waitForAssistantResponse(page, assistantCountBefore, options.timeoutMs);
      await screenshot(page, outputDir, `${spec.slug}-response-visible`);

      const assistantMessage = await waitForAssistantMessage(options.runtimeUrl, newConversation.id, options.timeoutMs);
      if (!/title="[^"]+"/i.test(assistantMessage.content)) {
        throw new Error(`${spec.label} did not return titled file blocks`);
      }
      if (!spec.verifyResponse(assistantMessage.content)) {
        throw new Error(`${spec.label} response did not contain the expected app markers`);
      }

      const projectUpdateArtifact = await waitForProjectUpdateArtifact(options.runtimeUrl, newConversation.id, options.timeoutMs);
      await screenshot(page, outputDir, `${spec.slug}-builder-running`);
      const previewUrl = projectUpdateArtifact.liveUrl
        ?? (projectUpdateArtifact.port ? `http://127.0.0.1:${projectUpdateArtifact.port}/` : null);
      if (!previewUrl) {
        throw new Error(`${spec.label} project update artifact did not expose a live preview URL`);
      }
      const previewResult = await verifyPreview(spec, context, outputDir, previewUrl, options.widths, options.lighthouse);

      summary.push({
        label: spec.label,
        prompt: spec.prompt,
        conversationId: newConversation.id,
        sandboxId,
        previewUrl: previewResult.resolvedPreviewUrl,
        responseLength: assistantMessage.content.length,
        responsePreview: responsePreview.text.slice(0, 180),
        interaction: previewResult.interactionNote,
        previewAudit: previewResult.previewAudit,
        styleWarnings: previewResult.styleWarnings,
        lighthouse: previewResult.lighthouse,
        screenshots: fs.readdirSync(outputDir).filter((file) => file.startsWith(spec.slug)),
      });

      if (!options.keepProjects) {
        await deleteSandbox(options.runtimeUrl, sandboxId);
        await deleteConversation(options.runtimeUrl, newConversation.id);
      }
    }

    const afterSandboxIds = new Set((await apiJson(options.runtimeUrl, '/api/sandbox')).map((sandbox) => sandbox.id));
    const afterConversationIds = new Set((await apiJson(options.runtimeUrl, '/api/conversations?limit=50')).map((conversation) => conversation.id));
    const report = {
      ok: true,
      baseUrl: resolvedBaseUrl,
      runtimeUrl: options.runtimeUrl,
      keepProjects: options.keepProjects,
      outputDir,
      verifiedApps: summary,
      sandboxDelta: afterSandboxIds.size - beforeSandboxIds.size,
      conversationDelta: afterConversationIds.size - beforeConversationIds.size,
    };

    fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2));
    log(`\n[verify-five-apps] PASS — verified ${summary.length} chat-built apps`);
    log(`[verify-five-apps] Summary: ${path.join(outputDir, 'summary.json')}`);
    await page.waitForTimeout(1500);
  } finally {
    if (!options.keepProjects) {
      for (const sandboxId of [...createdSandboxes].reverse()) {
        await deleteSandbox(options.runtimeUrl, sandboxId);
      }
      for (const conversationId of [...createdConversations].reverse()) {
        await deleteConversation(options.runtimeUrl, conversationId);
      }
    }
    await browser.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[verify-five-apps] FAIL: ${message}`);
  process.exit(1);
});