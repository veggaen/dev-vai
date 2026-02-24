/**
 * YouTube Content Script
 *
 * Detects when you're watching a YouTube video and captures the transcript.
 * Only captures on video pages, not on the homepage or search.
 */

export default defineContentScript({
  matches: ['https://www.youtube.com/watch*'],
  runAt: 'document_idle',

  main() {
    let lastVideoId = '';

    // YouTube is a SPA — watch for URL changes
    const observer = new MutationObserver(() => {
      const videoId = new URLSearchParams(window.location.search).get('v');
      if (videoId && videoId !== lastVideoId) {
        lastVideoId = videoId;
        // Wait for page to fully load
        setTimeout(() => captureTranscript(videoId), 3000);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Also capture on initial load
    const videoId = new URLSearchParams(window.location.search).get('v');
    if (videoId) {
      lastVideoId = videoId;
      setTimeout(() => captureTranscript(videoId), 3000);
    }
  },
});

async function captureTranscript(videoId: string) {
  const title = document.querySelector('h1.ytd-video-primary-info-renderer, h1.style-scope.ytd-watch-metadata')?.textContent?.trim()
    ?? document.title.replace(' - YouTube', '').trim();

  // Try to get transcript from the page
  // Method 1: Click "Show transcript" button if available
  let transcript = '';

  // Look for transcript in the page's initial data
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    const text = script.textContent ?? '';
    if (text.includes('captionTracks')) {
      const match = text.match(/"captionTracks":\s*(\[[\s\S]*?\])/);
      if (match) {
        try {
          const tracks = JSON.parse(match[1]);
          const track = tracks.find((t: Record<string, string>) => t.languageCode === 'en')
            ?? tracks.find((t: Record<string, string>) => t.languageCode === 'no')
            ?? tracks[0];

          if (track?.baseUrl) {
            const res = await fetch(track.baseUrl);
            const xml = await res.text();
            transcript = parseTranscriptXml(xml);
          }
        } catch {
          // Failed to parse caption tracks
        }
      }
      break;
    }
  }

  // Method 2: Try to get description as fallback
  if (!transcript) {
    const description = document.querySelector('#description-inner, #description')?.textContent?.trim();
    if (description && description.length > 50) {
      transcript = `[Video description - no transcript available]\n${description}`;
    }
  }

  if (!transcript) {
    transcript = `[No transcript available for: ${title}]`;
  }

  // Send to background script -> VAI server
  browser.runtime.sendMessage({
    type: 'SAVE_TRANSCRIPT',
    url: window.location.href,
    title,
    content: transcript,
    meta: {
      videoId,
      channel: document.querySelector('#channel-name a, ytd-channel-name a')?.textContent?.trim(),
    },
  });

  console.log(`[VAI] Captured YouTube transcript: "${title}" (${transcript.length} chars)`);
}

function parseTranscriptXml(xml: string): string {
  const segments = xml.match(/<text[^>]*>([\s\S]*?)<\/text>/g);
  if (!segments) return '';
  return segments
    .map((s) => s.replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim())
    .filter((s) => s.length > 0)
    .join(' ');
}
