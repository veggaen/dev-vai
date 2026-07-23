import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { auditVisualLayout, type VisualLayoutAuditReport, type VisualLayoutNode } from '@vai/core';

export interface VisualAuditViewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

export interface VisualAuditViewportRun extends VisualLayoutAuditReport {
  readonly viewport: VisualAuditViewport;
  readonly browserErrors: readonly string[];
}

export interface VisualAuditSuiteReport {
  readonly url: string;
  readonly verdict: 'pass' | 'warn' | 'fail';
  readonly runs: readonly VisualAuditViewportRun[];
}

export interface RunVisualAuditOptions {
  readonly screenshotDir?: string;
  readonly viewports?: readonly VisualAuditViewport[];
}

const DEFAULT_VIEWPORTS: readonly VisualAuditViewport[] = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

let auditQueue: Promise<void> = Promise.resolve();

function assertLocalUrl(value: string): URL {
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error(`Visual layout audit only accepts local URLs, received ${url.hostname}`);
  }
  return url;
}

async function launchAuditBrowser(): Promise<Browser> {
  const attempts: Array<Parameters<typeof chromium.launch>[0]> = [
    { headless: true, channel: 'chrome' },
    { headless: true, channel: 'msedge' },
    { headless: true },
  ];
  let lastError: unknown;
  for (const options of attempts) {
    try {
      return await chromium.launch(options);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('No compatible Chromium browser is available.');
}

async function collectSnapshot(page: Page): Promise<VisualLayoutNode[]> {
  await page.evaluate('globalThis.__name = (target) => target');
  return page.evaluate(() => {
    const elements = [...document.querySelectorAll<HTMLElement>('body *')];
    const visible = elements.filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return rect.width > 0
        && rect.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number.parseFloat(style.opacity || '1') > 0.01;
    });
    const ids = new Map<Element, string>(visible.map((element, index) => [element, `n${index}`]));
    const numeric = (value: string): number => Number.parseFloat(value) || 0;
    const readableSelector = (element: HTMLElement): string => {
      if (element.id) return `#${element.id}`;
      const classes = [...element.classList].filter(Boolean).slice(0, 3);
      if (classes.length > 0) return `${element.tagName.toLowerCase()}.${classes.join('.')}`;
      const role = element.getAttribute('role');
      return role ? `${element.tagName.toLowerCase()}[role="${role}"]` : element.tagName.toLowerCase();
    };

    return visible.map((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute('role') ?? (tag === 'img' || tag === 'svg' ? 'img' : undefined);
      const accessibleName = element.getAttribute('aria-label')
        ?? element.getAttribute('alt')
        ?? (role === 'img' ? element.getAttribute('title') : null)
        ?? undefined;
      const classKey = [...element.classList].filter(Boolean).sort().slice(0, 4).join('.');
      return {
        id: ids.get(element)!,
        parentId: element.parentElement ? ids.get(element.parentElement) ?? null : null,
        selector: readableSelector(element),
        tag,
        role,
        accessibleName,
        repeatKey: classKey ? `${tag}.${classKey}` : `${tag}:${role ?? ''}`,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        visible: true,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        boxShadow: style.boxShadow,
        borderWidth: Math.max(
          numeric(style.borderTopWidth),
          numeric(style.borderRightWidth),
          numeric(style.borderBottomWidth),
          numeric(style.borderLeftWidth),
        ),
        borderRadii: {
          topLeft: numeric(style.borderTopLeftRadius),
          topRight: numeric(style.borderTopRightRadius),
          bottomRight: numeric(style.borderBottomRightRadius),
          bottomLeft: numeric(style.borderBottomLeftRadius),
        },
        position: style.position,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight,
      } satisfies VisualLayoutNode;
    });
  });
}

async function runNow(urlValue: string, options: RunVisualAuditOptions): Promise<VisualAuditSuiteReport> {
  const url = assertLocalUrl(urlValue);
  const screenshotDir = options.screenshotDir ? resolve(options.screenshotDir) : null;
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  const browser = await launchAuditBrowser();
  const runs: VisualAuditViewportRun[] = [];
  try {
    for (const viewport of options.viewports ?? DEFAULT_VIEWPORTS) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
      const browserErrors: string[] = [];
      page.on('pageerror', (error) => browserErrors.push(error.message));
      await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await page.waitForTimeout(700);
      const report = auditVisualLayout(await collectSnapshot(page));
      if (screenshotDir) {
        await page.screenshot({ path: resolve(screenshotDir, `${viewport.name}.png`), fullPage: true });
      }
      runs.push({ viewport, browserErrors, ...report });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  const failed = runs.some((run) => run.verdict === 'fail' || run.browserErrors.length > 0);
  return {
    url: url.toString(),
    verdict: failed ? 'fail' : runs.some((run) => run.verdict === 'warn') ? 'warn' : 'pass',
    runs,
  };
}

/** Serializes browser work so Vai never runs concurrent heavy visual audits. */
export function runLocalVisualLayoutAudit(
  url: string,
  options: RunVisualAuditOptions = {},
): Promise<VisualAuditSuiteReport> {
  const result = auditQueue.then(() => runNow(url, options));
  auditQueue = result.then(() => undefined, () => undefined);
  return result;
}
