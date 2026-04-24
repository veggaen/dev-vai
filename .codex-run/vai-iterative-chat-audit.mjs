#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, '.codex-run');
const APP_URL = process.env.VAI_APP_URL || 'http://127.0.0.1:5173/?devAuthBypass=1';
const API_URL = (process.env.VAI_API_URL || 'http://127.0.0.1:3006').replace(/\/$/, '');
const DEV_AUTH_BYPASS_HEADERS = { 'x-vai-dev-auth-bypass': '1' };

const prompts = [
  {
    key: 'build',
    text: [
      'Build a one-page neon fitness landing page I can preview.',
      'It must include the exact heading Kinetic Pulse, a hero paragraph,',
      'and a primary CTA button labeled Start Training.',
      'Use a dark visual style and make it runnable now.',
    ].join(' '),
  },
  {
    key: 'color-edit',
    text: [
      'Change the primary CTA button color to hot pink (#ff2ea6)',
      'and change the page background to deep navy (#020617).',
      'Keep the same app and preview running.',
    ].join(' '),
  },
  {
    key: 'motion-edit',
    text: [
      'Add kinetic text animation to the hero heading and subtle body entrance animations.',
      'Keep it smooth and do not rebuild from scratch.',
    ].join(' '),
  },
];

async function apiJson(relativePath, init) {
  const response = await fetch(`${API_URL}${relativePath}`, {
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

async function maybeApiJson(relativePath) {
  try {
    return await apiJson(relativePath);
  } catch {
    return null;
  }
}

async function waitUntil(label, fn, timeoutMs = 120_000, intervalMs = 700) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await fn();
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}${lastValue ? `: ${JSON.stringify(lastValue).slice(0, 600)}` : ''}`);
}

async function evalString(page, source) {
  return page.evaluate(source);
}

async function waitForStore(page) {
  await waitUntil('chat store', async () => {
    return evalString(page, 'Boolean(window.__vai_chat_store && window.__vai_chat_store.getState)');
  }, 30_000, 300);
}

async function getChatState(page) {
  return {
    activeConversationId: await evalString(page, 'window.__vai_chat_store.getState().activeConversationId || null'),
    isStreaming: await evalString(page, 'Boolean(window.__vai_chat_store.getState().isStreaming)'),
    messages: await evalString(page, 'window.__vai_chat_store.getState().messages.map(m => ({ role: m.role, content: String(m.content || ""), id: String(m.id || ""), isAutoRepair: Boolean(m.isAutoRepair), repairAttempt: m.repairAttempt || null }))'),
    conversations: await evalString(page, 'window.__vai_chat_store.getState().conversations.map(c => ({ id: c.id, sandboxProjectId: c.sandboxProjectId || null, mode: c.mode || null, title: c.title || "" }))'),
  };
}

async function waitForAssistantTurn(page, beforeAssistantCount) {
  await waitUntil('assistant stream to finish', async () => {
    const state = await getChatState(page);
    const assistantCount = state.messages.filter((message) => message.role === 'assistant' && message.content.trim().length > 0).length;
    return !state.isStreaming && assistantCount > beforeAssistantCount ? state : null;
  }, 180_000, 700);
  return getChatState(page);
}

async function sendPrompt(page, text) {
  const before = await getChatState(page);
  const beforeAssistantCount = before.messages.filter((message) => message.role === 'assistant' && message.content.trim().length > 0).length;
  const textarea = page.locator('textarea').first();
  await textarea.waitFor({ timeout: 30_000 });
  await textarea.fill(text);
  await textarea.press('Enter');
  const state = await waitForAssistantTurn(page, beforeAssistantCount);
  const assistantMessages = state.messages.filter((message) => message.role === 'assistant' && message.content.trim().length > 0);
  const latestAssistant = assistantMessages.at(-1);
  return { state, latestAssistant };
}

async function waitForConversationId(page) {
  return waitUntil('active conversation id', async () => {
    return evalString(page, 'window.__vai_chat_store.getState().activeConversationId || null');
  }, 30_000, 300);
}

async function waitForSandboxId(page, conversationId, previousSandboxId) {
  return waitUntil('conversation sandbox binding', async () => {
    await evalString(page, 'window.__vai_chat_store.getState().fetchConversations()');
    const fromStore = await evalString(page, `(() => {
      const state = window.__vai_chat_store.getState();
      const conversation = state.conversations.find((entry) => entry.id === ${JSON.stringify(conversationId)});
      return conversation && conversation.sandboxProjectId || null;
    })()`);
    if (fromStore && fromStore !== previousSandboxId) return fromStore;
    const conversations = await maybeApiJson('/api/conversations?limit=50');
    const fromApi = conversations?.find?.((entry) => entry.id === conversationId)?.sandboxProjectId || null;
    if (fromApi && fromApi !== previousSandboxId) return fromApi;
    return null;
  }, 180_000, 1000);
}

async function waitForSandboxRunning(sandboxId) {
  return waitUntil(`sandbox ${sandboxId} running`, async () => {
    const sandbox = await maybeApiJson(`/api/sandbox/${sandboxId}`);
    if (!sandbox) return null;
    if (sandbox.status === 'failed') return { failed: true, sandbox };
    if (sandbox.status === 'running' && sandbox.devPort) return sandbox;
    return null;
  }, 180_000, 1000);
}

async function waitForProjectUpdate(conversationId, sinceMessageCount) {
  return waitUntil('project update message', async () => {
    const messages = await maybeApiJson(`/api/conversations/${conversationId}/messages`);
    if (!Array.isArray(messages) || messages.length <= sinceMessageCount) return null;
    const latestProjectUpdate = [...messages].reverse().find((message) => {
      const content = String(message.content || '');
      return message.role === 'assistant' && (content.includes('Project update:') || content.includes('[vai-artifact]'));
    });
    return latestProjectUpdate || null;
  }, 180_000, 1000);
}

async function readSandboxFile(sandboxId, filePath) {
  const response = await fetch(`${API_URL}/api/sandbox/${sandboxId}/file?path=${encodeURIComponent(filePath)}`, {
    headers: DEV_AUTH_BYPASS_HEADERS,
  });
  if (!response.ok) return null;
  const payload = await response.json();
  return typeof payload.content === 'string' ? payload.content : null;
}

async function snapshotSandboxFiles(sandboxId) {
  const sandbox = await maybeApiJson(`/api/sandbox/${sandboxId}`);
  const files = Array.isArray(sandbox?.files) ? sandbox.files : [];
  const interesting = files.filter((file) => /(?:src\/App\.(?:tsx|jsx|ts|js)|src\/.*\.(?:css|scss)|package\.json|index\.html)$/i.test(file));
  const contents = {};
  for (const file of interesting.slice(0, 10)) {
    contents[file] = await readSandboxFile(sandboxId, file);
  }
  return { sandbox, files, contents };
}

async function auditPreview(browser, port) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 920 } });
  const url = `http://127.0.0.1:${port}`;
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(1600);
  const screenshotPath = path.join(OUTPUT_DIR, `vai-iterative-preview-${port}-${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const dom = await page.evaluate(() => {
    const text = document.body.innerText || '';
    const button = Array.from(document.querySelectorAll('button, a')).find((element) => /Start Training/i.test(element.textContent || ''));
    const heading = Array.from(document.querySelectorAll('main h1, h1')).find((element) => /Kinetic Pulse/i.test(element.textContent || ''))
      || Array.from(document.querySelectorAll('[data-testid], .hero, main *')).find((element) => /Kinetic Pulse/i.test(element.textContent || ''));
    const bodyStyle = window.getComputedStyle(document.body);
    const htmlStyle = window.getComputedStyle(document.documentElement);
    const buttonStyle = button ? window.getComputedStyle(button) : null;
    const headingStyle = heading ? window.getComputedStyle(heading) : null;
    const animatedElements = Array.from(document.body.querySelectorAll('*'))
      .map((element) => {
        const style = window.getComputedStyle(element);
        return {
          tag: element.tagName.toLowerCase(),
          text: (element.textContent || '').trim().slice(0, 80),
          animationName: style.animationName,
          animationDuration: style.animationDuration,
          transitionDuration: style.transitionDuration,
          transform: style.transform,
          opacity: style.opacity,
        };
      })
      .filter((entry) => (
        entry.animationName && entry.animationName !== 'none'
      ) || (
        entry.transitionDuration && entry.transitionDuration !== '0s'
      ) || (
        entry.transform && entry.transform !== 'none'
      ))
      .slice(0, 20);
    return {
      title: document.title,
      text,
      hasHeading: /Kinetic Pulse/i.test(text),
      hasCta: /Start Training/i.test(text),
      bodyBackground: bodyStyle.backgroundColor,
      htmlBackground: htmlStyle.backgroundColor,
      buttonBackground: buttonStyle?.backgroundColor || null,
      buttonColor: buttonStyle?.color || null,
      headingAnimation: headingStyle?.animationName || null,
      headingTag: heading?.tagName.toLowerCase() || null,
      animatedElements,
      sectionCount: document.querySelectorAll('section, main, article, aside, form').length,
      buttonCount: document.querySelectorAll('button, a[role="button"], a').length,
    };
  });
  await page.close();
  return { url, screenshotPath, consoleErrors, dom };
}

function includesHotPink(content) {
  return /#ff2ea6|rgb\(255,\s*46,\s*166\)|hot\s*pink/i.test(content || '');
}

function includesDeepNavy(content) {
  return /#020617|rgb\(2,\s*6,\s*23\)|deep\s+navy/i.test(content || '');
}

function includesMotion(content) {
  return /@keyframes|animation(?:Name)?|animate-|framer-motion|motion\.|transition|entrance|kinetic/i.test(content || '');
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const audit = {
    startedAt: new Date().toISOString(),
    appUrl: APP_URL,
    apiUrl: API_URL,
    turns: [],
    final: null,
    verdict: 'unknown',
    failures: [],
  };

  try {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await waitForStore(page);
    await evalString(page, 'window.__vai_chat_store.getState().startNewChat()');
    await page.waitForTimeout(500);

    let conversationId = null;
    let sandboxId = null;
    let previousMessageCount = 0;

    for (const prompt of prompts) {
      const turn = {
        key: prompt.key,
        prompt: prompt.text,
        assistant: null,
        conversationId: null,
        sandboxIdBefore: sandboxId,
        sandboxIdAfter: null,
        projectUpdate: null,
        sandbox: null,
        preview: null,
        checks: {},
      };
      audit.turns.push(turn);

      const { state, latestAssistant } = await sendPrompt(page, prompt.text);
      turn.assistant = {
        id: latestAssistant?.id || null,
        chars: latestAssistant?.content?.length || 0,
        excerpt: (latestAssistant?.content || '').replace(/\s+/g, ' ').slice(0, 1200),
        emittedFileBlocks: /```[^\n`]*(?:title|path|file|filename)=/i.test(latestAssistant?.content || ''),
      };
      conversationId = state.activeConversationId || await waitForConversationId(page);
      turn.conversationId = conversationId;

      const messagesAfterAssistant = await maybeApiJson(`/api/conversations/${conversationId}/messages`);
      previousMessageCount = Array.isArray(messagesAfterAssistant) ? messagesAfterAssistant.length : previousMessageCount;

      if (prompt.key === 'build') {
        sandboxId = await waitForSandboxId(page, conversationId, null).catch((error) => {
          audit.failures.push(`build did not bind sandbox: ${error.message}`);
          return null;
        });
      } else if (sandboxId) {
        await waitForProjectUpdate(conversationId, previousMessageCount).catch(() => null);
      }

      if (sandboxId) {
        turn.sandboxIdAfter = sandboxId;
        const projectUpdate = await waitForProjectUpdate(conversationId, Math.max(0, previousMessageCount - 2)).catch(() => null);
        turn.projectUpdate = projectUpdate
          ? String(projectUpdate.content || '').replace(/\s+/g, ' ').slice(0, 1200)
          : null;
        const running = await waitForSandboxRunning(sandboxId);
        turn.sandbox = running;
        if (running?.failed) {
          audit.failures.push(`${prompt.key} sandbox failed`);
        } else if (running?.devPort) {
          const snapshot = await snapshotSandboxFiles(sandboxId);
          turn.files = {
            list: snapshot.files,
            snippets: Object.fromEntries(Object.entries(snapshot.contents).map(([file, content]) => [file, String(content || '').slice(0, 1600)])),
          };
          turn.preview = await auditPreview(browser, running.devPort);
        }
      }

      if (prompt.key === 'build') {
        turn.checks.hasHeading = Boolean(turn.preview?.dom?.hasHeading);
        turn.checks.hasCta = Boolean(turn.preview?.dom?.hasCta);
        turn.checks.boundSandbox = Boolean(sandboxId);
      }
      if (prompt.key === 'color-edit') {
        const allContent = Object.values(turn.files?.snippets || {}).join('\n');
        const dom = turn.preview?.dom;
        turn.checks.fileHasHotPink = includesHotPink(allContent);
        turn.checks.fileHasDeepNavy = includesDeepNavy(allContent);
        turn.checks.previewHasHotPinkButton = /rgb\(255,\s*46,\s*166\)/i.test(dom?.buttonBackground || '');
        turn.checks.previewHasDeepNavyBackground = /rgb\(2,\s*6,\s*23\)/i.test(`${dom?.bodyBackground || ''} ${dom?.htmlBackground || ''}`);
      }
      if (prompt.key === 'motion-edit') {
        const allContent = Object.values(turn.files?.snippets || {}).join('\n');
        const dom = turn.preview?.dom;
        turn.checks.fileHasMotion = includesMotion(allContent);
        turn.checks.previewHasAnimatedElements = Array.isArray(dom?.animatedElements) && dom.animatedElements.length > 0;
        turn.checks.headingAnimation = dom?.headingAnimation || null;
      }
    }

    const flatChecks = audit.turns.flatMap((turn) => Object.entries(turn.checks).map(([key, value]) => `${turn.key}.${key}=${String(value)}`));
    audit.final = {
      conversationId,
      sandboxId,
      checks: flatChecks,
    };
    const failingChecks = audit.turns.flatMap((turn) => Object.entries(turn.checks)
      .filter(([, value]) => value === false || value === null)
      .map(([key, value]) => `${turn.key}.${key}=${String(value)}`));
    audit.failures.push(...failingChecks);
    audit.verdict = audit.failures.length === 0 ? 'pass' : 'fail';
  } finally {
    audit.finishedAt = new Date().toISOString();
    const outPath = path.join(OUTPUT_DIR, 'vai-iterative-chat-audit.json');
    await fs.writeFile(outPath, JSON.stringify(audit, null, 2));
    console.log(JSON.stringify({
      verdict: audit.verdict,
      failures: audit.failures,
      output: outPath,
      final: audit.final,
    }, null, 2));
    await page.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
