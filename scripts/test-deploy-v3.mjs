/**
 * Deploy Test v3 — Triggers PERN Basic deploy via Zustand store directly,
 * validates that Docker/Tests steps are hidden, and health check completes.
 */
import puppeteer from 'puppeteer';
import { mkdirSync, readdirSync, statSync } from 'fs';

const DIR = 'scripts/screenshots/deploy-basic';
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

  console.log('=== Deploy Test v3: PERN Basic (store-triggered) ===\n');

  // Load app
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 15000 });
  await sleep(2000);
  await page.screenshot({ path: `${DIR}/01-initial.png` });
  console.log('01 - App loaded');

  // Trigger PERN Basic deploy via the sandbox store directly
  console.log('\nTriggering PERN Basic deploy via store API...');
  const deployed = await page.evaluate(async () => {
    // Access Zustand store from React internals
    // The store is imported as useSandboxStore — we need to find it
    // Alternative: trigger via the onDeploy callback by clicking the right UI elements

    // Try accessing the store via __ZUSTAND__
    const stores = window.__ZUSTAND_DEVTOOLS_GLOBAL_HOOK__?.stores;
    if (stores) {
      for (const [name, store] of stores) {
        const state = store.getState();
        if (state.deployStack) {
          await state.deployStack('pern', 'basic', 'PERN', 'Basic SPA');
          return { method: 'zustand-devtools', name };
        }
      }
    }

    // Fallback: try to find via module cache or globals
    // Actually, the simplest way is to use the deploy API endpoint directly
    // and then monitor the UI
    return null;
  });

  if (!deployed) {
    console.log('  Store not accessible via devtools, using fetch API fallback...');
    // Use page.evaluate to call fetch and trigger the deploy stream
    await page.evaluate(() => {
      // Import the sandbox store by finding a React component that uses it
      // We need to dispatch the deploy action. Let's try injecting a module import.
      const script = document.createElement('script');
      script.type = 'module';
      script.textContent = `
        // Access the store via the React fiber tree
        const root = document.getElementById('root');
        const fiberKey = Object.keys(root).find(k => k.startsWith('__reactFiber'));
        if (fiberKey) {
          let fiber = root[fiberKey];
          // Walk up/down to find a component with useSandboxStore
          const visited = new Set();
          const queue = [fiber];
          while (queue.length > 0) {
            const f = queue.shift();
            if (!f || visited.has(f)) continue;
            visited.add(f);
            const hooks = f.memoizedState;
            if (hooks?.queue?.lastRenderedState?.deployStack) {
              hooks.queue.lastRenderedState.deployStack('pern', 'basic', 'PERN', 'Basic SPA');
              window.__deploy_triggered = true;
              break;
            }
            if (f.child) queue.push(f.child);
            if (f.sibling) queue.push(f.sibling);
            if (f.return) queue.push(f.return);
          }
        }
      `;
      document.head.appendChild(script);
    });
    await sleep(1000);

    const triggered = await page.evaluate(() => window.__deploy_triggered);
    if (!triggered) {
      // Last resort: click through the UI properly
      console.log('  Fiber walk failed, clicking through UI...');

      // Click "Deploy from a template"
      await page.evaluate(() => {
        const els = [...document.querySelectorAll('*')];
        const card = els.find(el => el.textContent?.includes('Deploy from a template') && el.offsetWidth > 0 && el.offsetWidth < 500);
        if (card) card.click();
      });
      await sleep(1500);

      // Now find the PERN card and its quick deploy button
      // The gallery should show stack cards with deploy buttons
      const stackState = await page.evaluate(() => {
        const body = document.body.textContent || '';
        return {
          hasPERN: body.includes('PERN'),
          hasMERN: body.includes('MERN'),
          hasNextjs: body.includes('Next.js'),
          hasT3: body.includes('T3'),
          buttons: [...document.querySelectorAll('button')].filter(b => b.offsetWidth > 0).map(b => ({
            text: b.textContent?.trim()?.slice(0, 50) || '',
            hasData: Object.keys(b.dataset || {}).join(','),
          })).filter(b => b.text.includes('Deploy') || b.text.includes('Build')),
        };
      });
      console.log(`  Gallery state:`, stackState);

      // Click Deploy PERN Basic — need to find the right button
      // First get into the PERN detail view
      const clickedPern = await page.evaluate(() => {
        // Find clickable card containing PERN
        const cards = [...document.querySelectorAll('div[class*="cursor-pointer"], div[class*="border"]')];
        const pernCard = cards.find(c => {
          const text = c.textContent || '';
          return text.includes('PERN') && c.offsetWidth > 100 && c.offsetWidth < 500 &&
                 !text.includes('MERN') && !text.includes('Next');
        });
        if (pernCard) { pernCard.click(); return true; }
        return false;
      });
      console.log(`  Clicked PERN card: ${clickedPern}`);
      await sleep(1000);

      // Now the tier view should be showing — look for Basic/Starter
      const tierState = await page.evaluate(() => {
        const body = document.body.textContent || '';
        return {
          hasBasic: body.includes('Basic SPA') || body.includes('Starter'),
          hasSolid: body.includes('With Auth') || body.includes('Recommended'),
          hasBattle: body.includes('Social Platform'),
          hasVai: body.includes('Full Commerce'),
        };
      });
      console.log(`  Tier state:`, tierState);
      await page.screenshot({ path: `${DIR}/02-after-pern-click.png` });

      // Click Basic SPA tier
      await page.evaluate(() => {
        const els = [...document.querySelectorAll('div[class*="cursor-pointer"], div[class*="border"], button')];
        const basic = els.find(el => {
          const text = el.textContent || '';
          return (text.includes('Basic SPA') || text.includes('Starter')) &&
                 el.offsetWidth > 50 && el.offsetWidth < 500 &&
                 !text.includes('Social') && !text.includes('Commerce');
        });
        if (basic) basic.click();
      });
      await sleep(500);

      // Now click Deploy
      const deployResult = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        // Look for deploy button that says "Deploy" and matches Basic
        const deploy = btns.find(b => {
          const t = b.textContent?.trim().toLowerCase() || '';
          return t.includes('deploy') && (t.includes('basic') || !t.includes('battle')) && b.offsetWidth > 0;
        });
        if (deploy) { deploy.click(); return deploy.textContent?.trim(); }
        return null;
      });
      console.log(`  Deploy button: "${deployResult}"`);
    }
  } else {
    console.log(`  Deploy triggered via: ${deployed.method}`);
  }

  await sleep(500);
  await page.screenshot({ path: `${DIR}/03-deploy-started.png` });
  console.log('03 - Deploy started');

  // Monitor progress
  console.log('\nMonitoring deploy...');
  let lastProgress = -1;
  for (let sec = 2; sec <= 90; sec += 2) {
    await sleep(2000);

    const state = await page.evaluate(() => {
      const body = document.body.textContent || '';
      const percentMatch = body.match(/(\d+)%/);

      return {
        progress: percentMatch ? parseInt(percentMatch[1]) : null,
        isComplete: body.includes('Deployment Complete') || body.includes('Ready — loading'),
        hasFailed: body.includes('Deploy Issue'),
        headerText: body.match(/(Deploying\.\.\.|Deployment Complete|Deploy Issue)/)?.[1] || '',
        hasDockerStep: body.includes('Docker verification'),
        hasTestStep: body.includes('Running tests'),
        hasNotIncluded: body.includes('Not included in this tier'),
        deployLabel: body.match(/(PERN\s*—\s*[\w\s]+)/)?.[1]?.trim() || '',
      };
    });

    // Screenshot at progress changes
    if (state.progress !== lastProgress || state.isComplete) {
      const idx = String(Math.floor(sec / 2) + 3).padStart(2, '0');
      await page.screenshot({ path: `${DIR}/${idx}-${state.progress}pct-${sec}s.png` });
      lastProgress = state.progress;
    }

    console.log(`  [${sec}s] ${state.progress}% "${state.headerText}" docker=${state.hasDockerStep} tests=${state.hasTestStep} notIncluded=${state.hasNotIncluded} label="${state.deployLabel}"`);

    if (state.isComplete || state.hasFailed) {
      console.log(`\n  ✓ ${state.isComplete ? 'COMPLETE' : 'FAILED'} at ${sec}s`);
      break;
    }
  }

  await sleep(2000);
  await page.screenshot({ path: `${DIR}/99-final.png` });

  // Detailed final analysis
  const final = await page.evaluate(() => {
    const body = document.body.textContent || '';
    const stepLabels = ['Scaffolding project', 'Installing packages', 'Building application',
                       'Docker verification', 'Running tests', 'Starting dev server', 'Health check'];
    return {
      visibleSteps: stepLabels.filter(s => body.includes(s)),
      hiddenSteps: stepLabels.filter(s => !body.includes(s)),
      progress: body.match(/(\d+)%/)?.[1],
      tierLabel: body.match(/(PERN\s*—\s*[\w\s]+)/)?.[1]?.trim(),
      isComplete: body.includes('Deployment Complete'),
      hasNotIncluded: body.includes('Not included'),
    };
  });

  console.log('\n=== VALIDATION RESULTS ===');
  console.log(`Tier: ${final.tierLabel || 'unknown'}`);
  console.log(`Progress: ${final.progress}%`);
  console.log(`Complete: ${final.isComplete}`);
  console.log(`\nVisible steps: ${JSON.stringify(final.visibleSteps)}`);
  console.log(`Hidden steps: ${JSON.stringify(final.hiddenSteps)}`);
  console.log(`"Not included" text visible: ${final.hasNotIncluded}`);

  if (final.tierLabel?.includes('Basic')) {
    console.log(`\n--- Basic Tier Assertions ---`);
    console.log(`Docker hidden: ${!final.visibleSteps.includes('Docker verification')} ${!final.visibleSteps.includes('Docker verification') ? '✓' : '✗ FAIL'}`);
    console.log(`Tests hidden: ${!final.visibleSteps.includes('Running tests')} ${!final.visibleSteps.includes('Running tests') ? '✓' : '✗ FAIL'}`);
    console.log(`No "Not included": ${!final.hasNotIncluded} ${!final.hasNotIncluded ? '✓' : '✗ FAIL'}`);
  }

  // Console logs
  const relevant = consoleLogs.filter(l => l.toLowerCase().includes('deploy') || l.toLowerCase().includes('error'));
  if (relevant.length > 0) {
    console.log('\n=== Console ===');
    relevant.slice(0, 10).forEach(l => console.log(`  ${l}`));
  }

  console.log('\n=== Screenshots ===');
  readdirSync(DIR).filter(f => f.endsWith('.png')).sort().forEach(f => {
    console.log(`  ${f}: ${(statSync(`${DIR}/${f}`).size / 1024).toFixed(1)} KB`);
  });

  await browser.close();
  console.log('\nDone.');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
