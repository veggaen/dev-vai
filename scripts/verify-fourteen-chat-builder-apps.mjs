#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const DEV_AUTH_BYPASS_HEADERS = { 'x-vai-dev-auth-bypass': '1' };

const APP_SPECS = [
  {
    slug: 'neon-fitness-landing',
    prompt: 'Build a one-page neon fitness landing page I can preview. It must include the exact heading Kinetic Pulse, a hero paragraph, and a primary CTA button labeled Start Training. Use a dark visual style and make it runnable now.',
    expectedPaths: ['package.json', 'src/App.tsx', 'src/styles.css'],
    expectedPathGroups: [['package.json'], ['src/App.tsx', 'src/App.jsx'], ['src/styles.css']],
    requiredText: ['Kinetic Pulse', 'Start Training'],
    preview: true,
  },
  {
    slug: 'shared-shopping-list',
    prompt: 'Build the first runnable version now. Create a compact but polished shared shopping app for a household or roommates. Use Tailwind CSS v4 styling and framer-motion for subtle motion, seed mock data for members, items, aisle or category groupings, and activity messages. The preview must visibly include the heading Shared Shopping List plus separate sections labeled Household and Activity Chat.',
    expectedPaths: ['package.json', 'src/App.tsx'],
    expectedPathGroups: [['package.json'], ['src/App.tsx', 'src/App.jsx']],
    requiredText: ['Shared Shopping List', 'Household', 'Activity Chat'],
    preview: true,
  },
  {
    slug: 'photography-portfolio',
    prompt: 'Build me a photography portfolio with a fullscreen lightbox and masonry gallery. Make it feel like a premium editorial portfolio, not a generic starter.',
    expectedPaths: ['package.json', 'src/App.tsx', 'src/styles.css'],
    expectedPathGroups: [['package.json'], ['src/App.tsx', 'src/App.jsx'], ['src/styles.css']],
    requiredText: ['Photography', 'lightbox', 'gallery'],
    preview: true,
  },
  {
    slug: 'custom-storefront',
    prompt: 'Build a custom storefront app for a premium home goods brand. It needs catalog, product detail, cart summary, and checkout-ready flow in the first preview.',
    expectedPaths: ['package.json', 'src/App.tsx', 'src/styles.css'],
    expectedPathGroups: [['package.json'], ['src/App.tsx', 'src/App.jsx'], ['src/styles.css']],
    requiredText: ['Custom storefront', 'Catalog', 'Cart'],
    preview: true,
  },
  {
    slug: 'social-blog',
    prompt: 'Build a social blogging app I can preview. Include a write-post form, a feed, and real-looking seeded posts.',
    expectedPaths: ['package.json', 'src/App.tsx'],
    expectedPathGroups: [['package.json'], ['src/App.tsx', 'src/App.jsx']],
    requiredText: ['Social', 'Post', 'Feed'],
    preview: true,
  },
  {
    slug: 'ops-control-center',
    prompt: 'Build an internal ops dashboard app I can preview. It should include an approval queue, live activity, operational metrics, and obvious action buttons.',
    expectedPaths: ['package.json', 'src/App.tsx'],
    expectedPathGroups: [['package.json'], ['src/App.tsx', 'src/App.jsx']],
    requiredText: ['Ops', 'Approval', 'Activity'],
    preview: true,
  },
  {
    slug: 'saas-workspace',
    prompt: 'Build a premium SaaS workspace with auth, billing, settings, audit logs, and chat I can preview.',
    expectedPaths: ['package.json', 'src/App.tsx'],
    expectedPathGroups: [['package.json'], ['src/App.tsx', 'src/App.jsx']],
    requiredText: ['SaaS', 'Audit', 'Chat'],
    preview: true,
  },
  {
    slug: 'analytics-dashboard',
    prompt: 'Build an analytics dashboard with charts, revenue over time, traffic sources, KPI cards, and date range filters.',
    expectedPaths: ['package.json', 'src/App.tsx'],
    expectedPathGroups: [['package.json'], ['src/App.tsx', 'src/App.jsx']],
    requiredText: ['Analytics Dashboard', 'Revenue Over Time', 'Traffic Sources'],
    preview: true,
  },
  {
    slug: 'booking-studio',
    prompt: 'Build a booking scheduler app for a small creative studio. Include appointments, customers, schedule, and a booking CTA.',
    expectedPaths: ['package.json', 'src/App.tsx'],
    expectedPathGroups: [['package.json'], ['src/App.tsx', 'src/App.jsx']],
    requiredText: ['Booking', 'appointments', 'schedule'],
    preview: true,
  },
  {
    slug: 'fitness-tracker',
    prompt: 'Build a personal training tracker app with weekly plan, progress metrics, session toggles, and recovery checklist.',
    expectedPaths: ['package.json', 'src/App.tsx'],
    expectedPathGroups: [['package.json'], ['src/App.tsx', 'src/App.jsx']],
    requiredText: ['Training', 'Weekly plan', 'sessions'],
    preview: true,
  },
  {
    slug: 'dating-matcher',
    prompt: 'Build a Tinder-inspired dating matcher app with swipe-style profile deck, matches, and chat preview. Do not copy branding.',
    expectedPaths: ['package.json', 'src/App.tsx'],
    expectedPathGroups: [['package.json'], ['src/App.tsx', 'src/App.jsx']],
    requiredText: ['match', 'profile', 'chat'],
    preview: true,
  },
  {
    slug: 'x-social-feed',
    prompt: 'Build an X/Twitter-inspired social feed app with composer, timeline, who-to-follow, and trend cards. Do not copy logos.',
    expectedPaths: ['package.json', 'src/App.tsx'],
    expectedPathGroups: [['package.json'], ['src/App.tsx', 'src/App.jsx']],
    requiredText: ['timeline', 'composer', 'follow'],
    preview: true,
  },
  {
    slug: 'fastapi-inventory-api',
    prompt: 'Build a Python FastAPI inventory API with health, list, create, update, and delete endpoints. Return complete runnable files.',
    expectedPaths: ['requirements.txt', 'main.py'],
    requiredText: ['FastAPI', '/health', '/items'],
    requiredFilePatterns: [
      { paths: ['main.py'], pattern: /app\s*=\s*FastAPI\s*\(/, label: 'FastAPI app instance' },
      { paths: ['main.py'], pattern: /@app\.get\(["']\/health["']\)/, label: 'GET /health endpoint' },
      { paths: ['main.py'], pattern: /@app\.get\(["']\/items["']\)/, label: 'GET /items endpoint' },
      { paths: ['main.py'], pattern: /@app\.post\(["']\/items["'][^)]*\)/, label: 'POST /items endpoint' },
      { paths: ['main.py'], pattern: /@app\.put\(["']\/items\/\{item_id\}["'][^)]*\)/, label: 'PUT /items/{item_id} endpoint' },
      { paths: ['main.py'], pattern: /@app\.delete\(["']\/items\/\{item_id\}["'][^)]*\)/, label: 'DELETE /items/{item_id} endpoint' },
    ],
    preview: false,
  },
  {
    slug: 'rust-incident-cli',
    prompt: 'Build a Rust CLI incident triage tool with clap commands. Return Cargo.toml and src/main.rs as separate complete files.',
    expectedPaths: ['Cargo.toml', 'src/main.rs'],
    requiredText: ['Rust CLI', 'clap', 'Commands'],
    requiredFilePatterns: [
      { paths: ['Cargo.toml'], pattern: /\[package\][\s\S]*name\s*=\s*["'][^"']+["']/, label: 'Cargo package metadata' },
      { paths: ['Cargo.toml'], pattern: /clap\s*=/, label: 'clap dependency' },
      { paths: ['src/main.rs'], pattern: /derive\s*\(\s*Parser\s*\)|Command::new|Subcommand/, label: 'clap command parser' },
      { paths: ['src/main.rs'], pattern: /(?:triage|incident|sev|status|list|add)/i, label: 'incident triage domain commands' },
    ],
    preview: false,
  },
];

function parseArgs(argv) {
  const options = {
    appUrl: process.env.VAI_APP_URL || 'http://127.0.0.1:5173/?devAuthBypass=1',
    apiUrl: (process.env.VAI_API_URL || 'http://127.0.0.1:3006').replace(/\/$/, ''),
    limit: APP_SPECS.length,
    previewLimit: 4,
    keepProjects: false,
    only: [],
    outputDir: path.join(ROOT, '.codex-run', `fourteen-app-gauntlet-${new Date().toISOString().replace(/[:.]/g, '-')}`),
    timeoutMs: 180_000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--app-url' && next) {
      options.appUrl = next;
      index += 1;
    } else if (arg === '--api-url' && next) {
      options.apiUrl = next.replace(/\/$/, '');
      index += 1;
    } else if (arg === '--limit' && next) {
      options.limit = Number.parseInt(next, 10) || options.limit;
      index += 1;
    } else if (arg === '--preview-limit' && next) {
      options.previewLimit = Number.parseInt(next, 10) || options.previewLimit;
      index += 1;
    } else if (arg === '--output-dir' && next) {
      options.outputDir = path.resolve(next);
      index += 1;
    } else if (arg === '--timeout-ms' && next) {
      options.timeoutMs = Number.parseInt(next, 10) || options.timeoutMs;
      index += 1;
    } else if (arg === '--only' && next) {
      options.only = next.split(',').map((slug) => slug.trim()).filter(Boolean);
      index += 1;
    } else if (arg === '--keep-projects') {
      options.keepProjects = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/verify-fourteen-chat-builder-apps.mjs [--limit 14] [--only slug-a,slug-b] [--preview-limit 4] [--keep-projects]');
      process.exit(0);
    }
  }

  return options;
}

async function apiJson(apiUrl, relativePath, init) {
  const response = await fetch(`${apiUrl}${relativePath}`, {
    ...init,
    headers: {
      ...DEV_AUTH_BYPASS_HEADERS,
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`${relativePath} -> ${response.status} ${await response.text()}`);
  return response.json();
}

async function maybeApiJson(apiUrl, relativePath, init) {
  try {
    return await apiJson(apiUrl, relativePath, init);
  } catch {
    return null;
  }
}

async function waitUntil(label, fn, timeoutMs = 60_000, intervalMs = 600) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await fn();
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}${lastValue ? `: ${JSON.stringify(lastValue).slice(0, 500)}` : ''}`);
}

async function waitForStore(page) {
  await waitUntil('chat store', async () => page.evaluate('Boolean(window.__vai_chat_store?.getState)'), 30_000, 300);
}

async function getChatState(page) {
  return page.evaluate(() => {
    const state = window.__vai_chat_store.getState();
    return {
      activeConversationId: state.activeConversationId || null,
      isStreaming: Boolean(state.isStreaming),
      messages: state.messages.map((message) => ({
        id: String(message.id || ''),
        role: message.role,
        content: String(message.content || ''),
      })),
      conversations: state.conversations.map((conversation) => ({
        id: conversation.id,
        sandboxProjectId: conversation.sandboxProjectId || null,
        mode: conversation.mode || null,
      })),
    };
  });
}

async function startFreshBuilderChat(page) {
  const conversationId = await page.evaluate(async () => {
    const chat = window.__vai_chat_store?.getState?.();
    if (!chat?.createConversation) throw new Error('Chat store createConversation unavailable');
    chat.startNewChat?.();
    return chat.createConversation('vai:v0', 'builder', { sandboxProjectId: null });
  });

  await waitUntil('fresh builder conversation selected', async () => {
    const state = await getChatState(page);
    const conversation = state.conversations.find((entry) => entry.id === conversationId);
    if (state.activeConversationId === conversationId && conversation?.mode === 'builder') return conversation;
    return null;
  }, 45_000, 500);

  const textarea = page.locator('textarea').first();
  await textarea.waitFor({ timeout: 30_000 });
  await textarea.click();
  return { textarea, conversationId };
}

async function waitForAssistantTurn(page, beforeAssistantIds, timeoutMs) {
  return waitUntil('assistant turn', async () => {
    const state = await getChatState(page);
    const assistants = state.messages.filter((message) => message.role === 'assistant' && message.content.trim());
    const newAssistants = assistants.filter((message) => !beforeAssistantIds.has(message.id));
    if (!state.isStreaming && newAssistants.length > 0) {
      return { state, latestAssistant: pickLatestBuildAssistant(newAssistants) ?? assistants.at(-1) };
    }
    return null;
  }, timeoutMs, 700);
}

function isProjectUpdateAssistant(content) {
  return /\bProject update:/i.test(content)
    || /\[vai-artifact\]/i.test(content)
    || /\bSandbox:\s+[a-f0-9-]{6,}/i.test(content);
}

function pickLatestBuildAssistant(assistants) {
  for (let index = assistants.length - 1; index >= 0; index -= 1) {
    const content = String(assistants[index]?.content ?? '').trim();
    if (!content || isProjectUpdateAssistant(content)) continue;
    return assistants[index];
  }
  return null;
}

async function sendPrompt(page, prompt, timeoutMs) {
  const before = await getChatState(page);
  const beforeAssistantIds = new Set(before.messages
    .filter((message) => message.role === 'assistant' && message.content.trim())
    .map((message) => message.id));
  const textarea = page.locator('textarea').first();
  await textarea.waitFor({ timeout: 30_000 });
  await textarea.fill(prompt);
  await textarea.press('Enter');
  return waitForAssistantTurn(page, beforeAssistantIds, timeoutMs);
}

function extractTitledPaths(content) {
  return [...content.matchAll(/```[a-z0-9+#.-]*\s+title=["']([^"']+)["']/gi)].map((match) => match[1]);
}

function expectedPathGroups(spec) {
  return spec.expectedPathGroups ?? spec.expectedPaths.map((filePath) => [filePath]);
}

function expectedPathCandidates(spec) {
  return [...new Set(expectedPathGroups(spec).flat())];
}

function formatPathGroup(group) {
  return group.join(' or ');
}

function scoreResponse(spec, content) {
  const paths = extractTitledPaths(content);
  const failures = [];
  const warnings = [];

  for (const group of expectedPathGroups(spec)) {
    if (!group.some((expectedPath) => paths.includes(expectedPath))) {
      failures.push(`missing file block ${formatPathGroup(group)}`);
    }
  }
  for (const required of spec.requiredText) {
    if (!content.toLowerCase().includes(required.toLowerCase())) failures.push(`missing required response text ${required}`);
  }
  if (/tell me more|what would you like|send `src\/App|need the current page|I can edit the active app/i.test(content)) {
    failures.push('response looks like a clarification/file-request instead of a build');
  }
  if (content.length < 600) warnings.push('short response for a build request');

  return { paths, failures, warnings };
}

async function waitForConversationSandboxId(apiUrl, page, conversationId, timeoutMs) {
  return waitUntil('conversation sandbox id', async () => {
    const conversations = await maybeApiJson(apiUrl, '/api/conversations?limit=100');
    const apiSandbox = conversations?.find?.((conversation) => conversation.id === conversationId)?.sandboxProjectId || null;
    if (apiSandbox) return apiSandbox;
    return page.evaluate((id) => {
      const state = window.__vai_chat_store.getState();
      return state.conversations.find((conversation) => conversation.id === id)?.sandboxProjectId || null;
    }, conversationId);
  }, timeoutMs, 1000);
}

async function getConversationMessageCount(apiUrl, conversationId) {
  const messages = await maybeApiJson(apiUrl, `/api/conversations/${conversationId}/messages`);
  return Array.isArray(messages) ? messages.length : 0;
}

async function waitForProjectUpdateArtifact(apiUrl, conversationId, sinceMessageCount, timeoutMs) {
  return waitUntil('project update artifact', async () => {
    const messages = await maybeApiJson(apiUrl, `/api/conversations/${conversationId}/messages`);
    if (!Array.isArray(messages) || messages.length <= sinceMessageCount) return null;
    const latestProjectUpdate = [...messages].reverse().find((message) => {
      const content = String(message.content || '');
      return message.role === 'assistant' && (content.includes('Project update:') || content.includes('[vai-artifact]'));
    });
    return latestProjectUpdate || null;
  }, timeoutMs, 1000);
}

async function waitForSandboxRunning(apiUrl, sandboxId, timeoutMs) {
  return waitUntil(`sandbox ${sandboxId} running`, async () => {
    const sandbox = await maybeApiJson(apiUrl, `/api/sandbox/${sandboxId}`);
    if (!sandbox) return null;
    if (sandbox.status === 'failed') return { failed: true, sandbox };
    if (sandbox.status === 'running' && sandbox.devPort) return sandbox;
    return null;
  }, timeoutMs, 1000);
}

async function readSandboxFile(apiUrl, sandboxId, filePath) {
  const response = await fetch(`${apiUrl}/api/sandbox/${sandboxId}/file?path=${encodeURIComponent(filePath)}`, {
    headers: DEV_AUTH_BYPASS_HEADERS,
  });
  if (!response.ok) return null;
  const payload = await response.json();
  return typeof payload.content === 'string' ? payload.content : null;
}

async function inspectSandboxFiles(apiUrl, sandboxId, expectedPaths) {
  const sandbox = await maybeApiJson(apiUrl, `/api/sandbox/${sandboxId}`);
  const files = Array.isArray(sandbox?.files) ? sandbox.files : [];
  const contents = {};
  for (const filePath of expectedPaths) {
    contents[filePath] = await readSandboxFile(apiUrl, sandboxId, filePath);
  }
  return { sandbox, files, contents };
}

function scoreSandboxFiles(spec, fileSnapshot) {
  const failures = [];
  const combined = Object.values(fileSnapshot.contents).filter(Boolean).join('\n');
  for (const group of expectedPathGroups(spec)) {
    const found = group.some((expectedPath) => (
      fileSnapshot.files.includes(expectedPath) || Boolean(fileSnapshot.contents[expectedPath])
    ));
    if (!found) {
      failures.push(`sandbox missing ${formatPathGroup(group)}`);
    }
  }
  for (const required of spec.requiredText) {
    if (!combined.toLowerCase().includes(required.toLowerCase())) {
      failures.push(`sandbox files missing ${required}`);
    }
  }
  for (const check of spec.requiredFilePatterns ?? []) {
    const candidates = check.paths ?? [check.path];
    const matched = candidates.some((filePath) => {
      const content = fileSnapshot.contents[filePath];
      return typeof content === 'string' && check.pattern.test(content);
    });
    if (!matched) {
      failures.push(`sandbox files missing ${check.label}`);
    }
  }
  const packageJson = fileSnapshot.contents['package.json'];
  if (packageJson) {
    try {
      JSON.parse(packageJson);
    } catch {
      failures.push('package.json is not valid JSON');
    }
  }
  return { failures };
}

async function waitForSandboxFiles(apiUrl, sandboxId, spec, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = null;
  let lastQuality = null;

  while (Date.now() < deadline) {
    lastSnapshot = await inspectSandboxFiles(apiUrl, sandboxId, expectedPathCandidates(spec));
    lastQuality = scoreSandboxFiles(spec, lastSnapshot);
    if (lastQuality.failures.length === 0) {
      return { snapshot: lastSnapshot, quality: lastQuality, timedOut: false };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return {
    snapshot: lastSnapshot ?? { sandbox: null, files: [], contents: {} },
    quality: lastQuality ?? { failures: ['sandbox files never became readable'] },
    timedOut: true,
  };
}

async function auditPreview(browser, outputDir, spec, sandbox) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 920 } });
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !/favicon/i.test(message.text())) consoleErrors.push(message.text());
  });

  const url = `http://127.0.0.1:${sandbox.devPort}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(1400);
  const screenshotPath = path.join(outputDir, `${spec.slug}-preview.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const dom = await page.evaluate(() => ({
    title: document.title,
    text: document.body.innerText || '',
    regionCount: document.querySelectorAll('main, section, article, aside, form, nav').length,
    buttonCount: document.querySelectorAll('button, a').length,
    inputCount: document.querySelectorAll('input, textarea, select').length,
    animatedCount: Array.from(document.body.querySelectorAll('*')).filter((element) => {
      const style = window.getComputedStyle(element);
      return (style.animationName && style.animationName !== 'none')
        || (style.transitionDuration && style.transitionDuration !== '0s')
        || (style.transform && style.transform !== 'none');
    }).length,
  }));
  await page.close();

  const failures = [];
  for (const required of spec.requiredText) {
    if (!dom.text.toLowerCase().includes(required.toLowerCase())) failures.push(`preview missing ${required}`);
  }
  if (dom.regionCount < 2) failures.push(`preview has too few structural regions: ${dom.regionCount}`);
  if (consoleErrors.length > 0) failures.push(`preview console errors: ${consoleErrors.slice(0, 3).join(' | ')}`);

  return { url, screenshotPath, dom, consoleErrors, failures };
}

async function deleteSandbox(apiUrl, sandboxId) {
  await fetch(`${apiUrl}/api/sandbox/${sandboxId}`, {
    method: 'DELETE',
    headers: DEV_AUTH_BYPASS_HEADERS,
  }).catch(() => {});
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await fs.mkdir(options.outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 940 } });
  const results = [];
  let previewRuns = 0;

  try {
    await page.goto(options.appUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForStore(page);

    const selectedSpecs = options.only.length > 0
      ? APP_SPECS.filter((spec) => options.only.includes(spec.slug))
      : APP_SPECS.slice(0, options.limit);
    const missingOnly = options.only.filter((slug) => !APP_SPECS.some((spec) => spec.slug === slug));
    if (missingOnly.length > 0) throw new Error(`Unknown --only slug(s): ${missingOnly.join(', ')}`);

    for (const spec of selectedSpecs) {
      const startedAt = Date.now();
      const result = {
        slug: spec.slug,
        prompt: spec.prompt,
        status: 'unknown',
        failures: [],
        warnings: [],
        conversationId: null,
        sandboxId: null,
        response: null,
        responseQuality: null,
        fileQuality: null,
        preview: null,
        durationMs: null,
      };
      results.push(result);

      try {
        const fresh = await startFreshBuilderChat(page);
        result.conversationId = fresh.conversationId;
        const beforeMessageCount = await getConversationMessageCount(options.apiUrl, result.conversationId);

        const { state, latestAssistant } = await sendPrompt(page, spec.prompt, options.timeoutMs);
        result.conversationId = state.activeConversationId || result.conversationId;
        result.response = latestAssistant?.content ?? '';
        const persistedMessages = await maybeApiJson(options.apiUrl, `/api/conversations/${result.conversationId}/messages`);
        if (Array.isArray(persistedMessages) && persistedMessages.length > beforeMessageCount) {
          const persistedBuildAssistant = pickLatestBuildAssistant(
            persistedMessages
              .slice(beforeMessageCount)
              .filter((message) => message.role === 'assistant' && String(message.content || '').trim()),
          );
          if (persistedBuildAssistant?.content) {
            result.response = String(persistedBuildAssistant.content);
          }
        }
        result.responseQuality = scoreResponse(spec, result.response);
        result.failures.push(...result.responseQuality.failures);
        result.warnings.push(...result.responseQuality.warnings);

        if (result.conversationId) {
          result.sandboxId = await waitForConversationSandboxId(options.apiUrl, page, result.conversationId, 45_000).catch(() => null);
        }

        if (result.sandboxId) {
          result.projectUpdate = await waitForProjectUpdateArtifact(
            options.apiUrl,
            result.conversationId,
            beforeMessageCount,
            spec.preview ? Math.min(options.timeoutMs, 90_000) : Math.min(options.timeoutMs, 10_000),
          ).catch((error) => {
            result.warnings.push(`project update artifact not observed before file polling: ${error instanceof Error ? error.message : String(error)}`);
            return null;
          });

          const refreshedSandboxId = await waitForConversationSandboxId(
            options.apiUrl,
            page,
            result.conversationId,
            15_000,
          ).catch(() => null);
          if (refreshedSandboxId && refreshedSandboxId !== result.sandboxId) {
            const updateContent = String(result.projectUpdate?.content ?? '');
            if (!result.projectUpdate || /recovered from|stale sandbox|recovery/i.test(updateContent)) {
              result.warnings.push(`sandbox binding changed after recovery: ${result.sandboxId} -> ${refreshedSandboxId}`);
            }
            result.sandboxId = refreshedSandboxId;
          }

          const fileResult = await waitForSandboxFiles(
            options.apiUrl,
            result.sandboxId,
            spec,
            Math.min(options.timeoutMs, 120_000),
          );
          result.fileSnapshot = {
            files: fileResult.snapshot.files,
            contents: Object.fromEntries(
              Object.entries(fileResult.snapshot.contents).map(([filePath, content]) => [
                filePath,
                typeof content === 'string' ? content.slice(0, 2000) : null,
              ]),
            ),
          };
          result.fileQuality = fileResult.quality;
          if (fileResult.timedOut) result.warnings.push('timed out waiting for sandbox files to match the requested app');
          result.failures.push(...result.fileQuality.failures);

          if (spec.preview && previewRuns < options.previewLimit) {
            previewRuns += 1;
            const sandbox = await waitForSandboxRunning(options.apiUrl, result.sandboxId, options.timeoutMs);
            if (sandbox?.failed) {
              result.failures.push(`sandbox failed: ${JSON.stringify((sandbox.sandbox.logs ?? []).slice(-5))}`);
            } else {
              result.preview = await auditPreview(browser, options.outputDir, spec, sandbox);
              result.failures.push(...result.preview.failures);
            }
          }
        } else {
          result.warnings.push('no sandbox binding observed');
        }

        result.status = result.failures.length === 0 ? 'pass' : 'fail';
      } catch (error) {
        result.status = 'error';
        result.failures.push(error instanceof Error ? error.message : String(error));
      } finally {
        result.durationMs = Date.now() - startedAt;
        if (result.sandboxId && !options.keepProjects) await deleteSandbox(options.apiUrl, result.sandboxId);
        await fs.writeFile(path.join(options.outputDir, 'report.json'), JSON.stringify({ options, results }, null, 2));
        console.log(`[${result.status.toUpperCase()}] ${spec.slug} (${result.durationMs}ms)`);
        for (const failure of result.failures) console.log(`  - ${failure}`);
        for (const warning of result.warnings) console.log(`  ! ${warning}`);
      }
    }
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  const passed = results.filter((result) => result.status === 'pass').length;
  const failed = results.length - passed;
  const summary = {
    verdict: failed === 0 ? 'pass' : 'fail',
    passed,
    failed,
    total: results.length,
    outputDir: options.outputDir,
    reportPath: path.join(options.outputDir, 'report.json'),
    results: results.map((result) => ({
      slug: result.slug,
      status: result.status,
      failures: result.failures,
      warnings: result.warnings,
      conversationId: result.conversationId,
      sandboxId: result.sandboxId,
      previewUrl: result.preview?.url ?? null,
    })),
  };
  await fs.writeFile(path.join(options.outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (summary.verdict !== 'pass') process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
