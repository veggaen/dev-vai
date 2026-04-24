/**
 * Fresh live screenshot + interactive overlay validation.
 * Takes screenshots in sequence: default → trigger radial → expand sub-tools → start tour.
 */
import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';

const DIR = 'scripts/screenshots/live';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const browser = await puppeteer.launch({
    headless: false, slowMo: 50,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();

  console.log('Loading app...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 15000 });
  await sleep(2000);

  // 1. Initial state
  await page.screenshot({ path: `${DIR}/01-initial.png` });
  console.log('01 - Initial state captured');

  // Collect DOM info about overlays
  const domInfo = await page.evaluate(() => {
    const all = document.querySelectorAll('*');
    const overlayEls = [];
    for (const el of all) {
      const z = parseInt(getComputedStyle(el).zIndex);
      if (z >= 1000) {
        overlayEls.push({
          tag: el.tagName,
          class: el.className?.toString().slice(0, 60),
          zIndex: z,
          visible: el.offsetWidth > 0 && el.offsetHeight > 0,
          rect: el.getBoundingClientRect(),
        });
      }
    }
    // Check for demo buttons
    const btns = [...document.querySelectorAll('button')].filter(b =>
      b.textContent.includes('Tour') || b.textContent.includes('Demo')
    );
    return {
      overlayCount: overlayEls.length,
      overlays: overlayEls.slice(0, 10),
      demoButtons: btns.map(b => ({
        text: b.textContent.trim(),
        rect: b.getBoundingClientRect(),
        visible: b.offsetWidth > 0,
      })),
    };
  });

  console.log('\nDOM Overlay Analysis:');
  console.log(`  Total high-z elements: ${domInfo.overlayCount}`);
  for (const o of domInfo.overlays) {
    console.log(`  ${o.tag}.${o.class?.slice(0, 40)} z=${o.zIndex} visible=${o.visible} ${Math.round(o.rect.x)},${Math.round(o.rect.y)} ${Math.round(o.rect.width)}x${Math.round(o.rect.height)}`);
  }
  console.log(`\n  Demo buttons found: ${domInfo.demoButtons.length}`);
  for (const b of domInfo.demoButtons) {
    console.log(`    "${b.text}" at (${Math.round(b.rect.x)},${Math.round(b.rect.y)}) ${Math.round(b.rect.width)}x${Math.round(b.rect.height)} visible=${b.visible}`);
  }

  // 2. Move cursor to center via global API
  await page.evaluate(() => {
    if (window.__vai_cursor) {
      window.__vai_cursor.moveTo(720, 450);
    }
  });
  await sleep(800);
  await page.screenshot({ path: `${DIR}/02-cursor-visible.png` });
  console.log('\n02 - Cursor visible at center');

  // 3. Open radial menu
  await page.evaluate(() => {
    if (window.__vai_cursor) {
      window.__vai_cursor.openRadialMenu(720, 450);
    }
  });
  await sleep(1000);
  await page.screenshot({ path: `${DIR}/03-radial-open.png` });
  console.log('03 - Radial menu opened');

  // Check radial items rendered
  const radialInfo = await page.evaluate(() => {
    const items = document.querySelectorAll('[class*="radial"]');
    const allText = [];
    items.forEach(el => {
      if (el.textContent.trim()) allText.push(el.textContent.trim().slice(0, 30));
    });
    return { count: items.length, texts: allText.slice(0, 12) };
  });
  console.log(`  Radial elements: ${radialInfo.count}, texts: ${JSON.stringify(radialInfo.texts)}`);

  // 4. Select a radial item, then close and type
  await page.evaluate(() => {
    if (window.__vai_cursor) {
      window.__vai_cursor.selectRadialItem('tools');
    }
  });
  await sleep(500);
  await page.screenshot({ path: `${DIR}/04-radial-tools.png` });
  console.log('04 - Radial Tools selected');

  await page.evaluate(() => {
    if (window.__vai_cursor) {
      window.__vai_cursor.closeRadialMenu();
      window.__vai_cursor.type(400, 300, 'Hello VeggaAI');
    }
  });
  await sleep(800);
  await page.screenshot({ path: `${DIR}/04b-keyboard.png` });
  console.log('04b - Virtual keyboard shown (typing)');

  // 5. Start the full tour
  await page.evaluate(() => {
    if (window.__vai_demo && window.__vai_demo.tour) {
      window.__vai_demo.tour();
    }
  });
  await sleep(3000);
  await page.screenshot({ path: `${DIR}/05-tour-3s.png` });
  console.log('05 - Tour at 3s');

  await sleep(5000);
  await page.screenshot({ path: `${DIR}/06-tour-8s.png` });
  console.log('06 - Tour at 8s');

  await sleep(7000);
  await page.screenshot({ path: `${DIR}/07-tour-15s.png` });
  console.log('07 - Tour at 15s');

  await sleep(10000);
  await page.screenshot({ path: `${DIR}/08-tour-25s.png` });
  console.log('08 - Tour at 25s');

  await sleep(10000);
  await page.screenshot({ path: `${DIR}/09-tour-35s.png` });
  console.log('09 - Tour at 35s');

  await sleep(10000);
  await page.screenshot({ path: `${DIR}/10-tour-45s.png` });
  console.log('10 - Tour at 45s (should be done)');

  // Final DOM state
  const finalState = await page.evaluate(() => {
    const logEntries = document.querySelectorAll('[class*="log"]');
    const visibleTexts = [];
    logEntries.forEach(el => {
      const t = el.textContent?.trim();
      if (t && t.length < 80) visibleTexts.push(t);
    });
    return {
      cursorVisible: !!document.querySelector('[class*="cursor"]'),
      logEntries: visibleTexts.slice(0, 10),
    };
  });
  console.log('\nFinal state:');
  console.log(`  Cursor visible: ${finalState.cursorVisible}`);
  console.log(`  Log entries: ${JSON.stringify(finalState.logEntries.slice(0, 5))}`);

  await browser.close();
  console.log('\nAll live screenshots saved to scripts/screenshots/live/');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});

