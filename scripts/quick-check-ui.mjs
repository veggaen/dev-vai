/* Quick UI validation — checks Dev Logs loads and takes screenshots */
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1920,1080'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });

console.log('Navigating to localhost:5173...');
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 30000 });
await page.screenshot({ path: 'screenshots/devlogs-01-landing.png' });
console.log('1/4 Landing page captured');

// Click the Dev Logs button
const devLogsBtn = await page.$('button[title*="Dev Logs"]');
if (devLogsBtn) {
  await devLogsBtn.click();
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'screenshots/devlogs-02-session-list.png' });
  console.log('2/4 Session list captured');
} else {
  console.log('2/4 SKIP — no Dev Logs button found');
}

// Try to click the first session item
const firstSession = await page.$('div[class*="cursor-pointer"]');
if (firstSession) {
  await firstSession.click();
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'screenshots/devlogs-03-session-viewer.png' });
  console.log('3/4 Session viewer captured');
} else {
  console.log('3/4 SKIP — no session item found');
}

// Check for Knowledge panel
const knowledgeTab = await page.$('button:has-text("Knowledge")');
if (knowledgeTab) {
  await knowledgeTab.click();
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'screenshots/devlogs-04-knowledge.png' });
  console.log('4/4 Knowledge panel captured');
} else {
  console.log('4/4 SKIP — no Knowledge tab found');
}

await browser.close();
console.log('Done — screenshots in screenshots/');
