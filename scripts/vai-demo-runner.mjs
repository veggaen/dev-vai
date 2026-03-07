#!/usr/bin/env node
/**
 * Vai Demo Runner — Executes demo.sequence.json via Selenium WebDriver.
 *
 * This script:
 * 1. Reads a demo.sequence.json from the template
 * 2. Connects to Selenium Chrome (with VNC for visual debugging)
 * 3. Executes each action (move, click, type, assert, screenshot)
 * 4. Reports pass/fail for each assertion (dual: demo + validation)
 * 5. Captures screenshots at key moments
 *
 * Environment:
 *   APP_URL          — The app URL (default: http://localhost:4100)
 *   SELENIUM_URL     — Selenium hub (default: http://localhost:4444/wd/hub)
 *   DEMO_SEQUENCE    — Path to demo.sequence.json
 *   SCREENSHOT_DIR   — Where to save screenshots (default: ./screenshots)
 *
 * Can run standalone or inside Docker Compose.
 */

import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Builder, By, until, Key } from 'selenium-webdriver';
import { Options } from 'selenium-webdriver/chrome.js';

const APP_URL = process.env.APP_URL || 'http://localhost:4100';
const SELENIUM_URL = process.env.SELENIUM_URL || 'http://localhost:4444/wd/hub';
const SEQUENCE_PATH = process.env.DEMO_SEQUENCE || './demo.sequence.json';
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || './screenshots';

const COLORS = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m',
};
const c = (color, text) => `${COLORS[color]}${text}${COLORS.reset}`;

// ── Load sequence ──
let sequence;
try {
  sequence = JSON.parse(readFileSync(SEQUENCE_PATH, 'utf-8'));
  console.log(c('cyan', `\n  ╔══════════════════════════════════════╗`));
  console.log(c('cyan', `  ║`) + c('bold', `  🤖 Vai Demo Runner`) + c('cyan', `                 ║`));
  console.log(c('cyan', `  ╚══════════════════════════════════════╝\n`));
  console.log(c('dim', `  Sequence: ${SEQUENCE_PATH}`));
  console.log(c('dim', `  Actions:  ${sequence.length}`));
  console.log(c('dim', `  App URL:  ${APP_URL}`));
  console.log('');
} catch (err) {
  console.error(c('red', `  ✗ Failed to load sequence: ${err.message}`));
  process.exit(1);
}

// ── Ensure screenshot dir ──
if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ── Build driver ──
async function main() {
  const chromeOptions = new Options();
  chromeOptions.addArguments('--no-sandbox', '--disable-dev-shm-usage', '--window-size=1920,1080');

  let driver;
  try {
    driver = await new Builder()
      .forBrowser('chrome')
      .setChromeOptions(chromeOptions)
      .usingServer(SELENIUM_URL)
      .build();
  } catch (err) {
    // Fallback: try local Chrome
    console.log(c('yellow', `  ⚠ Selenium hub not available, trying local Chrome...`));
    try {
      driver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(chromeOptions)
        .build();
    } catch (err2) {
      console.error(c('red', `  ✗ No browser available: ${err2.message}`));
      process.exit(1);
    }
  }

  let passed = 0;
  let failed = 0;
  let total = sequence.length;

  try {
    // Navigate to app
    console.log(c('blue', `  → Navigating to ${APP_URL}...`));
    await driver.get(APP_URL);
    await driver.sleep(2000); // Wait for React hydration

    for (let i = 0; i < sequence.length; i++) {
      const action = sequence[i];
      const stepNum = `[${i + 1}/${total}]`;

      try {
        switch (action.type) {
          case 'wait':
            console.log(c('dim', `  ${stepNum} wait ${action.duration || 1000}ms`));
            await driver.sleep(action.duration || 1000);
            break;

          case 'tooltip':
            console.log(c('cyan', `  ${stepNum} 💬 ${action.message}`));
            // Inject tooltip overlay into the page
            await driver.executeScript(`
              const tip = document.createElement('div');
              tip.textContent = ${JSON.stringify(action.message || '')};
              tip.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#18181b;color:#e4e4e7;padding:12px 24px;border-radius:12px;border:1px solid #3f3f46;font-size:14px;z-index:99999;animation:fadeIn 0.3s;box-shadow:0 8px 32px rgba(0,0,0,0.5)';
              document.body.appendChild(tip);
              setTimeout(() => tip.remove(), ${action.duration || 2000});
            `);
            await driver.sleep(action.duration || 2000);
            break;

          case 'move':
            if (action.target) {
              console.log(c('dim', `  ${stepNum} move → ${action.target}`));
              const el = await driver.findElement(By.css(action.target));
              await driver.actions().move({ origin: el }).perform();
            }
            break;

          case 'click':
            console.log(c('blue', `  ${stepNum} click → ${action.target}`));
            if (action.target) {
              const el = await driver.wait(until.elementLocated(By.css(action.target)), 5000);
              await driver.wait(until.elementIsVisible(el), 3000);
              await el.click();
            }
            break;

          case 'type':
            console.log(c('blue', `  ${stepNum} type "${action.value}" → ${action.target}`));
            if (action.target && action.value) {
              const el = await driver.wait(until.elementLocated(By.css(action.target)), 5000);
              await el.clear();
              // Type character by character for realistic feel
              for (const char of action.value) {
                await el.sendKeys(char);
                await driver.sleep(30 + Math.random() * 50); // Human-like typing speed
              }
            }
            break;

          case 'hover':
            if (action.target) {
              console.log(c('dim', `  ${stepNum} hover → ${action.target}`));
              const el = await driver.findElement(By.css(action.target));
              await driver.actions().move({ origin: el }).perform();
              await driver.sleep(500);
            }
            break;

          case 'scroll':
            console.log(c('dim', `  ${stepNum} scroll`));
            await driver.executeScript('window.scrollBy(0, 300)');
            await driver.sleep(500);
            break;

          case 'assert-visible': {
            const assertTarget = action.target;
            try {
              const el = await driver.wait(until.elementLocated(By.css(assertTarget)), 5000);
              await driver.wait(until.elementIsVisible(el), 3000);
              console.log(c('green', `  ${stepNum} ✓ ASSERT visible: ${action.message || assertTarget}`));
              passed++;
            } catch {
              console.log(c('red', `  ${stepNum} ✗ ASSERT visible FAILED: ${action.message || assertTarget}`));
              failed++;
            }
            break;
          }

          case 'assert-text': {
            try {
              const el = await driver.wait(until.elementLocated(By.css(action.target)), 5000);
              const text = await el.getText();
              if (text.includes(action.value)) {
                console.log(c('green', `  ${stepNum} ✓ ASSERT text contains "${action.value}"`));
                passed++;
              } else {
                console.log(c('red', `  ${stepNum} ✗ ASSERT text FAILED: expected "${action.value}", got "${text.slice(0, 50)}"`));
                failed++;
              }
            } catch (err) {
              console.log(c('red', `  ${stepNum} ✗ ASSERT text FAILED: ${err.message}`));
              failed++;
            }
            break;
          }

          case 'screenshot': {
            const filename = `step-${String(i).padStart(3, '0')}-${(action.message || 'screenshot').replace(/[^a-zA-Z0-9]/g, '-').slice(0, 40)}.png`;
            const filepath = join(SCREENSHOT_DIR, filename);
            const png = await driver.takeScreenshot();
            const { writeFileSync } = await import('node:fs');
            writeFileSync(filepath, png, 'base64');
            console.log(c('yellow', `  ${stepNum} 📸 ${action.message || 'Screenshot saved'} → ${filename}`));
            break;
          }

          default:
            console.log(c('dim', `  ${stepNum} skip unknown action: ${action.type}`));
        }
      } catch (err) {
        console.log(c('red', `  ${stepNum} ✗ ${action.type} failed: ${err.message}`));
        failed++;
        // Take error screenshot
        try {
          const png = await driver.takeScreenshot();
          const { writeFileSync } = await import('node:fs');
          writeFileSync(join(SCREENSHOT_DIR, `error-step-${i}.png`), png, 'base64');
        } catch {}
      }
    }

    // Final screenshot
    const png = await driver.takeScreenshot();
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(SCREENSHOT_DIR, 'final.png'), png, 'base64');

  } finally {
    await driver.quit();
  }

  // ── Report ──
  console.log('');
  console.log(c('bold', '  ══════════════════════════════════'));
  console.log(c('bold', '  Demo Results'));
  console.log(c('bold', '  ══════════════════════════════════'));
  console.log(c('green', `  ✓ Passed: ${passed}`));
  if (failed > 0) console.log(c('red', `  ✗ Failed: ${failed}`));
  console.log(c('dim', `  Total actions: ${total}`));
  console.log(c('dim', `  Screenshots: ${SCREENSHOT_DIR}/`));
  console.log('');

  if (failed > 0) {
    console.log(c('red', '  ⚠ Some assertions failed — check screenshots for details.'));
    process.exit(1);
  } else {
    console.log(c('green', '  ✅ All assertions passed! Template is working correctly.'));
  }
}

main().catch(err => {
  console.error(c('red', `  Fatal: ${err.message}`));
  process.exit(1);
});
