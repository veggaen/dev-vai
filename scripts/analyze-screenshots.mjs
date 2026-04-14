/**
 * Pixel analysis of screenshots — verifies overlay elements render correctly.
 */
import puppeteer from 'puppeteer';

async function main() {
  const browser = await puppeteer.launch({
    headless: false, slowMo: 50,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();

  const files = [
    '01-initial-state.png',
    '03-radial-menu-open.png',
    '04-radial-tools-selected.png',
    '05-cursor-activity-rail.png',
    '06-virtual-keyboard.png',
    '07-click-ripple.png',
    '09-tour-progress-3.png',
    '10-final-state.png',
  ];

  for (const f of files) {
    const url = `file:///C:/Users/v3gga/Documents/dev-vai/scripts/screenshots/${f}`;
    await page.goto(url, { waitUntil: 'load' });

    const info = await page.evaluate(() => {
      const img = document.querySelector('img');
      if (!img) return { error: 'no img' };

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const samplePixel = (x, y) => {
        const d = ctx.getImageData(x, y, 1, 1).data;
        return { r: d[0], g: d[1], b: d[2] };
      };

      const checkRegion = (x1, y1, x2, y2, label) => {
        let purpleCount = 0;
        let nonBlackCount = 0;
        let blueCount = 0;
        const step = 5;
        let total = 0;
        for (let x = x1; x < x2; x += step) {
          for (let y = y1; y < y2; y += step) {
            const d = ctx.getImageData(x, y, 1, 1).data;
            total++;
            const sum = d[0] + d[1] + d[2];
            if (sum > 50) nonBlackCount++;
            if (d[2] > 150 && d[0] > 80 && d[1] < 150) purpleCount++;
            if (d[2] > 150 && d[0] < 80 && d[1] < 120) blueCount++;
          }
        }
        return { label, purpleCount, blueCount, nonBlackCount, total };
      };

      return {
        width: img.naturalWidth,
        height: img.naturalHeight,
        center: samplePixel(720, 450),
        topLeft: samplePixel(24, 100),
        bottomRight: samplePixel(1400, 860),
        cursorArea: samplePixel(720, 450),
        regions: [
          checkRegion(0, 0, 48, 900, 'activity-rail'),
          checkRegion(680, 400, 760, 500, 'center-area'),
          checkRegion(1300, 800, 1440, 900, 'demo-buttons'),
          checkRegion(0, 0, 1440, 900, 'full-screen'),
        ],
      };
    });

    console.log(`\n${f}:`);
    console.log(`  Size: ${info.width}x${info.height}`);
    console.log(`  Center pixel: rgb(${info.center.r},${info.center.g},${info.center.b})`);
    console.log(`  Top-left:     rgb(${info.topLeft.r},${info.topLeft.g},${info.topLeft.b})`);
    console.log(`  Bottom-right: rgb(${info.bottomRight.r},${info.bottomRight.g},${info.bottomRight.b})`);
    for (const r of (info.regions || [])) {
      const purplePct = ((r.purpleCount / r.total) * 100).toFixed(1);
      const nonBlackPct = ((r.nonBlackCount / r.total) * 100).toFixed(1);
      console.log(`  ${r.label}: purple=${purplePct}% nonBlack=${nonBlackPct}% (${r.nonBlackCount}/${r.total})`);
    }
  }

  await browser.close();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
