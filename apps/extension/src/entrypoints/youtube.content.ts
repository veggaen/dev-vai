/**
 * YouTube Content Script
 *
 * Detects when you're watching a YouTube video and captures:
 *   1. The actual spoken transcript (captions XML)
 *   2. Video metadata (title, channel, description)
 *   3. Popular comments (those with significant likes/replies)
 *
 * Only captures on video pages, not on the homepage or search.
 */

// Module-level context reference so capture functions can check validity
let _ctx: { isValid: boolean } | null = null;

// Suppress "Extension context invalidated" errors globally.
// These are expected when the extension is reloaded while content scripts are active on open tabs.
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || String(e.reason || '');
  if (msg.includes('context invalidated') || msg.includes('Extension context')) {
    e.preventDefault();
  }
});
window.addEventListener('error', (e) => {
  if (e.message?.includes('context invalidated') || e.message?.includes('Extension context')) {
    e.preventDefault();
  }
});

export default defineContentScript({
  matches: ['https://www.youtube.com/watch*'],
  runAt: 'document_idle',

  main(ctx) {
    _ctx = ctx;

    // Respond to popup requests for page content
    try {
      if (!browser.runtime?.id) return;
      browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg?.type === 'VAI_GET_CONTENT') {
          sendResponse({
            title: document.title,
            content: document.body.innerText.slice(0, 50000),
            url: window.location.href,
          });
        }
      });
    } catch {
      console.warn('[VAI] Extension context invalidated on listener setup');
      return;
    }

    let lastVideoId = '';

    // YouTube is a SPA — watch for URL changes
    const observer = new MutationObserver(() => {
      if (!ctx.isValid) { observer.disconnect(); return; }
      const videoId = new URLSearchParams(window.location.search).get('v');
      if (videoId && videoId !== lastVideoId) {
        lastVideoId = videoId;
        // Wait longer for page to fully load (transcript + comments)
        ctx.setTimeout(() => captureVideoContent(videoId), 4000);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Clean up observer when context is invalidated
    ctx.onInvalidated(() => observer.disconnect());

    // Also capture on initial load
    const videoId = new URLSearchParams(window.location.search).get('v');
    if (videoId) {
      lastVideoId = videoId;
      ctx.setTimeout(() => captureVideoContent(videoId), 4000);
    }
  },
});

// ================================================================
// Main capture orchestrator
// ================================================================

async function captureVideoContent(videoId: string) {
  // ---- Video title ----
  const title = getVideoTitle();

  // ---- Channel name ----
  const channel = getChannelName();

  // ---- Description ----
  const description = getVideoDescription();

  // ---- Transcript (the actual spoken words) ----
  let transcript = '';

  // Method 1: Parse captions from ytInitialPlayerResponse (most reliable — available before page renders)
  transcript = await tryExtractCaptionsFromPageData();

  // Method 2: Parse from inline scripts
  if (!transcript) {
    transcript = await tryFetchCaptionTrackFromScripts();
  }

  // Method 3: Read the transcript panel in the DOM
  if (!transcript) {
    transcript = await tryReadTranscriptPanel();
  }

  // ---- Popular comments (likes >= 3 OR has replies) ----
  const comments = extractPopularComments();

  // ---- Build structured content ----
  const sections: string[] = [];

  // Header
  sections.push(`Title: ${title}`);
  if (channel) sections.push(`Channel: ${channel}`);
  sections.push(`URL: https://www.youtube.com/watch?v=${videoId}`);
  sections.push('');

  // Transcript section (the most important part)
  if (transcript && transcript.length > 50) {
    sections.push('=== TRANSCRIPT ===');
    sections.push(transcript);
    sections.push('');
  } else {
    sections.push('[No transcript/captions available for this video]');
    sections.push('');
  }

  // Description section
  if (description && description.length > 30) {
    sections.push('=== DESCRIPTION ===');
    sections.push(description);
    sections.push('');
  }

  // Popular comments section
  if (comments.length > 0) {
    sections.push('=== TOP COMMENTS ===');
    for (const c of comments) {
      const parts: string[] = [`@${c.author}: ${c.text}`];
      const metrics: string[] = [];
      if (c.likes > 0) metrics.push(`${c.likes} likes`);
      if (c.replies > 0) metrics.push(`${c.replies} replies`);
      if (metrics.length > 0) parts.push(`  [${metrics.join(', ')}]`);
      sections.push(parts.join('\n'));
    }
    sections.push('');
  }

  const content = sections.join('\n');

  // Only send if we have something meaningful
  const hasTranscript = transcript.length > 50;
  const hasDescription = (description?.length ?? 0) > 30;
  const hasComments = comments.length > 0;

  if (!hasTranscript && !hasDescription && !hasComments) {
    console.log(`[VAI] Skipping "${title}" — no transcript, description, or comments found`);
    return;
  }

  // Send to background script -> VAI server
  try {
    if (!browser.runtime?.id || !_ctx?.isValid) {
      console.warn('[VAI] Extension context invalidated — reload the extension or refresh the page');
      return;
    }
    browser.runtime.sendMessage({
      type: 'SAVE_TRANSCRIPT',
      url: window.location.href,
      title: title.replace(/^\(\d+\)\s*/, ''), // strip "(15) " prefix
      content,
      meta: {
        videoId,
        channel,
        hasTranscript,
        hasDescription,
        commentCount: comments.length,
        capturedBy: 'extension',
      },
    });
    console.log(
      `[VAI] Captured YouTube: "${title}" — transcript: ${hasTranscript ? transcript.length + ' chars' : 'none'}, ` +
      `description: ${hasDescription ? 'yes' : 'none'}, comments: ${comments.length}`
    );
  } catch (err) {
    console.warn('[VAI] Failed to send message (extension may have been reloaded):', err);
  }
}

// ================================================================
// Metadata extraction
// ================================================================

function getVideoTitle(): string {
  return (
    document.querySelector('#title h1 yt-formatted-string')?.textContent?.trim() ??
    document.querySelector('h1.style-scope.ytd-watch-metadata')?.textContent?.trim() ??
    document.querySelector('h1.ytd-video-primary-info-renderer')?.textContent?.trim() ??
    document.title.replace(' - YouTube', '').replace(/^\(\d+\)\s*/, '').trim()
  );
}

function getChannelName(): string {
  return (
    document.querySelector('#channel-name a')?.textContent?.trim() ??
    document.querySelector('ytd-channel-name a')?.textContent?.trim() ??
    document.querySelector('ytd-channel-name yt-formatted-string a')?.textContent?.trim() ??
    ''
  );
}

function getVideoDescription(): string {
  // Try the expanded description first
  const expander = document.querySelector('ytd-text-inline-expander #plain-snippet-text');
  if (expander?.textContent && expander.textContent.trim().length > 30) {
    return cleanDescription(expander.textContent.trim());
  }

  // Structured description
  const structured = document.querySelector('#description-inner, ytd-structured-description-content-renderer');
  if (structured?.textContent && structured.textContent.trim().length > 30) {
    return cleanDescription(structured.textContent.trim());
  }

  // Fallback
  const desc = document.querySelector('#description, #description-text');
  if (desc?.textContent && desc.textContent.trim().length > 30) {
    return cleanDescription(desc.textContent.trim());
  }

  return '';
}

function cleanDescription(text: string): string {
  return text
    .replace(/Show less\s*$/, '')
    .replace(/...more\s*$/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 3000); // cap description at 3k chars
}

// ================================================================
// Transcript extraction — 3 methods
// ================================================================

/**
 * Method 1 (BEST): Extract caption track URL from ytInitialPlayerResponse.
 * This global variable contains the full player config including caption URLs.
 * It's available before the page fully renders.
 */
async function tryExtractCaptionsFromPageData(): Promise<string> {
  try {
    // Try the global variable first
    const playerResponse = (window as Record<string, unknown>).ytInitialPlayerResponse as Record<string, unknown> | undefined;
    if (playerResponse) {
      const result = await extractCaptionsFromPlayerResponse(playerResponse);
      if (result) return result;
    }

    // Also try extracting from ytInitialData (sometimes captions are here too)
    const initialData = (window as Record<string, unknown>).ytInitialData as Record<string, unknown> | undefined;
    if (initialData) {
      // Walk through the engagement panels to find transcript data
      const panels = getNestedValue(initialData, 'engagementPanels') as unknown[];
      if (Array.isArray(panels)) {
        for (const panel of panels) {
          const transcriptRenderer = getNestedValue(panel, 'transcriptRenderer');
          if (transcriptRenderer) {
            const body = getNestedValue(transcriptRenderer, 'body', 'transcriptBodyRenderer', 'content') as unknown[];
            if (Array.isArray(body)) {
              const texts = body
                .map((segment: unknown) => {
                  const text = getNestedValue(segment, 'transcriptSegmentRenderer', 'snippet', 'runs');
                  if (Array.isArray(text)) return text.map((r: Record<string, string>) => r.text ?? '').join('');
                  return '';
                })
                .filter((t: string) => t.length > 0);
              if (texts.length > 5) return texts.join(' ');
            }
          }
        }
      }
    }
  } catch {
    // Not available
  }
  return '';
}

async function extractCaptionsFromPlayerResponse(playerResponse: Record<string, unknown>): Promise<string> {
  try {
    const captions = getNestedValue(playerResponse, 'captions', 'playerCaptionsTracklistRenderer') as Record<string, unknown> | undefined;
    const captionTracks = captions?.captionTracks as Array<Record<string, string>> | undefined;

    if (!captionTracks?.length) return '';

    // Prefer English, then Norwegian, then first available
    const track =
      captionTracks.find(t => t.languageCode === 'en' && t.kind !== 'asr') ?? // manual English
      captionTracks.find(t => t.languageCode === 'en') ?? // auto English
      captionTracks.find(t => t.languageCode === 'no') ??
      captionTracks.find(t => t.languageCode === 'nb') ??
      captionTracks[0];

    if (!track?.baseUrl) return '';

    // Fetch the captions XML with fmt=srv3 for better structure, fallback to default
    const urls = [
      track.baseUrl + (track.baseUrl.includes('?') ? '&' : '?') + 'fmt=srv3',
      track.baseUrl,
    ];

    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const xml = await res.text();
        if (xml.length > 0) {
          const parsed = parseTranscriptXml(xml);
          if (parsed.length > 50) {
            console.log(`[VAI] Got transcript from captions API (${parsed.length} chars, lang: ${track.languageCode})`);
            return parsed;
          }
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Failed to extract
  }
  return '';
}

/**
 * Method 2: Scan all <script> tags in the page for captionTracks JSON.
 * Broader regex to catch different YouTube page formats.
 */
async function tryFetchCaptionTrackFromScripts(): Promise<string> {
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    const text = script.textContent ?? '';
    if (!text.includes('captionTracks')) continue;

    // Try multiple regex patterns — YouTube changes their format
    const patterns = [
      /"captionTracks":\s*(\[[\s\S]*?\])(?=\s*[,}])/,
      /"captionTracks"\s*:\s*(\[.*?\])/,
      /captionTracks.*?(\[\{.*?\}\])/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;

      try {
        // Clean up potential escape sequences
        const jsonStr = match[1]
          .replace(/\\"/g, '"')
          .replace(/\\\\u/g, '\\u')
          .replace(/\\u0026/g, '&');

        const tracks = JSON.parse(jsonStr);
        if (!Array.isArray(tracks) || tracks.length === 0) continue;

        const track =
          tracks.find((t: Record<string, string>) => t.languageCode === 'en' && t.kind !== 'asr') ??
          tracks.find((t: Record<string, string>) => t.languageCode === 'en') ??
          tracks.find((t: Record<string, string>) => t.languageCode === 'no') ??
          tracks.find((t: Record<string, string>) => t.languageCode === 'nb') ??
          tracks[0];

        if (!track?.baseUrl) continue;

        // Decode the URL (YouTube often encodes it)
        const baseUrl = track.baseUrl
          .replace(/\\u0026/g, '&')
          .replace(/\\u003d/g, '=');

        const res = await fetch(baseUrl);
        if (!res.ok) continue;
        const xml = await res.text();
        if (xml.length > 0) {
          const parsed = parseTranscriptXml(xml);
          if (parsed.length > 50) {
            console.log(`[VAI] Got transcript from script parsing (${parsed.length} chars)`);
            return parsed;
          }
        }
      } catch {
        // Try next pattern
        continue;
      }
    }
    break; // Only check the first script that mentions captionTracks
  }
  return '';
}

/**
 * Method 3: Open the transcript panel in the DOM and read the segments.
 * Updated selectors for modern YouTube (2024-2026).
 */
async function tryReadTranscriptPanel(): Promise<string> {
  try {
    // First check if transcript panel is already open
    let segments = getTranscriptSegments();
    if (segments.length > 0) return segments.join(' ');

    // Try clicking "...more" on the description to reveal transcript button
    const moreButton = document.querySelector(
      'tp-yt-paper-button#expand, ' +
      '#expand.button, ' +
      'ytd-text-inline-expander #expand, ' +
      '#description-inline-expander tp-yt-paper-button'
    ) as HTMLElement | null;

    if (moreButton) {
      moreButton.click();
      await sleep(500);
    }

    // Look for "Show transcript" button in the description area
    const showTranscriptButton = findButtonByText('show transcript') ?? findButtonByText('vis transkripsjon');
    if (showTranscriptButton) {
      showTranscriptButton.click();
      await sleep(1500);

      segments = getTranscriptSegments();
      if (segments.length > 0) {
        console.log(`[VAI] Got transcript from DOM panel (${segments.length} segments)`);
        closeTranscriptPanel();
        return segments.join(' ');
      }
    }

    // Try the three-dot menu approach
    const menuButton = document.querySelector(
      'ytd-menu-renderer.ytd-watch-metadata button[aria-label], ' +
      '#above-the-fold ytd-menu-renderer button, ' +
      'ytd-watch-metadata ytd-menu-renderer yt-icon-button'
    ) as HTMLElement | null;

    if (menuButton) {
      menuButton.click();
      await sleep(500);

      const menuItems = document.querySelectorAll(
        'tp-yt-paper-listbox ytd-menu-service-item-renderer, ' +
        'ytd-menu-popup-renderer tp-yt-paper-item, ' +
        'ytd-menu-popup-renderer ytd-menu-service-item-renderer'
      );

      let transcriptButton: HTMLElement | null = null;
      for (const item of menuItems) {
        const itemText = item.textContent?.toLowerCase() ?? '';
        if (itemText.includes('transcript') || itemText.includes('transkripsjon')) {
          transcriptButton = item as HTMLElement;
          break;
        }
      }

      if (transcriptButton) {
        transcriptButton.click();
        await sleep(1500);

        segments = getTranscriptSegments();
        if (segments.length > 0) {
          console.log(`[VAI] Got transcript from menu->panel (${segments.length} segments)`);
          closeTranscriptPanel();
          return segments.join(' ');
        }
      } else {
        // Close menu if no transcript button found
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
    }
  } catch {
    // DOM method failed
  }
  return '';
}

function getTranscriptSegments(): string[] {
  const selectors = [
    'ytd-transcript-segment-renderer .segment-text',
    'ytd-transcript-segment-renderer yt-formatted-string.segment-text',
    '#segments-container ytd-transcript-segment-renderer',
    'ytd-transcript-segment-list-renderer ytd-transcript-segment-renderer',
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] .segment-text',
  ];

  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
      const texts = Array.from(elements)
        .map(el => el.textContent?.trim() ?? '')
        .filter(s => s.length > 0 && !s.match(/^\d{1,2}:\d{2}$/)); // filter out bare timestamps
      if (texts.length > 3) return texts;
    }
  }
  return [];
}

function closeTranscriptPanel() {
  const closeButton = document.querySelector(
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] #visibility-button button, ' +
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] button[aria-label="Close"]'
  ) as HTMLElement | null;
  if (closeButton) closeButton.click();
}

function findButtonByText(text: string): HTMLElement | null {
  const allButtons = document.querySelectorAll('button, tp-yt-paper-button, a[role="button"], [role="button"]');
  for (const btn of allButtons) {
    if (btn.textContent?.toLowerCase().includes(text)) {
      return btn as HTMLElement;
    }
  }
  return null;
}

// ================================================================
// Popular comments extraction
// ================================================================

interface ExtractedComment {
  author: string;
  text: string;
  likes: number;
  replies: number;
  isPinned: boolean;
}

/**
 * Extract comments that have significant engagement (likes >= 3 or has replies).
 * Skips low-engagement "me too" comments.
 */
function extractPopularComments(): ExtractedComment[] {
  const commentElements = document.querySelectorAll('ytd-comment-thread-renderer');
  const results: ExtractedComment[] = [];

  for (const thread of commentElements) {
    try {
      // Author
      const author = (
        thread.querySelector('#author-text')?.textContent?.trim() ??
        thread.querySelector('a#author-text span')?.textContent?.trim() ??
        'Unknown'
      );

      // Comment text
      const contentEl = thread.querySelector('#content-text');
      const text = contentEl?.textContent?.trim() ?? '';
      if (!text || text.length < 5) continue;

      // Like count — YouTube shows "1K", "452", etc.
      const likeText = (
        thread.querySelector('#vote-count-middle')?.textContent?.trim() ??
        thread.querySelector('#vote-count-left')?.textContent?.trim() ??
        '0'
      );
      const likes = parseLikeCount(likeText);

      // Reply count
      const replyText = (
        thread.querySelector('#more-replies button')?.textContent?.trim() ??
        thread.querySelector('[id*="replies"] #more-replies')?.textContent?.trim() ??
        ''
      );
      const replies = parseReplyCount(replyText);

      // Pinned?
      const isPinned = !!thread.querySelector('#pinned-comment-badge');

      // Filter: only keep comments with real engagement
      // Pinned comments are always included (creator highlights them for a reason)
      // Otherwise need >= 3 likes OR >= 1 reply
      if (!isPinned && likes < 3 && replies < 1) continue;

      // Skip very short comments (< 15 chars) unless they have high engagement
      if (text.length < 15 && likes < 10) continue;

      results.push({ author, text: text.slice(0, 500), likes, replies, isPinned });
    } catch {
      continue;
    }
  }

  // Sort: pinned first, then by engagement (likes + replies*5)
  results.sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return (b.likes + b.replies * 5) - (a.likes + a.replies * 5);
  });

  // Cap at 20 top comments
  return results.slice(0, 20);
}

function parseLikeCount(text: string): number {
  if (!text) return 0;
  const cleaned = text.replace(/\s/g, '').trim();
  if (!cleaned || cleaned === '0') return 0;

  // "1.2K" => 1200, "5K" => 5000, "1.3M" => 1300000
  const match = cleaned.match(/^([\d.]+)\s*([KkMm])?$/);
  if (!match) return 0;

  const num = parseFloat(match[1]);
  const suffix = (match[2] ?? '').toUpperCase();
  if (suffix === 'K') return Math.round(num * 1000);
  if (suffix === 'M') return Math.round(num * 1000000);
  return Math.round(num);
}

function parseReplyCount(text: string): number {
  if (!text) return 0;
  // "5 replies", "1 reply", "View 3 replies"
  const match = text.match(/(\d+)\s*repl/i);
  if (match) return parseInt(match[1], 10);
  // Just "View replies" means at least 1
  if (text.toLowerCase().includes('repl')) return 1;
  // Norwegian: "svar" means replies
  const noMatch = text.match(/(\d+)\s*svar/i);
  if (noMatch) return parseInt(noMatch[1], 10);
  if (text.toLowerCase().includes('svar')) return 1;
  return 0;
}

// ================================================================
// XML parsing + helpers
// ================================================================

function parseTranscriptXml(xml: string): string {
  // Handle both <text> format (srv1) and <p> format (srv3)
  const textSegments = xml.match(/<text[^>]*>([\s\S]*?)<\/text>/g);
  const pSegments = xml.match(/<p[^>]*>([\s\S]*?)<\/p>/g);

  const segments = textSegments ?? pSegments;
  if (!segments) return '';

  return segments
    .map((s) => {
      // Strip tags, decode HTML entities
      return s
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/\n/g, ' ')
        .trim();
    })
    .filter((s) => s.length > 0)
    .join(' ');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Safely navigate nested objects.
 * getNestedValue(obj, 'a', 'b', 'c') === obj?.a?.b?.c
 */
function getNestedValue(obj: unknown, ...keys: string[]): unknown {
  let current = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
