/**
 * Adapter definitions for the visible AI comparison harness.
 * Each adapter declares enough structure for the runner to drive it safely
 * while keeping brittle site-specific details isolated in one place.
 */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   url: string,
 *   requiresAuth?: boolean,
 *   promptSelectors: string[],
 *   submitSelectors?: string[],
 *   assistantSelectors?: string[],
 *   responseContainerSelector?: string,
 *   responseMode: 'assistant-list' | 'container-growth',
 *   sourceSelectors?: string[],
 *   followUpSelectors?: string[],
 *   loginSentinelSelectors?: string[],
 *   answerNoisePatterns?: string[],
 *   readyWaitMs?: number,
 *   hint?: string,
 * }} SiteAdapter
 */

/** @returns {Record<string, SiteAdapter>} */
export function getSiteAdapters() {
  return {
    vai: {
      id: 'vai',
      label: 'Vai Desktop',
      url: 'http://127.0.0.1:5173',
      promptSelectors: ['textarea'],
      submitSelectors: ['button[title="Send message (Enter)"]'],
      assistantSelectors: ['[data-chat-message-role="assistant"]'],
      responseMode: 'assistant-list',
      sourceSelectors: [
        '[data-research-source-summary="button"]',
        'a[aria-label^="Source "]',
        'text=/\\d+ source(s)?/i',
      ],
      followUpSelectors: ['[data-follow-up-button="button"]'],
      answerNoisePatterns: [
        '^vai\\d+%\\d+\\s*sources?',
        '^vai\\s*\\d+%\\s*\\d+\\s*sources?',
      ],
      readyWaitMs: 1200,
      hint: 'Local desktop shell with auth bypass support.',
    },
    perplexity: {
      id: 'perplexity',
      label: 'Perplexity',
      url: 'https://www.perplexity.ai/',
      promptSelectors: [
        'textarea',
        '[contenteditable="true"][role="textbox"]',
        '[contenteditable="true"]',
      ],
      submitSelectors: [
        'button[aria-label*="Submit"]',
        'button[aria-label*="Send"]',
        'button[type="submit"]',
      ],
      responseContainerSelector: 'main',
      responseMode: 'container-growth',
      sourceSelectors: [
        'a[href^="http"]',
        'button:has-text("Sources")',
        'text=/\\d+ source(s)?/i',
      ],
      followUpSelectors: [
        'button:has-text("Related")',
        'button:has-text("Ask follow-up")',
        'button',
      ],
      answerNoisePatterns: [
        '^answer(?:answer)?links(?:links)?images(?:images)?sharedownloadcomet',
        '^answer\\s+links\\s+images\\s+share\\s+download(?:\\s+comet)?',
      ],
      loginSentinelSelectors: [
        'button:has-text("Sign in")',
        'a:has-text("Sign in")',
        'text=Continue with Google',
      ],
      readyWaitMs: 2000,
      hint: 'Public access is often available, but layout/anti-bot changes can break selectors.',
    },
    chatgpt: {
      id: 'chatgpt',
      label: 'ChatGPT',
      url: 'https://chatgpt.com/',
      requiresAuth: true,
      promptSelectors: [
        '#prompt-textarea',
        'textarea[placeholder*="Message"]',
        'textarea',
        '[contenteditable="true"][role="textbox"]',
      ],
      submitSelectors: [
        'button[data-testid="send-button"]',
        'button[aria-label*="Send"]',
        'button[type="submit"]',
      ],
      assistantSelectors: [
        '[data-message-author-role="assistant"]',
        'article[data-testid^="conversation-turn-"]',
      ],
      responseMode: 'assistant-list',
      sourceSelectors: [],
      followUpSelectors: [
        'button:has-text("Suggested")',
        'button:has-text("Try again")',
      ],
      answerNoisePatterns: [
        '^chatgpt',
      ],
      loginSentinelSelectors: [
        'button:has-text("Log in")',
        'button:has-text("Sign up")',
        'a:has-text("Log in")',
      ],
      readyWaitMs: 2000,
      hint: 'Usually requires an authenticated session; the harness marks it blocked instead of failing hard when login is required.',
    },
  };
}

export function resolveAdapters(targetIds) {
  const adapters = getSiteAdapters();
  return targetIds.map((targetId) => {
    const adapter = adapters[targetId.trim().toLowerCase()];
    if (!adapter) {
      throw new Error(`Unknown target '${targetId}'. Available: ${Object.keys(adapters).join(', ')}`);
    }
    return adapter;
  });
}