/**
 * Pixel analysis of live screenshots — checks for visual differences between states.
 */
import puppeteer from 'puppeteer';
import { readdirSync, statSync } from 'fs';

const DIR = 'scripts/screenshots/live';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const files = readdirSync(DIR).filter(f => f.endsWith('.png')).sort();
  console.log(`Analyzing ${files.length} live screenshots...\n`);

  // First, print file sizes
  for (const f of files) {
    const size = statSync(`${DIR}/${f}`).size;
    console.log(`  ${f}: ${(size / 1024).toFixed(1)} KB`);
  }

  const browser = await puppeteer.launch({
    headless: false, slowMo: 50,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();

  for (const f of files) {
    const url = `file:///C:/Users/v3gga/Documents/dev-vai/${DIR}/${f}`;
    await page.goto(url, { waitUntil: 'load' });
    await sleep(200);

    const info = await page.evaluate(() => {
      const img = document.querySelector('img');
      if (!img) return { error: 'no img' };

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const countColors = (x1, y1, x2, y2) => {
        let purple = 0, white = 0, bright = 0, total = 0;
        const step = 3;
        for (let x = x1; x < x2; x += step) {
          for (let y = y1; y < y2; y += step) {
            const d = ctx.getImageData(x, y, 1, 1).data;
            total++;
            const sum = d[0] + d[1] + d[2];
            if (sum > 600) white++;
            if (sum > 100) bright++;
            const isPurple = d[2] > 150 && d[0] > 60 && d[1] < 160 && d[2] > d[1];
            if (isPurple) purple++;
          }
        }
        return { purple, white, bright, total };
      };

      return {
        width: img.naturalWidth,
        height: img.naturalHeight,
        fullScreen: countColors(0, 0, img.naturalWidth, img.naturalHeight),
        center: countColors(600, 350, 840, 550),        // center 240x200
        bottomRight: countColors(1200, 800, 1440, 900),  // demo buttons
        leftRail: countColors(0, 0, 60, 900),            // activity rail
        bottom: countColors(0, 700, 1440, 900),          // keyboard area
        topBar: countColors(60, 0, 1440, 60),            // top bar
      };
    });

    if (info.error) {
      console.log(`\n${f}: ERROR ${info.error}`);
      continue;
    }

    const pct = (region) => ({
      purple: ((region.purple / region.total) * 100).toFixed(1),
      white: ((region.white / region.total) * 100).toFixed(1),
      bright: ((region.bright / region.total) * 100).toFixed(1),
    });

    const full = pct(info.fullScreen);
    const center = pct(info.center);
    const br = pct(info.bottomRight);
    const rail = pct(info.leftRail);
    const bottom = pct(info.bottom);

    console.log(`\n${f} (${info.width}x${info.height}):`);
    console.log(`  Full:    purple=${full.purple}%  white=${full.white}%  bright=${full.bright}%`);
    console.log(`  Center:  purple=${center.purple}%  white=${center.white}%  bright=${center.bright}%`);
    console.log(`  BotRight: purple=${br.purple}%  white=${br.white}%  bright=${br.bright}%`);
    console.log(`  Rail:    purple=${rail.purple}%  white=${rail.white}%  bright=${rail.bright}%`);
    console.log(`  Bottom:  purple=${bottom.purple}%  white=${bottom.white}%  bright=${bottom.bright}%`);
  }

  await browser.close();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
