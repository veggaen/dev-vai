/**
 * VAI Chrome Extension — Background Service Worker
 *
 * Receives captured data from content scripts and sends it to the VAI server.
 * Uses chrome.storage to persist state across service worker restarts (MV3 requirement).
 */

import { isSensitivePage, sanitizeContent } from '../lib/privacy.js';

let autoCaptureEnabled = false;

export default defineBackground({
  type: 'module',
  main() {
    // Restore auto-capture setting
    browser.storage.local.get('autoCapture').then((data) => {
      autoCaptureEnabled = (data.autoCapture as boolean) ?? false;
    });

    // Listen for messages from content scripts and popup
    browser.runtime.onMessage.addListener(
      (message: Record<string, unknown>, sender, sendResponse) => {
        handleMessage(message, sender)
          .then((result) => sendResponse(result))
          .catch((err) => sendResponse({ success: false, error: String(err) }));
        return true; // async response
      },
    );

    // Auto-capture: listen for tab navigation completions
    browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (!autoCaptureEnabled) return;
      if (changeInfo.status !== 'complete') return;
      if (!tab.url || !tab.url.startsWith('http')) return;
      if (isSensitivePage(tab.url)) return;

      // Skip URLs that are already handled by content scripts
      if (tab.url.includes('youtube.com/watch') ||
          tab.url.includes('github.com/') ||
          tab.url.match(/google\.\w+\/search/)) {
        return;
      }

      // Debounce: wait 2s after page load before capturing
      setTimeout(() => autoCapturePage(tabId, tab.url!, tab.title ?? ''), 2000);
    });

    console.log('[VAI] Background service worker started');
  },
});

/**
 * Auto-capture a page: inject script to get content, send to server.
 */
async function autoCapturePage(tabId: number, url: string, title: string) {
  try {
    // Check if server is available
    const healthRes = await fetch('http://localhost:3006/health');
    if (!healthRes.ok) return;

    // Try to get page content via scripting
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

    // Skip pages with very little content
    if (pageData.content.length < 100) return;

    // Sanitize content before sending
    const content = sanitizeContent(pageData.content);

    const res = await fetch('http://localhost:3006/api/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'SAVE_CONTENT',
        url: pageData.url || url,
        title: pageData.title || title,
        content,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      // Only increment count for new captures (not updates)
      if (!data.updated) {
        const storageData = await browser.storage.local.get('captureCount');
        const count = ((storageData.captureCount as number) ?? 0) + 1;
        await browser.storage.local.set({ captureCount: count });
      }
      console.log(`[VAI] Auto-captured: "${pageData.title}" (${data.updated ? 'updated' : 'new'})`);
    }
  } catch {
    // Auto-capture failed silently — don't bother the user
  }
}

async function handleMessage(
  message: Record<string, unknown>,
  sender: browser.Runtime.MessageSender,
) {
  const type = message.type as string;

  if (type === 'GET_STATUS') {
    try {
      const res = await fetch('http://localhost:3006/health');
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
    try {
      const res = await fetch('http://localhost:3006/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...message,
          url: (message.url as string) ?? sender.url ?? '',
        }),
      });

      if (!res.ok) {
        return { success: false, error: `Server error: ${res.status}` };
      }

      const result = await res.json();

      // Only increment capture count for new sources (not updates)
      if (!result.updated) {
        const data = await browser.storage.local.get('captureCount');
        const count = ((data.captureCount as number) ?? 0) + 1;
        await browser.storage.local.set({ captureCount: count });
      }

      return { success: true, result };
    } catch (_err) {
      return {
        success: false,
        error: 'VAI server not reachable. Is it running on localhost:3006?',
      };
    }
  }

  if (type === 'CAPTURE_PAGE') {
    const tabId = message.tabId as number | undefined;
    const tabUrl = message.url as string;
    const tabTitle = message.title as string;

    // Strategy 1: Try to get content from a content script already on the page
    if (tabId) {
      try {
        const pageData = await browser.tabs.sendMessage(tabId, { type: 'VAI_GET_CONTENT' });
        if (pageData?.content) {
          const res = await fetch('http://localhost:3006/api/capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'SAVE_CONTENT',
              url: pageData.url ?? tabUrl,
              title: pageData.title ?? tabTitle,
              content: pageData.content,
            }),
          });
          if (res.ok) {
            const result = await res.json();
            if (!result.updated) {
              const data = await browser.storage.local.get('captureCount');
              const count = ((data.captureCount as number) ?? 0) + 1;
              await browser.storage.local.set({ captureCount: count });
            }
            return { success: true, method: 'content-script', result };
          }
        }
      } catch {
        // No content script responding — fall through
      }
    }

    // Strategy 2: Try scripting.executeScript (works on most pages)
    if (tabId) {
      try {
        const [result] = await browser.scripting.executeScript({
          target: { tabId },
          func: () => ({
            title: document.title,
            content: document.body.innerText.slice(0, 50000),
            url: window.location.href,
          }),
        });
        if (result?.result) {
          const res = await fetch('http://localhost:3006/api/capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'SAVE_CONTENT',
              ...result.result,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            if (!data.updated) {
              const storageData = await browser.storage.local.get('captureCount');
              const count = ((storageData.captureCount as number) ?? 0) + 1;
              await browser.storage.local.set({ captureCount: count });
            }
            return { success: true, method: 'inject', result: data };
          }
        }
      } catch {
        // CSP or other restriction — fall through
      }
    }

    // Strategy 3: Server-side scrape (works for any public URL, bypasses CSP entirely)
    try {
      const res = await fetch('http://localhost:3006/api/ingest/web', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: tabUrl }),
      });
      if (res.ok) {
        const result = await res.json();
        if (!result.updated) {
          const data = await browser.storage.local.get('captureCount');
          const count = ((data.captureCount as number) ?? 0) + 1;
          await browser.storage.local.set({ captureCount: count });
        }
        return { success: true, method: 'server-scrape', result };
      }
      return { success: false, error: 'Server failed to scrape page' };
    } catch {
      return { success: false, error: 'VAI server not reachable' };
    }
  }

  return { success: false, error: `Unknown message type: ${type}` };
}
