/**
 * YouTube transcript extraction.
 *
 * Two modes:
 *   1. Server-side: fetch transcript from YouTube's innertube API (no auth needed for public videos)
 *   2. Extension-side: content script extracts transcript from DOM (handled by Chrome extension)
 *
 * This file handles mode 1 (server-side).
 */

import type { RawCapture } from './pipeline.js';

export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export async function fetchYouTubeTranscript(url: string): Promise<RawCapture> {
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error(`Could not extract video ID from URL: ${url}`);
  }

  // Fetch the video page to get metadata and caption tracks
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': 'VeggaAI/0.1 (Local AI Learning Agent)',
      Accept: 'text/html',
    },
  });

  if (!pageRes.ok) {
    throw new Error(`Failed to fetch YouTube page: ${pageRes.status}`);
  }

  const pageHtml = await pageRes.text();

  // Extract video title
  const titleMatch = pageHtml.match(/<title>([\s\S]*?)<\/title>/);
  const title = titleMatch
    ? titleMatch[1].replace(' - YouTube', '').trim()
    : `YouTube Video ${videoId}`;

  // Extract caption track URLs from the page data
  const captionsMatch = pageHtml.match(/"captions":\s*(\{[\s\S]*?"playerCaptionsTracklistRenderer"[\s\S]*?\})\s*,\s*"/);

  if (!captionsMatch) {
    return {
      sourceType: 'youtube',
      url,
      title,
      content: `[No transcript available for video: ${title}]`,
      meta: {
        videoId,
        hasTranscript: false,
        fetchedAt: new Date().toISOString(),
      },
    };
  }

  // Try to parse and fetch the actual transcript
  try {
    const captionsData = JSON.parse(captionsMatch[1]);
    const tracks = captionsData?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!tracks || tracks.length === 0) {
      return {
        sourceType: 'youtube',
        url,
        title,
        content: `[No transcript tracks found for video: ${title}]`,
        meta: { videoId, hasTranscript: false, fetchedAt: new Date().toISOString() },
      };
    }

    // Prefer English, then any language
    const track = tracks.find((t: Record<string, string>) => t.languageCode === 'en')
      ?? tracks.find((t: Record<string, string>) => t.languageCode === 'no')
      ?? tracks[0];

    const captionRes = await fetch(track.baseUrl);
    if (!captionRes.ok) {
      throw new Error(`Failed to fetch captions: ${captionRes.status}`);
    }

    const captionXml = await captionRes.text();
    const transcript = parseCaptionXml(captionXml);

    return {
      sourceType: 'youtube',
      url,
      title,
      content: transcript,
      language: track.languageCode === 'no' ? 'no' : 'en',
      meta: {
        videoId,
        hasTranscript: true,
        languageCode: track.languageCode,
        fetchedAt: new Date().toISOString(),
      },
    };
  } catch {
    return {
      sourceType: 'youtube',
      url,
      title,
      content: `[Failed to parse transcript for video: ${title}]`,
      meta: { videoId, hasTranscript: false, fetchedAt: new Date().toISOString() },
    };
  }
}

/**
 * Parse YouTube's XML caption format into plain text.
 */
function parseCaptionXml(xml: string): string {
  const textSegments = xml.match(/<text[^>]*>([\s\S]*?)<\/text>/g);
  if (!textSegments) return '';

  return textSegments
    .map((segment) => {
      const content = segment.replace(/<[^>]*>/g, '');
      return content
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n/g, ' ')
        .trim();
    })
    .filter((s) => s.length > 0)
    .join(' ');
}

/**
 * Accept a transcript directly from the Chrome extension.
 * This is used when the extension captures the transcript from the DOM.
 */
export function createYouTubeCapture(
  url: string,
  title: string,
  transcript: string,
  meta?: Record<string, unknown>,
): RawCapture {
  const videoId = extractVideoId(url);
  return {
    sourceType: 'youtube',
    url,
    title,
    content: transcript,
    meta: {
      videoId,
      hasTranscript: true,
      capturedBy: 'extension',
      fetchedAt: new Date().toISOString(),
      ...meta,
    },
  };
}
