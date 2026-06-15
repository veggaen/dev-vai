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

/** A Google search run: the organic results plus, when present, the AI Overview box. */
export interface GoogleSearchPage {
  readonly results: readonly BrowserSearchResult[];
  /** Google's AI Overview (generative summary) text, or null when absent / extraction failed. */
  readonly aiOverview: string | null;
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

/**
 * Clean an extracted AI Overview blob: drop Google's "AI Overview", "Show more",
 * "Learn more", and feedback chrome, collapse whitespace, cap length. Returns null
 * when what's left is too short to be a real summary (Google omits the box for many
 * queries, and its DOM changes often — null = "not present", never an error).
 */
function cleanAiOverview(raw: string): string | null {
  const text = raw
    .replace(/^\s*AI Overview\s*/i, '')
    .replace(/\b(Show more|Show less|Learn more)\b/gi, ' ')
    .replace(/AI responses may include mistakes[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1500);
  return text.length >= 60 ? text : null;
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

async function runGoogleSearch(query: string, timeoutMs: number): Promise<GoogleSearchPage> {
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
      return { results: [], aiOverview: null };
    }

    // AI Overview box (generative summary). Google renders it lazily and renames
    // its containers constantly, so we try a few stable-ish anchors and fall back
    // to scanning for the labelled block. Best-effort: any miss yields null, never
    // an error — the organic results below are the reliable signal.
    const aiOverviewRaw = await page.evaluate(() => {
      const selectors = [
        '[data-attrid="AIOverview"]',
        '[aria-label*="AI Overview" i]',
        'div[data-subtree="aifb"]',
        '#m-x-content',
      ];
      for (const sel of selectors) {
        const el = document.querySelector<HTMLElement>(sel);
        const t = (el?.innerText ?? '').trim();
        if (t.length > 80) return t;
      }
      // Fallback: find a heading that says "AI Overview" and take its container text.
      const headings = Array.from(document.querySelectorAll<HTMLElement>('h1,h2,div,span'));
      const label = headings.find((h) => /^AI Overview$/i.test((h.textContent ?? '').trim()));
      const container = label?.closest('div[jscontroller], div[data-hveid]') as HTMLElement | null;
      const text = (container?.innerText ?? '').trim();
      return text.length > 80 ? text : '';
    }).catch(() => '');
    const aiOverview = cleanAiOverview(aiOverviewRaw);

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

    const results = extracted
      .map(({ title, url: resultUrl, snippet }) => ({ title, url: resultUrl, snippet: cleanGoogleSnippet(title, snippet) }))
      .filter((r) => r.snippet.length >= 20 && !/^https?:\/\/(?:[a-z0-9-]+\.)*google\./i.test(r.url));
    return { results, aiOverview };
  } finally {
    await page.close().catch(() => undefined);
  }
}

// ── Generic page rendering (for JS-heavy SPAs like ChatGPT share links) ──────

/**
 * Load an arbitrary URL in the real browser, let its JavaScript render, and return
 * the fully-rendered HTML — what a human would actually see. This is the escalation
 * for client-rendered SPAs (ChatGPT share pages, JS-only docs) where a plain HTTP
 * fetch only gets an empty app shell. {@link readUrl} calls this when static
 * extraction finds nothing.
 *
 * Reuses the same singleton browser, profile and polite serialization as search, but
 * is independent of Google's CAPTCHA cooldown (that only governs google.com). Returns
 * null on no-browser / timeout / failure so the caller degrades gracefully. The caller
 * is responsible for SSRF/private-network checks BEFORE calling this — a real browser
 * will happily load internal addresses.
 */
export async function fetchRenderedHtml(url: string, timeoutMs: number): Promise<string | null> {
  if (!isBrowserSearchEnabled()) return null;
  try {
    return await enqueue(() => renderPage(url, Math.max(timeoutMs, 12_000)));
  } catch (error) {
    if (process.env.VAI_SEARCH_DEBUG) {
      console.error(`[browser-search] render failed for "${url}": ${(error as Error).message}`);
    }
    return null;
  }
}

async function renderPage(url: string, timeoutMs: number): Promise<string | null> {
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
    // domcontentloaded gets us a parseable DOM fast; then give the SPA a beat to
    // hydrate its content before we snapshot. networkidle would be ideal but many
    // chat/doc apps hold long-poll connections open and never go idle.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.evaluate(() => new Promise<void>((r) => setTimeout(r, 1200))).catch(() => undefined);
    const html = await page.content().catch(() => '');
    return html && html.length > 0 ? html : null;
  } finally {
    await page.close().catch(() => undefined);
  }
}

// ── Verifiable page OBSERVATION (browser-interaction evidence) ───────────────

/** What a single selector observation captured. */
export interface SelectorObservation {
  readonly selector: string;
  readonly exists: boolean;
  /** innerText of the first match, trimmed (empty when absent). */
  readonly text: string;
}

/** A real, structured observation of a page — the bindable browser evidence. */
export interface PageObservation {
  readonly ok: boolean;
  readonly url: string;
  /** URL after any redirects (what the browser actually landed on). */
  readonly finalUrl: string;
  /** HTTP status of the main response (null when unknown). */
  readonly status: number | null;
  readonly title: string;
  /** Per-requested-selector existence + text. */
  readonly selectors: readonly SelectorObservation[];
  readonly observedAt: string;
  readonly durationMs: number;
  readonly error?: string;
}

/**
 * Navigate to `url` in the real browser and capture a STRUCTURED, verifiable observation:
 * the final URL, HTTP status, page title, and — for each requested CSS selector — whether
 * it exists and its text. This is the deterministic core of browser interaction: the facts
 * come from real DOM observation, so a downstream capability binds claims to them instead
 * of letting a model invent page content. The caller MUST have SSRF-validated `url` first.
 *
 * Returns `{ ok: false }` (never throws) when no browser is available or navigation fails.
 */
export async function observePage(
  url: string,
  selectors: readonly string[] = [],
  timeoutMs = 15_000,
): Promise<PageObservation> {
  const started = Date.now();
  const base = (error?: string): PageObservation => ({
    ok: false, url, finalUrl: url, status: null, title: '', selectors: [],
    observedAt: new Date().toISOString(), durationMs: Date.now() - started, error,
  });
  if (!isBrowserSearchEnabled()) return base('no browser available');
  try {
    return await enqueue(() => runObservation(url, selectors, Math.max(timeoutMs, 8_000), started));
  } catch (error) {
    return base(error instanceof Error ? error.message : String(error));
  }
}

async function runObservation(
  url: string,
  selectors: readonly string[],
  timeoutMs: number,
  started: number,
): Promise<PageObservation> {
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
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.evaluate(() => new Promise<void>((r) => setTimeout(r, 800))).catch(() => undefined);

    const title = await page.title().catch(() => '');
    const finalUrl = page.url();
    const status = response ? response.status() : null;

    const observations: SelectorObservation[] = [];
    for (const selector of selectors) {
      try {
        const text = await page.$eval(selector, (el) => (el.textContent ?? '').trim());
        observations.push({ selector, exists: true, text });
      } catch {
        observations.push({ selector, exists: false, text: '' });
      }
    }

    return {
      ok: true, url, finalUrl, status, title, selectors: observations,
      observedAt: new Date().toISOString(), durationMs: Date.now() - started,
    };
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
  return [...(await fetchGooglePageViaBrowser(query, timeoutMs)).results];
}

/**
 * Like {@link fetchGoogleViaBrowser} but also returns Google's AI Overview box when present.
 * Returns `{ results: [], aiOverview: null }` on cooldown / no browser / failure — every
 * caller can rely on the shape and fall back to the HTTP provider chain.
 */
export async function fetchGooglePageViaBrowser(query: string, timeoutMs: number): Promise<GoogleSearchPage> {
  if (!isBrowserSearchEnabled() || isGoogleCoolingDown()) return { results: [], aiOverview: null };
  try {
    return await enqueue(() => runGoogleSearch(query, Math.max(timeoutMs, 12_000)));
  } catch (error) {
    if (process.env.VAI_SEARCH_DEBUG) {
      console.error(`[browser-search] google failed for "${query}": ${(error as Error).message}`);
    }
    return { results: [], aiOverview: null };
  }
}
