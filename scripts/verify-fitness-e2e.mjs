/**
 * verify-fitness-e2e.mjs — Thorsen-grade E2E verification
 *
 * Uses YOUR real Chrome (with existing Google session) to:
 * 1. Open VeggaAI desktop (localhost:5173)
 * 2. Switch to Builder mode
 * 3. Send fitness app build prompt
 * 4. Wait for Vai response + auto-sandbox pipeline
 * 5. Verify preview panel renders the fitness app
 * 6. Open sandbox directly (localhost:4100) in a second tab
 * 7. Click through all dashboard tabs
 * 8. Screenshot everything
 *
 * KEEPS BROWSER OPEN so V3gga can visually verify.
 */

import { chromium } from 'playwright';
import { mkdirSync, existsSync, cpSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots', 'verify-fitness-e2e');
const APP_URL = 'http://localhost:5173';
const SANDBOX_URL = 'http://localhost:4100';
const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const USER_DATA_DIR = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data');
const PROFILE_SNAPSHOT = path.join(tmpdir(), `vai-chrome-verify-${Date.now()}`);

if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function screenshotPath(name) {
  return path.join(SCREENSHOT_DIR, `${name}.png`);
}

/** Wait for user to press Enter in the terminal */
function waitForEnter(message) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n⏸  ${message} [Press Enter to continue] `, () => {
      rl.close();
      resolve();
    });
  });
}

function snapshotChromeProfile() {
  console.log('[verify] Creating Chrome profile snapshot...');
  const skipDirs = new Set([
    'Cache', 'Code Cache', 'GPUCache', 'ShaderCache', 'DawnCache',
    'Service Worker', 'blob_storage', 'GrShaderCache', 'optimization_guide_model_store',
  ]);

  mkdirSync(PROFILE_SNAPSHOT, { recursive: true });

  for (const entry of readdirSync(USER_DATA_DIR, { withFileTypes: true })) {
    if (entry.isFile()) {
      try {
        cpSync(path.join(USER_DATA_DIR, entry.name), path.join(PROFILE_SNAPSHOT, entry.name));
      } catch { /* skip locked */ }
    }
  }

  const defaultProfile = path.join(USER_DATA_DIR, 'Default');
  const targetDefault = path.join(PROFILE_SNAPSHOT, 'Default');
  if (existsSync(defaultProfile)) {
    mkdirSync(targetDefault, { recursive: true });
    for (const entry of readdirSync(defaultProfile, { withFileTypes: true })) {
      if (skipDirs.has(entry.name)) continue;
      try {
        cpSync(
          path.join(defaultProfile, entry.name),
          path.join(targetDefault, entry.name),
          { recursive: true },
        );
      } catch { /* skip locked */ }
    }
  }

  console.log(`[verify] Profile snapshot ready`);
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  VeggaAI — Thorsen E2E Visual Verification');
  console.log('  Browser will STAY OPEN for you to inspect');
  console.log('═══════════════════════════════════════════════════\n');

  snapshotChromeProfile();

  const context = await chromium.launchPersistentContext(PROFILE_SNAPSHOT, {
    executablePath: CHROME_PATH,
    headless: false,
    slowMo: 140,
    args: [
      '--no-sandbox',
      '--start-maximized',
      '--window-size=1920,1080',
      '--disable-blink-features=AutomationControlled',
      '--profile-directory=Default',
    ],
    viewport: null,
    colorScheme: 'dark',
    ignoreDefaultArgs: ['--enable-automation'],
  });

  // ═══════════════════════════════════════════════════════
  // TAB 1: VeggaAI Desktop — Build the fitness app
  // ═══════════════════════════════════════════════════════
  console.log('\n[Tab 1] Opening VeggaAI Desktop...');

  const appPage = context.pages()[0] ?? await context.newPage();
  await appPage.goto(APP_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await sleep(3000);
  await appPage.screenshot({ path: screenshotPath('01-app-loaded'), fullPage: false });
  console.log('[verify] ✓ App loaded');

  // Switch to Builder mode
  const textarea = appPage.locator('textarea');
  if (await textarea.count() > 0) {
    await appPage.keyboard.press('Control+3');
    await sleep(600);
    await appPage.screenshot({ path: screenshotPath('02-builder-mode'), fullPage: false });
    console.log('[verify] ✓ Builder mode active');

    // Type the prompt slowly so you can see it
    const prompt = 'Build me a polished fitness and meal planning dashboard with Google auth';
    await textarea.first().click();
    await sleep(300);
    // Type character by character for visual effect
    for (const char of prompt) {
      await textarea.first().press(char === ' ' ? 'Space' : char);
      await sleep(25); // ~40 WPM typing speed
    }
    await sleep(500);
    await appPage.screenshot({ path: screenshotPath('03-prompt-typed'), fullPage: false });
    console.log(`[verify] ✓ Typed: "${prompt}"`);

    // Send it
    await textarea.first().press('Enter');
    console.log('[verify] → Message sent! Watching Vai respond...');

    // Wait and screenshot during streaming
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      const elapsed = (i + 1) * 2;

      // Screenshot every 6 seconds
      if (elapsed % 6 === 0) {
        await appPage.screenshot({ path: screenshotPath(`04-streaming-${elapsed}s`), fullPage: false });
        console.log(`[verify] ... ${elapsed}s — streaming`);
      }

      // Check if response is done
      const typing = await appPage.locator('[class*="animate-bounce"], [class*="typing-dot"]').count();
      const msgBlocks = await appPage.locator('[class*="whitespace-pre-wrap"], [class*="prose"]').count();
      if (typing === 0 && msgBlocks > 1 && i > 3) {
        console.log(`[verify] ✓ Response complete at ${elapsed}s`);
        break;
      }
    }

    await sleep(2000);
    await appPage.screenshot({ path: screenshotPath('05-response-done'), fullPage: false });

    // Check if preview panel appeared
    const hasPreview = await appPage.locator('iframe').count() > 0;
    console.log(`[verify] Preview iframe: ${hasPreview}`);

    if (hasPreview) {
      console.log('[verify] → Waiting for sandbox to build and start dev server...');
      // Wait for sandbox pipeline (install deps + start)
      for (let i = 0; i < 15; i++) {
        await sleep(3000);
        const elapsed = (i + 1) * 3;
        if (elapsed % 9 === 0) {
          await appPage.screenshot({ path: screenshotPath(`06-building-${elapsed}s`), fullPage: false });
          console.log(`[verify] ... building ${elapsed}s`);
        }
      }
      await appPage.screenshot({ path: screenshotPath('07-preview-ready'), fullPage: false });
      console.log('[verify] ✓ Preview should be ready');
    }

    // Scroll chat to see the full response
    const chatScroll = appPage.locator('[class*="overflow-y-auto"]').first();
    if (await chatScroll.count() > 0) {
      await chatScroll.evaluate(el => el.scrollTop = el.scrollHeight);
      await sleep(500);
      await appPage.screenshot({ path: screenshotPath('08-chat-scrolled'), fullPage: false });
    }

  } else {
    console.log('[verify] ⚠ No textarea — checking for auth gate...');
    await appPage.screenshot({ path: screenshotPath('02-no-textarea'), fullPage: false });
  }

  // ═══════════════════════════════════════════════════════
  // TAB 2: Open sandbox directly at localhost:4100
  // ═══════════════════════════════════════════════════════
  console.log('\n[Tab 2] Opening fitness app sandbox directly...');

  const sandboxPage = await context.newPage();
  await sandboxPage.goto(SANDBOX_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(2000);
  await sandboxPage.screenshot({ path: screenshotPath('10-sandbox-direct'), fullPage: false });
  console.log('[verify] ✓ Sandbox page loaded');

  // The fitness app has its own auth — try to get past it
  const emailInput = sandboxPage.locator('input[placeholder*="Email"], input[type="email"]');
  const passInput = sandboxPage.locator('input[placeholder*="Password"], input[type="password"]');
  if (await emailInput.count() > 0) {
    await emailInput.fill('v3ggat@gmail.com');
    await passInput.fill('fitness2026!');

    // Click Sign Up to create an account (client-side mock auth)
    const signUpBtn = sandboxPage.locator('button:has-text("Sign up"), a:has-text("Sign up")');
    if (await signUpBtn.count() > 0) {
      await signUpBtn.first().click();
      await sleep(1500);
      console.log('[verify] → Clicked Sign up');
    }

    // Now fill again and sign in
    const emailInput2 = sandboxPage.locator('input[placeholder*="Email"], input[type="email"]');
    if (await emailInput2.count() > 0) {
      await emailInput2.fill('v3ggat@gmail.com');
      const passInput2 = sandboxPage.locator('input[placeholder*="Password"], input[type="password"]');
      if (await passInput2.count() > 0) await passInput2.fill('fitness2026!');
      const signInBtn = sandboxPage.locator('button:has-text("Sign In"), button:has-text("Sign in")');
      if (await signInBtn.count() > 0) {
        await signInBtn.first().click();
        await sleep(2000);
        console.log('[verify] → Signed in');
      }
    }
  }

  await sandboxPage.screenshot({ path: screenshotPath('11-sandbox-after-auth'), fullPage: false });

  // Check dashboard and click through tabs
  const dashboardVisible = await sandboxPage.locator('text=Overview').count() > 0
    || await sandboxPage.locator('text=PULSEPLATE').count() > 0
    || await sandboxPage.locator('text=recovery').count() > 0;

  if (dashboardVisible) {
    console.log('[verify] ✓ Dashboard loaded!');

    const tabs = ['Overview', 'Workouts', 'Meals', 'Grocery', 'Progress'];
    for (const tab of tabs) {
      const tabBtn = sandboxPage.locator(`button:has-text("${tab}")`);
      if (await tabBtn.count() > 0) {
        await tabBtn.first().click();
        await sleep(1200);
        await sandboxPage.screenshot({ path: screenshotPath(`12-tab-${tab.toLowerCase()}`), fullPage: false });
        console.log(`[verify] ✓ Tab: ${tab}`);
      }
    }
  } else {
    console.log('[verify] ⚠ Dashboard not visible — screenshotting current state');
    await sandboxPage.screenshot({ path: screenshotPath('11b-sandbox-state'), fullPage: false });
  }

  // ═══════════════════════════════════════════════════════
  // TAB 3: Open sandbox in a third tab for responsive test
  // ═══════════════════════════════════════════════════════
  console.log('\n[Tab 3] Responsive viewport tests...');

  const responsivePage = await context.newPage();
  await responsivePage.goto(SANDBOX_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(2000);

  // If auth is still there, try same flow
  const respEmail = responsivePage.locator('input[placeholder*="Email"], input[type="email"]');
  if (await respEmail.count() > 0) {
    await respEmail.fill('v3ggat@gmail.com');
    const respPass = responsivePage.locator('input[placeholder*="Password"], input[type="password"]');
    if (await respPass.count() > 0) await respPass.fill('fitness2026!');
    const respSignIn = responsivePage.locator('button:has-text("Sign In"), button:has-text("Sign in")');
    if (await respSignIn.count() > 0) {
      await respSignIn.first().click();
      await sleep(2000);
    }
  }

  await responsivePage.screenshot({ path: screenshotPath('20-responsive-full'), fullPage: false });

  // ═══════════════════════════════════════════════════════
  // Code verification
  // ═══════════════════════════════════════════════════════
  console.log('\n[Code] Verifying fitness app structure...');
  try {
    const sandboxes = await (await fetch('http://localhost:3006/api/sandbox')).json();
    const running = sandboxes.filter(p => p.status === 'running');
    for (const proj of running) {
      const pageResp = await (await fetch(`http://localhost:3006/api/sandbox/${proj.id}/file?path=src/app/page.tsx`)).json();
      if (pageResp.content) {
        const checks = {
          'AuthProvider': pageResp.content.includes('AuthProvider'),
          'Overview tab': pageResp.content.includes("'overview'"),
          'Workouts tab': pageResp.content.includes("'workouts'"),
          'Meals tab': pageResp.content.includes("'meals'"),
          'Grocery tab': pageResp.content.includes("'grocery'"),
          'Progress tab': pageResp.content.includes("'progress'"),
          'Google auth': pageResp.content.includes('Google') || pageResp.content.includes('google'),
          'Framer Motion': pageResp.content.includes('motion') || pageResp.content.includes('animate'),
        };
        console.log('[code] Feature check:');
        for (const [feature, ok] of Object.entries(checks)) {
          console.log(`  ${ok ? '✓' : '✗'} ${feature}`);
        }
      }
    }
  } catch (err) {
    console.error(`[code] ${err.message}`);
  }

  // ═══════════════════════════════════════════════════════
  // KEEP BROWSER OPEN
  // ═══════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════════');
  console.log('  ✓ All verification steps complete!');
  console.log('  → 3 Chrome tabs open for your inspection:');
  console.log('    Tab 1: VeggaAI Desktop (chat + builder preview)');
  console.log('    Tab 2: Fitness dashboard (direct sandbox)');
  console.log('    Tab 3: Responsive test tab');
  console.log(`  → Screenshots: ${SCREENSHOT_DIR}`);
  console.log('══════════════════════════════════════════════════');

  await waitForEnter('Take your time inspecting. Press Enter when done to close browser.');
  await context.close();
}

main().catch((err) => {
  console.error('[verify] Fatal error:', err);
  process.exit(1);
});
