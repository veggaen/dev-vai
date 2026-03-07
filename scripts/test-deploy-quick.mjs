/**
 * Quick deploy validation — triggers PERN Basic via UI, checks:
 * 1. Docker/Tests steps are hidden
 * 2. Progress reaches 100%
 * 3. Deployment completes successfully
 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';

const DIR = 'scripts/screenshots/deploy-final';
const sleep = ms => new Promise(r => setTimeout(r, ms));
mkdirSync(DIR, { recursive: true });

async function main() {
  const browser = await puppeteer.launch({
    headless: false, slowMo: 50,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();

  console.log('=== Quick Deploy Validation ===\n');

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 15000 });
  await sleep(2000);

  // Navigate: Click "Deploy from a template"
  await page.evaluate(() => {
    const els = [...document.querySelectorAll('*')];
    const card = els.find(el => el.textContent?.includes('Deploy from a template') && el.offsetWidth > 0 && el.offsetWidth < 500);
    if (card) card.click();
  });
  await sleep(1500);

  // Click PERN card
  await page.evaluate(() => {
    const allEls = [...document.querySelectorAll('*')];
    const pernLabel = allEls.find(el => el.textContent?.trim() === 'PERN' && el.tagName !== 'BODY' && el.tagName !== 'HTML');
    if (pernLabel) {
      const target = pernLabel.closest('button') || pernLabel.closest('[class*="cursor-pointer"]') || pernLabel.closest('div[class*="border"]');
      if (target) target.click(); else pernLabel.click();
    }
  });
  await sleep(1000);

  // Click Basic SPA tier
  await page.evaluate(() => {
    const els = [...document.querySelectorAll('div[class*="cursor-pointer"], div[class*="border"], button')];
    const basic = els.find(el => {
      const t = el.textContent || '';
      return (t.includes('Basic SPA') || t.includes('Starter')) && el.offsetWidth > 50 && el.offsetWidth < 500 && !t.includes('Social') && !t.includes('Commerce');
    });
    if (basic) basic.click();
  });
  await sleep(500);

  // Click Deploy
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const deploy = btns.find(b => {
      const t = b.textContent?.trim() || '';
      return t.includes('Deploy') && t.includes('Basic') && b.offsetWidth > 0;
    }) || btns.find(b => {
      const t = b.textContent?.trim()?.toLowerCase() || '';
      return t.startsWith('deploy') && b.offsetWidth > 0 && !t.includes('template');
    });
    if (deploy) deploy.click();
  });
  await sleep(500);
  await page.screenshot({ path: `${DIR}/01-deploy-start.png` });

  // Monitor progress — capture at milestones
  const results = { maxProgress: 0, completed: false, dockerVisible: null, testsVisible: null, progressValues: [] };

  for (let sec = 2; sec <= 90; sec += 1) {
    await sleep(1000);

    const state = await page.evaluate(() => {
      const body = document.body.textContent || '';
      return {
        progress: parseInt(body.match(/(\d+)%/)?.[1] || '0'),
        isComplete: body.includes('Deployment Complete'),
        hasDocker: body.includes('Docker verification'),
        hasTests: body.includes('Running tests'),
        hasNotIncluded: body.includes('Not included'),
      };
    });

    if (state.progress > results.maxProgress) {
      results.maxProgress = state.progress;
      results.progressValues.push({ sec, pct: state.progress });
      await page.screenshot({ path: `${DIR}/${String(sec).padStart(2,'0')}-${state.progress}pct.png` });
      console.log(`  [${sec}s] Progress: ${state.progress}% docker=${state.hasDocker} tests=${state.hasTests}`);
    }

    if (results.dockerVisible === null && state.progress > 5) {
      results.dockerVisible = state.hasDocker;
      results.testsVisible = state.hasTests;
    }

    if (state.isComplete) {
      results.completed = true;
      await page.screenshot({ path: `${DIR}/99-complete.png` });
      console.log(`\n  ✓ COMPLETE at ${sec}s! Progress: ${state.progress}%`);
      break;
    }
  }

  // Final analysis
  const final = await page.evaluate(() => {
    const body = document.body.textContent || '';
    return {
      steps: ['Scaffolding project', 'Installing packages', 'Building application',
              'Docker verification', 'Running tests', 'Starting dev server', 'Health check']
        .map(s => ({ name: s, visible: body.includes(s) })),
      tierLabel: body.match(/(PERN\s*—\s*[\w\s]+)/)?.[1]?.trim(),
    };
  });

  console.log(`\n=== RESULTS ===`);
  console.log(`Tier: ${final.tierLabel || 'unknown'}`);
  console.log(`Max progress: ${results.maxProgress}%`);
  console.log(`Completed: ${results.completed}`);
  console.log(`Docker step visible: ${results.dockerVisible}`);
  console.log(`Tests step visible: ${results.testsVisible}`);
  console.log(`\nStep visibility:`);
  for (const s of final.steps) {
    const expected = !['Docker verification', 'Running tests'].includes(s.name);
    const pass = s.visible === expected;
    console.log(`  ${pass ? '✓' : '✗'} ${s.name}: ${s.visible ? 'visible' : 'hidden'} (expected: ${expected ? 'visible' : 'hidden'})`);
  }
  console.log(`\nProgress milestones: ${results.progressValues.map(v => `${v.pct}%@${v.sec}s`).join(' → ')}`);

  await browser.close();
  console.log('\nDone.');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
