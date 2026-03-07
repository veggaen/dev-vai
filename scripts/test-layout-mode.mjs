import puppeteer from 'puppeteer';

const b = await puppeteer.launch({
  headless: false, slowMo: 50,
  defaultViewport: { width: 2560, height: 1440 },
  args: ['--no-sandbox'],
});
const p = await b.newPage();
await p.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 15000 });
await new Promise(r => setTimeout(r, 3000));

// Check compact mode
const compact = await p.evaluate(() => {
  const lr = document.getElementById('layout-root');
  const btns = [...document.querySelectorAll('button')];
  const toggleBtn = btns.find(b => b.title?.includes('compact') || b.title?.includes('open'));
  return {
    hasLayoutRoot: !!lr,
    mode: lr?.dataset?.layoutMode,
    hasToggle: !!toggleBtn,
    toggleTitle: toggleBtn?.title?.substring(0, 60),
  };
});
console.log('Compact mode:', JSON.stringify(compact));
await p.screenshot({ path: 'scripts/screenshots/mode-compact.png' });

// Toggle to open mode
if (compact.hasToggle) {
  await p.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const btn = btns.find(b => b.title?.includes('compact') || b.title?.includes('open'));
    btn?.click();
  });
  await new Promise(r => setTimeout(r, 600));

  const open = await p.evaluate(() => {
    const lr = document.getElementById('layout-root');
    return { mode: lr?.dataset?.layoutMode };
  });
  console.log('Open mode:', JSON.stringify(open));
  await p.screenshot({ path: 'scripts/screenshots/mode-open.png' });

  // Toggle back to compact
  await p.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const btn = btns.find(b => b.title?.includes('compact') || b.title?.includes('open'));
    btn?.click();
  });
  await new Promise(r => setTimeout(r, 600));
  const back = await p.evaluate(() => {
    const lr = document.getElementById('layout-root');
    return { mode: lr?.dataset?.layoutMode };
  });
  console.log('Back to:', JSON.stringify(back));
}

// Test different viewport sizes (simulate monitors)
const viewports = [
  { name: 'main-desktop', w: 2560, h: 1440 },
  { name: 'ultrawide', w: 3440, h: 1440 },
  { name: 'portrait-tall', w: 1440, h: 3440 },
  { name: 'portrait-phone', w: 1440, h: 2560 },
];

for (const vp of viewports) {
  await p.setViewport({ width: vp.w, height: vp.h });
  await new Promise(r => setTimeout(r, 500));
  const sc = await p.evaluate(() => {
    const lr = document.getElementById('layout-root');
    return {
      mode: lr?.dataset?.layoutMode,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  });
  console.log(`${vp.name} (${vp.w}x${vp.h}):`, JSON.stringify(sc));
  await p.screenshot({ path: `scripts/screenshots/viewport-${vp.name}.png` });
}

await b.close();
console.log('Done');
