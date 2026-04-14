/**
 * drive-chrome-build.mjs — Visual Chrome automation + manual code review
 *
 * Drives YOUR Chrome, sends the build prompt, then:
 * 1. Waits for Vai response
 * 2. Reads the response text via API
 * 3. Reviews every file Vai wrote
 * 4. Checks code quality, animations, auth, tabs
 * 5. Screenshots each phase
 * 6. Opens the live preview so you can see the app
 */

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRIVER = path.join(__dirname, 'chrome-ui-driver.ps1');
const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots', 'verify-fitness-e2e');
if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });

const API = 'http://localhost:3006';

function ps(args) {
  const cmd = `powershell -ExecutionPolicy Bypass -File "${DRIVER}" ${args}`;
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 15000 }).trim();
  } catch (err) {
    console.error(`[ps] ${err.stderr?.slice(0, 200) || err.message}`);
    return '';
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function apiFetch(path) {
  const res = await fetch(`${API}${path}`);
  return res.json();
}

function logSection(title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

async function main() {
  logSection('PHASE 1: Visual Chrome Automation');

  // Step 1: Focus VeggaAI
  console.log('[1] Focusing VeggaAI Chrome window...');
  ps('-Title "VeggaAI"');
  await sleep(1200);
  ps(`-ScreenshotPath "${path.join(SCREENSHOT_DIR, 'drive-01-focused.png')}"`);

  // Step 2: Builder mode
  console.log('[2] Ctrl+3 → Builder mode');
  ps('-Keys "^3"');
  await sleep(800);

  // Step 3: Click textarea
  console.log('[3] Clicking chat input...');
  ps('-RelativeClickX 400 -RelativeClickY -80');
  await sleep(500);

  // Step 4: Type the prompt
  const prompt = 'Build me a polished fitness and meal planning dashboard with Google auth';
  console.log(`[4] Typing: "${prompt}"`);
  ps(`-TypeText "${prompt}"`);
  await sleep(400);
  ps(`-ScreenshotPath "${path.join(SCREENSHOT_DIR, 'drive-02-typed.png')}"`);

  // Step 5: Send
  console.log('[5] Enter → Sending...');
  ps('-PressEnter');
  console.log('[5] ✓ Sent! Watching response...\n');

  // Wait for Vai to respond — check via API
  let responseText = '';
  let convId = '';
  for (let i = 0; i < 20; i++) {
    await sleep(3000);
    const sec = (i + 1) * 3;

    // Take screenshot every 9s
    if (sec % 9 === 0) {
      ps(`-ScreenshotPath "${path.join(SCREENSHOT_DIR, `drive-03-streaming-${sec}s.png`)}"`);
      console.log(`  ... ${sec}s`);
    }

    // Check conversations for the latest one
    try {
      const convs = await apiFetch('/api/conversations?limit=1');
      if (convs.length > 0 && convs[0].mode === 'builder') {
        convId = convs[0].id;
        const msgs = await apiFetch(`/api/conversations/${convId}/messages`);
        const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant');
        if (lastAssistant && lastAssistant.content.length > 50) {
          responseText = lastAssistant.content;
          console.log(`  ✓ Got response (${responseText.length} chars) at ${sec}s`);
          break;
        }
      }
    } catch { /* still streaming */ }
  }

  ps(`-ScreenshotPath "${path.join(SCREENSHOT_DIR, 'drive-04-response-done.png')}"`);

  // ═══════════════════════════════════════════════════════
  logSection('PHASE 2: Review Vai Response');
  // ═══════════════════════════════════════════════════════

  if (!responseText) {
    console.log('⚠ No response captured — checking sandbox directly...');
  } else {
    // Count code blocks
    const codeBlocks = responseText.match(/```[\s\S]*?```/g) || [];
    const fileBlocks = responseText.match(/```\w+\s+title="([^"]+)"/g) || [];
    console.log(`[review] Response length: ${responseText.length} chars`);
    console.log(`[review] Code blocks: ${codeBlocks.length}`);
    console.log(`[review] File blocks (title="path"): ${fileBlocks.length}`);

    // Extract file paths
    const filePaths = [...responseText.matchAll(/title="([^"]+)"/g)].map(m => m[1]);
    console.log(`[review] Files generated: ${filePaths.join(', ')}`);

    // Check for key patterns
    const checks = {
      'Has package.json': filePaths.includes('package.json'),
      'Has main entry': filePaths.some(f => f.includes('main') || f.includes('App')),
      'Has styles': filePaths.some(f => f.includes('style') || f.includes('css')),
      'Has React import': responseText.includes('import React') || responseText.includes("from 'react'"),
      'Has auth code': responseText.includes('auth') || responseText.includes('Auth'),
      'Has fitness content': responseText.includes('fitness') || responseText.includes('workout') || responseText.includes('meal'),
      'Has animations': responseText.includes('animation') || responseText.includes('transition') || responseText.includes('animate'),
      'No console.log spam': (responseText.match(/console\.log/g) || []).length < 5,
    };

    console.log('\n[review] Quality checks:');
    let allPass = true;
    for (const [check, ok] of Object.entries(checks)) {
      console.log(`  ${ok ? '✓' : '✗'} ${check}`);
      if (!ok) allPass = false;
    }
    console.log(allPass ? '\n✓ All quality checks passed!' : '\n⚠ Some checks failed');
  }

  // ═══════════════════════════════════════════════════════
  logSection('PHASE 3: Review Sandbox Files');
  // ═══════════════════════════════════════════════════════

  // Wait a bit for auto-sandbox to process
  console.log('[sandbox] Waiting for auto-sandbox pipeline...');
  await sleep(10000);

  // Check sandbox state
  const sandboxes = await apiFetch('/api/sandbox');
  const running = sandboxes.filter(p => p.status === 'running');
  console.log(`[sandbox] Running projects: ${running.length}`);

  for (const proj of running) {
    const details = await apiFetch(`/api/sandbox/${proj.id}`);
    console.log(`\n[sandbox] "${details.name}" on port ${details.devPort}`);
    console.log(`[sandbox] Files: ${details.files.length}`);

    // Read and review key files
    for (const filePath of details.files.slice(0, 10)) {
      if (filePath.includes('node_modules') || filePath.endsWith('.lock')) continue;

      try {
        const fileData = await apiFetch(`/api/sandbox/${proj.id}/file?path=${encodeURIComponent(filePath)}`);
        const content = fileData.content || '';
        const lineCount = content.split('\n').length;

        // Quick quality checks per file
        const issues = [];
        if (content.includes('TODO') || content.includes('FIXME')) issues.push('has TODO/FIXME');
        if (content.includes('any') && filePath.endsWith('.tsx')) issues.push('uses "any" type');
        if (lineCount > 300) issues.push(`long file (${lineCount} lines)`);

        const status = issues.length === 0 ? '✓' : '⚠';
        console.log(`  ${status} ${filePath} (${lineCount} lines) ${issues.join(', ')}`);
      } catch {
        console.log(`  ? ${filePath} (could not read)`);
      }
    }

    // Verify the dev server responds
    if (details.devPort) {
      try {
        const res = await fetch(`http://localhost:${details.devPort}/`);
        console.log(`\n[sandbox] HTTP ${res.status} from localhost:${details.devPort}`);
      } catch (err) {
        console.log(`[sandbox] ⚠ localhost:${details.devPort} not responding: ${err.message}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  logSection('PHASE 4: Visual Verification');
  // ═══════════════════════════════════════════════════════

  // Click the Preview tab in the builder panel
  console.log('[visual] Clicking Preview tab...');
  // Preview button is in the top-right area of the window
  ps('-RelativeClickX 520 -RelativeClickY 22');
  await sleep(2000);
  ps(`-ScreenshotPath "${path.join(SCREENSHOT_DIR, 'drive-05-preview.png')}"`);

  // Click Code tab
  console.log('[visual] Clicking Code tab...');
  ps('-RelativeClickX 555 -RelativeClickY 22');
  await sleep(1500);
  ps(`-ScreenshotPath "${path.join(SCREENSHOT_DIR, 'drive-06-code-view.png')}"`);

  // Wait and take final screenshots
  await sleep(5000);
  ps(`-ScreenshotPath "${path.join(SCREENSHOT_DIR, 'drive-07-final.png')}"`);

  logSection('COMPLETE');
  console.log(`Screenshots saved to: ${SCREENSHOT_DIR}`);
  console.log('Chrome stays open — inspect everything yourself.');
}

main().catch(err => {
  console.error('[drive] Fatal:', err);
  process.exit(1);
});
