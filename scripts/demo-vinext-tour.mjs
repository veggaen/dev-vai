#!/usr/bin/env node
/**
 * demo-vinext-tour.mjs — Interactive Puppeteer demo with VISIBLE mouse + keyboard.
 *
 * Per Two-Eyes Protocol (Master.md §16):
 * - Real Chrome window (headless: false, slowMo: 50)
 * - Visible red cursor dot following mouse movements
 * - Click animations (ripple effect on click)
 * - Real typing in input fields
 * - Navigate all pages per template: home → sub-page → login → settings → home
 * - Screenshot at every meaningful step
 * - Hold view 2-3s between interactions
 *
 * Usage: node scripts/demo-vinext-tour.mjs [template-index]
 *   template-index: 0-3 (default: all)
 */

import puppeteer from 'puppeteer';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API = 'http://localhost:3006';
const SCREENSHOT_DIR = './screenshots/templates';
const DEPLOY_TIMEOUT = 180_000;

const TEMPLATES = [
  {
    stackId: 'vinext', tier: 'basic', name: 'Aurora', desc: 'AI Analytics Command Center',
    subPages: ['/analytics', '/login', '/settings'],
  },
  {
    stackId: 'vinext', tier: 'solid', name: 'Fjord', desc: 'Creative Studio & Portfolio',
    subPages: ['/portfolio', '/login', '/settings'],
  },
  {
    stackId: 'vinext', tier: 'battle-tested', name: 'Tundra', desc: 'Infrastructure Console',
    subPages: ['/deploys', '/login', '/settings'],
  },
  {
    stackId: 'vinext', tier: 'vai', name: 'Solstice', desc: 'Subscription Commerce Platform',
    subPages: ['/pricing', '/login', '/settings', '/dashboard'],
  },
];

/* ── Deploy helper ── */
function deploy(stackId, tier) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Deploy timeout')), DEPLOY_TIMEOUT);
    const opts = {
      hostname: 'localhost', port: 3006,
      path: '/api/sandbox/deploy', method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        clearTimeout(timer);
        const events = data.trim().split('\n').map(l => {
          try { return JSON.parse(l); } catch { return null; }
        }).filter(Boolean);
        const steps = events.filter(e => e.step);
        const failed = steps.filter(s => s.status === 'failed');
        const startEvt = events.find(e => e.step === 'start' && e.port);
        const scaffoldEvt = events.find(e => e.step === 'scaffold' && e.projectId);
        resolve({
          ok: failed.length === 0 || (failed.every(f => f.step !== 'start')),
          port: startEvt?.port ?? null,
          projectId: scaffoldEvt?.projectId ?? null,
          steps: steps.map(s => `${s.step}:${s.status}`).join(' → '),
        });
      });
    });
    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    req.write(JSON.stringify({ stackId, tier }));
    req.end();
  });
}

/* ── Destroy sandbox ── */
async function destroy(projectId) {
  if (!projectId) return;
  try { await fetch(`${API}/api/sandbox/${projectId}`, { method: 'DELETE' }); } catch {}
}

/* ── Inject visible cursor + click ripple ── */
async function injectVisibleCursor(page) {
  await page.evaluate(() => {
    // Red cursor dot
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    Object.assign(cursor.style, {
      position: 'fixed', width: '16px', height: '16px',
      background: 'radial-gradient(circle, #ff3333 0%, #ff333388 50%, transparent 70%)',
      borderRadius: '50%', pointerEvents: 'none', zIndex: '99999',
      transform: 'translate(-50%, -50%)', transition: 'left 0.08s ease, top 0.08s ease',
      boxShadow: '0 0 12px rgba(255,50,50,0.6), 0 0 4px rgba(255,50,50,0.9)',
      left: '-100px', top: '-100px',
    });
    document.body.appendChild(cursor);

    // Click ripple
    const ripple = document.createElement('div');
    ripple.id = 'demo-ripple';
    Object.assign(ripple.style, {
      position: 'fixed', width: '40px', height: '40px',
      border: '2px solid #ff3333', borderRadius: '50%',
      pointerEvents: 'none', zIndex: '99998',
      transform: 'translate(-50%, -50%) scale(0)', opacity: '0',
      transition: 'none', left: '-100px', top: '-100px',
    });
    document.body.appendChild(ripple);

    // Track mouse for cursor
    document.addEventListener('mousemove', (e) => {
      cursor.style.left = e.clientX + 'px';
      cursor.style.top = e.clientY + 'px';
    });

    // Click animation
    document.addEventListener('mousedown', (e) => {
      ripple.style.left = e.clientX + 'px';
      ripple.style.top = e.clientY + 'px';
      ripple.style.transition = 'none';
      ripple.style.transform = 'translate(-50%, -50%) scale(0)';
      ripple.style.opacity = '1';
      requestAnimationFrame(() => {
        ripple.style.transition = 'transform 0.4s ease-out, opacity 0.4s ease-out';
        ripple.style.transform = 'translate(-50%, -50%) scale(1.5)';
        ripple.style.opacity = '0';
      });
    });
  });
}

/* ── Move mouse smoothly to an element and click ── */
async function moveAndClick(page, selector, label = '') {
  try {
    await page.waitForSelector(selector, { timeout: 5000 });
    const el = await page.$(selector);
    if (!el) return false;
    const box = await el.boundingBox();
    if (!box) return false;

    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    // Move to element in steps for visibility
    await page.mouse.move(x, y, { steps: 15 });
    await new Promise(r => setTimeout(r, 300));
    await page.mouse.click(x, y);
    if (label) console.log(`      🖱️  Clicked: ${label}`);
    await new Promise(r => setTimeout(r, 800));
    return true;
  } catch {
    return false;
  }
}

/* ── Move mouse to element (hover only) ── */
async function hoverElement(page, selector, label = '') {
  try {
    await page.waitForSelector(selector, { timeout: 3000 });
    const el = await page.$(selector);
    if (!el) return;
    const box = await el.boundingBox();
    if (!box) return;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
    if (label) console.log(`      👆 Hover: ${label}`);
    await new Promise(r => setTimeout(r, 600));
  } catch {}
}

/* ── Type in an input field ── */
async function typeInField(page, selector, text, label = '') {
  try {
    await page.waitForSelector(selector, { timeout: 3000 });
    const el = await page.$(selector);
    if (!el) return;
    const box = await el.boundingBox();
    if (!box) return;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
    await new Promise(r => setTimeout(r, 200));
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await new Promise(r => setTimeout(r, 200));
    await page.type(selector, text, { delay: 60 });
    if (label) console.log(`      ⌨️  Typed: "${text}" in ${label}`);
    await new Promise(r => setTimeout(r, 500));
  } catch {}
}

/* ── Smooth scroll ── */
async function smoothScroll(page, direction = 'down') {
  const totalHeight = await page.evaluate(() => document.body.scrollHeight);
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  const scrollStep = direction === 'down' ? 4 : -6;
  const scrollDelay = 12;

  if (direction === 'down') {
    let currentPos = 0;
    while (currentPos < totalHeight - viewportHeight) {
      currentPos += scrollStep;
      await page.evaluate((y) => window.scrollTo({ top: y }), currentPos);
      await new Promise(r => setTimeout(r, scrollDelay));
    }
  } else {
    let currentPos = await page.evaluate(() => window.scrollY);
    while (currentPos > 0) {
      currentPos += scrollStep;
      await page.evaluate((y) => window.scrollTo({ top: Math.max(0, y) }), currentPos);
      await new Promise(r => setTimeout(r, scrollDelay));
    }
  }
  await new Promise(r => setTimeout(r, 800));
}

/* ── Take a labelled screenshot ── */
let ssCounter = 0;
async function screenshot(page, name) {
  ssCounter++;
  const file = `${SCREENSHOT_DIR}/${name}.png`;
  await page.screenshot({ path: file, fullPage: false });
  console.log(`      📸 Screenshot: ${file}`);
  return file;
}

/* ── Template-specific interaction sequences ── */
async function interactWithHome(page, template) {
  console.log(`    🏠 Home page interactions...`);
  await screenshot(page, `${template.tier}-01-home`);

  if (template.name === 'Aurora') {
    // Hover KPI cards
    await hoverElement(page, '[data-reveal]:first-child', 'First KPI card');
    // Click sidebar nav items
    await moveAndClick(page, 'nav button:nth-child(2)', 'Analytics nav');
    await new Promise(r => setTimeout(r, 500));
    await moveAndClick(page, 'nav button:nth-child(1)', 'Dashboard nav');
  } else if (template.name === 'Fjord') {
    // Hover stat cards
    await hoverElement(page, '[data-reveal]:first-child', 'Active Projects card');
    // Click New Project button
    await hoverElement(page, 'button:has(svg)', 'New Project');
  } else if (template.name === 'Tundra') {
    // Hover service rows
    await hoverElement(page, '.divide-y > div:first-child', 'api-gateway service');
    await hoverElement(page, '.divide-y > div:nth-child(3)', 'ml-inference (degraded)');
  } else if (template.name === 'Solstice') {
    // Hover feature cards
    await hoverElement(page, '[data-reveal].glass-card:first-child', 'First feature card');
    await hoverElement(page, '[data-reveal].glass-card:nth-child(3)', 'Third feature card');
  }

  // Scroll through
  console.log(`    📜 Scrolling home page...`);
  await smoothScroll(page, 'down');
  await screenshot(page, `${template.tier}-02-home-bottom`);
  await smoothScroll(page, 'up');
}

async function interactWithLogin(page, template) {
  console.log(`    🔒 Login page interactions...`);
  await screenshot(page, `${template.tier}-login-initial`);

  // Type in email field
  await typeInField(page, 'input[type="email"]', 'vetle@veggaai.com', 'Email');
  await screenshot(page, `${template.tier}-login-email`);

  // Type in password field
  await typeInField(page, 'input[type="password"]', 'supersecret', 'Password');

  // Toggle password visibility
  const eyeBtn = await page.$('button:has(svg):not([type="submit"])');
  if (eyeBtn) {
    const box = await eyeBtn.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      console.log('      👁️  Toggled password visibility');
      await new Promise(r => setTimeout(r, 600));
    }
  }

  await screenshot(page, `${template.tier}-login-filled`);

  // Hover social login buttons
  await hoverElement(page, 'button:has(svg[viewBox="0 0 24 24"])', 'GitHub login');

  // Click Sign in button (triggers loading spinner)
  await moveAndClick(page, 'button[type="submit"]', 'Sign in');
  await screenshot(page, `${template.tier}-login-loading`);
  await new Promise(r => setTimeout(r, 1500));
}

async function interactWithSettings(page, template) {
  console.log(`    ⚙️  Settings page interactions...`);
  await screenshot(page, `${template.tier}-settings`);

  // Click toggle buttons
  const toggles = await page.$$('button.relative.inline-flex');
  for (let i = 0; i < Math.min(toggles.length, 2); i++) {
    const box = await toggles[i].boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      console.log(`      🔘 Toggled notification #${i + 1}`);
      await new Promise(r => setTimeout(r, 500));
    }
  }
  await screenshot(page, `${template.tier}-settings-toggled`);

  // Hover API key reveal button
  await hoverElement(page, 'button:has-text("Reveal")', 'Reveal API key');
  
  // Scroll to danger zone
  await smoothScroll(page, 'down');
  await screenshot(page, `${template.tier}-settings-danger`);
}

/* ── Main ── */
await mkdir(SCREENSHOT_DIR, { recursive: true });

const targetIdx = process.argv[2] !== undefined ? parseInt(process.argv[2]) : -1;
const templatesToRun = targetIdx >= 0 ? [TEMPLATES[targetIdx]] : TEMPLATES;

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║   🎯  VINEXT INTERACTIVE TOUR — Mouse + Keyboard    ║');
console.log(`║   ${templatesToRun.length} template(s) • Real Chrome • Visible cursor     ║`);
console.log('╚══════════════════════════════════════════════════════╝\n');

const browser = await puppeteer.launch({
  headless: false,
  defaultViewport: { width: 1920, height: 1080 },
  slowMo: 50,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--window-size=1920,1080',
    '--window-position=0,0',
    '--start-maximized',
  ],
});

const results = [];

for (let i = 0; i < templatesToRun.length; i++) {
  const t = templatesToRun[i];
  const tag = `${t.stackId}-${t.tier}`;
  console.log(`\n━━━ [${i + 1}/${templatesToRun.length}] ${t.name} — ${t.desc} ━━━`);
  console.log(`    Deploying ${tag}...`);

  let result = { name: t.name, tag, ok: false };

  try {
    const d = await deploy(t.stackId, t.tier);
    console.log(`    Pipeline: ${d.steps}`);
    result.port = d.port;
    result.projectId = d.projectId;

    if (!d.port) {
      console.log('    ❌ No port — server did not start');
      results.push(result);
      continue;
    }

    console.log(`    ✅ Live on http://localhost:${d.port}`);
    const page = await browser.newPage();

    // Navigate to home
    await page.goto(`http://localhost:${d.port}`, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    await new Promise(r => setTimeout(r, 3000));

    // Inject visible cursor
    await injectVisibleCursor(page);
    console.log('    🔴 Cursor injected');

    // Phase 1: Home page interactions
    await interactWithHome(page, t);

    // Phase 2: Visit sub-pages
    for (const subPage of t.subPages) {
      console.log(`    📄 Navigating to ${subPage}...`);
      try {
        await page.goto(`http://localhost:${d.port}${subPage}`, {
          waitUntil: 'networkidle2',
          timeout: 15000,
        });
        await new Promise(r => setTimeout(r, 2000));
        await injectVisibleCursor(page);

        if (subPage === '/login') {
          await interactWithLogin(page, t);
        } else if (subPage === '/settings') {
          await interactWithSettings(page, t);
        } else {
          // Generic sub-page tour
          await screenshot(page, `${t.tier}-${subPage.slice(1)}`);
          await smoothScroll(page, 'down');
          await screenshot(page, `${t.tier}-${subPage.slice(1)}-scrolled`);
          await smoothScroll(page, 'up');
        }
      } catch (err) {
        console.log(`      ⚠️  Could not load ${subPage}: ${err.message}`);
      }
    }

    // Return to home for final screenshot
    await page.goto(`http://localhost:${d.port}`, {
      waitUntil: 'networkidle2',
      timeout: 15000,
    });
    await new Promise(r => setTimeout(r, 1500));
    await screenshot(page, `${t.tier}-final`);

    result.ok = true;
    console.log(`    ✅ Tour complete for ${t.name}`);

    // Hold view
    await new Promise(r => setTimeout(r, 3000));
    await page.close();

    // Clean up sandbox
    await destroy(d.projectId);
    console.log(`    🧹 Sandbox cleaned`);

  } catch (err) {
    console.log(`    ❌ Error: ${err.message}`);
    if (result.projectId) await destroy(result.projectId);
  }

  results.push(result);
}

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║                    TOUR RESULTS                      ║');
console.log('╠══════════════════════════════════════════════════════╣');
for (const r of results) {
  const status = r.ok ? '✅ PASS' : '❌ FAIL';
  console.log(`║  ${status}  ${r.name.padEnd(10)} ${r.tag.padEnd(24)} ║`);
}
console.log('╚══════════════════════════════════════════════════════╝');

const passed = results.filter(r => r.ok).length;
console.log(`\n${passed}/${templatesToRun.length} templates toured successfully.\n`);
console.log(`📸 Screenshots saved to ${SCREENSHOT_DIR}/\n`);

await new Promise(r => setTimeout(r, 3000));
await browser.close();
