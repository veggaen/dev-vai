/**
 * YouTube transcript extraction.
 *
 * Three modes:
 *   1. Server-side via yt-dlp: Most reliable — uses yt-dlp CLI to download subtitle files
 *   2. Server-side HTTP fallback: Fetches captionTracks from page HTML (often blocked by YouTube)
 *   3. Extension-side: Content script extracts transcript from DOM (handled by Chrome extension)
 *
 * This file handles modes 1 and 2 (server-side).
 */

import { execFile } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  // Try yt-dlp first (most reliable), fall back to HTTP
  const ytdlpResult = await fetchViaYtDlp(videoId);
  if (ytdlpResult) {
    return {
      sourceType: 'youtube',
      url,
      title: ytdlpResult.title,
      content: ytdlpResult.transcript,
      language: ytdlpResult.lang === 'no' ? 'no' : 'en',
      meta: {
        videoId,
        hasTranscript: true,
        languageCode: ytdlpResult.lang,
        method: 'yt-dlp',
        fetchedAt: new Date().toISOString(),
      },
    };
  }

  // Fallback: direct HTTP fetch of caption tracks
  return fetchViaHttp(url, videoId);
}

/**
 * Use yt-dlp CLI to download subtitles. This is the most reliable method
 * since yt-dlp handles YouTube's anti-bot protections.
 */
async function fetchViaYtDlp(videoId: string): Promise<{ title: string; transcript: string; lang: string } | null> {
  const tmpBase = join(tmpdir(), `vai-yt-${videoId}-${Date.now()}`);
  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    // First get video title
    const title = await runYtDlp(['--get-title', '--no-warnings', ytUrl]);

    // Try each language separately — yt-dlp exits with error if any language
    // in a comma-separated list fails, even if others succeed
    for (const lang of ['en', 'no']) {
      try {
        await runYtDlp([
          '--write-subs',
          '--write-auto-subs',
          '--sub-lang', lang,
          '--sub-format', 'json3',
          '--skip-download',
          '--no-warnings',
          '-o', tmpBase,
          ytUrl,
        ]);
      } catch {
        // This language failed (429, not available, etc.)
      }

      const subFile = `${tmpBase}.${lang}.json3`;
      try {
        const data = await readFile(subFile, 'utf-8');
        const transcript = parseJson3Subtitles(data);
        await unlink(subFile).catch(() => {});
        if (transcript.length > 10) {
          return { title: title.trim(), transcript, lang };
        }
      } catch {
        // File doesn't exist for this language, try next
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Parse yt-dlp's json3 subtitle format into plain text.
 */
function parseJson3Subtitles(jsonStr: string): string {
  try {
    const data = JSON.parse(jsonStr);
    const events = data.events || [];
    return events
      .filter((e: Record<string, unknown>) => e.segs)
      .map((e: Record<string, unknown>) => {
        const segs = e.segs as Array<{ utf8?: string }>;
        return segs.map(s => s.utf8 || '').join('');
      })
      .map((s: string) => s.replace(/\n/g, ' ').trim())
      .filter((s: string) => s.length > 0)
      .join(' ');
  } catch {
    return '';
  }
}

/**
 * Run yt-dlp as a subprocess. Tries `python -m yt_dlp` first, then `yt-dlp` directly.
 */
function runYtDlp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // Try python -m yt_dlp first (works when installed via pip)
    execFile('python', ['-m', 'yt_dlp', ...args], { timeout: 30000 }, (err, stdout, _stderr) => {
      if (!err) {
        resolve(stdout);
        return;
      }
      // Fallback: try yt-dlp directly
      execFile('yt-dlp', args, { timeout: 30000 }, (err2, stdout2) => {
        if (!err2) {
          resolve(stdout2);
          return;
        }
        reject(new Error(`yt-dlp not available: ${err2.message}`));
      });
    });
  });
}

/**
 * Fallback: Direct HTTP fetch of caption tracks from YouTube page HTML.
 * This often fails due to YouTube's timedtext API requiring session tokens,
 * but works for some videos.
 */
async function fetchViaHttp(url: string, videoId: string): Promise<RawCapture> {
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!pageRes.ok) {
    throw new Error(`Failed to fetch YouTube page: ${pageRes.status}`);
  }

  const pageHtml = await pageRes.text();

  const titleMatch = pageHtml.match(/<title>([\s\S]*?)<\/title>/);
  const title = titleMatch
    ? titleMatch[1].replace(' - YouTube', '').trim()
    : `YouTube Video ${videoId}`;

  const tracksMatch = pageHtml.match(/"captionTracks":\s*(\[.*?\])(?=\s*[,}\]])/);

  if (!tracksMatch) {
    return {
      sourceType: 'youtube',
      url,
      title,
      content: `[No transcript available for video: ${title}]`,
      meta: { videoId, hasTranscript: false, fetchedAt: new Date().toISOString() },
    };
  }

  try {
    const tracks = JSON.parse(tracksMatch[1]);
    if (!tracks || tracks.length === 0) {
      return {
        sourceType: 'youtube',
        url,
        title,
        content: `[No transcript tracks found for video: ${title}]`,
        meta: { videoId, hasTranscript: false, fetchedAt: new Date().toISOString() },
      };
    }

    const track = tracks.find((t: Record<string, string>) => t.languageCode === 'en')
      ?? tracks.find((t: Record<string, string>) => t.languageCode === 'no')
      ?? tracks[0];

    const captionRes = await fetch(track.baseUrl);
    if (!captionRes.ok) {
      throw new Error(`Failed to fetch captions: ${captionRes.status}`);
    }

    const captionXml = await captionRes.text();
    const transcript = parseCaptionXml(captionXml);

    if (!transcript || transcript.length < 10) {
      throw new Error('Empty transcript received');
    }

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
        method: 'http',
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
 *
 * `hasTranscript` is determined by content analysis — if the content contains
 * only a "no transcript available" placeholder, we mark it `false` regardless
 * of what the caller passed. This prevents the UI from lying.
 */
export function createYouTubeCapture(
  url: string,
  title: string,
  transcript: string,
  meta?: Record<string, unknown>,
): RawCapture {
  const videoId = extractVideoId(url);

  // Content-based detection: does this actually contain transcript text?
  const noTranscriptPattern =
    /\[no transcript|no captions available|no subtitles available/i;
  const strippedContent = transcript
    .replace(/📝[^\n]*/g, '')          // strip emoji headers
    .replace(/💬[^\n]*/g, '')
    .replace(/\[No transcript[^\]]*\]/g, '')  // strip placeholder brackets
    .replace(/\[No captions[^\]]*\]/g, '')
    .trim();

  // True only when there's real transcript text (not just description/comments)
  const actuallyHasTranscript =
    !noTranscriptPattern.test(transcript) && strippedContent.length > 100;

  // Explicit meta.hasTranscript can only DEMOTE (true → false), never promote
  const metaHas = meta?.hasTranscript;
  const hasTranscript =
    metaHas === false ? false : actuallyHasTranscript;

  const mergedMeta = {
    videoId,
    capturedBy: 'extension',
    fetchedAt: new Date().toISOString(),
    ...meta,
    hasTranscript, // always wins — content-based truth
  };

  return {
    sourceType: 'youtube',
    url,
    title,
    content: transcript,
    meta: mergedMeta,
  };
}
