import { launchVisualBrowser, maximizeBrowserWindow, resizeBrowserWindow, wait } from './visual-browser.mjs';

const { browser: b, page: p } = await launchVisualBrowser();
const viewport = await maximizeBrowserWindow(p);
console.log(`Using real browser viewport ${viewport.width}x${viewport.height}`);
await p.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 15000 });
await wait(3000);

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
  await wait(600);

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
  await wait(600);
  const back = await p.evaluate(() => {
    const lr = document.getElementById('layout-root');
    return { mode: lr?.dataset?.layoutMode };
  });
  console.log('Back to:', JSON.stringify(back));
}

// Test different viewport sizes (simulate monitors)
const viewports = [
  { name: 'main-desktop', w: 1800, h: 1100 },
  { name: 'desktop-min', w: 1100, h: 820 },
  { name: 'tablet', w: 900, h: 760 },
  { name: 'phone-wide', w: 760, h: 760 },
];

for (const vp of viewports) {
  const metrics = await resizeBrowserWindow(p, vp.w, vp.h);
  const sc = await p.evaluate(() => {
    const lr = document.getElementById('layout-root');
    return {
      mode: lr?.dataset?.layoutMode,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  });
  console.log(`${vp.name} (${metrics.width}x${metrics.height}):`, JSON.stringify(sc));
  await p.screenshot({ path: `scripts/screenshots/viewport-${vp.name}.png` });
}

await maximizeBrowserWindow(p);

await b.close();
console.log('Done');
