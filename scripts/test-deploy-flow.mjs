/**
 * Deploy Test — Puppeteer-driven deployment flow test.
 * Clicks through UI to deploy PERN Basic, captures screenshots at each step.
 * Validates all visible steps are real (no Docker/Tests for Basic tier).
 */
import puppeteer from 'puppeteer';
import { mkdirSync, readdirSync, statSync } from 'fs';

const DIR = 'scripts/screenshots/deploy-test';
const sleep = ms => new Promise(r => setTimeout(r, ms));

mkdirSync(DIR, { recursive: true });

async function main() {
  const browser = await puppeteer.launch({
    headless: false, slowMo: 50,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();

  // Collect console messages for debugging
  const consoleLogs = [];
  page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

  console.log('=== Deploy Test: PERN Basic via UI ===\n');

  // 1. Load the app
  console.log('Step 1: Loading app...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 15000 });
  await sleep(2000);
  await page.screenshot({ path: `${DIR}/01-app-loaded.png` });
  console.log('  Screenshot: 01-app-loaded.png');

  // 2. Find and click "Deploy from a template" starter card
  console.log('\nStep 2: Clicking "Deploy from a template"...');
  const deployCard = await page.evaluateHandle(() => {
    const buttons = [...document.querySelectorAll('button, [role="button"], div[class*="cursor-pointer"]')];
    return buttons.find(b => b.textContent?.includes('Deploy from a template'));
  });

  if (deployCard) {
    await deployCard.asElement()?.click();
    await sleep(1500);
    await page.screenshot({ path: `${DIR}/02-template-gallery.png` });
    console.log('  Screenshot: 02-template-gallery.png');
  } else {
    console.log('  WARN: Could not find "Deploy from a template" button');
    // Try clicking via the template gallery navigation
    const galleryBtn = await page.$('button[data-panel="gallery"]');
    if (galleryBtn) {
      await galleryBtn.click();
      await sleep(1500);
    }
    await page.screenshot({ path: `${DIR}/02-template-gallery.png` });
  }

  // 3. Check what stacks are visible
  console.log('\nStep 3: Analyzing template gallery...');
  const galleryInfo = await page.evaluate(() => {
    const stackCards = document.querySelectorAll('[class*="stack"], [class*="card"]');
    const allButtons = document.querySelectorAll('button');
    const buttonTexts = [...allButtons].map(b => b.textContent?.trim()).filter(Boolean);
    const deployButtons = buttonTexts.filter(t => t?.includes('Deploy') || t?.includes('Build'));

    // Look for PERN specifically
    const pernElements = [...document.querySelectorAll('*')].filter(el =>
      el.textContent?.includes('PERN') && el.offsetWidth > 0
    );

    return {
      stackCardCount: stackCards.length,
      buttonTexts: buttonTexts.slice(0, 20),
      deployButtons,
      pernFound: pernElements.length > 0,
      pernTexts: pernElements.slice(0, 3).map(el => el.textContent?.trim().slice(0, 50)),
    };
  });
  console.log(`  Stack cards: ${galleryInfo.stackCardCount}`);
  console.log(`  Deploy buttons: ${JSON.stringify(galleryInfo.deployButtons)}`);
  console.log(`  PERN found: ${galleryInfo.pernFound}`);

  // 4. Click on PERN stack
  console.log('\nStep 4: Clicking PERN stack...');
  const pernClicked = await page.evaluate(() => {
    // Find clickable element containing "PERN"
    const els = [...document.querySelectorAll('button, [role="button"], [class*="cursor-pointer"], div')];
    const pern = els.find(el => {
      const text = el.textContent?.trim() || '';
      return text.includes('PERN') && el.offsetWidth > 0 && el.offsetWidth < 400;
    });
    if (pern) { pern.click(); return true; }
    return false;
  });
  console.log(`  PERN click: ${pernClicked}`);
  await sleep(1000);
  await page.screenshot({ path: `${DIR}/03-pern-selected.png` });
  console.log('  Screenshot: 03-pern-selected.png');

  // 5. Check tier selector and ensure Basic is selected (or select it)
  console.log('\nStep 5: Checking tier selector...');
  const tierInfo = await page.evaluate(() => {
    const tierButtons = [...document.querySelectorAll('button')].filter(b => {
      const t = b.textContent?.trim() || '';
      return t.includes('Basic') || t.includes('Solid') || t.includes('Battle') || t.includes('Commerce');
    });
    return tierButtons.map(b => ({
      text: b.textContent?.trim().slice(0, 30),
      active: b.className?.includes('active') || b.className?.includes('selected') ||
              b.getAttribute('data-active') === 'true' || b.className?.includes('violet'),
    }));
  });
  console.log(`  Tiers found: ${JSON.stringify(tierInfo)}`);

  // Click "Basic" tier if available
  const basicClicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const basic = btns.find(b => b.textContent?.trim().includes('Basic'));
    if (basic) { basic.click(); return true; }
    return false;
  });
  console.log(`  Basic tier clicked: ${basicClicked}`);
  await sleep(500);
  await page.screenshot({ path: `${DIR}/04-basic-tier.png` });

  // 6. Click Deploy button
  console.log('\nStep 6: Clicking Deploy button...');
  const deployClicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    // Look for deploy/build button
    const deploy = btns.find(b => {
      const t = b.textContent?.trim().toLowerCase() || '';
      return (t.includes('deploy') || t.includes('build')) && !t.includes('template') && b.offsetWidth > 0;
    });
    if (deploy) { deploy.click(); return deploy.textContent?.trim(); }
    return null;
  });
  console.log(`  Deploy button clicked: "${deployClicked}"`);
  await sleep(500);
  await page.screenshot({ path: `${DIR}/05-deploy-started.png` });
  console.log('  Screenshot: 05-deploy-started.png');

  // 7. Now capture screenshots at intervals during deployment
  console.log('\nStep 7: Capturing deploy progress...');
  const captureDeployState = async (label) => {
    return await page.evaluate(() => {
      // Find deploy progress info
      const stepEls = document.querySelectorAll('[class*="rounded-lg"]');
      const steps = [];
      stepEls.forEach(el => {
        const text = el.textContent?.trim();
        if (text && (text.includes('Scaffolding') || text.includes('Installing') ||
            text.includes('Building') || text.includes('Docker') || text.includes('Running tests') ||
            text.includes('Starting') || text.includes('Health') || text.includes('Deployment Complete'))) {
          steps.push(text.slice(0, 80));
        }
      });

      // Check progress bar
      const progressBar = document.querySelector('[style*="width"]');
      const progressText = document.body.textContent?.match(/(\d+)%/)?.[1];

      // Check if deployment complete
      const complete = document.body.textContent?.includes('Deployment Complete') ||
                       document.body.textContent?.includes('Ready');

      return {
        steps,
        progressPercent: progressText,
        isComplete: !!complete,
        hasDocker: document.body.textContent?.includes('Docker'),
        hasTests: document.body.textContent?.includes('Running tests'),
        bodySnippet: document.body.textContent?.slice(0, 300),
      };
    });
  };

  // Capture every 2 seconds for 60 seconds
  for (let sec = 2; sec <= 60; sec += 2) {
    await sleep(2000);
    const idx = String(Math.floor(sec / 2) + 5).padStart(2, '0');
    await page.screenshot({ path: `${DIR}/${idx}-deploy-${sec}s.png` });

    const state = await captureDeployState(`${sec}s`);
    console.log(`  [${sec}s] progress=${state.progressPercent}% complete=${state.isComplete} docker=${state.hasDocker} tests=${state.hasTests}`);

    if (state.isComplete) {
      console.log(`  Deployment completed at ${sec}s!`);
      break;
    }
  }

  // 8. Final state
  await sleep(2000);
  await page.screenshot({ path: `${DIR}/99-final-state.png` });
  console.log('\n  Screenshot: 99-final-state.png');

  // 9. Analyze final state
  const finalState = await page.evaluate(() => {
    const body = document.body.textContent || '';
    return {
      hasDeployComplete: body.includes('Deployment Complete'),
      hasReady: body.includes('Ready'),
      hasDockerStep: body.includes('Docker verification'),
      hasTestStep: body.includes('Running tests'),
      hasSkipped: body.includes('skipped') || body.includes('Not included'),
      progressPercent: body.match(/(\d+)%/)?.[1],
      visibleSteps: (() => {
        const items = [];
        const patterns = ['Scaffolding', 'Installing', 'Building', 'Docker', 'Running tests', 'Starting', 'Health check'];
        for (const p of patterns) {
          if (body.includes(p)) items.push(p);
        }
        return items;
      })(),
    };
  });

  console.log('\n=== Final Analysis ===');
  console.log(`  Deploy complete: ${finalState.hasDeployComplete}`);
  console.log(`  Ready: ${finalState.hasReady}`);
  console.log(`  Progress: ${finalState.progressPercent}%`);
  console.log(`  Docker step visible: ${finalState.hasDockerStep}`);
  console.log(`  Test step visible: ${finalState.hasTestStep}`);
  console.log(`  Has "skipped/Not included": ${finalState.hasSkipped}`);
  console.log(`  Visible steps: ${JSON.stringify(finalState.visibleSteps)}`);

  // 10. Verify the deployed app
  if (finalState.hasReady || finalState.hasDeployComplete) {
    console.log('\nStep 10: Checking deployed sandbox...');
    // Check if an iframe or preview is showing
    const preview = await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      return iframe ? { src: iframe.src, visible: iframe.offsetWidth > 0 } : null;
    });
    console.log(`  Preview iframe: ${preview ? `src=${preview.src} visible=${preview.visible}` : 'none'}`);
  }

  // List all captured screenshots with sizes
  console.log('\n=== Screenshot Summary ===');
  const files = readdirSync(DIR).filter(f => f.endsWith('.png')).sort();
  for (const f of files) {
    const size = statSync(`${DIR}/${f}`).size;
    console.log(`  ${f}: ${(size / 1024).toFixed(1)} KB`);
  }

  // Print relevant console logs
  const relevantLogs = consoleLogs.filter(l =>
    l.includes('deploy') || l.includes('sandbox') || l.includes('error') ||
    l.includes('fetch') || l.includes('scaffold')
  );
  if (relevantLogs.length > 0) {
    console.log('\n=== Relevant Console Logs ===');
    relevantLogs.slice(0, 20).forEach(l => console.log(`  ${l}`));
  }

  await browser.close();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
