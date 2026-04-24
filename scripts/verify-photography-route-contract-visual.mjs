#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_AUTH_BYPASS_HEADERS = { 'x-vai-dev-auth-bypass': '1' };
const SPEC = {
  slug: 'photography-route-contract',
  label: 'Photography Route Contract',
  prompt: 'Build me a website for a pro Norwegian nature photographer with distinct home, gallery, and contact pages. Use relevant nature imagery and context, and make the result feel like a real photography site rather than a generic landing page.',
  responseChecks: [
    'react-router-dom',
    '```tsx title="src/App.tsx"',
    '```tsx title="src/main.tsx"',
    'to="/gallery"',
    'to="/contact"',
    'Norwegian nature photographer',
    'https://images.unsplash.com/',
  ],
};

function parseArgs(argv) {
  const options = {
    baseUrl: 'http://localhost:5173?devAuthBypass=1',
    runtimeUrl: process.env.VAI_API?.trim() || 'http://127.0.0.1:3006',
    outputDir: '',
    keepProject: false,
    timeoutMs: 240000,
    widths: [375, 768, 1280, 1920, 2560],
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
    if (arg === '--keep-project') {
      options.keepProject = true;
      continue;
    }
    if (arg === '--timeout-ms' && next) {
      options.timeoutMs = Number.parseInt(next, 10) || options.timeoutMs;
      index++;
      continue;
    }
    if (arg === '--widths' && next) {
      options.widths = next
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isFinite(value) && value >= 320);
      index++;
    }
  }

  return options;
}

function buildOutputDir(customDir) {
  if (customDir) return customDir;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(__dirname, '..', 'screenshots', 'photography-route-contract', stamp);
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
    user: { id: 'photo-route-driver', email: 'visual@test.local', name: 'Visual Driver' },
  };
  return JSON.stringify(payload);
}

async function screenshot(page, outputDir, name) {
  const filePath = path.join(outputDir, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false, animations: 'disabled', timeout: 0 });
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
  return /favicon\.ico/i.test(message)
    || /Failed to load resource: the server responded with a status of 404 \(Not Found\)/i.test(message);
}

async function auditPreview(page) {
  return page.evaluate(() => {
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
        return { radius: Math.round(radius) };
      })
      .filter(Boolean);

    const links = Array.from(document.querySelectorAll('a[href]'));
    const routeLinks = links.filter((link) => {
      const href = link.getAttribute('href') || '';
      return href.startsWith('/') && !href.startsWith('//');
    });

    return {
      path: window.location.pathname,
      regionCount: document.querySelectorAll('section, article, nav, aside, form').length,
      buttonCount: document.querySelectorAll('button').length,
      imageCount: document.querySelectorAll('img').length,
      formCount: document.querySelectorAll('form').length,
      inputCount: document.querySelectorAll('input, textarea, select').length,
      routeLinkCount: routeLinks.length,
      surfaceCount: surfaces.length,
      largeRoundedCount: surfaces.filter((surface) => surface.radius >= 18).length,
      maxRadius: surfaces.length > 0 ? Math.max(...surfaces.map((surface) => surface.radius)) : 0,
      scrollHeight: Math.round(document.documentElement.scrollHeight),
    };
  });
}

function buildStyleWarnings(audit) {
  const warnings = [];
  const largeRoundedRatio = audit.surfaceCount > 0 ? audit.largeRoundedCount / audit.surfaceCount : 0;
  if (audit.surfaceCount >= 8 && largeRoundedRatio >= 0.55) {
    warnings.push('rounded-box-density-high');
  }
  if (audit.maxRadius >= 28 && audit.largeRoundedCount >= 6) {
    warnings.push('large-radius-overuse');
  }
  return warnings;
}

async function waitForPathname(page, pathname, timeoutMs) {
  await page.waitForFunction((expected) => window.location.pathname === expected, pathname, { timeout: timeoutMs });
}

async function captureResponsiveShots(page, outputDir, widths) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width <= 768 ? 980 : 1180 });
    await page.waitForTimeout(350);
    await screenshot(page, outputDir, `${SPEC.slug}-responsive-${width}`);
  }
}

async function verifyPreview(previewPage, outputDir, timeoutMs, widths) {
  const pageErrors = [];
  const consoleErrors = [];

  previewPage.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  previewPage.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await previewPage.getByText('Norwegian nature photographer', { exact: true }).first().waitFor({ timeout: timeoutMs });
  await previewPage.getByRole('link', { name: 'Gallery', exact: true }).hover();
  await screenshot(previewPage, outputDir, `${SPEC.slug}-home-loaded`);
  const homeAudit = await auditPreview(previewPage);
  if (homeAudit.path !== '/' || homeAudit.routeLinkCount < 4 || homeAudit.imageCount < 1) {
    throw new Error(`Home route audit failed: ${JSON.stringify(homeAudit)}`);
  }

  await previewPage.getByRole('link', { name: 'Gallery', exact: true }).click();
  await waitForPathname(previewPage, '/gallery', timeoutMs);
  await previewPage.getByText('Relevant nature context, real imagery, and a route that stands on its own.', { exact: true }).waitFor({ timeout: timeoutMs });
  const galleryCards = previewPage.locator('.gallery-card');
  const galleryCardCount = await galleryCards.count();
  if (galleryCardCount < 4) {
    throw new Error(`Gallery route only rendered ${galleryCardCount} gallery cards before interaction`);
  }
  await galleryCards.first().click();
  await previewPage.getByRole('link', { name: 'Plan a shoot like this', exact: true }).waitFor({ timeout: timeoutMs });
  await screenshot(previewPage, outputDir, `${SPEC.slug}-gallery-route`);
  const galleryAudit = await auditPreview(previewPage);
  if (galleryAudit.path !== '/gallery' || galleryAudit.routeLinkCount < 3 || galleryAudit.imageCount < 2 || galleryAudit.buttonCount < 4) {
    throw new Error(`Gallery route audit failed: ${JSON.stringify(galleryAudit)}`);
  }

  await previewPage.getByRole('link', { name: 'Contact', exact: true }).hover();
  await previewPage.getByRole('link', { name: 'Contact', exact: true }).click();
  await waitForPathname(previewPage, '/contact', timeoutMs);
  await previewPage.getByRole('heading', { name: 'Plan the shoot, the location, and the delivery expectations.' }).waitFor({ timeout: timeoutMs });
  await previewPage.getByLabel('Name').fill('Visual Driver');
  await previewPage.getByLabel('Email').fill('visual@test.local');
  await previewPage.getByLabel('Shoot type').fill('Nature editorial');
  await previewPage.getByLabel('Brief').fill('Need a visible route contract pass that proves the gallery and contact flows are real.');
  await screenshot(previewPage, outputDir, `${SPEC.slug}-contact-route`);
  const contactAudit = await auditPreview(previewPage);
  if (contactAudit.path !== '/contact' || contactAudit.formCount < 1 || contactAudit.inputCount < 4 || contactAudit.routeLinkCount < 3) {
    throw new Error(`Contact route audit failed: ${JSON.stringify(contactAudit)}`);
  }

  await captureResponsiveShots(previewPage, outputDir, widths);

  if (pageErrors.length > 0) {
    throw new Error(`Preview threw page errors: ${pageErrors.join(' | ')}`);
  }
  const significantConsoleErrors = consoleErrors.filter((message) => !isIgnorableConsoleError(message));
  if (significantConsoleErrors.length > 0) {
    throw new Error(`Preview logged console errors: ${significantConsoleErrors.join(' | ')}`);
  }

  return {
    homeAudit,
    galleryAudit,
    contactAudit,
    styleWarnings: {
      home: buildStyleWarnings(homeAudit),
      gallery: buildStyleWarnings(galleryAudit),
      contact: buildStyleWarnings(contactAudit),
    },
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
    body: JSON.stringify({ authenticated: true, user: { id: 'photo-route-driver', email: 'visual@test.local', name: 'Visual Driver' } }),
  }));

  try {
    await page.goto(resolvedBaseUrl, { waitUntil: 'networkidle', timeout: options.timeoutMs });
    await page.locator('textarea').first().waitFor({ timeout: options.timeoutMs });
    await page.waitForTimeout(1000);
    await screenshot(page, outputDir, `${SPEC.slug}-shell-loaded`);

    const knownConversationIds = new Set((await apiJson(options.runtimeUrl, '/api/conversations?limit=50')).map((conversation) => conversation.id));
    const textarea = await startFreshBuilderChat(page);
    await textarea.fill(SPEC.prompt);
    await screenshot(page, outputDir, `${SPEC.slug}-prompt-typed`);
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
    await screenshot(page, outputDir, `${SPEC.slug}-response-visible`);

    const assistantMessage = await waitForAssistantMessage(options.runtimeUrl, newConversation.id, options.timeoutMs);
    for (const marker of SPEC.responseChecks) {
      if (!assistantMessage.content.includes(marker)) {
        throw new Error(`Builder response missed marker: ${marker}`);
      }
    }

    const projectUpdateArtifact = await waitForProjectUpdateArtifact(options.runtimeUrl, newConversation.id, options.timeoutMs);
    const previewUrl = projectUpdateArtifact.liveUrl
      ?? (projectUpdateArtifact.port ? `http://127.0.0.1:${projectUpdateArtifact.port}/` : null);
    if (!previewUrl) {
      throw new Error('Project update artifact did not expose a live preview URL');
    }

    const previewPage = await context.newPage();
    await previewPage.setViewportSize({ width: 1440, height: 1180 });
    const resolvedPreviewUrl = await resolvePreviewUrl(previewUrl);
    await previewPage.goto(resolvedPreviewUrl, { waitUntil: 'networkidle', timeout: 120000 });
    const previewResult = await verifyPreview(previewPage, outputDir, options.timeoutMs, options.widths);
    await previewPage.close();

    const report = {
      ok: true,
      label: SPEC.label,
      prompt: SPEC.prompt,
      baseUrl: resolvedBaseUrl,
      runtimeUrl: options.runtimeUrl,
      conversationId: newConversation.id,
      sandboxId,
      previewUrl: resolvedPreviewUrl,
      responseLength: assistantMessage.content.length,
      responsePreview: responsePreview.text.slice(0, 220),
      previewAudit: previewResult,
      screenshots: fs.readdirSync(outputDir).filter((file) => file.startsWith(SPEC.slug)),
    };

    fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2));
    log(`\n[verify-photo-route] PASS — verified explicit photography route contract`);
    log(`[verify-photo-route] Summary: ${path.join(outputDir, 'summary.json')}`);

    if (!options.keepProject) {
      await deleteSandbox(options.runtimeUrl, sandboxId);
      await deleteConversation(options.runtimeUrl, newConversation.id);
    }
  } finally {
    if (!options.keepProject) {
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
  console.error(`[verify-photo-route] FAIL: ${message}`);
  process.exit(1);
});