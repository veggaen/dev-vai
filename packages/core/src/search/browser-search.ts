/**
 * Browser-driven web search — drives the user's installed browser (Chrome /
 * Edge / Opera) headlessly via puppeteer-core to run real Google searches.
 *
 * Why: every keyless HTTP provider is either bot-blocked (DDG-lite 403s
 * Node's TLS fingerprint, Bing serves ad-heavy junk to cookie-less clients)
 * or only covers famous entities (Wikipedia, DDG Instant Answers). A real
 * browser gets the same organic results the user sees, which is what makes
 * "who is <ordinary person>" / local-business / fresh-info queries answerable.
 *
 * Design constraints:
 * - Uses the installed browser BINARY but a dedicated profile directory, so
 *   it never touches (or locks) the user's real browsing profile.
 * - One browser instance, lazily launched, reused, auto-closed after idle.
 * - Searches are serialized with a polite minimum interval + jitter.
 * - Google CAPTCHA / "unusual traffic" triggers a cooldown; the caller falls
 *   back to the HTTP provider chain during cooldown instead of hammering.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export interface BrowserSearchResult {
  title: string;
  snippet: string;
  url: string;
}

type PuppeteerBrowser = import('puppeteer-core').Browser;
type PuppeteerPage = import('puppeteer-core').Page;

const WINDOWS_BROWSER_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

const POSIX_BROWSER_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

/** Resolve the browser executable: env override → installed candidates. */
export function findBrowserExecutable(): string | null {
  const fromEnv = process.env.VAI_BROWSER_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const home = process.env.LOCALAPPDATA;
  const candidates = process.platform === 'win32'
    ? [
      ...WINDOWS_BROWSER_CANDIDATES,
      ...(home ? [
        join(home, 'Google\\Chrome\\Application\\chrome.exe'),
        join(home, 'Programs\\Opera\\opera.exe'),
        join(home, 'Programs\\Opera GX\\opera.exe'),
      ] : []),
    ]
    : POSIX_BROWSER_CANDIDATES;

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Browser search is on when a binary exists and VAI_BROWSER_SEARCH !== '0'. */
export function isBrowserSearchEnabled(): boolean {
  if (process.env.VAI_BROWSER_SEARCH === '0') return false;
  // Never drive a real browser inside the unit-test runner — those suites
  // mock globalThis.fetch and expect deterministic, sub-second runs.
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return false;
  return findBrowserExecutable() !== null;
}

// ── Singleton browser lifecycle ────────────────────────────────────────────

let browserPromise: Promise<PuppeteerBrowser> | null = null;
let idleCloseTimer: NodeJS.Timeout | null = null;

const IDLE_CLOSE_MS = 3 * 60_000;
const LAUNCH_TIMEOUT_MS = 20_000;

async function getBrowser(): Promise<PuppeteerBrowser> {
  if (!browserPromise) {
    browserPromise = launchBrowser();
    browserPromise.catch(() => { browserPromise = null; });
  }
  scheduleIdleClose();
  return browserPromise;
}

async function launchBrowser(): Promise<PuppeteerBrowser> {
  const executablePath = findBrowserExecutable();
  if (!executablePath) throw new Error('no browser executable found');
  const { default: puppeteer } = await import('puppeteer-core');

  // Google's /sorry CAPTCHA wall fires immediately for headless Chrome but
  // not for a real (headful) window with automation flags suppressed. We run
  // headful and park the window far off-screen so it never appears to the
  // user. VAI_BROWSER_HEADLESS=1 forces headless for debugging.
  const headless = process.env.VAI_BROWSER_HEADLESS === '1';
  const launchWith = (userDataDir: string) => puppeteer.launch({
    executablePath,
    headless,
    userDataDir,
    timeout: LAUNCH_TIMEOUT_MS,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-extensions',
      '--mute-audio',
      '--window-size=1280,900',
      ...(headless ? [] : ['--window-position=-2400,-2400']),
      '--disable-blink-features=AutomationControlled',
      '--lang=en-US',
    ],
  });

  const stableProfile = join(tmpdir(), 'vai-browser-search-profile');
  let browser: PuppeteerBrowser;
  try {
    browser = await launchWith(stableProfile);
  } catch (error) {
    // A crashed/stale instance can hold the profile lock — fall back to a
    // per-process profile instead of failing every search until reboot.
    if (/already running/i.test((error as Error).message)) {
      browser = await launchWith(join(tmpdir(), `vai-browser-search-profile-${process.pid}`));
    } else {
      throw error;
    }
  }
  browser.on('disconnected', () => {
    browserPromise = null;
  });
  return browser;
}

function scheduleIdleClose(): void {
  if (idleCloseTimer) clearTimeout(idleCloseTimer);
  idleCloseTimer = setTimeout(() => {
    void closeBrowserSearch();
  }, IDLE_CLOSE_MS);
  idleCloseTimer.unref?.();
}

/** Close the shared browser (idle timeout / process shutdown). */
export async function closeBrowserSearch(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;
  if (idleCloseTimer) {
    clearTimeout(idleCloseTimer);
    idleCloseTimer = null;
  }
  if (pending) {
    try {
      const browser = await pending;
      await browser.close();
    } catch { /* already gone */ }
  }
}

process.once('exit', () => { void closeBrowserSearch(); });

// ── Rate limiting + cooldown ───────────────────────────────────────────────

const MIN_SEARCH_INTERVAL_MS = 2_500;
const CAPTCHA_COOLDOWN_MS = 10 * 60_000;

let googleCooldownUntil = 0;
let lastSearchAt = 0;
let searchChain: Promise<unknown> = Promise.resolve();

/** True while Google has us in a CAPTCHA / rate-limit cooldown window. */
export function isGoogleCoolingDown(): boolean {
  return Date.now() < googleCooldownUntil;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serialize searches and keep a polite minimum interval between them. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = searchChain.then(async () => {
    const sinceLast = Date.now() - lastSearchAt;
    const waitMs = MIN_SEARCH_INTERVAL_MS - sinceLast;
    if (waitMs > 0) await sleep(waitMs + Math.floor(Math.random() * 500));
    lastSearchAt = Date.now();
    return task();
  });
  searchChain = run.catch(() => undefined);
  return run;
}

// ── Google search ──────────────────────────────────────────────────────────

interface ExtractedResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Strip Google chrome from a result block's text: the leading title and the
 * "<SiteName> https://… › … · Translate this page" breadcrumb that precedes
 * the actual description, plus trailing "Read more" affordances.
 */
function cleanGoogleSnippet(title: string, containerText: string): string {
  let text = containerText;
  if (text.startsWith(title)) text = text.slice(title.length);

  // The breadcrumb usually ends with "· Translate this page" — everything
  // after it is the real description. Take that when present.
  const translateIdx = text.indexOf('· Translate this page');
  if (translateIdx !== -1 && translateIdx < 200) {
    text = text.slice(translateIdx + '· Translate this page'.length);
  } else {
    // English results have no "Translate this page": strip a leading
    // "[SiteName] (www.)domain.tld › path › path" display-URL breadcrumb.
    text = text.replace(/^\s*(?:[^›·\n]{0,40}?\s)?(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z]{2,})+(?:\s*›[^·\n]*)+/i, '');
  }

  return text
    .replace(/^[\s›·|—-]+/, '')
    .replace(/\s*Read more\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function looksLikeCaptcha(pageUrl: string, bodyText: string): boolean {
  return /\/sorry\//.test(pageUrl)
    || /unusual traffic|not a robot|recaptcha/i.test(bodyText.slice(0, 3000));
}

async function dismissGoogleConsent(page: PuppeteerPage): Promise<void> {
  if (!/consent\.google\./.test(page.url())) return;
  try {
    // "Accept all" button — stable id on the consent interstitial.
    const accept = await page.$('#L2AGLb, button[aria-label*="Accept"], form[action*="consent"] button');
    if (accept) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8_000 }).catch(() => undefined),
        accept.click(),
      ]);
    }
  } catch { /* continue — results extraction will just find nothing */ }
}

async function runGoogleSearch(query: string, timeoutMs: number): Promise<BrowserSearchResult[]> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    );
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&hl=en&pws=0`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await dismissGoogleConsent(page);

    const bodyText = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
    if (looksLikeCaptcha(page.url(), bodyText)) {
      googleCooldownUntil = Date.now() + CAPTCHA_COOLDOWN_MS;
      return [];
    }

    // Organic results: anchors containing an <h3>. Snippets live in sibling
    // text containers; falling back to the result block's text keeps this
    // resilient to Google's frequently-renamed CSS classes.
    const extracted = await page.evaluate(() => {
      const out: Array<{ title: string; url: string; snippet: string }> = [];
      const seen = new Set<string>();
      const headings = Array.from(document.querySelectorAll<HTMLHeadingElement>('#search a h3, #rso a h3'));
      for (const h3 of headings) {
        const anchor = h3.closest('a') as HTMLAnchorElement | null;
        if (!anchor) continue;
        const href = anchor.href;
        if (!href || seen.has(href)) continue;
        if (/google\.[a-z.]+\//i.test(href) && !/url\?/.test(href)) continue;

        // Walk up to the result block: the smallest ancestor that still holds
        // exactly one result heading but enough text to include the snippet.
        let container: HTMLElement | null = anchor;
        for (let depth = 0; depth < 8 && container; depth += 1) {
          const parent: HTMLElement | null = container.parentElement;
          if (!parent) break;
          container = parent;
          if (parent.querySelectorAll('a h3').length === 1 && (parent.innerText || '').length > 120) break;
        }

        const title = (h3.textContent ?? '').trim();
        const containerText = (container?.innerText ?? '').replace(/\s+/g, ' ').trim();
        if (!title) continue;
        seen.add(href);
        out.push({ title, url: href, snippet: containerText });
        if (out.length >= 10) break;
      }
      return out;
    }) as ExtractedResult[];

    return extracted
      .map(({ title, url: resultUrl, snippet }) => ({ title, url: resultUrl, snippet: cleanGoogleSnippet(title, snippet) }))
      .filter((r) => r.snippet.length >= 20 && !/^https?:\/\/(?:[a-z0-9-]+\.)*google\./i.test(r.url));
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Search Google through the installed browser. Returns [] on cooldown, when
 * no browser is available, or when extraction fails — the HTTP provider
 * chain continues as fallback in all those cases.
 */
export async function fetchGoogleViaBrowser(query: string, timeoutMs: number): Promise<BrowserSearchResult[]> {
  if (!isBrowserSearchEnabled() || isGoogleCoolingDown()) return [];
  try {
    return await enqueue(() => runGoogleSearch(query, Math.max(timeoutMs, 12_000)));
  } catch (error) {
    if (process.env.VAI_SEARCH_DEBUG) {
      console.error(`[browser-search] google failed for "${query}": ${(error as Error).message}`);
    }
    return [];
  }
}
