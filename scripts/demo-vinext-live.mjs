#!/usr/bin/env node
/**
 * demo-vinext-live.mjs — Live browser demo of all 4 Vinext premium templates.
 *
 * Deploys each template, opens it in a VISIBLE Chrome window (headless: false),
 * scrolls through the page slowly so v3gga can see every section,
 * takes a full-page screenshot, then moves to the next template.
 *
 * Usage: node scripts/demo-vinext-live.mjs
 */

import puppeteer from 'puppeteer';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API = 'http://localhost:3006';
const SCREENSHOT_DIR = './screenshots/templates';
const DEPLOY_TIMEOUT = 180_000;

const TEMPLATES = [
  { stackId: 'vinext', tier: 'basic',          name: 'Aurora',   desc: 'AI Analytics Command Center' },
  { stackId: 'vinext', tier: 'solid',           name: 'Fjord',    desc: 'Creative Studio & Portfolio' },
  { stackId: 'vinext', tier: 'battle-tested',   name: 'Tundra',   desc: 'Infrastructure Monitoring Console' },
  { stackId: 'vinext', tier: 'vai',             name: 'Solstice', desc: 'Subscription Commerce Platform' },
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

/* ── Smooth scroll helper ── */
async function smoothScrollDemo(page) {
  const totalHeight = await page.evaluate(() => document.body.scrollHeight);
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  const scrollStep = 3;     // pixels per tick
  const scrollDelay = 12;   // ms between ticks — nice and smooth

  let currentPos = 0;
  while (currentPos < totalHeight - viewportHeight) {
    currentPos += scrollStep;
    await page.evaluate((y) => window.scrollTo({ top: y }), currentPos);
    await new Promise(r => setTimeout(r, scrollDelay));
  }

  // Pause at bottom
  await new Promise(r => setTimeout(r, 1500));

  // Scroll back to top smoothly
  while (currentPos > 0) {
    currentPos -= scrollStep * 2;
    await page.evaluate((y) => window.scrollTo({ top: Math.max(0, y) }), currentPos);
    await new Promise(r => setTimeout(r, scrollDelay));
  }

  await new Promise(r => setTimeout(r, 1000));
}

/* ── Navigate to sub-pages ── */
async function visitSubPages(page, port) {
  // Find all internal nav links
  const links = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    return anchors
      .map(a => a.getAttribute('href'))
      .filter(h => h && h.startsWith('/') && !h.startsWith('/api') && h !== '/')
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .slice(0, 3); // max 3 sub-pages
  });

  for (const link of links) {
    console.log(`      📄 Visiting ${link}`);
    try {
      await page.goto(`http://localhost:${port}${link}`, { waitUntil: 'networkidle2', timeout: 15000 });
      await new Promise(r => setTimeout(r, 2000));
      await smoothScrollDemo(page);
    } catch (err) {
      console.log(`      ⚠️  Could not load ${link}: ${err.message}`);
    }
  }

  // Return to home
  try {
    await page.goto(`http://localhost:${port}`, { waitUntil: 'networkidle2', timeout: 15000 });
    await new Promise(r => setTimeout(r, 1000));
  } catch {}
}

/* ── Main ── */
await mkdir(SCREENSHOT_DIR, { recursive: true });

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║   🚀  VINEXT PREMIUM TEMPLATES — LIVE DEMO          ║');
console.log('║   4 SaaS products • Real Chrome • Visible browser   ║');
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

for (let i = 0; i < TEMPLATES.length; i++) {
  const t = TEMPLATES[i];
  const tag = `${t.stackId}-${t.tier}`;
  console.log(`\n━━━ [${i + 1}/4] ${t.name} — ${t.desc} ━━━`);
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
    console.log(`    🌐 Opening in Chrome...`);

    const page = await browser.newPage();
    
    // Navigate to the template
    await page.goto(`http://localhost:${d.port}`, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Let it fully render + hydrate
    await new Promise(r => setTimeout(r, 4000));

    console.log(`    📜 Scrolling through ${t.name}...`);
    await smoothScrollDemo(page);

    // Take home screenshot
    const ssHome = `${SCREENSHOT_DIR}/vinext-${t.tier}-home.png`;
    await page.screenshot({ path: ssHome, fullPage: false });
    console.log(`    📸 Screenshot: ${ssHome}`);

    // Visit sub-pages
    console.log(`    🔗 Visiting sub-pages...`);
    await visitSubPages(page, d.port);

    // Take a full-page screenshot at the end
    const ssFull = `${SCREENSHOT_DIR}/vinext-${t.tier}-full.png`;
    await page.screenshot({ path: ssFull, fullPage: true });
    console.log(`    📸 Full-page: ${ssFull}`);

    result.ok = true;

    // Keep page open briefly so user can look
    console.log(`    👁️  Holding view for 3 seconds...`);
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
console.log('║                    DEMO RESULTS                      ║');
console.log('╠══════════════════════════════════════════════════════╣');
for (const r of results) {
  const status = r.ok ? '✅ PASS' : '❌ FAIL';
  console.log(`║  ${status}  ${r.name.padEnd(10)} ${r.tag.padEnd(24)} ║`);
}
console.log('╚══════════════════════════════════════════════════════╝');

const passed = results.filter(r => r.ok).length;
console.log(`\n${passed}/4 templates demoed successfully.\n`);

// Keep browser open for a few more seconds
await new Promise(r => setTimeout(r, 3000));
await browser.close();
