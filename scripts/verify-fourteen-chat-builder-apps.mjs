#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const DEV_AUTH_BYPASS_HEADERS = { 'x-vai-dev-auth-bypass': '1' };

const APP_SPECS = [
  {
    slug: 'clean-conversion-landing',
    prompt: "Design a clean, modern, and conversion-focused landing page for a product/service called 'LedgerFlow'. Layout & Structure: use a minimalist grid-based structure with a clean navigation bar, a high-impact hero section, a 3-column feature section with simple iconography, and a single high-contrast CTA button labeled Start free. Visual Aesthetics: prioritize minimalism, premium feel, and heavy use of white space to prevent clutter. Use a strict color palette: #2563eb as the primary color for main actions, #f8fafc as the secondary color for backgrounds, and #111827 as the neutral color for typography. Use a modern, legible sans-serif font like Inter or system-ui. UX Guidelines: avoid all visual clutter, neon glows, or dense drop shadows. Elements should have smooth corners, subtle borders, and a clear natural visual hierarchy. Make it feel trustworthy, approachable, and highly accessible. Generate complete runnable code using HTML, CSS, and Tailwind CSS.",
    expectedPaths: ['package.json', 'src/App.tsx', 'src/styles.css', 'vite.config.ts'],
    expectedPathGroups: [['package.json'], ['src/App.tsx', 'src/App.jsx'], ['src/styles.css'], ['vite.config.ts', 'vite.config.js']],
    requiredText: ['LedgerFlow', 'Start free', 'Fast onboarding', 'Clear pipeline', 'Trusted reporting'],
    requiredFilePatterns: [
      { paths: ['src/styles.css'], pattern: /@import\s+["']tailwindcss["']/, label: 'Tailwind v4 CSS import' },
      { paths: ['vite.config.ts', 'vite.config.js'], pattern: /@tailwindcss\/vite|tailwindcss\(\)/, label: 'Tailwind Vite plugin' },
      { paths: ['src/App.tsx', 'src/App.jsx'], pattern: /grid[\w\s:[\]-]*md:grid-cols-3|md:grid-cols-3|grid-template-columns:\s*repeat\(3/i, label: 'three-column feature layout' },
    ],
    forbiddenFilePatterns: [
      { paths: ['src/App.tsx', 'src/App.jsx', 'src/styles.css'], pattern: /\bneon\b|\bglow\b|landing-noise|theme-toggle|radial-gradient|blur\(/i, label: 'forbidden neon/glow/template visual language' },
    ],
    designContract: { kind: 'clean-conversion-landing', brand: 'LedgerFlow', cta: 'Start free' },
    preview: true,
  },
  {
    slug: 'shared-shopping-list',
    prompt: 'Build the first runnable version now. Create a compact but polished shared shopping app for a household or roommates. Use Tailwind CSS v4 styling and framer-motion for subtle motion, seed mock data for members, items, aisle or category groupings, and activity messages. The preview must visibly include the heading Shared Shopping List plus separate sections labeled Household and Activity Chat.',
    expectedPaths: ['package.json', 'src/App.tsx'],
    expectedPathGroups: [['package.json'], ['src/App.tsx', 'src/App.jsx']],
    requiredText: ['Shared Shopping List', 'Household', 'Activity Chat', 'Store Run', 'Mark bought', 'Assign me', 'Suggest substitute'],
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
    requiredText: ['Maison Grove', 'Catalog', 'Product detail', 'Cart summary', 'Continue to checkout'],
    forbiddenFilePatterns: [
      { paths: ['src/App.tsx', 'src/App.jsx', 'src/styles.css'], pattern: /borrowed demo shell|builder target|mock checkout|\bmocked\b|commerce workspace|radial-gradient|backdrop-filter/i, label: 'forbidden storefront template/demo language' },
    ],
    designContract: { kind: 'premium-storefront', cta: 'Continue to checkout' },
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
  for (const check of spec.forbiddenFilePatterns ?? []) {
    const candidates = check.paths ?? [check.path];
    const matched = candidates.some((filePath) => {
      const content = fileSnapshot.contents[filePath];
      return typeof content === 'string' && check.pattern.test(content);
    });
    if (matched) {
      failures.push(`sandbox files contain ${check.label}`);
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
  const failedResponses = [];
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() !== 'error') return;
    if (/favicon|Failed to load resource/i.test(text)) return;
    consoleErrors.push(text);
  });
  page.on('response', (response) => {
    const status = response.status();
    const responseUrl = response.url();
    if (status < 400) return;
    if (/favicon|apple-touch-icon|manifest\.webmanifest/i.test(responseUrl)) return;
    failedResponses.push(`${status} ${responseUrl}`);
  });

  const url = `http://127.0.0.1:${sandbox.devPort}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(1400);
  const screenshotPath = path.join(outputDir, `${spec.slug}-preview.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const dom = await page.evaluate(() => ({
    title: document.title,
    text: document.body.innerText || '',
    navCount: document.querySelectorAll('nav').length,
    articleCount: document.querySelectorAll('article').length,
    productCardCount: document.querySelectorAll('.product-card, [data-product-card]').length,
    headingTexts: Array.from(document.querySelectorAll('h1, h2, h3'))
      .map((element) => (element.textContent || '').trim())
      .filter(Boolean)
      .slice(0, 40),
    regionCount: document.querySelectorAll('main, section, article, aside, form, nav').length,
    buttonCount: document.querySelectorAll('button, a').length,
    inputCount: document.querySelectorAll('input, textarea, select').length,
    buttonTexts: Array.from(document.querySelectorAll('button, a'))
      .map((element) => (element.textContent || '').trim())
      .filter(Boolean)
      .slice(0, 80),
    brightSurfaceCount: Array.from(document.querySelectorAll('main, section, article, aside, form, div')).filter((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width < 120 || rect.height < 60 || rect.width * rect.height < 7000) return false;
      const color = window.getComputedStyle(element).backgroundColor;
      const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (!match) return false;
      const [, r, g, b] = match.map(Number);
      return r > 235 && g > 235 && b > 235;
    }).length,
    darkSurfaceCount: Array.from(document.querySelectorAll('main, section, article, aside, form, div')).filter((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width < 180 || rect.height < 80 || rect.width * rect.height < 12000) return false;
      const color = window.getComputedStyle(element).backgroundColor;
      const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([.\d]+))?/i);
      if (!match) return false;
      const [, r, g, b] = match.map((value) => Number(value));
      const alpha = match[4] === undefined ? 1 : Number(match[4]);
      if (alpha < 0.75) return false;
      return r < 45 && g < 45 && b < 55;
    }).length,
    brightControlCount: Array.from(document.querySelectorAll('button, a')).filter((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width < 70 || rect.height < 28) return false;
      const color = window.getComputedStyle(element).backgroundColor;
      const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (!match) return false;
      const [, r, g, b] = match.map(Number);
      return r > 235 && g > 235 && b > 235;
    }).length,
    animatedCount: Array.from(document.body.querySelectorAll('*')).filter((element) => {
      const style = window.getComputedStyle(element);
      return (style.animationName && style.animationName !== 'none')
        || (style.transitionDuration && style.transitionDuration !== '0s')
        || (style.transform && style.transform !== 'none');
    }).length,
  }));
  dom.ctaMetrics = await page.evaluate((ctaText) => {
    if (!ctaText) return null;
    const parseColor = (value) => {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([.\d]+))?/i);
      if (!match) return null;
      return {
        r: Number(match[1]),
        g: Number(match[2]),
        b: Number(match[3]),
        a: match[4] === undefined ? 1 : Number(match[4]),
      };
    };
    const luminance = ({ r, g, b }) => {
      const channel = (value) => {
        const normalized = value / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const contrastRatio = (first, second) => {
      const firstLum = luminance(first);
      const secondLum = luminance(second);
      const lighter = Math.max(firstLum, secondLum);
      const darker = Math.min(firstLum, secondLum);
      return (lighter + 0.05) / (darker + 0.05);
    };
    const readableText = (value) => value.trim().replace(/\s+/g, ' ').toLowerCase();
    const target = Array.from(document.querySelectorAll('button, a')).find((element) => readableText(element.textContent || '') === readableText(ctaText));
    if (!target) return null;
    const style = window.getComputedStyle(target);
    const foreground = parseColor(style.color);
    let background = parseColor(style.backgroundColor);
    let current = target.parentElement;
    while ((!background || background.a < 0.75) && current) {
      background = parseColor(window.getComputedStyle(current).backgroundColor);
      current = current.parentElement;
    }
    if (!foreground || !background) return null;
    return {
      text: target.textContent?.trim() || '',
      color: style.color,
      backgroundColor: style.backgroundColor,
      contrastRatio: Number(contrastRatio(foreground, background).toFixed(2)),
    };
  }, spec.designContract?.cta ?? '');
  await page.close();

  const failures = [];
  for (const required of spec.requiredText) {
    if (!dom.text.toLowerCase().includes(required.toLowerCase())) failures.push(`preview missing ${required}`);
  }
  if (dom.regionCount < 2) failures.push(`preview has too few structural regions: ${dom.regionCount}`);
  if (consoleErrors.length > 0) failures.push(`preview console errors: ${consoleErrors.slice(0, 3).join(' | ')}`);
  if (failedResponses.length > 0) failures.push(`preview failed network responses: ${failedResponses.slice(0, 3).join(' | ')}`);
  if (spec.designContract?.kind === 'clean-conversion-landing') {
    const bodyText = dom.text.toLowerCase();
    const buttonTexts = dom.buttonTexts.map((text) => text.trim());
    const ctaCount = buttonTexts.filter((text) => text.toLowerCase() === spec.designContract.cta.toLowerCase()).length;
    if (dom.navCount < 1) failures.push('clean landing preview missing navigation bar');
    if (!dom.headingTexts.some((text) => text.trim().toLowerCase() === spec.designContract.brand.toLowerCase())) {
      failures.push(`clean landing preview missing brand h1: ${spec.designContract.brand}`);
    }
    if (ctaCount !== 1) failures.push(`clean landing preview should have exactly one primary CTA "${spec.designContract.cta}", found ${ctaCount}`);
    if (dom.articleCount < 3) failures.push(`clean landing preview has too few feature cards/articles: ${dom.articleCount}`);
    if (dom.darkSurfaceCount > 0) failures.push(`clean landing preview has large dark surfaces despite light minimal brief: ${dom.darkSurfaceCount}`);
    if (!dom.ctaMetrics) {
      failures.push('clean landing preview missing measurable CTA contrast');
    } else if (dom.ctaMetrics.contrastRatio < 4.5) {
      failures.push(`clean landing CTA contrast is too low: ${dom.ctaMetrics.contrastRatio} (${dom.ctaMetrics.color} on ${dom.ctaMetrics.backgroundColor})`);
    }
    if (/\b(?:neon|glow|glows|orb|dark-first|theme toggle|kinetic)\b/i.test(bodyText)) {
      failures.push('clean landing preview leaks forbidden neon/dark/template language');
    }
  }
  if (spec.designContract?.kind === 'premium-storefront') {
    const bodyText = dom.text.toLowerCase();
    const buttonText = dom.buttonTexts.join(' | ').toLowerCase();
    if (dom.productCardCount < 4) failures.push(`premium storefront has too few product cards: ${dom.productCardCount}`);
    if (!buttonText.includes('add to cart')) failures.push('premium storefront missing add-to-cart action');
    if (!buttonText.includes('continue to checkout')) failures.push('premium storefront missing checkout continuation action');
    if (!dom.ctaMetrics) {
      failures.push('premium storefront missing measurable checkout CTA contrast');
    } else if (dom.ctaMetrics.contrastRatio < 4.5) {
      failures.push(`premium storefront checkout CTA contrast is too low: ${dom.ctaMetrics.contrastRatio} (${dom.ctaMetrics.color} on ${dom.ctaMetrics.backgroundColor})`);
    }
    if (/\b(?:borrowed demo shell|builder target|mock checkout|mocked|commerce workspace)\b/i.test(bodyText)) {
      failures.push('premium storefront leaks template/demo language into the UI');
    }
  }
  if (spec.slug === 'shared-shopping-list') {
    const buttonText = dom.buttonTexts.join(' | ').toLowerCase();
    for (const requiredButton of ['add item', 'mark bought', 'assign me', 'store run', 'activity chat']) {
      if (!buttonText.includes(requiredButton)) failures.push(`shared shopping preview missing product action button: ${requiredButton}`);
    }
    if (dom.buttonCount < 10) failures.push(`shared shopping preview has too few real controls: ${dom.buttonCount}`);
    if (dom.inputCount < 2) failures.push(`shared shopping preview needs quick-add input plus category/aisle control: ${dom.inputCount}`);
    if (dom.brightSurfaceCount > 0) failures.push(`shared shopping preview has large bright panels on dark UI: ${dom.brightSurfaceCount}`);
    if (dom.brightControlCount > 0) failures.push(`shared shopping preview has bright white controls on dark UI: ${dom.brightControlCount}`);
    if (/aisle grouping/i.test(dom.text)) failures.push('shared shopping preview still uses generic aisle grouping labels');
  }

  return { url, screenshotPath, dom, consoleErrors, failedResponses, failures };
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

  const browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath() });
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
