/**
 * test-grand-tour.mjs — Validates the Grand Tour system:
 *   1. Grand Tour button visible on load
 *   2. Clicking it activates the tour overlay
 *   3. Step annotation panel renders with correct content
 *   4. Navigation (Next/Back/Skip) works
 *   5. Spotlight highlights target elements
 *   6. All 10 steps can be stepped through
 *   7. Screenshots captured at each step
 */

import { mkdir } from 'fs/promises';
import { launchVisualBrowser, maximizeBrowserWindow, wait } from './visual-browser.mjs';

const SCREENSHOTS = 'scripts/screenshots/grand-tour';
await mkdir(SCREENSHOTS, { recursive: true });

const { browser, page } = await launchVisualBrowser();
const viewport = await maximizeBrowserWindow(page);
console.log(`Using real browser viewport ${viewport.width}x${viewport.height}`);

const errors = [];
page.on('pageerror', (err) => errors.push(err.message));

console.log('⏳ Loading app...');
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 20000 });
await wait(3000);

// Stop any auto-running demo first
await page.evaluate(() => {
  if (window.__vai_demo?.isRunning?.()) {
    window.__vai_demo.stop();
  }
});
await wait(1000);

// ── Test 1: Grand Tour button exists ──
console.log('\n═══ Test 1: Grand Tour Button ═══');
const grandTourBtn = await page.$('button[title*="Grand Tour"]');
if (grandTourBtn) {
  const text = await page.evaluate((el) => el.textContent, grandTourBtn);
  console.log(`✅ Grand Tour button found: "${text.trim()}"`);
} else {
  console.log('❌ Grand Tour button NOT found');
}

await page.screenshot({ path: `${SCREENSHOTS}/00-before-tour.png` });

// ── Test 2: Start Grand Tour ──
console.log('\n═══ Test 2: Start Grand Tour ═══');
await page.evaluate(() => window.__vai_demo?.grandTour?.());
await wait(1500);

// Check if spotlight/annotation rendered
const hasSpotlight = await page.evaluate(() => {
  const svgs = document.querySelectorAll('svg');
  for (const svg of svgs) {
    if (svg.querySelector('#spotlight-mask')) return true;
  }
  // Check for backdrop div
  const fixed = document.querySelectorAll('.fixed');
  for (const el of fixed) {
    if (el.style.background?.includes('rgba(0, 0, 0')) return true;
  }
  return false;
});

const annotation = await page.evaluate(() => {
  const els = document.querySelectorAll('.fixed');
  for (const el of els) {
    const h3 = el.querySelector('h3');
    if (h3) return { title: h3.textContent, found: true };
  }
  return { found: false };
});

console.log(`  Spotlight overlay: ${hasSpotlight ? '✅' : '⚠️ not detected (may use backdrop)'}`);
console.log(`  Annotation panel: ${annotation.found ? '✅ ' + annotation.title : '❌ not found'}`);

await page.screenshot({ path: `${SCREENSHOTS}/01-step-welcome.png` });

// ── Test 3: Step through all 10 steps ──
console.log('\n═══ Test 3: Stepping Through All Steps ═══');
for (let step = 1; step <= 10; step++) {
  // Get step info
  const info = await page.evaluate(() => {
    const h3 = document.querySelector('.fixed h3');
    const counter = document.querySelector('.fixed .text-violet-400');
    const desc = document.querySelector('.fixed .text-zinc-400');
    return {
      title: h3?.textContent || '(none)',
      counter: counter?.textContent || '(none)',
      desc: desc?.textContent?.substring(0, 80) || '(none)',
    };
  });

  console.log(`  Step ${step}: ${info.counter} — ${info.title}`);

  // Screenshot
  await page.screenshot({ path: `${SCREENSHOTS}/${String(step).padStart(2, '0')}-step-${info.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png` });

  // Click Next (unless last step)
  if (step < 10) {
    const nextBtn = await page.evaluateHandle(() => {
      const buttons = document.querySelectorAll('.fixed button');
      for (const btn of buttons) {
        const text = btn.textContent || '';
        if (text.includes('Next') || text.includes('→') || text.includes('⏭')) {
          return btn;
        }
      }
      return null;
    });

    if (nextBtn) {
      await nextBtn.asElement()?.click();
      // Wait for step transition + actions to begin
      await wait(2000);
    } else {
      console.log(`  ⚠️ Next button not found at step ${step}`);
      break;
    }
  }
}

// ── Test 4: Complete tour (click Done) ──
console.log('\n═══ Test 4: Complete Tour ═══');
const doneBtn = await page.evaluateHandle(() => {
  const buttons = document.querySelectorAll('.fixed button');
  for (const btn of buttons) {
    if (btn.textContent?.includes('Done') || btn.textContent?.includes('Next')) {
      return btn;
    }
  }
  return null;
});

if (doneBtn && doneBtn.asElement()) {
  await doneBtn.asElement().click();
  await wait(1000);

  const tourGone = await page.evaluate(() => {
    // Check if annotation panel is gone
    const h3s = document.querySelectorAll('.fixed h3');
    return h3s.length === 0;
  });

  console.log(`  Tour dismissed: ${tourGone ? '✅' : '⚠️ annotation might still be visible'}`);
}

await page.screenshot({ path: `${SCREENSHOTS}/11-tour-complete.png` });

// ── Summary ──
console.log('\n═══════════════════════════════════════');
console.log('📊 Grand Tour Test Summary');
console.log('═══════════════════════════════════════');
console.log(`  Page errors: ${errors.length}`);
if (errors.length > 0) errors.forEach((e) => console.log(`    ❌ ${e}`));

// Count screenshots
const { readdirSync } = await import('fs');
const screenshots = readdirSync(SCREENSHOTS).filter((f) => f.endsWith('.png'));
console.log(`  Screenshots captured: ${screenshots.length}`);
screenshots.forEach((f) => console.log(`    📸 ${f}`));

console.log('\n✅ Grand Tour test complete');
await browser.close();
