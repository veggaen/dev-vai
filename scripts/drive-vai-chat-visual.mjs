import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const options = {
    baseUrl: 'http://127.0.0.1:5173',
    runtimeUrl: 'http://127.0.0.1:3006',
    prompt: 'hva er dockre',
    followUp: 'Can you show me a code example?',
    useRelated: true,
    requireSources: false,
    requireRelated: false,
    widths: [375, 768, 1280, 1920],
    timeoutMs: 30000,
    outputDir: '',
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
    if (arg === '--prompt' && next) {
      options.prompt = next;
      index++;
      continue;
    }
    if (arg === '--follow-up' && next) {
      options.followUp = next;
      index++;
      continue;
    }
    if (arg === '--no-related') {
      options.useRelated = false;
      continue;
    }
    if (arg === '--require-sources') {
      options.requireSources = true;
      continue;
    }
    if (arg === '--require-related') {
      options.requireRelated = true;
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
    if (arg === '--output-dir' && next) {
      options.outputDir = next;
      index++;
    }
  }

  return options;
}

function buildOutputDir(customDir) {
  if (customDir) return customDir;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(__dirname, '..', 'screenshots', 'visible-chat-drive', stamp);
}

function log(message) {
  console.log(message);
}

async function screenshot(page, dir, step, name) {
  const filePath = path.join(dir, `${String(step).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  log(`  screenshot: ${path.basename(filePath)}`);
}

async function patchBootstrap(runtimeUrl) {
  const response = await fetch(`${runtimeUrl}/api/platform/bootstrap`);
  if (!response.ok) {
    throw new Error(`Bootstrap failed: ${response.status}`);
  }

  const payload = await response.json();
  payload.auth = {
    ...payload.auth,
    enabled: false,
    authenticated: true,
    user: { id: 'visual-driver', email: 'visual@test.local', name: 'Visual Driver' },
  };
  return JSON.stringify(payload);
}

async function moveToElement(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + (box.width / 2), box.y + (box.height / 2), { steps: 12 });
  await page.waitForTimeout(160);
}

async function typePrompt(page, textarea, prompt) {
  await moveToElement(page, textarea);
  await textarea.click();
  await page.waitForTimeout(120);
  await page.keyboard.type(prompt, { delay: 35 });
}

async function waitForAssistantResponse(page, previousCount, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const selector = '[data-chat-message-role="assistant"]';

  while (Date.now() < deadline) {
    const count = await page.locator(selector).count();
    if (count > previousCount) {
      const target = page.locator(selector).nth(count - 1);
      const text = (await target.textContent())?.replace(/\s+/g, ' ').trim() ?? '';
      if (text.length > 20) {
        return { count, text };
      }
    }
    await page.waitForTimeout(400);
  }

  throw new Error('Timed out waiting for assistant response');
}

async function ensureSourcesVisible(page, outputDir, step, requireSources) {
  const inlineSourceLabel = page.locator('text=/\\d+ source(s)?/i').first();
  const sourceSummaryButton = page.locator('[data-research-source-summary="button"]').first();
  const inlineChip = page.locator('a[aria-label^="Source "]').first();

  const hasSummary = await sourceSummaryButton.count() > 0;
  const hasChip = await inlineChip.count() > 0;
  const hasInlineLabel = await inlineSourceLabel.count() > 0;

  if (!hasSummary && !hasChip && !hasInlineLabel) {
    if (requireSources) throw new Error('No source UI was visible for the latest answer');
    return step;
  }

  if (hasSummary) {
    await moveToElement(page, sourceSummaryButton);
    await screenshot(page, outputDir, step++, 'source-summary-visible');
    await sourceSummaryButton.click();
    await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-research-sidebar="panel"][data-state="open"]')).some((element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }), { timeout: 10000 });
    const sourceItems = page.locator('[data-research-source-item]');
    const count = await sourceItems.count();
    if (count === 0 && requireSources) {
      throw new Error('Source sidebar opened without visible source items');
    }
    await screenshot(page, outputDir, step++, 'source-sidebar-open');
    return step;
  }

  await moveToElement(page, inlineChip);
  await screenshot(page, outputDir, step++, 'source-chips-visible');
  return step;
}

async function clickFirstRelatedFollowUp(page, outputDir, step, timeoutMs, requireRelated) {
  const relatedButtons = page.locator('[data-follow-up-button="button"]');
  const count = await relatedButtons.count();
  if (count === 0) {
    if (requireRelated) throw new Error('No related follow-up buttons were visible');
    return { step, clicked: false };
  }

  const first = relatedButtons.first();
  const assistantCountBefore = await page.locator('[data-chat-message-role="assistant"]').count();
  await moveToElement(page, first);
  await screenshot(page, outputDir, step++, 'related-hover');
  const label = ((await first.textContent()) ?? '').replace(/\s+/g, ' ').trim();
  await first.click();
  const response = await waitForAssistantResponse(page, assistantCountBefore, timeoutMs);
  log(`  related follow-up: ${label.slice(0, 120)}`);
  log(`  related response: ${response.text.slice(0, 140)}`);
  await screenshot(page, outputDir, step++, 'related-response');
  return { step, clicked: true };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputDir = buildOutputDir(options.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  log('Visible Vai chat driver');
  log(`  app: ${options.baseUrl}`);
  log(`  runtime: ${options.runtimeUrl}`);
  log(`  prompt: ${options.prompt}`);
  log(`  requireSources: ${options.requireSources}`);
  log(`  requireRelated: ${options.requireRelated}`);
  log(`  output: ${outputDir}`);

  const health = await fetch(`${options.runtimeUrl}/health`).catch(() => null);
  if (!health?.ok) {
    throw new Error(`Runtime is not reachable at ${options.runtimeUrl}`);
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

  await page.route('**/api/platform/bootstrap', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: patchedBootstrap,
  }));
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: true, user: { id: 'visual-driver', email: 'visual@test.local', name: 'Visual Driver' } }),
  }));

  let step = 1;

  try {
    await page.goto(options.baseUrl, { waitUntil: 'networkidle', timeout: options.timeoutMs });
    await page.waitForSelector('textarea', { timeout: options.timeoutMs });
    await page.waitForTimeout(1000);
    await screenshot(page, outputDir, step++, 'initial-load');

    const textarea = page.locator('textarea').first();
    const sendButton = page.locator('button[title="Send message (Enter)"]').first();
    await typePrompt(page, textarea, options.prompt);
    await screenshot(page, outputDir, step++, 'prompt-typed');

    const assistantCountBefore = await page.locator('[data-chat-message-role="assistant"]').count();
    await moveToElement(page, sendButton);
    await screenshot(page, outputDir, step++, 'send-hover');
    await page.keyboard.press('Enter');

    const firstResponse = await waitForAssistantResponse(page, assistantCountBefore, options.timeoutMs);
    log(`  first response: ${firstResponse.text.slice(0, 140)}`);
    await screenshot(page, outputDir, step++, 'first-response');

    step = await ensureSourcesVisible(page, outputDir, step, options.requireSources);

    const relatedSection = page.locator('text=Related').first();
    if (await relatedSection.count()) {
      await moveToElement(page, relatedSection);
      await screenshot(page, outputDir, step++, 'related-visible');
    } else if (options.requireRelated && options.useRelated) {
      throw new Error('Related section was not visible after the first response');
    }

    let relatedClicked = false;
    if (options.useRelated) {
      const relatedResult = await clickFirstRelatedFollowUp(page, outputDir, step, options.timeoutMs, options.requireRelated);
      step = relatedResult.step;
      relatedClicked = relatedResult.clicked;
    }

    if (!relatedClicked && options.followUp.trim().length > 0) {
      await typePrompt(page, textarea, options.followUp);
      await screenshot(page, outputDir, step++, 'follow-up-typed');
      const followUpCountBefore = await page.locator('[data-chat-message-role="assistant"]').count();
      await page.keyboard.press('Enter');
      const secondResponse = await waitForAssistantResponse(page, followUpCountBefore, options.timeoutMs);
      log(`  follow-up response: ${secondResponse.text.slice(0, 140)}`);
      await screenshot(page, outputDir, step++, 'follow-up-response');
    }

    const scrollContainer = page.locator('[class*="overflow-y-auto"]').first();
    if (await scrollContainer.count()) {
      await scrollContainer.evaluate((element) => element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' }));
      await page.waitForTimeout(800);
      await screenshot(page, outputDir, step++, 'transcript-bottom');
    }

    for (const width of options.widths) {
      await page.setViewportSize({ width, height: width <= 768 ? 900 : 1080 });
      await page.waitForTimeout(700);
      await screenshot(page, outputDir, step++, `viewport-${width}`);
    }

    log('Visual drive finished successfully.');
    log(`Screenshots saved to: ${outputDir}`);
    await page.waitForTimeout(2000);
  } catch (error) {
    await screenshot(page, outputDir, step++, 'error-state').catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Visual drive failed: ${message}`);
  process.exit(1);
});