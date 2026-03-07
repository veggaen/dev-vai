/**
 * Quick debug script — check what the Docker panel renders.
 */
import puppeteer from 'puppeteer';
import { writeFile, mkdir } from 'fs/promises';

const DIR = './screenshots/docker-panel';
await mkdir(DIR, { recursive: true });

const browser = await puppeteer.launch({
  headless: false, slowMo: 50,
  defaultViewport: { width: 2560, height: 1440 },
});

const page = await browser.newPage();
await page.goto('http://localhost:5173', { waitUntil: 'networkidle2', timeout: 30_000 });
await new Promise((r) => setTimeout(r, 2000));

// Click Docker button using title attribute
const btns = await page.$$('button');
let clicked = false;
for (const btn of btns) {
  const title = await btn.evaluate((el) => el.getAttribute('title'));
  if (title && title.startsWith('Docker Sandboxes')) {
    await btn.click();
    clicked = true;
    console.log('Clicked:', title);
    break;
  }
}
if (!clicked) {
  console.log('❌ No Docker button found');
  // List all button titles
  for (const btn of btns) {
    const title = await btn.evaluate((el) => el.getAttribute('title') || el.textContent?.trim()?.slice(0, 40));
    if (title) console.log('  button:', title);
  }
}

await new Promise((r) => setTimeout(r, 2000));
await page.screenshot({ path: `${DIR}/debug-docker.png`, fullPage: true });

// Dump text from the area to the right of the rail
const info = await page.evaluate(() => {
  // The sidebar panel area — find all visible text nodes
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const texts = [];
  let node;
  while ((node = walker.nextNode())) {
    const txt = node.textContent?.trim();
    if (txt && txt.length > 1 && txt.length < 200) texts.push(txt);
  }
  return texts;
});

console.log('\nVisible text on page:');
info.forEach((t) => console.log(` "${t}"`));

await browser.close();
