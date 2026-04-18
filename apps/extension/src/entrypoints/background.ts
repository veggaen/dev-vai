/**
 * VAI Chrome Extension — Background Service Worker
 *
 * Receives captured data from content scripts and sends it to the VAI server.
 * Adds per-domain capture policies, a local capture log, and consistent sanitization
 * across every capture path.
 */

import {
  getCapturePolicy,
  hostnameFromUrl,
  isSensitivePage,
  sanitizeContent,
  type CapturePolicy,
  type DomainCapturePolicyMap,
} from '../lib/privacy.js';

const RUNTIME_BASE = 'http://localhost:3006';
const CAPTURE_LOG_LIMIT = 20;

type CaptureMethod = 'auto' | 'content-script' | 'inject' | 'server-scrape' | 'content-message';

interface CaptureLogEntry {
  readonly id: string;
  readonly at: string;
  readonly title: string;
  readonly url: string;
  readonly hostname: string;
  readonly method: CaptureMethod;
  readonly policy: CapturePolicy;
  readonly updated: boolean;
  readonly reason: string;
}

interface CaptureMessagePayload {
  readonly type: string;
  readonly url: string;
  readonly title: string;
  readonly content: string;
  readonly language?: string;
  readonly meta?: Record<string, unknown>;
}

let autoCaptureEnabled = false;

export default defineBackground({
  type: 'module',
  main() {
    browser.storage.local.get('autoCapture').then((data) => {
      autoCaptureEnabled = (data.autoCapture as boolean) ?? false;
    });

    browser.runtime.onMessage.addListener(
      (message: Record<string, unknown>, sender, sendResponse) => {
        handleMessage(message, sender)
          .then((result) => sendResponse(result))
          .catch((err) => sendResponse({ success: false, error: String(err) }));
        return true;
      },
    );

    browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (!autoCaptureEnabled) return;
      if (changeInfo.status !== 'complete') return;
      if (!tab.url || !tab.url.startsWith('http')) return;

      setTimeout(() => {
        void autoCapturePage(tabId, tab.url!, tab.title ?? '');
      }, 2000);
    });

    console.log('[VAI] Background service worker started');
  },
});

async function getDomainPolicies(): Promise<DomainCapturePolicyMap> {
  const data = await browser.storage.local.get('domainCapturePolicies');
  const raw = data.domainCapturePolicies;
  return raw && typeof raw === 'object' ? raw as DomainCapturePolicyMap : {};
}

async function getPolicyForUrl(url: string): Promise<CapturePolicy> {
  const rules = await getDomainPolicies();
  return getCapturePolicy(url, rules);
}

async function isRuntimeAvailable(): Promise<boolean> {
  try {
    const healthRes = await fetch(`${RUNTIME_BASE}/health`);
    return healthRes.ok;
  } catch {
    return false;
  }
}

async function incrementCaptureCountIfNeeded(updated: boolean): Promise<void> {
  if (updated) return;
  const data = await browser.storage.local.get('captureCount');
  const count = ((data.captureCount as number) ?? 0) + 1;
  await browser.storage.local.set({ captureCount: count });
}

async function recordCaptureLog(entry: Omit<CaptureLogEntry, 'id'>): Promise<void> {
  const data = await browser.storage.local.get('captureLog');
  const existing = Array.isArray(data.captureLog) ? data.captureLog as CaptureLogEntry[] : [];
  const next: CaptureLogEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  await browser.storage.local.set({
    captureLog: [next, ...existing].slice(0, CAPTURE_LOG_LIMIT),
  });
}

async function postCapturePayload(
  payload: CaptureMessagePayload,
  context: {
    method: CaptureMethod;
    policy: CapturePolicy;
    reason: string;
  },
) {
  const hostname = hostnameFromUrl(payload.url) ?? 'unknown';
  const sanitizedContent = sanitizeContent(payload.content);
  const meta = {
    ...(payload.meta ?? {}),
    captureMethod: context.method,
    capturePolicy: context.policy,
    captureReason: context.reason,
    contentSanitized: true,
    capturedAt: new Date().toISOString(),
    captureHostname: hostname,
  };

  const res = await fetch(`${RUNTIME_BASE}/api/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      content: sanitizedContent,
      meta,
    }),
  });

  if (!res.ok) {
    throw new Error(`Server error: ${res.status}`);
  }

  const result = await res.json();
  await incrementCaptureCountIfNeeded(Boolean(result.updated));
  await recordCaptureLog({
    at: new Date().toISOString(),
    title: payload.title,
    url: payload.url,
    hostname,
    method: context.method,
    policy: context.policy,
    updated: Boolean(result.updated),
    reason: context.reason,
  });
  return result;
}

async function autoCapturePage(tabId: number, url: string, title: string) {
  try {
    if (!(await isRuntimeAvailable())) return;
    const policy = await getPolicyForUrl(url);
    if (policy !== 'always') return;
    if (isSensitivePage(url)) return;

    if (
      url.includes('youtube.com/watch') ||
      url.includes('github.com/') ||
      url.match(/google\.\w+\/search/)
    ) {
      return;
    }

    const [result] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => ({
        title: document.title,
        content: document.body.innerText.slice(0, 50000),
        url: window.location.href,
      }),
    });

    if (!result?.result) return;
    const pageData = result.result as { title: string; content: string; url: string };
    if (pageData.content.length < 100) return;

    const captureResult = await postCapturePayload(
      {
        type: 'SAVE_CONTENT',
        url: pageData.url || url,
        title: pageData.title || title,
        content: pageData.content,
      },
      {
        method: 'auto',
        policy,
        reason: 'auto-capture enabled for this domain',
      },
    );

    console.log(`[VAI] Auto-captured: "${pageData.title}" (${captureResult.updated ? 'updated' : 'new'})`);
  } catch {
    // Auto-capture stays quiet by design.
  }
}

async function handleCaptureMessage(
  message: Record<string, unknown>,
  sender: browser.Runtime.MessageSender,
) {
  const url = (message.url as string) ?? sender.url ?? '';
  const policy = await getPolicyForUrl(url);

  if (policy === 'never' || isSensitivePage(url)) {
    return { success: false, error: 'Capture blocked by privacy policy for this domain.' };
  }

  try {
    const result = await postCapturePayload(
      {
        type: message.type as string,
        url,
        title: (message.title as string) ?? '',
        content: (message.content as string) ?? '',
        language: message.language as string | undefined,
        meta: (message.meta as Record<string, unknown> | undefined) ?? undefined,
      },
      {
        method: 'content-message',
        policy,
        reason: policy === 'ask' ? 'manual capture allowed for ask-only domain' : 'content capture message',
      },
    );

    return { success: true, result };
  } catch {
    return {
      success: false,
      error: 'VAI server not reachable. Is it running on localhost:3006?',
    };
  }
}

async function tryContentScriptCapture(
  tabId: number,
  tabUrl: string,
  tabTitle: string,
  policy: CapturePolicy,
) {
  try {
    const pageData = await browser.tabs.sendMessage(tabId, { type: 'VAI_GET_CONTENT' });
    if (!pageData?.content) return null;
    return await postCapturePayload(
      {
        type: 'SAVE_CONTENT',
        url: (pageData.url as string) ?? tabUrl,
        title: (pageData.title as string) ?? tabTitle,
        content: pageData.content as string,
      },
      {
        method: 'content-script',
        policy,
        reason: policy === 'ask' ? 'manual capture from content script on ask-only domain' : 'manual capture from content script',
      },
    );
  } catch {
    return null;
  }
}

async function tryInjectedCapture(
  tabId: number,
  policy: CapturePolicy,
) {
  try {
    const [result] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => ({
        title: document.title,
        content: document.body.innerText.slice(0, 50000),
        url: window.location.href,
      }),
    });

    if (!result?.result) return null;

    return await postCapturePayload(
      {
        type: 'SAVE_CONTENT',
        url: result.result.url,
        title: result.result.title,
        content: result.result.content,
      },
      {
        method: 'inject',
        policy,
        reason: policy === 'ask' ? 'manual capture from script injection on ask-only domain' : 'manual capture from script injection',
      },
    );
  } catch {
    return null;
  }
}

async function tryServerScrapeCapture(
  tabUrl: string,
  tabTitle: string,
  policy: CapturePolicy,
) {
  try {
    const res = await fetch(`${RUNTIME_BASE}/api/ingest/web`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: tabUrl }),
    });
    if (!res.ok) {
      return { success: false, error: 'Server failed to scrape page' };
    }

    const result = await res.json();
    await incrementCaptureCountIfNeeded(Boolean(result.updated));
    await recordCaptureLog({
      at: new Date().toISOString(),
      title: tabTitle,
      url: tabUrl,
      hostname: hostnameFromUrl(tabUrl) ?? 'unknown',
      method: 'server-scrape',
      policy,
      updated: Boolean(result.updated),
      reason: policy === 'ask' ? 'manual server scrape for ask-only domain' : 'manual server scrape fallback',
    });
    return { success: true, method: 'server-scrape', result };
  } catch {
    return { success: false, error: 'VAI server not reachable' };
  }
}

async function handleMessage(
  message: Record<string, unknown>,
  sender: browser.Runtime.MessageSender,
) {
  const type = message.type as string;

  if (type === 'GET_STATUS') {
    try {
      const res = await fetch(`${RUNTIME_BASE}/health`);
      const data = await res.json();
      return { success: true, connected: true, data };
    } catch {
      return { success: true, connected: false };
    }
  }

  if (type === 'SET_AUTO_CAPTURE') {
    autoCaptureEnabled = (message.enabled as boolean) ?? false;
    return { success: true };
  }

  if (
    type === 'SAVE_TRANSCRIPT' ||
    type === 'SAVE_GITHUB_REPO' ||
    type === 'SAVE_SEARCH' ||
    type === 'SAVE_CONTENT'
  ) {
    return handleCaptureMessage(message, sender);
  }

  if (type === 'CAPTURE_PAGE') {
    const tabId = message.tabId as number | undefined;
    const tabUrl = message.url as string;
    const tabTitle = message.title as string;
    const policy = await getPolicyForUrl(tabUrl);

    if (policy === 'never' || isSensitivePage(tabUrl)) {
      return { success: false, error: 'Capture blocked by privacy policy for this domain.' };
    }

    if (!(await isRuntimeAvailable())) {
      return { success: false, error: 'VAI server not reachable. Is it running on localhost:3006?' };
    }

    if (tabId) {
      const contentScriptResult = await tryContentScriptCapture(tabId, tabUrl, tabTitle, policy);
      if (contentScriptResult) {
        return { success: true, method: 'content-script', result: contentScriptResult };
      }
    }

    if (tabId) {
      const injectedResult = await tryInjectedCapture(tabId, policy);
      if (injectedResult) {
        return { success: true, method: 'inject', result: injectedResult };
      }
    }

    return tryServerScrapeCapture(tabUrl, tabTitle, policy);
  }

  return { success: false, error: `Unknown message type: ${type}` };
}
