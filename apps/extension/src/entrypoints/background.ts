/**
 * VAI Chrome Extension — Background Service Worker
 *
 * Receives captured data from content scripts and sends it to the VAI server.
 * Uses chrome.storage to persist state across service worker restarts (MV3 requirement).
 */

export default defineBackground({
  type: 'module',
  main() {
    // Track capture count across service worker restarts
    browser.runtime.onMessage.addListener(
      (message: Record<string, unknown>, sender, sendResponse) => {
        handleMessage(message, sender)
          .then((result) => sendResponse(result))
          .catch((err) => sendResponse({ success: false, error: String(err) }));
        return true; // async response
      },
    );

    console.log('[VAI] Background service worker started');
  },
});

async function handleMessage(
  message: Record<string, unknown>,
  sender: browser.Runtime.MessageSender,
) {
  const type = message.type as string;

  if (type === 'GET_STATUS') {
    try {
      const res = await fetch('http://localhost:3001/health');
      const data = await res.json();
      return { success: true, connected: true, data };
    } catch {
      return { success: true, connected: false };
    }
  }

  if (
    type === 'SAVE_TRANSCRIPT' ||
    type === 'SAVE_GITHUB_REPO' ||
    type === 'SAVE_SEARCH' ||
    type === 'SAVE_CONTENT'
  ) {
    try {
      const res = await fetch('http://localhost:3001/api/capture', {
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

      // Update capture count in storage
      const data = await browser.storage.local.get('captureCount');
      const count = ((data.captureCount as number) ?? 0) + 1;
      await browser.storage.local.set({ captureCount: count });

      return { success: true, ...result };
    } catch (_err) {
      return {
        success: false,
        error: 'VAI server not reachable. Is it running on localhost:3001?',
      };
    }
  }

  return { success: false, error: `Unknown message type: ${type}` };
}
