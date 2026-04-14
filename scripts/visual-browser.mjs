import puppeteer from 'puppeteer';

const DEFAULT_ARGS = ['--no-sandbox', '--start-maximized', '--force-device-scale-factor=1'];

export async function launchVisualBrowser(options = {}) {
  const {
    headless = false,
    slowMo = 50,
    args = [],
    defaultViewport = null,
    preferredChannel = 'chrome',
  } = options;

  const launchOptions = {
    headless,
    slowMo,
    defaultViewport,
    args: [...DEFAULT_ARGS, ...args],
  };

  let browser;
  try {
    browser = await puppeteer.launch({
      ...launchOptions,
      channel: preferredChannel,
    });
  } catch {
    browser = await puppeteer.launch(launchOptions);
  }

  const [page] = await browser.pages();
  return { browser, page };
}

export async function getWindowSession(page) {
  const session = await page.target().createCDPSession();
  const { windowId } = await session.send('Browser.getWindowForTarget');
  return { session, windowId };
}

export async function getViewportMetrics(page) {
  return page.evaluate(() => ({
    width: window.innerWidth || document.documentElement.clientWidth || 1440,
    height: window.innerHeight || document.documentElement.clientHeight || 900,
    screenWidth: window.screen.availWidth || window.screen.width || 1440,
    screenHeight: window.screen.availHeight || window.screen.height || 900,
  }));
}

export async function maximizeBrowserWindow(page, delayMs = 700) {
  const { session, windowId } = await getWindowSession(page);
  await session.send('Browser.setWindowBounds', {
    windowId,
    bounds: { windowState: 'maximized' },
  });
  await wait(delayMs);
  return getViewportMetrics(page);
}

export async function resizeBrowserWindow(page, width, height, delayMs = 700) {
  const { session, windowId } = await getWindowSession(page);
  await session.send('Browser.setWindowBounds', {
    windowId,
    bounds: {
      windowState: 'normal',
      width,
      height,
    },
  });
  await wait(delayMs);
  return getViewportMetrics(page);
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}