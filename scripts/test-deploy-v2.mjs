/**
 * Deploy Test v2 — Tests PERN Basic deploy via API directly,
 * then validates the DeployProgress UI renders correctly.
 */
import puppeteer from 'puppeteer';
import { mkdirSync, readdirSync, statSync } from 'fs';

const DIR = 'scripts/screenshots/deploy-v2';
const sleep = ms => new Promise(r => setTimeout(r, ms));

mkdirSync(DIR, { recursive: true });

async function main() {
  const browser = await puppeteer.launch({
    headless: false, slowMo: 50,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();

  const consoleLogs = [];
  page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

  console.log('=== Deploy Test v2: PERN Basic (API-triggered) ===\n');

  // Load app
  console.log('Loading app...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 15000 });
  await sleep(1500);

  // Take initial screenshot
  await page.screenshot({ path: `${DIR}/01-initial.png` });
  console.log('01 - Initial state');

  // Trigger deploy via the sandboxStore global (bypasses navigation issues)
  console.log('\nTriggering PERN Basic deploy via store...');
  await page.evaluate(() => {
    // Access the sandbox store and trigger deploy
    // The store is accessible via React internals or we can call the API directly
    const event = new CustomEvent('vai-deploy', {
      detail: { stackId: 'pern', tier: 'basic' }
    });
    window.dispatchEvent(event);
  });
  await sleep(500);

  // Actually trigger via Zustand store
  const storeFound = await page.evaluate(() => {
    // Try to find the store via window or React fiber
    const storeHooks = document.querySelector('[class*="preview"], [class*="sandbox"]');
    return !!storeHooks;
  });
  console.log(`Store element found: ${storeFound}`);

  // Navigate to deploy: Click "Deploy from a template" starter
  console.log('\nNavigating to template gallery...');
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('div[class*="cursor-pointer"], button')];
    const deployCard = cards.find(c => c.textContent?.includes('Deploy from a template'));
    if (deployCard) deployCard.click();
  });
  await sleep(1500);
  await page.screenshot({ path: `${DIR}/02-gallery.png` });
  console.log('02 - Template gallery');

  // Now click on PERN stack card specifically
  console.log('\nLooking for PERN card...');
  const pernInfo = await page.evaluate(() => {
    // Find all visible elements with PERN text
    const allEls = [...document.querySelectorAll('*')];
    const pernEls = allEls.filter(el => {
      const text = el.textContent?.trim() || '';
      const ownText = el.childNodes.length === 0 || (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3);
      return text === 'PERN' || (text.startsWith('PERN') && text.length < 30 && ownText);
    });
    return pernEls.map(el => ({
      tag: el.tagName,
      text: el.textContent?.trim()?.slice(0, 30) || '',
      class: (el.className?.toString() || '').slice(0, 50),
      clickable: !!(el.closest('button') || el.closest('[class*="cursor-pointer"]')),
    }));
  });
  console.log(`  PERN elements: ${JSON.stringify(pernInfo.slice(0, 5))}`);

  // Click the PERN card by finding its parent clickable element
  const clicked = await page.evaluate(() => {
    const allEls = [...document.querySelectorAll('*')];
    const pernLabel = allEls.find(el => {
      const text = el.textContent?.trim();
      return text === 'PERN' && el.tagName !== 'BODY' && el.tagName !== 'HTML';
    });
    if (pernLabel) {
      const clickTarget = pernLabel.closest('button') ||
                          pernLabel.closest('[class*="cursor-pointer"]') ||
                          pernLabel.closest('div[class*="border"]');
      if (clickTarget) {
        clickTarget.click();
        return { text: clickTarget.textContent?.trim().slice(0, 60), tag: clickTarget.tagName };
      }
      // Try clicking the label itself
      pernLabel.click();
      return { text: pernLabel.textContent?.trim(), tag: pernLabel.tagName, direct: true };
    }
    return null;
  });
  console.log(`  Clicked: ${JSON.stringify(clicked)}`);
  await sleep(1000);
  await page.screenshot({ path: `${DIR}/03-pern-clicked.png` });
  console.log('03 - After PERN click');

  // Now look for tier selector
  console.log('\nLooking for tier buttons...');
  const tierButtons = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, [role="button"]')];
    return btns.filter(b => {
      const t = b.textContent?.trim().toLowerCase() || '';
      return (t.includes('basic') || t.includes('solid') || t.includes('auth') ||
              t.includes('social') || t.includes('commerce')) &&
             b.offsetWidth > 0 && b.offsetWidth < 400;
    }).map(b => ({
      text: b.textContent?.trim().slice(0, 40),
      width: b.offsetWidth,
      height: b.offsetHeight,
    }));
  });
  console.log(`  Tier buttons: ${JSON.stringify(tierButtons)}`);

  // Click "Basic SPA" tier if found
  const basicClicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, div[class*="cursor-pointer"]')];
    const basic = btns.find(b => {
      const t = b.textContent?.trim() || '';
      return (t.includes('Basic SPA') || t.includes('Starter')) && b.offsetWidth > 0;
    });
    if (basic) { basic.click(); return basic.textContent?.trim().slice(0, 40); }
    return null;
  });
  console.log(`  Basic tier clicked: ${basicClicked}`);
  await sleep(500);
  await page.screenshot({ path: `${DIR}/04-basic-selected.png` });
  console.log('04 - Basic tier selected');

  // Now find and click the deploy button
  console.log('\nLooking for Deploy button...');
  const allButtons = await page.evaluate(() => {
    return [...document.querySelectorAll('button')].filter(b => b.offsetWidth > 0).map(b => ({
      text: b.textContent?.trim().slice(0, 50),
      class: b.className?.toString().slice(0, 60),
    }));
  });
  console.log(`  All visible buttons: ${JSON.stringify(allButtons.slice(0, 15))}`);

  const deployClicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const deploy = btns.find(b => {
      const t = b.textContent?.trim() || '';
      return t.includes('Deploy') && t.includes('Basic') && b.offsetWidth > 0;
    }) || btns.find(b => {
      const t = b.textContent?.trim().toLowerCase() || '';
      return t.startsWith('deploy') && b.offsetWidth > 0 && !t.includes('template');
    });
    if (deploy) { deploy.click(); return deploy.textContent?.trim().slice(0, 50); }
    return null;
  });
  console.log(`  Deploy clicked: "${deployClicked}"`);
  await sleep(500);
  await page.screenshot({ path: `${DIR}/05-deploy-started.png` });
  console.log('05 - Deploy started');

  // Monitor deploy progress
  console.log('\nMonitoring deploy progress...');
  let completed = false;
  for (let sec = 2; sec <= 80; sec += 2) {
    await sleep(2000);

    const state = await page.evaluate(() => {
      const body = document.body.textContent || '';
      const percentMatch = body.match(/(\d+)%/);

      // Check visible step labels
      const stepLabels = ['Scaffolding project', 'Installing packages', 'Building application',
                         'Docker verification', 'Running tests', 'Starting dev server', 'Health check'];
      const visibleSteps = stepLabels.filter(s => body.includes(s));
      const hiddenSteps = stepLabels.filter(s => !body.includes(s));

      return {
        progress: percentMatch ? parseInt(percentMatch[1]) : null,
        isComplete: body.includes('Deployment Complete') || body.includes('Ready —'),
        hasFailed: body.includes('Deploy Issue') || body.includes('Deploy had issues'),
        visibleSteps,
        hiddenSteps,
        hasDocker: body.includes('Docker verification'),
        hasTests: body.includes('Running tests'),
        hasNotIncluded: body.includes('Not included'),
      };
    });

    // Take screenshots at key moments
    if (sec === 2 || sec === 8 || sec === 20 || sec === 40 || state.isComplete) {
      const idx = String(Math.floor(sec / 2) + 5).padStart(2, '0');
      await page.screenshot({ path: `${DIR}/${idx}-deploy-${sec}s.png` });
    }

    const stepStr = state.visibleSteps.map(s => s.split(' ')[0]).join(',');
    console.log(`  [${sec}s] ${state.progress}% steps=[${stepStr}] docker=${state.hasDocker} tests=${state.hasTests} notIncluded=${state.hasNotIncluded}`);

    if (state.isComplete || state.hasFailed) {
      completed = true;
      console.log(`\n  ✓ Deploy ${state.isComplete ? 'COMPLETE' : 'FAILED'} at ${sec}s`);
      console.log(`  Visible steps: ${JSON.stringify(state.visibleSteps)}`);
      console.log(`  Hidden steps: ${JSON.stringify(state.hiddenSteps)}`);
      console.log(`  Docker visible: ${state.hasDocker}`);
      console.log(`  Tests visible: ${state.hasTests}`);
      console.log(`  "Not included" text: ${state.hasNotIncluded}`);
      break;
    }
  }

  // Final screenshot
  await sleep(2000);
  await page.screenshot({ path: `${DIR}/99-final.png` });
  console.log('\n99 - Final state');

  // Check final step state
  const finalSteps = await page.evaluate(() => {
    const body = document.body.textContent || '';
    return {
      scaffolding: body.includes('Scaffolding project'),
      installing: body.includes('Installing packages'),
      building: body.includes('Building application'),
      docker: body.includes('Docker verification'),
      tests: body.includes('Running tests'),
      startDev: body.includes('Starting dev server'),
      healthCheck: body.includes('Health check'),
      notIncluded: body.includes('Not included in this tier'),
      complete: body.includes('Deployment Complete'),
      ready: body.includes('Ready'),
      progressBar: body.match(/(\d+)%/)?.[1],
    };
  });

  console.log('\n=== Final Validation ===');
  console.log(`  Scaffolding: ${finalSteps.scaffolding}`);
  console.log(`  Installing:  ${finalSteps.installing}`);
  console.log(`  Building:    ${finalSteps.building}`);
  console.log(`  Docker:      ${finalSteps.docker} (should be false for Basic)`);
  console.log(`  Tests:       ${finalSteps.tests} (should be false for Basic)`);
  console.log(`  Start Dev:   ${finalSteps.startDev}`);
  console.log(`  Health:      ${finalSteps.healthCheck}`);
  console.log(`  Not Included: ${finalSteps.notIncluded} (should be false after fix)`);
  console.log(`  Complete:    ${finalSteps.complete}`);
  console.log(`  Progress:    ${finalSteps.progressBar}%`);

  // Check iframe
  const preview = await page.evaluate(() => {
    const iframe = document.querySelector('iframe');
    return iframe ? { src: iframe.src, visible: iframe.offsetWidth > 0 } : null;
  });
  console.log(`  Preview: ${preview ? `src=${preview.src}` : 'none'}`);

  // Print file listing
  console.log('\n=== Screenshots ===');
  const files = readdirSync(DIR).filter(f => f.endsWith('.png')).sort();
  for (const f of files) {
    const size = statSync(`${DIR}/${f}`).size;
    console.log(`  ${f}: ${(size / 1024).toFixed(1)} KB`);
  }

  await browser.close();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
