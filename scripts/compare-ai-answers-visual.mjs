import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { resolveAdapters } from './lib/ai-site-adapters.mjs';
import { resolveSuite } from './lib/ai-compare-suites.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const options = {
    targets: ['vai', 'perplexity', 'chatgpt'],
    suite: '',
    prompt: 'What is Docker?',
    expect: ['docker', 'container'],
    runtimeUrl: 'http://127.0.0.1:3006',
    timeoutMs: 45000,
    manualAuthSeconds: 0,
    limit: 0,
    outputDir: '',
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--targets' && next) {
      options.targets = next.split(',').map((item) => item.trim()).filter(Boolean);
      index++;
      continue;
    }
    if (arg === '--prompt' && next) {
      options.prompt = next;
      index++;
      continue;
    }
    if (arg === '--suite' && next) {
      options.suite = next;
      index++;
      continue;
    }
    if (arg === '--expect' && next) {
      options.expect = next.split(',').map((item) => item.trim()).filter(Boolean);
      index++;
      continue;
    }
    if (arg === '--runtime-url' && next) {
      options.runtimeUrl = next;
      index++;
      continue;
    }
    if (arg === '--timeout-ms' && next) {
      options.timeoutMs = Number.parseInt(next, 10) || options.timeoutMs;
      index++;
      continue;
    }
    if (arg === '--manual-auth-seconds' && next) {
      options.manualAuthSeconds = Number.parseInt(next, 10) || 0;
      index++;
      continue;
    }
    if (arg === '--limit' && next) {
      options.limit = Number.parseInt(next, 10) || 0;
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

function defaultOutputDir(customDir) {
  if (customDir) return customDir;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(__dirname, '..', 'screenshots', 'ai-compare', stamp);
}

function log(message) {
  console.log(message);
}

function sanitizeSegment(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'item';
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

async function screenshot(page, outputDir, targetId, step, name) {
  const fileName = `${String(step).padStart(2, '0')}-${sanitizeSegment(targetId)}-${sanitizeSegment(name)}.png`;
  const filePath = path.join(outputDir, fileName);
  await page.screenshot({ path: filePath, fullPage: false });
  log(`  screenshot: ${fileName}`);
  return filePath;
}

async function patchVaiBootstrap(runtimeUrl) {
  const response = await fetch(`${runtimeUrl}/api/platform/bootstrap`);
  if (!response.ok) {
    throw new Error(`Failed to fetch Vai bootstrap: ${response.status}`);
  }

  const payload = await response.json();
  payload.auth = {
    ...payload.auth,
    enabled: false,
    authenticated: true,
    user: { id: 'ai-compare', email: 'compare@test.local', name: 'AI Compare' },
  };
  return JSON.stringify(payload);
}

async function installVaiAuthBypass(context, runtimeUrl) {
  const patchedBootstrap = await patchVaiBootstrap(runtimeUrl);
  await context.route('**/api/platform/bootstrap', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: patchedBootstrap,
  }));
  await context.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: true, user: { id: 'ai-compare', email: 'compare@test.local', name: 'AI Compare' } }),
  }));
}

async function moveToElement(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + (box.width / 2), box.y + (box.height / 2), { steps: 10 });
  await page.waitForTimeout(150);
}

async function findFirstVisible(page, selectors, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.count() > 0) {
        try {
          if (await locator.isVisible()) return locator;
        } catch {}
      }
    }
    await page.waitForTimeout(250);
  }
  return null;
}

async function hasAnyVisible(page, selectors) {
  if (!selectors || selectors.length === 0) return false;
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count() > 0) {
      try {
        if (await locator.isVisible()) return true;
      } catch {}
    }
  }
  return false;
}

async function waitForPromptSurface(page, adapter, manualAuthSeconds) {
  const prompt = await findFirstVisible(page, adapter.promptSelectors, adapter.readyWaitMs ?? 5000);
  if (prompt) return { prompt, blockedReason: null };

  const blockedByLogin = await hasAnyVisible(page, adapter.loginSentinelSelectors ?? []);
  if (blockedByLogin && manualAuthSeconds > 0) {
    log(`  ${adapter.label}: waiting ${manualAuthSeconds}s for manual auth...`);
    await page.waitForTimeout(manualAuthSeconds * 1000);
    const retriedPrompt = await findFirstVisible(page, adapter.promptSelectors, 4000);
    if (retriedPrompt) return { prompt: retriedPrompt, blockedReason: null };
  }

  if (blockedByLogin) {
    return { prompt: null, blockedReason: `${adapter.label} appears to require login.` };
  }
  return { prompt: null, blockedReason: `${adapter.label} prompt surface was not found.` };
}

async function submitPrompt(page, adapter, promptLocator, promptText) {
  await moveToElement(page, promptLocator);
  await promptLocator.click();
  await page.waitForTimeout(100);

  const tagName = await promptLocator.evaluate((element) => element.tagName.toLowerCase()).catch(() => '');
  if (tagName === 'textarea' || tagName === 'input') {
    await promptLocator.fill('');
  }

  await page.keyboard.type(promptText, { delay: 28 });
  const submitLocator = await findFirstVisible(page, adapter.submitSelectors ?? [], 1500);
  if (submitLocator) {
    await moveToElement(page, submitLocator);
    await submitLocator.click();
  } else {
    await page.keyboard.press('Enter');
  }
}

async function captureResponseBaseline(page, adapter) {
  if (adapter.responseMode === 'assistant-list') {
    const selectors = adapter.assistantSelectors ?? [];
    return { assistantCount: await page.locator(selectors.join(', ')).count() };
  }

  const container = adapter.responseContainerSelector ? page.locator(adapter.responseContainerSelector).first() : page.locator('main').first();
  const text = ((await container.textContent()) ?? '').replace(/\s+/g, ' ').trim();
  return { containerText: text };
}

async function waitForAssistantListResponse(page, adapter, timeoutMs, baselineCount) {
  const selectors = adapter.assistantSelectors ?? [];
  const combined = selectors.join(', ');
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const count = await page.locator(combined).count();
    if (count > baselineCount) {
      const target = page.locator(combined).nth(count - 1);
      const text = ((await target.textContent()) ?? '').replace(/\s+/g, ' ').trim();
      if (text.length > 40) return text;
    }
    await page.waitForTimeout(500);
  }
  throw new Error('Timed out waiting for assistant list response');
}

async function waitForContainerGrowthResponse(page, adapter, timeoutMs, promptText, baselineText) {
  const container = adapter.responseContainerSelector ? page.locator(adapter.responseContainerSelector).first() : page.locator('main').first();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const text = ((await container.textContent()) ?? '').replace(/\s+/g, ' ').trim();
    if (text.length > baselineText.length + 120) {
      const normalized = text.replace(promptText, '').trim();
      if (normalized.length > 60) return normalized;
    }
    await page.waitForTimeout(700);
  }
  throw new Error('Timed out waiting for container-growth response');
}

async function waitForResponse(page, adapter, timeoutMs, promptText, baseline) {
  if (adapter.responseMode === 'assistant-list') {
    return waitForAssistantListResponse(page, adapter, timeoutMs, baseline.assistantCount ?? 0);
  }
  return waitForContainerGrowthResponse(page, adapter, timeoutMs, promptText, baseline.containerText ?? '');
}

function cleanAnswerText(adapter, rawText, promptText) {
  let cleaned = normalizeWhitespace(rawText);
  if (promptText) {
    cleaned = cleaned.replace(new RegExp(promptText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ');
    cleaned = normalizeWhitespace(cleaned);
  }

  for (const pattern of adapter.answerNoisePatterns ?? []) {
    cleaned = cleaned.replace(new RegExp(pattern, 'i'), ' ');
    cleaned = normalizeWhitespace(cleaned);
  }

  cleaned = cleaned
    .replace(/^answer\s+/i, '')
    .replace(/^links\s+/i, '')
    .replace(/^images\s+/i, '')
    .replace(/^share\s+/i, '')
    .replace(/^download\s+/i, '')
    .replace(/^comet\s+/i, '');

  cleaned = cleaned
    .replace(/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[a-z0-9-._~:/?#[\]@!$&'()*+,;=]*)?\d*\s*/i, '')
    .replace(/^(?:[a-z0-9-]+\.)+[a-z]{2,}\d*\s*/i, '')
    .replace(/^\d+%\s*/i, '')
    .replace(/^\d+\s*sources?\s*/i, '')
    .replace(/^(?:\d+\s*){1,4}(?=[a-z])/i, '')
    .replace(/^[^a-z0-9]+/i, '');

  return normalizeWhitespace(cleaned);
}

function scoreAnswer(answerText, expectedTerms) {
  const lower = answerText.toLowerCase();
  const hits = expectedTerms.filter((term) => lower.includes(term.toLowerCase()));
  const wordCount = answerText.split(/\s+/).filter(Boolean).length;
  const density = expectedTerms.length === 0 ? 1 : hits.length / expectedTerms.length;
  return {
    hitCount: hits.length,
    hits,
    wordCount,
    density,
    score: Math.round(((density * 0.7) + (Math.min(wordCount, 160) >= 12 ? 0.3 : 0.1)) * 100),
    passed: expectedTerms.length === 0 ? answerText.length > 40 : hits.length === expectedTerms.length,
  };
}

async function collectUiSignals(page, adapter) {
  const sourceVisible = await hasAnyVisible(page, adapter.sourceSelectors ?? []);
  const followUpVisible = await hasAnyVisible(page, adapter.followUpSelectors ?? []);
  return { sourceVisible, followUpVisible };
}

async function runTarget(page, adapter, options, outputDir, stepCounter) {
  const result = {
    target: adapter.id,
    label: adapter.label,
    status: 'failed',
    durationMs: 0,
    answerPreview: '',
    keywordHits: [],
    sourceVisible: false,
    followUpVisible: false,
    screenshots: [],
    score: 0,
    wordCount: 0,
    note: adapter.hint ?? '',
  };

  const start = performance.now();
  await page.goto(adapter.url, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs });
  await page.waitForTimeout(adapter.readyWaitMs ?? 1500);
  result.screenshots.push(await screenshot(page, outputDir, adapter.id, stepCounter.value++, 'initial'));

  const { prompt, blockedReason } = await waitForPromptSurface(page, adapter, options.manualAuthSeconds);
  if (!prompt) {
    result.status = 'blocked';
    result.note = blockedReason ?? result.note;
    result.durationMs = Math.round(performance.now() - start);
    return result;
  }

  const baseline = await captureResponseBaseline(page, adapter);
  await submitPrompt(page, adapter, prompt, options.prompt);
  result.screenshots.push(await screenshot(page, outputDir, adapter.id, stepCounter.value++, 'prompt-submitted'));

  let answerText;
  try {
    answerText = await waitForResponse(page, adapter, options.timeoutMs, options.prompt, baseline);
  } catch (error) {
    const timedOut = error instanceof Error && /timed out/i.test(error.message);
    const blockedByLogin = await hasAnyVisible(page, adapter.loginSentinelSelectors ?? []);
    if (adapter.requiresAuth && (blockedByLogin || timedOut)) {
      result.status = 'blocked';
      result.note = `${adapter.label} likely requires a live authenticated session for comparison.`;
      result.durationMs = Math.round(performance.now() - start);
      return result;
    }
    throw error;
  }
  const cleanedAnswer = cleanAnswerText(adapter, answerText, options.prompt);
  result.answerPreview = cleanedAnswer.slice(0, 320);
  result.screenshots.push(await screenshot(page, outputDir, adapter.id, stepCounter.value++, 'response'));

  const signals = await collectUiSignals(page, adapter);
  result.sourceVisible = signals.sourceVisible;
  result.followUpVisible = signals.followUpVisible;

  const score = scoreAnswer(cleanedAnswer, options.expect);
  result.keywordHits = score.hits;
  result.score = score.score;
  result.wordCount = score.wordCount;
  result.status = score.passed ? 'passed' : 'failed';
  if (!score.passed && score.hits.length === 0) {
    result.note = `${result.note ? `${result.note} ` : ''}Expected terms were not all present.`.trim();
  }
  result.durationMs = Math.round(performance.now() - start);
  return result;
}

function buildSummary(results) {
  return results.map((result) => ({
    target: result.target,
    promptId: result.promptId,
    status: result.status,
    score: result.score,
    durationMs: result.durationMs,
    sourceVisible: result.sourceVisible,
    followUpVisible: result.followUpVisible,
    keywordHits: result.keywordHits.join(', '),
    note: result.note,
  }));
}

function buildAggregate(results, prompts, targets) {
  const byTarget = targets.map((target) => {
    const subset = results.filter((result) => result.target === target.id);
    const passed = subset.filter((result) => result.status === 'passed').length;
    const blocked = subset.filter((result) => result.status === 'blocked').length;
    const failed = subset.filter((result) => result.status === 'failed').length;
    const avgScore = subset.length > 0
      ? Math.round(subset.reduce((sum, result) => sum + (result.score ?? 0), 0) / subset.length)
      : 0;
    const avgDurationMs = subset.length > 0
      ? Math.round(subset.reduce((sum, result) => sum + (result.durationMs ?? 0), 0) / subset.length)
      : 0;
    return {
      target: target.id,
      label: target.label,
      promptCount: prompts.length,
      passed,
      blocked,
      failed,
      avgScore,
      avgDurationMs,
    };
  });

  return { byTarget };
}

function writeMarkdownSummary(outputDir, report) {
  const lines = [];
  lines.push('# AI Comparison Summary');
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Prompt count: ${report.prompts.length}`);
  lines.push(`- Targets: ${report.targets.map((target) => target.id).join(', ')}`);
  lines.push('');
  lines.push('## Aggregate');
  lines.push('');
  lines.push('| Target | Passed | Blocked | Failed | Avg score | Avg duration ms |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const row of report.aggregate.byTarget) {
    lines.push(`| ${row.label} | ${row.passed} | ${row.blocked} | ${row.failed} | ${row.avgScore} | ${row.avgDurationMs} |`);
  }
  lines.push('');
  lines.push('## Results');
  lines.push('');
  lines.push('| Prompt | Target | Status | Score | Hits | Sources | Follow-ups |');
  lines.push('|---|---|---|---:|---|---|---|');
  for (const result of report.results) {
    lines.push(`| ${result.promptId} | ${result.label} | ${result.status} | ${result.score ?? 0} | ${result.keywordHits.join(', ')} | ${result.sourceVisible ? 'yes' : 'no'} | ${result.followUpVisible ? 'yes' : 'no'} |`);
  }
  lines.push('');

  fs.writeFileSync(path.join(outputDir, 'summary.md'), `${lines.join('\n')}\n`, 'utf8');
}

function buildPromptWorkItems(options) {
  if (options.suite) {
    const suite = resolveSuite(options.suite);
    const prompts = options.limit > 0 ? suite.prompts.slice(0, options.limit) : suite.prompts;
    return { suite, prompts };
  }

  return {
    suite: null,
    prompts: [{ id: 'single', prompt: options.prompt, expect: options.expect }],
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const adapters = resolveAdapters(options.targets);
  const work = buildPromptWorkItems(options);
  const outputDir = defaultOutputDir(options.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  log('Visible AI comparison harness');
  log(`  prompt mode: ${work.suite ? `suite:${work.suite.id}` : 'single'}`);
  if (!work.suite) log(`  prompt: ${options.prompt}`);
  log(`  targets: ${adapters.map((adapter) => adapter.id).join(', ')}`);
  log(`  output: ${outputDir}`);

  const browser = await chromium.launch({
    headless: false,
    slowMo: 50,
    args: ['--no-sandbox', '--start-maximized', '--window-size=1920,1080'],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });

  if (adapters.some((adapter) => adapter.id === 'vai')) {
    await installVaiAuthBypass(context, options.runtimeUrl);
  }

  const results = [];
  const stepCounter = { value: 1 };

  try {
    for (const promptItem of work.prompts) {
      log(`\n══ Prompt: ${promptItem.id} ══`);
      for (const adapter of adapters) {
        log(`▸ Running ${adapter.label}`);
        const page = await context.newPage();
        try {
          const result = await runTarget(page, adapter, { ...options, prompt: promptItem.prompt, expect: promptItem.expect }, outputDir, stepCounter);
          result.promptId = promptItem.id;
          result.prompt = promptItem.prompt;
          result.expectedTerms = promptItem.expect;
          results.push(result);
          log(`  status: ${result.status}`);
          if (result.answerPreview) {
            log(`  answer: ${result.answerPreview.slice(0, 180)}`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const failure = {
            target: adapter.id,
            label: adapter.label,
            promptId: promptItem.id,
            prompt: promptItem.prompt,
            expectedTerms: promptItem.expect,
            status: 'failed',
            durationMs: 0,
            answerPreview: '',
            keywordHits: [],
            sourceVisible: false,
            followUpVisible: false,
            screenshots: [],
            score: 0,
            wordCount: 0,
            note: message,
          };
          failure.screenshots.push(await screenshot(page, outputDir, adapter.id, stepCounter.value++, 'error').catch(() => ''));
          results.push(failure);
          log(`  status: failed`);
          log(`  error: ${message}`);
        } finally {
          await page.close().catch(() => {});
        }
      }
    }
  } finally {
    await browser.close();
  }

  const report = {
    mode: work.suite ? 'suite' : 'single',
    suite: work.suite ? { id: work.suite.id, label: work.suite.label } : null,
    prompt: work.suite ? null : options.prompt,
    expectedTerms: work.suite ? null : options.expect,
    prompts: work.prompts,
    targets: adapters.map((adapter) => ({ id: adapter.id, label: adapter.label })),
    generatedAt: new Date().toISOString(),
    outputDir,
    results,
    aggregate: buildAggregate(results, work.prompts, adapters),
  };
  fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  writeMarkdownSummary(outputDir, report);

  log('\nSummary');
  console.table(buildSummary(results));
  log('\nAggregate');
  console.table(report.aggregate.byTarget);

  const hardFailures = results.filter((result) => result.status === 'failed');
  if (hardFailures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});