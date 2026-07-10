/** Final pixel proof: load an app URL, capture errors + rendered text + screenshot. */
import puppeteer from 'puppeteer';

const URL = process.argv[2] ?? 'http://localhost:4101';
const OUT = process.argv[3] ?? 'Temporary_files/mpm-final-proof.png';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
await new Promise((r) => setTimeout(r, 20_000));

const proof = await page.evaluate(() => ({
  title: document.title,
  textLen: (document.body?.innerText ?? '').length,
  head: (document.body?.innerText ?? '').slice(0, 250).replace(/\s+/g, ' '),
  elements: document.querySelectorAll('*').length,
}));
console.log('ERRORS:', errs.length ? errs.join(' | ') : 'none');
console.log(JSON.stringify(proof, null, 2));
await page.screenshot({ path: OUT });
console.log(`screenshot: ${OUT}`);
await browser.close();
