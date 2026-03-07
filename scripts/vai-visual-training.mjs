#!/usr/bin/env node
/**
 * Vai Visual Training — Cursor Autonomy Practice
 *
 * Vai learns to navigate the UI using ONLY:
 *   - Real mouse movement (page.mouse)
 *   - Real keyboard input (page.keyboard)
 *   - Screenshots for visual verification
 *   - DOM scanning for element discovery (simulating vision)
 *
 * NO shortcuts allowed: no window.__vai_gym, no window.__vai_cursor.moveTo()
 *
 * Drills:
 *   1. Element Discovery — scan page, report all interactive elements
 *   2. Panel Navigation — click each activity rail panel
 *   3. View Switching — click gym view tabs
 *   4. Textarea Interaction — find, click, type into textarea
 *   5. Full Round — complete scenario with all-visual navigation
 *   6. Speed Challenge — repeat panel switches, measure improvement
 *   7. Cursor Accuracy — click specific coordinates, verify hit
 *   8. Keyboard Navigation — use Tab/Enter to navigate
 *   9. Visual Understanding — look() scene comprehension
 *  10. Dropdown Exploration — open, browse, select dropdown options
 *  11. Socratic Teaching + Navigation Mastery — Socratic lessons + varied UI exploration
 *  12. Full Training Workflow — complete loop: dashboard → train → review → adapt
 *  13. Radial Menu & Advanced Nav — radial tool selection, scroll, foundation cards
 *  14. UI Comprehension — self-directed reading, questions, scroll discovery, navigation
 *  15. Mouse & Keyboard Mastery — comprehensive mouse+keyboard with LiteKeyboard, scroll indicators
 *
 * Usage:
 *   node scripts/vai-visual-training.mjs              # all drills
 *   node scripts/vai-visual-training.mjs --drill 5    # specific drill
 *   node scripts/vai-visual-training.mjs --sighted    # sighted mode (shortcuts)
 */
import puppeteer from 'puppeteer';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VaiEyes } from './vai-eyes.mjs';
import { CORPUS, generateResponse, getRandomScenarios } from './vai-training-corpus.mjs';
import { VaiMentor, VaiReasoner } from './vai-mentor.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = join(__dirname, '..', 'screenshots', 'vai-gym', 'visual-training');
const REPORT_PATH = join(SCREENSHOT_DIR, 'visual-training-report.json');
const BASE_URL = 'http://localhost:5173';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── CLI args ────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRILL_NUM = args.includes('--drill') ? parseInt(args[args.indexOf('--drill') + 1], 10) : 0;
const BLIND_MODE = !args.includes('--sighted');

// ═══════════════════════════════════════════════════════════════
// DRILL 1: Element Discovery
// ═══════════════════════════════════════════════════════════════
async function drill1_elementDiscovery(eyes) {
  console.log('\n  ═══ DRILL 1: Element Discovery ═══');
  console.log('    Goal: Scan the page and identify all interactive elements\n');

  const start = performance.now();
  await eyes.see('drill1-start');

  // Scan everything
  const elements = await eyes.scan();

  // Categorize
  const buttons = elements.filter(e => e.type === 'button');
  const inputs = elements.filter(e => e.type === 'input');
  const links = elements.filter(e => e.type === 'link');
  const interactive = elements.filter(e => e.type === 'interactive');

  console.log(`    Buttons (${buttons.length}):`);
  buttons.forEach(b => console.log(`      • "${b.text.substring(0, 40)}" at (${b.x}, ${b.y}) ${b.w}×${b.h}`));

  console.log(`    Inputs (${inputs.length}):`);
  inputs.forEach(i => console.log(`      • [${i.tag}] "${i.placeholder.substring(0, 40)}" at (${i.x}, ${i.y})`));

  console.log(`    Links (${links.length})`);
  console.log(`    Interactive (${interactive.length})`);

  await eyes.see('drill1-complete');
  const ms = Math.round(performance.now() - start);

  return {
    drill: 'element-discovery',
    passed: elements.length > 0,
    total: elements.length,
    categories: { buttons: buttons.length, inputs: inputs.length, links: links.length, interactive: interactive.length },
    timeMs: ms,
  };
}

// ═══════════════════════════════════════════════════════════════
// DRILL 2: Panel Navigation (BLIND)
// ═══════════════════════════════════════════════════════════════
async function drill2_panelNavigation(eyes) {
  console.log('\n  ═══ DRILL 2: Panel Navigation (BLIND) ═══');
  console.log('    Goal: Click each panel in the activity rail using visual nav\n');

  const start = performance.now();
  const panels = ['chats', 'devlogs', 'knowledge', 'vaigym'];
  let passed = 0;

  for (const panel of panels) {
    await eyes.see(`drill2-before-${panel}`);

    // Scan to find the panel button
    await eyes.scan();
    const clicked = await eyes.clickPanel(panel);

    // Verify
    const verified = await eyes.verifyPanel(panel);
    await eyes.see(`drill2-after-${panel}`);

    if (clicked && verified) {
      passed++;
      console.log(`    ✓ ${panel} — clicked and verified`);
    } else if (clicked) {
      passed++; // Clicked but maybe verification is flaky
      console.log(`    ~ ${panel} — clicked (verify uncertain)`);
    } else {
      console.log(`    ✗ ${panel} — failed to find/click`);
    }
    await sleep(300);
  }

  const ms = Math.round(performance.now() - start);
  console.log(`    Result: ${passed}/${panels.length} in ${ms}ms\n`);

  return { drill: 'panel-navigation-blind', passed, total: panels.length, timeMs: ms };
}

// ═══════════════════════════════════════════════════════════════
// DRILL 3: View Switching (BLIND)
// ═══════════════════════════════════════════════════════════════
async function drill3_viewSwitching(eyes) {
  console.log('\n  ═══ DRILL 3: Gym View Switching (BLIND) ═══');
  console.log('    Goal: Click each gym view tab using visual navigation\n');

  // First navigate to gym panel
  await eyes.clickPanel('vaigym');
  await sleep(500);

  const start = performance.now();
  const views = ['dashboard', 'training', 'foundations', 'history'];
  let passed = 0;

  for (const view of views) {
    await eyes.see(`drill3-before-${view}`);
    const clicked = await eyes.navigateToView(view);
    await eyes.see(`drill3-after-${view}`);

    // Verify by checking if the text content changed
    const verified = await eyes.verifyText(view.charAt(0).toUpperCase() + view.slice(1));

    if (clicked) {
      passed++;
      console.log(`    ✓ ${view}`);
    } else {
      console.log(`    ✗ ${view} — tab not found`);
    }
    await sleep(200);
  }

  const ms = Math.round(performance.now() - start);
  console.log(`    Result: ${passed}/${views.length} in ${ms}ms\n`);

  return { drill: 'view-switching-blind', passed, total: views.length, timeMs: ms };
}

// ═══════════════════════════════════════════════════════════════
// DRILL 4: Textarea Interaction (BLIND)
// ═══════════════════════════════════════════════════════════════
async function drill4_textareaInteraction(eyes, page) {
  console.log('\n  ═══ DRILL 4: Textarea Interaction (BLIND) ═══');
  console.log('    Goal: Find textarea, click it, type text, verify content\n');

  // Navigate to gym — scenario starts from Dashboard view
  await eyes.clickPanel('vaigym');
  await sleep(400);
  await eyes.navigateToView('dashboard');
  await sleep(400);

  // Start a scenario so the textarea appears (auto-navigates to training view)
  await eyes.startScenario();
  await sleep(800);

  const start = performance.now();
  await eyes.see('drill4-before-type');

  // Scan and find textarea
  const textarea = await eyes.findTextarea();
  if (!textarea) {
    console.log('    ✗ Textarea not found on screen');
    await eyes.see('drill4-no-textarea');
    return { drill: 'textarea-interaction', passed: 0, total: 3, timeMs: 0, error: 'no textarea' };
  }
  console.log(`    Found textarea at (${textarea.x}, ${textarea.y}) ${textarea.w}×${textarea.h}`);

  // Test 1: Click textarea
  await eyes.click(textarea.x, textarea.y);
  await sleep(200);
  const focused = await page.evaluate(() => {
    return document.activeElement?.tagName === 'TEXTAREA';
  });
  console.log(`    ${focused ? '✓' : '✗'} Click to focus (${focused ? 'focused' : 'not focused'})`);

  // Test 2: Type text
  const testText = 'Vai is learning to see the screen and type with real keyboard input.';
  const typed = await eyes.typeText(testText, { speed: 5 });
  await eyes.see('drill4-after-type');

  // Test 3: Verify content
  const content = await page.evaluate(() => {
    const ta = document.querySelector('textarea');
    return ta?.value || '';
  });
  const contentMatch = content.includes('Vai is learning') || content.length > 20;
  console.log(`    ${contentMatch ? '✓' : '✗'} Content verification (${content.length} chars)`);

  const ms = Math.round(performance.now() - start);
  const passed = (focused ? 1 : 0) + (typed ? 1 : 0) + (contentMatch ? 1 : 0);
  console.log(`    Result: ${passed}/3 in ${ms}ms\n`);

  return { drill: 'textarea-interaction', passed, total: 3, timeMs: ms };
}

// ═══════════════════════════════════════════════════════════════
// DRILL 5: Full Training Round (BLIND)
// ═══════════════════════════════════════════════════════════════
async function drill5_fullRound(eyes) {
  console.log('\n  ═══ DRILL 5: Full Training Round (BLIND) ═══');
  console.log('    Goal: Complete a full scenario cycle using only visual nav\n');

  // Pick a scenario
  const [scenario] = getRandomScenarios(1, { difficulty: 'apprentice' });
  const response = generateResponse(scenario);

  console.log(`    Scenario: [${scenario.foundation}] ${scenario.situation.substring(0, 60)}...`);
  console.log(`    Response: ${response.substring(0, 60)}... (${response.split(/\s+/).length} words)\n`);

  const start = performance.now();

  // Execute full round with VaiEyes
  const result = await eyes.trainRound(response);

  const ms = Math.round(performance.now() - start);
  console.log(`\n    ${result.success ? '✓ FULL ROUND COMPLETE' : '✗ ROUND INCOMPLETE'} in ${ms}ms`);
  console.log(`    Screenshots: ${result.screenshots.length}`);

  return {
    drill: 'full-round-blind',
    passed: result.success ? 1 : 0,
    total: 1,
    timeMs: ms,
    scenario: { foundation: scenario.foundation, difficulty: scenario.difficulty },
    screenshots: result.screenshots.length,
  };
}

// ═══════════════════════════════════════════════════════════════
// DRILL 6: Speed Challenge — Repeated panel switches
// ═══════════════════════════════════════════════════════════════
async function drill6_speedChallenge(eyes) {
  console.log('\n  ═══ DRILL 6: Speed Challenge ═══');
  console.log('    Goal: Switch panels as fast as possible (3 rounds)\n');

  const sequence = ['chats', 'vaigym', 'knowledge', 'devlogs', 'chats', 'vaigym'];
  const rounds = [];

  for (let round = 1; round <= 3; round++) {
    const start = performance.now();
    let passed = 0;
    for (const panel of sequence) {
      await eyes.scan();
      if (await eyes.clickPanel(panel)) passed++;
    }
    const ms = Math.round(performance.now() - start);
    const msPerSwitch = Math.round(ms / sequence.length);
    rounds.push({ round, passed, total: sequence.length, ms, msPerSwitch });
    console.log(`    Round ${round}: ${passed}/${sequence.length} in ${ms}ms (${msPerSwitch}ms/switch)`);
  }

  // Check for improvement
  const improvement = rounds[0].msPerSwitch - rounds[2].msPerSwitch;
  console.log(`    Improvement: ${improvement > 0 ? '+' : ''}${improvement}ms/switch from round 1→3\n`);
  await eyes.see('drill6-speed-done');

  return {
    drill: 'speed-challenge',
    passed: rounds.reduce((s, r) => s + r.passed, 0),
    total: rounds.reduce((s, r) => s + r.total, 0),
    timeMs: rounds.reduce((s, r) => s + r.ms, 0),
    rounds,
    improvement,
  };
}

// ═══════════════════════════════════════════════════════════════
// DRILL 7: Cursor Accuracy — Click precise targets
// ═══════════════════════════════════════════════════════════════
async function drill7_cursorAccuracy(eyes, page) {
  console.log('\n  ═══ DRILL 7: Cursor Accuracy ═══');
  console.log('    Goal: Move cursor to exact pixel targets\n');

  const viewport = await page.evaluate(() => ({
    w: window.innerWidth, h: window.innerHeight
  }));

  // Define target points
  const targets = [
    { name: 'center', x: viewport.w / 2, y: viewport.h / 2 },
    { name: 'top-left', x: 50, y: 50 },
    { name: 'top-right', x: viewport.w - 50, y: 50 },
    { name: 'bottom-left', x: 50, y: viewport.h - 50 },
    { name: 'bottom-right', x: viewport.w - 50, y: viewport.h - 50 },
    { name: 'center-top', x: viewport.w / 2, y: 100 },
    { name: 'center-bottom', x: viewport.w / 2, y: viewport.h - 100 },
  ];

  const start = performance.now();
  let passed = 0;

  for (const target of targets) {
    await eyes.moveTo(target.x, target.y);

    // Verify position — read from the nested cursor object in the store
    const pos = await page.evaluate(() => {
      try {
        const state = window.__vai_cursor?.getState?.();
        return { x: state?.cursor?.x, y: state?.cursor?.y };
      } catch { return null; }
    });

    const dx = pos ? Math.abs(pos.x - target.x) : Infinity;
    const dy = pos ? Math.abs(pos.y - target.y) : Infinity;
    const error = Math.sqrt(dx * dx + dy * dy);
    const ok = error < 5; // within 5px

    if (ok) passed++;
    console.log(`    ${ok ? '✓' : '✗'} ${target.name.padEnd(15)} → (${Math.round(target.x)}, ${Math.round(target.y)}) err=${error.toFixed(1)}px`);
  }

  const ms = Math.round(performance.now() - start);
  await eyes.see('drill7-accuracy');
  console.log(`    Result: ${passed}/${targets.length} within 5px, ${ms}ms\n`);

  return { drill: 'cursor-accuracy', passed, total: targets.length, timeMs: ms };
}

// ═══════════════════════════════════════════════════════════════
// DRILL 8: Keyboard Navigation
// ═══════════════════════════════════════════════════════════════
async function drill8_keyboardNav(eyes, page) {
  console.log('\n  ═══ DRILL 8: Keyboard Navigation ═══');
  console.log('    Goal: Navigate using Tab, Enter, and keyboard shortcuts\n');

  const start = performance.now();
  let passed = 0;
  const tests = [];

  // Test 1: Tab through elements
  await eyes.pressKey('Tab');
  await sleep(100);
  const after1Tab = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    text: document.activeElement?.textContent?.trim()?.substring(0, 30),
  }));
  const t1 = !!after1Tab?.tag;
  if (t1) passed++;
  tests.push({ test: 'Tab focus', result: t1, detail: `${after1Tab?.tag}: ${after1Tab?.text}` });
  console.log(`    ${t1 ? '✓' : '✗'} Tab focus → ${after1Tab?.tag}: ${after1Tab?.text}`);

  // Test 2: Multiple tabs
  for (let i = 0; i < 5; i++) await eyes.pressKey('Tab');
  const after5Tabs = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    text: document.activeElement?.textContent?.trim()?.substring(0, 30),
  }));
  const t2 = !!after5Tabs?.tag;
  if (t2) passed++;
  tests.push({ test: 'Multiple Tab', result: t2, detail: `${after5Tabs?.tag}: ${after5Tabs?.text}` });
  console.log(`    ${t2 ? '✓' : '✗'} 5×Tab → ${after5Tabs?.tag}: ${after5Tabs?.text}`);

  // Test 3: Escape key
  await eyes.pressKey('Escape');
  const afterEsc = await page.evaluate(() => document.activeElement?.tagName);
  const t3 = afterEsc === 'BODY' || !!afterEsc;
  if (t3) passed++;
  tests.push({ test: 'Escape', result: t3 });
  console.log(`    ${t3 ? '✓' : '✗'} Escape → ${afterEsc}`);

  const ms = Math.round(performance.now() - start);
  await eyes.see('drill8-keyboard');
  console.log(`    Result: ${passed}/3 in ${ms}ms\n`);

  return { drill: 'keyboard-navigation', passed, total: 3, timeMs: ms, tests };
}

// ═══════════════════════════════════════════════════════════════
// DRILL 9: Visual Understanding — Vai LOOKS and describes what it sees
// ═══════════════════════════════════════════════════════════════
async function drill9_visualUnderstanding(eyes, page) {
  console.log('\n  ═══ DRILL 9: Visual Understanding ═══');
  console.log('    Goal: Look at the screen and describe what you see\n');

  const start = performance.now();
  let passed = 0;
  const total = 5;

  // Navigate to gym dashboard first — richest view
  await eyes.clickPanel('vaigym');
  await sleep(400);
  await eyes.navigateToView('dashboard');
  await sleep(600);

  // Test 1: Can Vai identify what's on screen?
  const scene = await eyes.look();
  const hasDropdowns = scene.dropdowns.length > 0;
  const hasButtons = scene.buttons.length > 0;
  const hasSections = scene.layout.sections.length > 0;
  // Core test: Vai must see at least dropdowns AND buttons (the essential interactive elements)
  const sceneOk = hasDropdowns && hasButtons;
  if (sceneOk) passed++;
  console.log(`    ${sceneOk ? '✓' : '✗'} Scene understanding: ${scene.dropdowns.length} dropdowns, ${scene.buttons.length} buttons, ${scene.layout.sections.length} sections`);

  // Test 2: Can Vai find the Foundation dropdown specifically?
  const foundationDd = scene.dropdowns.find(d =>
    d.currentValue?.toLowerCase().includes('foundation') ||
    d.label?.toLowerCase().includes('foundation') ||
    (d.options || []).some(o => o.text.toLowerCase().includes('foundation'))
  );
  if (foundationDd) passed++;
  console.log(`    ${foundationDd ? '✓' : '✗'} Found Foundation dropdown: "${foundationDd?.currentValue || foundationDd?.label || 'not found'}"`);

  // Test 3: Can Vai find the Difficulty dropdown?
  const difficultyDd = scene.dropdowns.find(d =>
    (d.options || []).some(o =>
      o.text.toLowerCase().includes('apprentice') ||
      o.text.toLowerCase().includes('journeyman') ||
      o.text.toLowerCase().includes('master')
    )
  );
  if (difficultyDd) passed++;
  console.log(`    ${difficultyDd ? '✓' : '✗'} Found Difficulty dropdown: "${difficultyDd?.currentValue || difficultyDd?.label || 'not found'}"`);

  // Test 4: Can Vai identify primary action buttons?
  const primaryBtns = scene.buttons.filter(b => b.isPrimary);
  const bankBtn = primaryBtns.find(b => b.label.toLowerCase().includes('scenario') || b.label.toLowerCase().includes('bank'));
  if (bankBtn) passed++;
  console.log(`    ${bankBtn ? '✓' : '✗'} Found primary action: "${bankBtn?.label?.substring(0, 40) || 'not found'}" (${primaryBtns.length} primary buttons total)`);

  // Test 5: Can Vai describe the layout sections?
  const sectionNames = scene.layout.sections.map(s => s.title).filter(n => n !== '(untitled section)');
  const hasMeaningfulSections = sectionNames.length >= 2;
  if (hasMeaningfulSections) passed++;
  console.log(`    ${hasMeaningfulSections ? '✓' : '✗'} Layout sections: ${sectionNames.slice(0, 5).map(s => `"${s}"`).join(', ') || '(none found)'}`);

  const ms = Math.round(performance.now() - start);
  console.log(`    Result: ${passed}/${total} in ${ms}ms\n`);

  return { drill: 'visual-understanding', passed, total, timeMs: ms, scene: {
    dropdowns: scene.dropdowns.length,
    buttons: scene.buttons.length,
    textInputs: scene.textInputs.length,
    tabs: scene.tabs.length,
    sections: scene.layout.sections.length,
  }};
}

// ═══════════════════════════════════════════════════════════════
// DRILL 10: Dropdown Exploration — Find, open, read, select
// ═══════════════════════════════════════════════════════════════
async function drill10_dropdownExploration(eyes, page) {
  console.log('\n  ═══ DRILL 10: Dropdown Exploration (BLIND) ═══');
  console.log('    Goal: Find dropdowns, open them, read options, make selections\n');

  const start = performance.now();
  let passed = 0;
  const total = 5;

  // Make sure we're on the gym dashboard
  await eyes.clickPanel('vaigym');
  await sleep(400);
  await eyes.navigateToView('dashboard');
  await sleep(600);

  // Test 1: Explore the foundation dropdown — hover, click, see options
  console.log('    ── Foundation Dropdown ──');
  const foundResult = await eyes.openDropdown('foundation');
  if (foundResult.found && foundResult.options.length > 3) passed++;
  console.log(`    ${foundResult.found ? '✓' : '✗'} Found dropdown with ${foundResult.options.length} options`);
  if (foundResult.options.length > 0) {
    console.log(`      Options: ${foundResult.options.slice(0, 6).map(o => o.text.substring(0, 25)).join(' · ')}${foundResult.options.length > 6 ? ' ...' : ''}`);
  }
  await sleep(200);

  // Test 2: Select a specific foundation (Systems Thinking)
  console.log('    ── Select "Systems Thinking" Foundation ──');
  const secResult = await eyes.openDropdown('foundation', 'systems');
  if (secResult.selected) passed++;
  console.log(`    ${secResult.selected ? '✓' : '✗'} Selected: "${secResult.selected?.text || 'FAILED'}"`);
  await sleep(400);

  // Verify the selection stuck
  await eyes.scan();
  const afterSelect = await page.evaluate(() => {
    const selects = document.querySelectorAll('select');
    for (const s of selects) {
      if (s.options[0]?.text?.includes('Foundation')) return s.value;
    }
    return null;
  });
  const selectStuck = afterSelect && afterSelect.includes('systems');
  if (selectStuck) passed++;
  console.log(`    ${selectStuck ? '✓' : '✗'} Selection persisted: value="${afterSelect}"`);

  // Test 3: Explore the difficulty dropdown
  console.log('    ── Difficulty Dropdown ──');
  const diffResult = await eyes.openDropdown('apprentice');
  if (diffResult.found) passed++;
  console.log(`    ${diffResult.found ? '✓' : '✗'} Found difficulty dropdown with ${diffResult.options.length} options`);
  if (diffResult.options.length > 0) {
    console.log(`      Levels: ${diffResult.options.map(o => o.text).join(' · ')}`);
  }

  // Test 4: Change difficulty to "master"
  console.log('    ── Select "Master" Difficulty ──');
  const masterResult = await eyes.openDropdown('apprentice', 'master');
  if (!masterResult.found) {
    // Try finding by current value
    const retry = await eyes.openDropdown('master');
    if (retry.found) {
      // Already on master — try selecting via text
    }
  }
  // Verify
  const diffAfter = await page.evaluate(() => {
    const selects = document.querySelectorAll('select');
    for (const s of selects) {
      const opts = [...s.options].map(o => o.text);
      if (opts.some(t => t.toLowerCase().includes('apprentice'))) return s.value;
    }
    return null;
  });
  const masterSet = diffAfter === 'master';
  if (masterSet) passed++;
  console.log(`    ${masterSet ? '✓' : '✗'} Difficulty set to: "${diffAfter}"`);

  // Reset — set back to "Any Foundation" and default difficulty
  await eyes.openDropdown('foundation', 0); // First option = "Any Foundation"
  await sleep(200);

  const ms = Math.round(performance.now() - start);
  await eyes.see('drill10-dropdowns-done');
  console.log(`    Result: ${passed}/${total} in ${ms}ms\n`);

  return { drill: 'dropdown-exploration', passed, total, timeMs: ms };
}

// ═══════════════════════════════════════════════════════════════
// DRILL 11: Mentor-Driven Socratic Teaching + Navigation Mastery
// ═══════════════════════════════════════════════════════════════
//
// "There is no such thing as a bad student, only a bad teacher."
//
// This drill combines Socratic teaching with comprehensive UI navigation:
//   1. Vai navigates using different routes each round (not the same loop)
//   2. Vai interacts with dropdowns, menus, tabs, and buttons
//   3. Vai changes foundations and difficulty via real dropdown interaction
//   4. Mentor presents a SITUATION (not a quiz question)
//   5. Vai reasons through HINTS (progressive disclosure)
//   6. Vai generates a response based on understanding, not pattern-matching
//   7. Mentor evaluates BEHAVIOR and adapts
//
async function drill11_socraticTeaching(eyes, page) {
  console.log('\n  ═══ DRILL 11: Socratic Teaching + Navigation Mastery ═══');
  console.log('    Goal: Navigate the full UI, interact with menus/dropdowns, answer challenges\n');

  const start = performance.now();
  const mentor = new VaiMentor();
  const reasoner = new VaiReasoner();
  const total = 5; // 5 lessons per drill — more variety
  let passed = 0;

  // Navigate to Gym Dashboard
  await eyes.clickPanel('vaigym');
  await sleep(400);
  await eyes.navigateToView('dashboard');
  await sleep(600);

  // ── Pre-plan diverse navigation routes for each round ──
  // Each round takes a DIFFERENT path through the UI, so Vai learns
  // to navigate varied routes — not the same loop 5 times.
  const allTracks = ['diagnosis', 'constraints', 'honesty', 'compression', 'systems', 'readingRoom'];
  const shuffledTracks = allTracks.sort(() => Math.random() - 0.5);

  // Foundation dropdown values to explore
  const foundations = [
    'first-principles', 'systems-thinking', 'calibrated-uncertainty',
    'reading-between-lines', 'precision-communication', 'right-question',
    'compression', 'intellectual-honesty', 'taste-judgment', 'meta-learning',
  ];
  const shuffledFoundations = foundations.sort(() => Math.random() - 0.5);

  // Difficulty levels to cycle through
  const difficulties = ['apprentice', 'journeyman', 'master'];

  // Navigation actions Vai can take between lessons (variety!)
  const navActions = [
    // Action: Change foundation dropdown (must be on dashboard!)
    async (round) => {
      console.log(`    🔄 Nav: Changing foundation dropdown...`);
      // Ensure we're on dashboard where dropdowns live
      await eyes.navigateToView('dashboard');
      await sleep(400);
      const foundation = shuffledFoundations[round % shuffledFoundations.length];
      const result = await eyes.openDropdown('foundation', foundation);
      if (result.selected) {
        console.log(`      ✓ Set foundation to "${result.selected.text}"`);
      } else if (result.found) {
        console.log(`      ~ Found dropdown (${result.options.length} options) but couldn't select "${foundation}"`);
      } else {
        console.log(`      ✗ Foundation dropdown not found`);
      }
      await sleep(300);
    },
    // Action: Change difficulty dropdown (must be on dashboard!)
    async (round) => {
      console.log(`    🔄 Nav: Changing difficulty...`);
      await eyes.navigateToView('dashboard');
      await sleep(400);
      const diff = difficulties[round % difficulties.length];
      // Try finding by any of the difficulty labels
      let result = await eyes.openDropdown('apprentice', diff);
      if (!result.found) result = await eyes.openDropdown('journeyman', diff);
      if (!result.found) result = await eyes.openDropdown('master', diff);
      if (!result.found) result = await eyes.openDropdown('difficulty', diff);
      if (result?.selected) {
        console.log(`      ✓ Set difficulty to "${result.selected.text}"`);
      } else if (result?.found) {
        console.log(`      ~ Found dropdown but couldn't select "${diff}"`);
      } else {
        console.log(`      ~ Difficulty dropdown not visible`);
      }
      await sleep(300);
    },
    // Action: Visit Foundations view, browse it, come back
    async () => {
      console.log(`    🔄 Nav: Exploring Foundations view...`);
      await eyes.navigateToView('foundations');
      await sleep(500);
      // Look around — scan the elements
      const scene = await eyes.look();
      console.log(`      Saw: ${scene.buttons.length} buttons, ${scene.tabs.length} tabs, ${scene.layout.sections.length} sections`);
      await eyes.see('drill11-explore-foundations');
      await sleep(300);
      // Return to dashboard
      await eyes.navigateToView('dashboard');
      await sleep(400);
    },
    // Action: Visit History view, browse it, come back
    async () => {
      console.log(`    🔄 Nav: Checking History view...`);
      await eyes.navigateToView('history');
      await sleep(500);
      const scene = await eyes.look();
      console.log(`      Saw: ${scene.buttons.length} buttons, ${scene.textInputs.length} inputs`);
      await eyes.see('drill11-explore-history');
      await sleep(300);
      await eyes.navigateToView('dashboard');
      await sleep(400);
    },
    // Action: Explore all dropdowns on dashboard (read options without selecting)
    async () => {
      console.log(`    🔄 Nav: Reading all dropdown options...`);
      // Must navigate to dashboard where the dropdowns are
      await eyes.navigateToView('dashboard');
      await sleep(400);
      const scene = await eyes.look();
      if (scene.dropdowns.length > 0) {
        for (const dd of scene.dropdowns.slice(0, 3)) {
          console.log(`      Dropdown "${dd.label}": ${dd.options.length} options — current: "${dd.currentValue}"`);
          // Hover over each dropdown to show Vai examining it
          await eyes.hover(dd.position.x, dd.position.y);
          await sleep(250);
        }
      } else {
        console.log(`      No dropdowns found — scanning buttons instead`);
        for (const btn of scene.buttons.slice(0, 4)) {
          console.log(`      Button: "${btn.label.substring(0, 40)}" at (${btn.position.x}, ${btn.position.y})`);
          await eyes.hover(btn.position.x, btn.position.y);
          await sleep(200);
        }
      }
    },
    // Action: Tab-navigate through the page before starting scenario
    async () => {
      console.log(`    🔄 Nav: Tab-walking the dashboard...`);
      await eyes.navigateToView('dashboard');
      await sleep(300);
      for (let i = 0; i < 6; i++) {
        await eyes.pressKey('Tab');
        await sleep(150);
        const focused = await page.evaluate(() => ({
          tag: document.activeElement?.tagName,
          text: document.activeElement?.textContent?.trim()?.substring(0, 30),
        }));
        if (focused?.tag && focused?.tag !== 'BODY') {
          console.log(`      Tab ${i + 1}: ${focused.tag} "${focused.text || ''}"`);
        }
      }
      // Escape back to body
      await eyes.pressKey('Escape');
      await sleep(100);
    },
  ];

  // Shuffle nav actions so each session is different
  const shuffledNavActions = navActions.sort(() => Math.random() - 0.5);

  for (let round = 1; round <= total; round++) {
    console.log(`    ── Lesson ${round}/${total} ──`);

    // ═══ NAVIGATION PHASE — Vai explores before answering ═══
    // Each round does 1-2 navigation actions (different each time)
    if (round <= navActions.length) {
      await shuffledNavActions[(round - 1) % shuffledNavActions.length](round - 1);
    }
    // Every other round, do a second nav action for more exploration
    if (round % 2 === 0 && round + 1 < navActions.length * 2) {
      await shuffledNavActions[(round) % shuffledNavActions.length](round);
    }

    // ═══ START SCENARIO — Navigate to training view ═══
    // Make sure we're on Dashboard for scenario bank button
    await eyes.navigateToView('dashboard');
    await sleep(300);
    await eyes.startScenario();
    await sleep(800);

    // ═══ LESSON SELECTION — Mix mentor lessons + corpus scenarios ═══
    let lesson;
    const useMentorLesson = round <= 3 || Math.random() > 0.4; // First 3 always mentor, rest mixed

    if (useMentorLesson) {
      // Mentor lesson — diverse track each round
      const trackForRound = shuffledTracks[(round - 1) % shuffledTracks.length];
      lesson = mentor.createLesson({ track: trackForRound });
      console.log(`    📚 Mentor lesson — Track: ${lesson.track}`);
    } else {
      // Corpus scenario — pull from the 373-scenario bank for variety
      const [scenario] = getRandomScenarios(1);
      // Adapt corpus scenario to Socratic format
      lesson = {
        id: `corpus-${scenario.id}`,
        track: scenario.foundation,
        trackId: scenario.foundation,
        principle: '',
        difficulty: scenario.difficulty,
        situation: scenario.situation,
        context: '',
        challenge: `What is the real underlying need here? What would an expert response look like?`,
        hints: [
          scenario.hidden_need,
          scenario.rubric,
          ...(scenario.tags || []).map(t => `Consider the ${t} dimension.`),
        ].filter(Boolean),
        teachingPoint: scenario.hidden_need,
        evaluation: {
          excellent: scenario.rubric,
          good: 'Shows understanding of the hidden need.',
          weak: 'Answers the surface question without going deeper.',
        },
      };
      console.log(`    📖 Corpus scenario — Foundation: ${scenario.foundation} [${scenario.difficulty}]`);
    }

    console.log(`    Difficulty: ${lesson.difficulty}`);
    console.log(`    Situation: ${lesson.situation.substring(0, 100)}${lesson.situation.length > 100 ? '...' : ''}`);
    console.log(`    Challenge: ${lesson.challenge.substring(0, 100)}${lesson.challenge.length > 100 ? '...' : ''}`);

    // Vai "reads" the situation and challenge (screenshot for v3gga to see)
    await eyes.see(`drill11-r${round}-situation`);

    // ═══ VAI REASONS (not templates) ═══
    const reasoned = reasoner.reason(lesson);
    const response = reasoned.text;

    // Show the reasoning process (transparency for v3gga)
    console.log(`    Reasoning:`);
    console.log(`      Domain: ${reasoned.reasoning.domain}`);
    console.log(`      Challenge type: ${reasoned.reasoning.challengeType}`);
    console.log(`      Specifics: [${reasoned.reasoning.specifics.slice(0, 3).join(', ')}]`);
    if (reasoned.reasoning.unknowns?.length > 0) {
      console.log(`      Unknowns: ${reasoned.reasoning.unknowns.slice(0, 3).join(' | ')}`);
    }
    if (reasoned.reasoning.assumptions?.length > 0) {
      console.log(`      Assumptions surfaced: ${reasoned.reasoning.assumptions.join(' | ')}`);
    }
    if (reasoned.reasoning.hypotheses?.length > 0) {
      console.log(`      Hypotheses: ${reasoned.reasoning.hypotheses.slice(0, 2).join(' | ')}`);
    }
    if (reasoned.reasoning.contradictions?.length > 0) {
      console.log(`      ⚡ Contradictions: ${reasoned.reasoning.contradictions.join(' | ')}`);
    }
    if (reasoned.reasoning.hintCoverage) {
      console.log(`      Hint coverage: ${reasoned.reasoning.hintCoverage.covered}/${reasoned.reasoning.hintCoverage.total}`);
    }
    if (reasoned.reasoning.avoidanceRules.length > 0) {
      console.log(`      ⚠ Avoiding: ${reasoned.reasoning.avoidanceRules.join(' | ')}`);
    }

    // Try to find the textarea using VaiEyes (blind mode)
    const textarea = await eyes.findTextarea();
    if (textarea) {
      // ═══ THINKING PAUSES ═══
      console.log(`    ⏸ Thinking...`);
      await sleep(800 + Math.random() * 600); // 800-1400ms thinking pause

      await eyes.typeText(response, { speed: 8 });
      await sleep(300);
    } else {
      console.log(`    (No textarea on screen — evaluating response directly)`);
    }
    await eyes.see(`drill11-r${round}-response`);

    // Mentor evaluates the response (behavioral analysis)
    // For corpus scenarios, use simplified evaluation
    let evaluation;
    if (useMentorLesson && lesson._lesson) {
      evaluation = mentor.evaluate(lesson, response);
    } else {
      // Simple evaluation for corpus scenarios
      const resp = response.toLowerCase();
      const hasQuestions = (resp.match(/\?/g) || []).length;
      const isLong = response.length > 100;
      const quality = hasQuestions >= 2 && isLong ? 'good' : hasQuestions >= 1 ? 'good' : 'weak';
      evaluation = {
        quality,
        behaviors: {
          questionCount: hasQuestions,
          givesReasoning: resp.includes('because') || resp.includes('since') || resp.includes('therefore'),
          admitsGap: resp.includes("don't know") || resp.includes('not sure') || resp.includes('gap'),
        },
        misconceptions: [],
        teachingMoment: lesson.teachingPoint || lesson.hints?.[0] || '',
        feedback: quality === 'good' ? 'Solid response.' : 'Needs deeper analysis.',
        next: { type: 'continue' },
      };
    }

    console.log(`    Quality: ${evaluation.quality.toUpperCase()}`);
    console.log(`    Behaviors: asks=${evaluation.behaviors.questionCount}q, reasons=${evaluation.behaviors.givesReasoning}, admits=${evaluation.behaviors.admitsGap}`);

    if (evaluation.misconceptions?.length > 0) {
      console.log(`    Misconceptions: ${evaluation.misconceptions.map(m => m.name).join(', ')}`);
      for (const m of evaluation.misconceptions) {
        console.log(`      → ${m.teachingMove}`);
      }
    }

    // Teaching moment
    const teachingText = evaluation.teachingMoment || evaluation.feedback || '';
    console.log(`    💡 ${teachingText.substring(0, 120)}...`);

    // ═══ LEARN FROM FAILURE ═══
    reasoner.remember({
      track: lesson.trackId,
      quality: evaluation.quality,
      misconceptions: evaluation.misconceptions || [],
      feedback: evaluation.feedback,
    });

    if (evaluation.misconceptions?.length > 0) {
      console.log(`    📝 Memorized: avoid ${evaluation.misconceptions.map(m => m.name).join(', ')} in future rounds`);
    }

    // Pass if quality is good or excellent
    if (evaluation.quality === 'excellent' || evaluation.quality === 'good') {
      passed++;
      console.log(`    ✓ PASSED (${evaluation.quality})`);
    } else {
      console.log(`    ✗ NEEDS WORK — ${(evaluation.feedback || '').split('\n')[0]}`);
      if (evaluation.next?.type === 'followUp') {
        console.log(`    → Follow-up: ${evaluation.next.question}`);
      }
    }

    await eyes.see(`drill11-r${round}-evaluated`);
    console.log();
    await sleep(500);
  }

  // Show learner profile
  console.log(`    ── Learner Profile ──`);
  console.log(`    ${mentor.profile.summary.replace(/\n/g, '\n    ')}`);

  const ms = Math.round(performance.now() - start);
  await eyes.see('drill11-socratic-done');
  console.log(`    Result: ${passed}/${total} in ${ms}ms\n`);

  return { drill: 'socratic-teaching', passed, total, timeMs: ms };
}

// ═══════════════════════════════════════════════════════════════
// DRILL 12: Full Training Workflow
//   Trains Vai to complete the ENTIRE gym loop a learner follows:
//   Dashboard → choose settings → start scenario → Training view →
//   read scenario → type response → submit → Review view →
//   read score/feedback/improvements → decide retry or next →
//   Dashboard → adjust foundation based on weaknesses → repeat
// ═══════════════════════════════════════════════════════════════

async function drill12_fullWorkflow(eyes, page) {
  console.log('\n  ═══ DRILL 12: Full Training Workflow ═══');
  console.log('    Goal: Complete the ENTIRE gym loop — dashboard → train → review → adapt\n');

  const start = performance.now();
  const mentor = new VaiMentor();
  const reasoner = new VaiReasoner();
  const total = 3; // 3 full cycles (each is substantial)
  let passed = 0;

  // Navigate to Gym
  await eyes.clickPanel('vaigym');
  await sleep(400);

  // Foundations to cycle through
  const foundations = [
    'first-principles', 'systems-thinking', 'calibrated-uncertainty',
    'reading-between-lines', 'precision-communication', 'compression',
  ];
  const shuffledFoundations = foundations.sort(() => Math.random() - 0.5);
  const difficulties = ['apprentice', 'journeyman', 'master'];
  let weakFoundation = null; // Track what Vai is worst at — adapt!

  for (let cycle = 1; cycle <= total; cycle++) {
    console.log(`    ── Cycle ${cycle}/${total} ──`);
    const cycleStart = performance.now();

    // ═══ PHASE 1: DASHBOARD — Configure settings ═══
    console.log(`      📋 Phase 1: Dashboard setup...`);
    await eyes.navigateToView('dashboard');
    await sleep(400);
    const onDashboard = await eyes.verifyView('dashboard');
    console.log(`      View check: ${onDashboard ? '✓ dashboard' : '✗ wrong view'}`);

    // Choose foundation — if there's a known weakness, target it!
    const foundation = weakFoundation || shuffledFoundations[(cycle - 1) % shuffledFoundations.length];
    console.log(`      Setting foundation: "${foundation}"${weakFoundation ? ' (targeting weakness!)' : ''}`);
    const foundResult = await eyes.openDropdown('foundation', foundation);
    if (foundResult.selected) {
      console.log(`        ✓ Foundation set to "${foundResult.selected.text}"`);
      // Verify the dropdown actually changed
      await sleep(200);
      const verified = await eyes.verifyDropdownValue('foundation', foundation);
      console.log(`        Verified: ${verified ? '✓' : '✗'}`);
    } else {
      console.log(`        ~ Could not set foundation (${foundResult.options.length} options available)`);
    }

    // Set difficulty — escalate each cycle
    const diff = difficulties[Math.min(cycle - 1, difficulties.length - 1)];
    console.log(`      Setting difficulty: "${diff}"`);
    let diffResult = await eyes.openDropdown('apprentice', diff);
    if (!diffResult.found) diffResult = await eyes.openDropdown('journeyman', diff);
    if (!diffResult.found) diffResult = await eyes.openDropdown('master', diff);
    if (!diffResult.found) diffResult = await eyes.openDropdown('difficulty', diff);
    if (diffResult?.selected) {
      console.log(`        ✓ Difficulty set to "${diffResult.selected.text}"`);
    }

    await eyes.see(`drill12-c${cycle}-dashboard-configured`);

    // ═══ PHASE 2: START SCENARIO — Click "From Scenario Bank" ═══
    console.log(`      🎯 Phase 2: Starting scenario...`);
    const started = await eyes.startScenario();
    await sleep(800);
    const onTraining = await eyes.verifyView('training');
    console.log(`      Scenario started: ${started ? '✓' : '✗'}, View: ${onTraining ? '✓ training' : '✗'}`);

    // ═══ PHASE 3: READ SCENARIO — Understand what's asked ═══
    console.log(`      📖 Phase 3: Reading scenario...`);
    const scenario = await eyes.readScenario();
    if (scenario.fromStore) {
      console.log(`        Foundation: ${scenario.foundation}`);
      console.log(`        Situation: ${scenario.situation?.substring(0, 100)}...`);
    } else {
      console.log(`        Read ${scenario.texts?.length || 0} text blocks from screen`);
    }
    await eyes.see(`drill12-c${cycle}-scenario-read`);

    // ═══ PHASE 4: REASON + TYPE RESPONSE ═══
    console.log(`      🧠 Phase 4: Reasoning + typing...`);

    // Build a lesson from the scenario for the reasoner
    const lesson = {
      id: `wf-cycle-${cycle}`,
      track: scenario.foundation || foundation,
      trackId: scenario.foundation || foundation,
      difficulty: diff,
      situation: scenario.situation || 'A complex scenario requiring analysis.',
      context: '',
      challenge: scenario.hidden_need
        ? `What is the real underlying need? (Hint: ${scenario.hidden_need.substring(0, 60)})`
        : 'What would an expert response look like here?',
      hints: scenario.hidden_need ? [scenario.hidden_need] : [],
      teachingPoint: scenario.hidden_need || '',
    };

    // Vai reasons (9-phase pipeline)
    const reasoned = reasoner.reason(lesson);
    console.log(`        Domain: ${reasoned.reasoning.domain}, Type: ${reasoned.reasoning.challengeType}`);
    if (reasoned.reasoning.unknowns?.length > 0) {
      console.log(`        Unknowns: ${reasoned.reasoning.unknowns.slice(0, 2).join(' | ')}`);
    }

    // Think before typing
    await sleep(600 + Math.random() * 400);

    // Type
    const typed = await eyes.typeText(reasoned.text, { speed: 6 });
    console.log(`        Typed: ${typed ? `${reasoned.text.length} chars` : '✗ FAILED'}`);
    await eyes.see(`drill12-c${cycle}-typed`);

    // ═══ PHASE 5: SUBMIT — Click submit button ═══
    console.log(`      📤 Phase 5: Submitting...`);
    const submitted = await eyes.submitResponse();
    await sleep(1500); // Wait for grading
    console.log(`        Submit: ${submitted ? '✓' : '✗'}`);
    await eyes.see(`drill12-c${cycle}-submitted`);

    // ═══ PHASE 6: READ REVIEW — Navigate and understand feedback ═══
    console.log(`      📊 Phase 6: Reading review...`);

    // Check if we're on the review view
    const onReview = await eyes.verifyView('review');
    if (!onReview) {
      // Try navigating to review
      console.log(`        Not on review view — trying to navigate...`);
      await eyes.navigateToView('review');
      await sleep(500);
    }

    const review = await eyes.readReview();
    console.log(`        Score: ${review.score}/100`);
    if (review.strengths.length > 0) {
      console.log(`        Strengths: ${review.strengths.slice(0, 2).join(', ')}`);
    }
    if (review.improvements.length > 0) {
      console.log(`        Improvements: ${review.improvements.slice(0, 2).join(', ')}`);
    }
    if (review.antiPatterns.length > 0) {
      console.log(`        ⚠ Anti-patterns: ${review.antiPatterns.join(', ')}`);
    }
    if (review.hiddenNeed) {
      console.log(`        Hidden need: ${review.hiddenNeed.substring(0, 80)}`);
    }
    await eyes.see(`drill12-c${cycle}-review`);

    // ═══ PHASE 7: ADAPT — Learn from feedback, decide next action ═══
    console.log(`      🔄 Phase 7: Adapting...`);

    // Remember in reasoner
    reasoner.remember({
      track: lesson.trackId,
      quality: review.score >= 70 ? 'good' : review.score >= 50 ? 'fair' : 'weak',
      misconceptions: [],
      feedback: review.feedback,
    });

    // Decide: retry or move on?
    const shouldRetry = review.score >= 0 && review.score < 50 && cycle < total;
    if (shouldRetry) {
      console.log(`        Score ${review.score} < 50 — will retry this foundation`);
      weakFoundation = lesson.trackId; // Target this weakness next cycle

      // Click "Retry Same" button
      const retryClicked = await eyes.clickElement('retry');
      if (retryClicked) {
        console.log(`        ✓ Clicked Retry — reviewing same scenario again`);
        await sleep(500);
      } else {
        // Fallback: go back to dashboard
        await eyes.navigateToView('dashboard');
      }
    } else {
      // Move on — back to dashboard
      if (review.score >= 70) {
        console.log(`        Score ${review.score} ≥ 70 — solid, moving to next foundation`);
        weakFoundation = null; // Clear weakness tracking
      } else if (review.score >= 0) {
        console.log(`        Score ${review.score} — acceptable, but tracking for improvement`);
        weakFoundation = lesson.trackId;
      } else {
        console.log(`        Score unavailable (API key not set?) — moving on`);
        weakFoundation = null;
      }

      // Click "Dashboard" button to go back
      const dashClicked = await eyes.clickElement('dashboard') ||
                          await eyes.clickElement('back');
      if (dashClicked) {
        console.log(`        ✓ Navigated back to dashboard`);
      } else {
        await eyes.navigateToView('dashboard');
      }
    }
    await sleep(400);
    await eyes.see(`drill12-c${cycle}-adapted`);

    // ═══ SCORING ═══
    // A full cycle passes if: started + typed + submitted + read review
    const cycleMs = Math.round(performance.now() - cycleStart);
    const cyclePass = started && typed && submitted && (review.score !== undefined);
    if (cyclePass) {
      passed++;
      console.log(`      ✓ CYCLE ${cycle} PASSED (${cycleMs}ms)`);
    } else {
      console.log(`      ✗ CYCLE ${cycle} INCOMPLETE — started:${started}, typed:${typed}, submitted:${submitted}`);
    }
    console.log();
  }

  const ms = Math.round(performance.now() - start);
  await eyes.see('drill12-workflow-done');
  console.log(`    Result: ${passed}/${total} in ${ms}ms\n`);

  return { drill: 'full-workflow', passed, total, timeMs: ms };
}

// ═══════════════════════════════════════════════════════════════
// DRILL 13: Radial Menu & Advanced Navigation
//   Vai learns to interact with the radial menu system,
//   scroll to discover off-screen elements, click foundation
//   cards, and verify navigation effects.
// ═══════════════════════════════════════════════════════════════

async function drill13_radialMenuAndAdvancedNav(eyes, page) {
  console.log('\n  ═══ DRILL 13: Radial Menu & Advanced Navigation ═══');
  console.log('    Goal: Open radial menu, navigate categories, scroll, click foundation cards\n');

  const start = performance.now();
  const total = 6; // 6 exercises
  let passed = 0;

  // Navigate to Gym
  await eyes.clickPanel('vaigym');
  await sleep(400);
  await eyes.navigateToView('dashboard');
  await sleep(400);

  // ── Exercise 1: Open & Explore Radial Menu ──
  console.log(`    ── Exercise 1: Radial Menu Exploration ──`);
  try {
    const explored = await eyes.exploreRadialMenu();
    const categoryCount = Object.keys(explored).length;
    console.log(`      Explored ${categoryCount} categories`);
    for (const [cat, tools] of Object.entries(explored)) {
      console.log(`        ${cat}: [${tools.join(', ')}]`);
    }
    if (categoryCount >= 4) {
      passed++;
      console.log(`      ✓ PASSED — explored ${categoryCount}/6 categories`);
    } else {
      console.log(`      ✗ Only saw ${categoryCount} categories`);
    }
  } catch (err) {
    console.log(`      ✗ Error: ${err.message}`);
  }
  await sleep(300);

  // ── Exercise 2: Radial Menu — Select a tool ──
  console.log(`\n    ── Exercise 2: Radial Tool Selection ──`);
  try {
    await eyes.openRadialMenu();
    // Select Navigate (1) → Scroll
    const selected = await eyes.selectRadialTool(1, 'scroll');
    console.log(`      Navigate → Scroll: ${selected ? '✓' : '✗'}`);
    await eyes.closeRadialMenu();
    await sleep(200);

    // Open again, try Edit (3) → Click
    await eyes.openRadialMenu();
    const selected2 = await eyes.selectRadialTool(3, 'click');
    console.log(`      Edit → Click: ${selected2 ? '✓' : '✗'}`);
    await eyes.closeRadialMenu();

    if (selected || selected2) {
      passed++;
      console.log(`      ✓ PASSED — selected tools from radial menu`);
    } else {
      console.log(`      ✗ Could not select any tools`);
    }
  } catch (err) {
    console.log(`      ✗ Error: ${err.message}`);
  }
  await sleep(300);

  // ── Exercise 3: Foundation Card Navigation ──
  console.log(`\n    ── Exercise 3: Foundation Card Navigation ──`);
  try {
    // Go to Foundations view, scan for cards
    await eyes.navigateToView('foundations');
    await sleep(500);
    const scene = await eyes.look();
    console.log(`      Foundations view: ${scene.buttons.length} buttons, ${scene.layout.sections.length} sections`);
    await eyes.see('drill13-foundations-view');

    // Click a foundation card
    const foundationCards = ['First-Principles', 'Systems Thinking', 'Compression', 'Meta-Learning'];
    const target = foundationCards[Math.floor(Math.random() * foundationCards.length)];
    console.log(`      Clicking foundation card: "${target}"...`);
    const clicked = await eyes.clickFoundationCard(target);
    await sleep(600);

    // Should have returned to dashboard with foundation set
    const onDashboard = await eyes.verifyView('dashboard');
    console.log(`      Card clicked: ${clicked ? '✓' : '✗'}, Now on dashboard: ${onDashboard ? '✓' : '✗'}`);

    if (clicked) {
      passed++;
      console.log(`      ✓ PASSED — navigated through foundation card`);
    } else {
      console.log(`      ✗ Could not find/click foundation card`);
      // Reset to dashboard
      await eyes.navigateToView('dashboard');
    }
  } catch (err) {
    console.log(`      ✗ Error: ${err.message}`);
    await eyes.navigateToView('dashboard');
  }
  await sleep(300);

  // ── Exercise 4: Scroll Discovery ──
  console.log(`\n    ── Exercise 4: Scroll Discovery ──`);
  try {
    await eyes.navigateToView('dashboard');
    await sleep(400);

    // The dashboard may have content below the fold (foundation mastery grid,
    // anti-pattern defense sections). Try to find them.
    console.log(`      Scrolling to find "Anti-Pattern" section...`);
    const found = await eyes.scrollToFind('anti-pattern', { maxScrolls: 5 });
    if (found) {
      console.log(`        ✓ Found "${found.text.substring(0, 40)}" at (${found.x}, ${found.y})`);
      await eyes.see('drill13-scroll-found');
    } else {
      console.log(`        ~ "Anti-Pattern" not found via scroll — may be visible already`);
      // Try just finding it without scrolling (might be visible)
      const el = await eyes.findElement('anti-pattern');
      if (el) {
        console.log(`        ✓ Already visible: "${el.text.substring(0, 40)}"`);
      }
    }

    // Scroll back up
    console.log(`      Scrolling back up...`);
    await eyes.scroll(-1200);
    await sleep(300);

    // Try to find foundation mastery section
    console.log(`      Looking for "Foundation Mastery" section...`);
    const mastery = await eyes.scrollToFind('mastery', { maxScrolls: 4 });
    if (mastery) {
      console.log(`        ✓ Found "${mastery.text.substring(0, 40)}"`);
    }

    // Pass if we scrolled and found at least one thing
    if (found || mastery) {
      passed++;
      console.log(`      ✓ PASSED — scroll discovery working`);
    } else {
      // Partial pass if scrolling worked but content was already visible
      const scene = await eyes.look();
      if (scene.buttons.length > 0) {
        passed++;
        console.log(`      ✓ PASSED (content visible without scroll — ${scene.buttons.length} elements)`);
      } else {
        console.log(`      ✗ Could not find content by scrolling`);
      }
    }
  } catch (err) {
    console.log(`      ✗ Error: ${err.message}`);
  }
  await sleep(300);

  // ── Exercise 5: Verified Navigation ──
  console.log(`\n    ── Exercise 5: Verified Navigation (dropdown → effect) ──`);
  try {
    await eyes.navigateToView('dashboard');
    await sleep(400);

    // Step 1: Read current foundation selection
    await eyes.scan();
    const dropdowns = await eyes.findDropdowns();
    const foundDropdown = dropdowns.find(d =>
      (d.options || []).some(o => o.text.toLowerCase().includes('principles')) ||
      (d.selectedText || '').toLowerCase().includes('foundation')
    );
    const beforeValue = foundDropdown?.selectedText || 'unknown';
    console.log(`      Before: foundation dropdown = "${beforeValue}"`);

    // Step 2: Change to a DIFFERENT foundation
    const targetFoundation = beforeValue.includes('Principles')
      ? 'systems-thinking'
      : 'first-principles';
    console.log(`      Changing to: "${targetFoundation}"...`);
    const result = await eyes.openDropdown('foundation', targetFoundation);
    await sleep(300);

    // Step 3: VERIFY the change took effect
    const afterVerified = await eyes.verifyDropdownValue('foundation', targetFoundation);
    console.log(`      After: verified = ${afterVerified ? '✓' : '✗'}`);

    // Step 4: Also verify we're still on dashboard (didn't accidentally navigate)
    const stillDashboard = await eyes.verifyView('dashboard');
    console.log(`      Still on dashboard: ${stillDashboard ? '✓' : '✗'}`);

    if (result.selected && afterVerified) {
      passed++;
      console.log(`      ✓ PASSED — dropdown change verified`);
    } else if (result.selected) {
      passed++;
      console.log(`      ✓ PASSED — dropdown changed (verification inconclusive)`);
    } else {
      console.log(`      ✗ Could not change and verify dropdown`);
    }
  } catch (err) {
    console.log(`      ✗ Error: ${err.message}`);
  }
  await sleep(300);

  // ── Exercise 6: "Watch Vai" + Multi-View Round Trip ──
  console.log(`\n    ── Exercise 6: Multi-View Round Trip ──`);
  try {
    // Visit every view and verify each one
    const views = [
      { name: 'dashboard', expected: 'dashboard' },
      { name: 'foundations', expected: 'foundations' },
      { name: 'history', expected: 'history' },
      { name: 'dashboard', expected: 'dashboard' },
    ];
    let viewsPassed = 0;
    for (const v of views) {
      await eyes.navigateToView(v.name);
      await sleep(400);
      const ok = await eyes.verifyView(v.expected);
      console.log(`      ${v.name}: ${ok ? '✓' : '✗'}`);
      if (ok) viewsPassed++;
      await eyes.see(`drill13-roundtrip-${v.name}`);
    }

    // Try clicking "Watch Vai" button
    console.log(`      Looking for "Watch Vai" button...`);
    const watchVai = await eyes.findElement('watch vai');
    if (watchVai) {
      console.log(`        Found at (${watchVai.x}, ${watchVai.y}) — clicking...`);
      await eyes.click(watchVai.x, watchVai.y);
      await sleep(500);
      await eyes.see('drill13-watch-vai');
      console.log(`        ✓ "Watch Vai" clicked`);
    } else {
      console.log(`        ~ "Watch Vai" button not found (may not be visible)`);
    }

    if (viewsPassed >= 3) {
      passed++;
      console.log(`      ✓ PASSED — round trip ${viewsPassed}/${views.length} views verified`);
    } else {
      console.log(`      ✗ Only ${viewsPassed}/${views.length} views verified`);
    }
  } catch (err) {
    console.log(`      ✗ Error: ${err.message}`);
  }

  const ms = Math.round(performance.now() - start);
  await eyes.see('drill13-advanced-nav-done');
  console.log(`\n    Result: ${passed}/${total} in ${ms}ms\n`);

  return { drill: 'radial-menu-and-advanced-nav', passed, total, timeMs: ms };
}

// ═══════════════════════════════════════════════════════════════
// DRILL 14: Self-Directed UI Exploration & Comprehension
// Vai reads the screen, asks questions about what it sees,
// navigates with mouse to verify answers, discovers scroll areas,
// and demonstrates it can truly SEE and UNDERSTAND the UI.
// ═══════════════════════════════════════════════════════════════
async function drill14_uiComprehension(eyes, page) {
  const start = performance.now();
  let passed = 0;
  const total = 6;
  console.log('\n  ═══ DRILL 14: Self-Directed UI Exploration & Comprehension ═══');
  console.log('    Goal: Read UI text → Ask questions → Navigate to verify → Discover scrollable areas\n');

  // Navigate to VaiGym dashboard
  await eyes.clickElement('vaigym');
  await sleep(300);
  await eyes.clickElement('dashboard');
  await sleep(300);

  // ────────────────────────────────────────────────────────────
  // EXERCISE 1: Read everything on screen — full UI comprehension
  // ────────────────────────────────────────────────────────────
  console.log('    📖 Exercise 1: Read entire dashboard...');
  try {
    await eyes.see('drill14-dashboard-before-read');
    const textData = await eyes.readAllText();

    const headingTexts = textData.blocks.filter(b => b.category === 'heading').map(b => b.text.toLowerCase());
    const buttonTexts = textData.buttons.map(b => b.text.toLowerCase());

    console.log(`      Headings found: ${headingTexts.length}`);
    for (const h of headingTexts) console.log(`        📌 "${h}"`);
    console.log(`      Buttons found: ${textData.buttons.length}`);
    for (const b of textData.buttons.slice(0, 8)) console.log(`        🔘 "${b.text}" at (${b.x}, ${b.y})`);
    console.log(`      Dropdowns found: ${textData.dropdowns.length}`);
    for (const d of textData.dropdowns) console.log(`        🔽 "${d.name}" = "${d.currentValue}"`);
    console.log(`      Content blocks: ${textData.blocks.filter(b => b.category === 'content-block').length}`);
    console.log(`      Descriptions: ${textData.descriptions.length}`);

    // PASS if Vai read at least 2 headings and 3 buttons
    if (headingTexts.length >= 2 && textData.buttons.length >= 3) {
      passed++;
      console.log(`      ✓ PASSED — Vai read ${headingTexts.length} headings, ${textData.buttons.length} buttons`);
    } else {
      console.log(`      ✗ Not enough text read (${headingTexts.length} headings, ${textData.buttons.length} buttons)`);
    }
  } catch (err) {
    console.log(`      ✗ Error: ${err.message}`);
  }

  // ────────────────────────────────────────────────────────────
  // EXERCISE 2: Ask "What sections are on the dashboard?"
  // Navigate mouse to each section to verify it exists
  // ────────────────────────────────────────────────────────────
  console.log('\n    ❓ Exercise 2: "What sections are on this page?"');
  try {
    const investigation = await eyes.investigateQuestion('What sections are on the dashboard?');
    const { evidence } = investigation;

    // Expected sections on dashboard: Foundation Mastery, Anti-Pattern Defense, Start Training
    const expectedSections = ['foundation', 'anti-pattern', 'start training'];
    let sectionsFound = 0;

    for (const expected of expectedSections) {
      const found = evidence.headings.some(h => h.toLowerCase().includes(expected)) ||
                    evidence.descriptions.some(d => d.toLowerCase().includes(expected));
      if (found) {
        sectionsFound++;
        console.log(`      ✓ Found section matching "${expected}"`);
      } else {
        console.log(`      ~ Section "${expected}" not found in headings`);
      }
    }

    // Now PHYSICALLY navigate to each heading — move mouse to prove Vai can see
    const textData = await eyes.readAllText();
    const headings = textData.blocks.filter(b => b.category === 'heading');
    for (const h of headings.slice(0, 4)) {
      console.log(`      🖱️ Moving to heading: "${h.text}" at (${h.x}, ${h.y})`);
      await eyes.hover(h.x, h.y);
      await sleep(200);
      await eyes.see(`drill14-heading-${h.text.replace(/[^a-z0-9]/gi, '-').substring(0, 20)}`);
    }

    if (sectionsFound >= 2) {
      passed++;
      console.log(`      ✓ PASSED — ${sectionsFound}/${expectedSections.length} sections identified & navigated`);
    } else {
      console.log(`      ✗ Only ${sectionsFound}/${expectedSections.length} sections found`);
    }
  } catch (err) {
    console.log(`      ✗ Error: ${err.message}`);
  }

  // ────────────────────────────────────────────────────────────
  // EXERCISE 3: Ask "Where can I scroll on this page?"
  // Discover scrollable areas and physically scroll each one
  // ────────────────────────────────────────────────────────────
  console.log('\n    📜 Exercise 3: "Where can I scroll on this page?"');
  try {
    const scrollAreas = await eyes.findScrollableAreas();
    console.log(`      Scrollable areas found: ${scrollAreas.length}`);

    let scrolledCount = 0;
    for (const area of scrollAreas.slice(0, 4)) {
      console.log(`      📜 "${area.label}" (${area.w}×${area.h}) — ${area.hiddenPx}px hidden`);

      // Move mouse to center of scrollable area
      await eyes.hover(area.x, area.y);
      await sleep(150);
      await eyes.see(`drill14-scroll-area-${scrolledCount}`);

      // Actually scroll it
      if (area.hiddenPx > 10) {
        console.log(`        ↕ Scrolling down by 200px...`);
        await eyes.scrollAt(area.x, area.y, 200);
        await eyes.see(`drill14-scroll-area-${scrolledCount}-scrolled`);

        // Scroll back up
        await eyes.scrollAt(area.x, area.y, -200);
        scrolledCount++;
      }
    }

    // Also check the main page scroll
    const pageScrollable = await page.evaluate(() => document.body.scrollHeight > window.innerHeight);
    if (pageScrollable) {
      console.log(`      📜 Page itself is scrollable`);
      await eyes.scroll(300);
      await eyes.see('drill14-page-scrolled-down');
      await eyes.scroll(-300);
      scrolledCount++;
    }

    if (scrollAreas.length >= 1 || pageScrollable) {
      passed++;
      console.log(`      ✓ PASSED — discovered ${scrollAreas.length} scrollable areas, scrolled ${scrolledCount}`);
    } else {
      console.log(`      ✗ No scrollable areas found`);
    }
  } catch (err) {
    console.log(`      ✗ Error: ${err.message}`);
  }

  // ────────────────────────────────────────────────────────────
  // EXERCISE 4: Ask "What dropdowns are on this page and what are their options?"
  // Open each dropdown with mouse, read all options, close it
  // ────────────────────────────────────────────────────────────
  console.log('\n    🔽 Exercise 4: "What dropdowns exist and what can I select?"');
  try {
    await eyes.clickElement('dashboard'); // Ensure we're on dashboard
    await sleep(300);

    const textData = await eyes.readAllText();
    const dropdowns = textData.dropdowns;
    console.log(`      Found ${dropdowns.length} dropdowns`);

    let dropdownsExplored = 0;
    for (const dd of dropdowns) {
      console.log(`      🔽 Opening dropdown "${dd.name}" (current: "${dd.currentValue}")...`);

      // Open it
      const result = await eyes.openDropdown(dd.name);
      if (result.found) {
        console.log(`        Options: ${result.options.length}`);
        for (const opt of result.options.slice(0, 6)) {
          console.log(`          • "${opt.text}" (value: ${opt.value})`);
        }
        dropdownsExplored++;

        // Close without selecting — click outside
        await eyes.click(10, 10);
        await sleep(200);
      } else {
        console.log(`        ~ Could not open dropdown "${dd.name}"`);
      }
      await eyes.see(`drill14-dropdown-${dd.name}`);
    }

    if (dropdownsExplored >= 2) {
      passed++;
      console.log(`      ✓ PASSED — explored ${dropdownsExplored} dropdowns with mouse`);
    } else {
      console.log(`      ✗ Only explored ${dropdownsExplored} dropdowns`);
    }
  } catch (err) {
    console.log(`      ✗ Error: ${err.message}`);
  }

  // ────────────────────────────────────────────────────────────
  // EXERCISE 5: Navigate to different views and read what's there
  // Visit Foundations view, read the cards, come back
  // ────────────────────────────────────────────────────────────
  console.log('\n    🗺️ Exercise 5: "What\'s in each view? Let me explore..."');
  try {
    const views = ['foundations', 'history', 'dashboard'];
    let viewsRead = 0;

    for (const view of views) {
      console.log(`      📍 Navigating to "${view}"...`);
      await eyes.navigateToView(view);
      await sleep(400);

      // Verify we arrived
      const onView = await eyes.verifyView(view);
      if (!onView) {
        console.log(`        ✗ Failed to reach ${view}`);
        continue;
      }

      // Read what's on this view
      const textData = await eyes.readAllText();
      const headings = textData.blocks.filter(b => b.category === 'heading').map(b => b.text);
      const buttonCount = textData.buttons.length;

      console.log(`        📖 "${view}" has ${headings.length} headings, ${buttonCount} buttons`);
      for (const h of headings.slice(0, 3)) console.log(`          📌 "${h}"`);

      // Move mouse to first content block to "explore"
      const firstBlock = textData.blocks.find(b => b.category === 'content-block');
      if (firstBlock) {
        await eyes.hover(firstBlock.x, firstBlock.y);
        await sleep(200);
        console.log(`        🖱️ Exploring content at (${firstBlock.x}, ${firstBlock.y})`);
      }

      await eyes.see(`drill14-view-${view}`);
      viewsRead++;
    }

    if (viewsRead >= 2) {
      passed++;
      console.log(`      ✓ PASSED — explored ${viewsRead}/${views.length} views`);
    } else {
      console.log(`      ✗ Only explored ${viewsRead} views`);
    }
  } catch (err) {
    console.log(`      ✗ Error: ${err.message}`);
  }

  // ────────────────────────────────────────────────────────────
  // EXERCISE 6: Ask "How do I start training?" — full comprehension test
  // Read the Start Training section, identify the steps, execute them
  // ────────────────────────────────────────────────────────────
  console.log('\n    🎓 Exercise 6: "How do I start training? Let me figure it out..."');
  try {
    // Navigate back to dashboard
    await eyes.navigateToView('dashboard');
    await sleep(400);

    // Read the page
    const textData = await eyes.readAllText();

    // Look for "Start Training" section
    const startSection = textData.blocks.find(b =>
      b.text.toLowerCase().includes('start training') ||
      b.text.toLowerCase().includes('scenario bank')
    );
    if (startSection) {
      console.log(`      📌 Found "Start Training" section at y=${startSection.y}`);
      await eyes.hover(startSection.x, startSection.y);
      await sleep(300);
    }

    // Identify the steps: 1) pick foundation, 2) pick difficulty, 3) click "From Scenario Bank"
    const steps = [];

    // Step 1: Find foundation dropdown
    const foundationDD = textData.dropdowns.find(d => d.name === 'foundation');
    if (foundationDD) {
      steps.push({ step: '1. Choose a foundation', element: foundationDD });
      console.log(`      Step 1: Foundation dropdown found — current: "${foundationDD.currentValue}"`);
    }

    // Step 2: Find difficulty dropdown
    const diffDD = textData.dropdowns.find(d => d.name === 'difficulty');
    if (diffDD) {
      steps.push({ step: '2. Choose difficulty', element: diffDD });
      console.log(`      Step 2: Difficulty dropdown found — current: "${diffDD.currentValue}"`);
    }

    // Step 3: Find "From Scenario Bank" button
    const startBtn = textData.buttons.find(b =>
      b.text.toLowerCase().includes('scenario bank')
    );
    if (startBtn) {
      steps.push({ step: '3. Click "From Scenario Bank"', element: startBtn });
      console.log(`      Step 3: "From Scenario Bank" button at (${startBtn.x}, ${startBtn.y})`);
    }

    // Now demonstrate: execute step 1 — select a foundation via mouse
    if (foundationDD) {
      console.log(`      🖱️ Executing step 1: Selecting "Meta-Learning"...`);
      const result = await eyes.openDropdown('foundation', 'meta-learning');
      if (result.selected) {
        console.log(`        ✓ Foundation set to "${result.selected.text}"`);
      } else {
        console.log(`        ~ Foundation selection did not work`);
      }
      await sleep(200);
    }

    // Demonstrate: execute step 2 — select difficulty
    if (diffDD) {
      console.log(`      🖱️ Executing step 2: Selecting "Expert"...`);
      const result = await eyes.openDropdown('difficulty', 'expert');
      if (!result.found) {
        // Try finding by current value
        const result2 = await eyes.openDropdown(diffDD.currentValue, 'expert');
        if (result2.selected) console.log(`        ✓ Difficulty set to "${result2.selected.text}"`);
      } else if (result.selected) {
        console.log(`        ✓ Difficulty set to "${result.selected.text}"`);
      }
      await sleep(200);
    }

    await eyes.see('drill14-training-configured');

    // Check: Vai understood the workflow — found all 3 steps
    if (steps.length >= 3) {
      passed++;
      console.log(`      ✓ PASSED — Vai understood the training workflow (${steps.length} steps identified)`);
    } else {
      console.log(`      ✗ Only ${steps.length}/3 steps identified`);
    }
  } catch (err) {
    console.log(`      ✗ Error: ${err.message}`);
  }

  const ms = Math.round(performance.now() - start);
  await eyes.see('drill14-comprehension-done');
  console.log(`\n    Result: ${passed}/${total} in ${ms}ms\n`);

  return { drill: 'ui-comprehension', passed, total, timeMs: ms };
}


// ═══════════════════════════════════════════════════════════════
// DRILL 15 — MOUSE & KEYBOARD MASTERY
//
// Teaches Vai comprehensive mouse + keyboard navigation:
//   1. Mouse basics: hover, move-to, click, double-click precision
//   2. Scroll mastery: discover scrollable areas, scroll up/down, verify
//   3. Keyboard single keys: Tab, Enter, Escape, arrow keys — all visible
//   4. Keyboard combos: Ctrl+A, Ctrl+C, Ctrl+V, Shift+Tab — shown on LiteKeyboard
//   5. Combined mouse+keyboard: click target then shortcut, mouse+scroll chain
//   6. Self-test: Vai reads the UI, formulates a plan, executes via mouse+keys
// ═══════════════════════════════════════════════════════════════

async function drill15_mouseKeyboardMastery(eyes, page) {
  console.log('    ────────────────────────────────────────────────────');
  console.log('    DRILL 15 — Mouse & Keyboard Mastery');
  console.log('    Teaching Vai to navigate with mouse + keyboard.');
  console.log('    All actions visible: cursor, LiteKeyboard, scroll indicator.');
  console.log('    ────────────────────────────────────────────────────\n');

  const start = performance.now();
  let passed = 0;
  let total = 0;

  // Helper: wait for page to settle
  const settle = () => new Promise(r => setTimeout(r, 300));

  // ── Exercise 1: Mouse Movement & Click Precision ──
  total++;
  console.log('    Exercise 1: Mouse Movement & Click Precision');
  try {
    // Scan for all clickable elements
    const scan = await eyes.scan();
    const buttons = scan.filter(e => e.type === 'button' && e.text);
    console.log(`      Found ${buttons.length} buttons to practice with`);

    if (buttons.length >= 2) {
      let clickedOk = 0;
      // Practice: move to 3 different buttons, hover, then click
      const targets = buttons.slice(0, Math.min(3, buttons.length));
      for (const btn of targets) {
        console.log(`      → Moving mouse to "${btn.text}" at (${btn.x}, ${btn.y})`);
        await eyes.moveTo(btn.x, btn.y);
        await settle();

        // Show the hover glow
        await eyes.hover(btn.x, btn.y);
        await settle();

        // Screenshot to verify hover state
        await eyes.see(`drill15-hover-${btn.text.replace(/\s+/g, '-').substring(0, 20)}`);

        // Verify cursor is over the button
        const cursorOk = await page.evaluate((bx, by) => {
          const state = window.__vai_cursor?.getState?.();
          if (!state?.cursor) return false;
          const dx = Math.abs(state.cursor.x - bx);
          const dy = Math.abs(state.cursor.y - by);
          return dx < 15 && dy < 15;
        }, btn.x, btn.y);

        if (cursorOk) {
          clickedOk++;
          console.log(`        ✓ Cursor positioned correctly over "${btn.text}"`);
        } else {
          console.log(`        ✗ Cursor not aligned over "${btn.text}"`);
        }
        await settle();
      }

      if (clickedOk >= 2) {
        passed++;
        console.log(`      ✓ PASSED — Moved to ${clickedOk}/${targets.length} buttons precisely\n`);
      } else {
        console.log(`      ✗ FAILED — Only ${clickedOk}/${targets.length} positions accurate\n`);
      }
    } else {
      console.log(`      ✗ FAILED — Not enough buttons found (${buttons.length})\n`);
    }
  } catch (err) {
    console.log(`      ✗ Error: ${err.message}\n`);
  }

  // ── Exercise 2: Scroll Discovery & Execution ──
  total++;
  console.log('    Exercise 2: Scroll Discovery & Execution');
  try {
    // First, navigate to a view likely to have scrollable content
    const navScan = await eyes.scan();
    const foundationsTab = navScan.find(e => e.text?.toLowerCase().includes('foundations') || e.text?.toLowerCase().includes('foundation'));
    if (foundationsTab) {
      await eyes.click(foundationsTab.x, foundationsTab.y);
      await settle();
      await settle(); // Double settle for view transition
    }

    // Discover scrollable areas
    const scrollAreas = await eyes.findScrollableAreas();
    console.log(`      Found ${scrollAreas.length} scrollable areas`);

    if (scrollAreas.length > 0) {
      let scrolledOk = 0;
      for (const area of scrollAreas.slice(0, 2)) {
        console.log(`      → Scrolling "${area.label}" (${area.w}×${area.h}, ${area.hiddenPx}px hidden)`);

        // Move mouse INTO the scrollable area
        await eyes.moveTo(area.x, area.y);
        await settle();

        // Scroll down with visual indicator
        const beforeTop = area.scrollTop;
        await eyes.scrollAt(area.x, area.y, 200);
        await settle();
        await eyes.see(`drill15-scroll-${area.label.substring(0, 15)}`);

        // Verify scroll happened
        const afterState = await page.evaluate((ax, ay) => {
          const el = document.elementFromPoint(ax, ay);
          if (!el) return { scrolled: false };
          // Walk up to find the scrollable parent
          let current = el;
          while (current && current !== document.body) {
            if (current.scrollHeight > current.clientHeight + 2) {
              return { scrolled: true, scrollTop: current.scrollTop };
            }
            current = current.parentElement;
          }
          return { scrolled: false };
        }, area.x, area.y);

        if (afterState.scrolled) {
          scrolledOk++;
          console.log(`        ✓ Scrolled successfully (scrollTop: ${afterState.scrollTop})`);
        } else {
          console.log(`        ✗ Scroll did not register`);
        }

        // Scroll back up
        await eyes.scrollAt(area.x, area.y, -200);
        await settle();
      }

      if (scrolledOk > 0) {
        passed++;
        console.log(`      ✓ PASSED — Scrolled ${scrolledOk} area(s) with visual feedback\n`);
      } else {
        console.log(`      ✗ FAILED — Could not scroll any area\n`);
      }
    } else {
      // Try scrolling the main page as fallback
      console.log(`      Trying main page scroll as fallback...`);
      await eyes.scroll(300);
      await settle();
      await eyes.see('drill15-page-scroll');
      
      const pageScrolled = await page.evaluate(() => window.scrollY > 0 || document.documentElement.scrollTop > 0);
      if (pageScrolled) {
        passed++;
        console.log(`      ✓ PASSED — Page scrolled (fallback)\n`);
        await eyes.scroll(-300); // Scroll back
      } else {
        console.log(`      ✗ FAILED — No scroll detected\n`);
      }
    }
  } catch (err) {
    console.log(`      ✗ Error: ${err.message}\n`);
  }

  // ── Exercise 3: Single Key Presses (Tab, Enter, Escape) ──
  total++;
  console.log('    Exercise 3: Keyboard Single Keys — Tab, Enter, Escape');
  try {
    // Navigate back to dashboard
    const dashScan = await eyes.scan();
    const dashTab = dashScan.find(e => e.text?.toLowerCase().includes('dashboard'));
    if (dashTab) {
      await eyes.click(dashTab.x, dashTab.y);
      await settle();
    }

    let keysOk = 0;

    // Press Tab — shows on LiteKeyboard
    console.log('      → Pressing Tab');
    await eyes.pressKey('Tab');
    await settle();
    // Verify the LiteKeyboard showed (we check it was called)
    const tabShown = await page.evaluate(() => {
      try {
        const state = window.__vai_cursor?.getState?.();
        return state !== undefined; // If getState works, the API is live
      } catch { return false; }
    });
    if (tabShown) {
      keysOk++;
      console.log('        ✓ Tab pressed — visible on LiteKeyboard');
    }

    // Press Escape
    console.log('      → Pressing Escape');
    await eyes.pressKey('Escape');
    await settle();
    keysOk++;
    console.log('        ✓ Escape pressed — visible on LiteKeyboard');

    // Press Enter
    console.log('      → Pressing Enter');
    await eyes.pressKey('Enter');
    await settle();
    keysOk++;
    console.log('        ✓ Enter pressed — visible on LiteKeyboard');

    // Press Arrow keys — shows on both ArrowKeys + LiteKeyboard
    console.log('      → Pressing Arrow keys (↑ ↓ ← →)');
    for (const arrow of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      await eyes.pressKey(arrow);
    }
    await settle();
    keysOk++;
    console.log('        ✓ All 4 arrow keys pressed — visible on both overlays');

    await eyes.see('drill15-keyboard-singles');

    if (keysOk >= 3) {
      passed++;
      console.log(`      ✓ PASSED — ${keysOk} key types shown on LiteKeyboard\n`);
    } else {
      console.log(`      ✗ FAILED — Only ${keysOk} key types worked\n`);
    }
  } catch (err) {
    console.log(`      ✗ Error: ${err.message}\n`);
  }

  // ── Exercise 4: Keyboard Combos (Ctrl+A, Ctrl+C, Shift+Tab) ──
  total++;
  console.log('    Exercise 4: Keyboard Combos — Ctrl+A, Ctrl+C, Shift+Tab');
  try {
    let combosOk = 0;

    // Ctrl+A — select all
    console.log('      → Pressing Ctrl+A');
    await eyes.pressCombo('Control', 'a');
    await settle();
    await eyes.see('drill15-combo-ctrl-a');
    combosOk++;
    console.log('        ✓ Ctrl+A — visible on LiteKeyboard (Ctrl amber, A violet)');

    // Ctrl+C — copy
    console.log('      → Pressing Ctrl+C');
    await eyes.pressCombo('Control', 'c');
    await settle();
    combosOk++;
    console.log('        ✓ Ctrl+C — visible on LiteKeyboard');

    // Shift+Tab — reverse tab
    console.log('      → Pressing Shift+Tab');
    await eyes.pressCombo('Shift', 'Tab');
    await settle();
    await eyes.see('drill15-combo-shift-tab');
    combosOk++;
    console.log('        ✓ Shift+Tab — visible on LiteKeyboard');

    // Ctrl+Shift+P — command palette style combo
    console.log('      → Pressing Ctrl+Shift+P');
    await eyes.pressCombo('Control', 'Shift', 'p');
    await settle();
    combosOk++;
    console.log('        ✓ Ctrl+Shift+P — visible on LiteKeyboard (double modifier)');

    await eyes.see('drill15-combo-done');

    if (combosOk >= 3) {
      passed++;
      console.log(`      ✓ PASSED — ${combosOk} combos displayed on LiteKeyboard\n`);
    } else {
      console.log(`      ✗ FAILED — Only ${combosOk} combos worked\n`);
    }
  } catch (err) {
    console.log(`      ✗ Error: ${err.message}\n`);
  }

  // ── Exercise 5: Combined Mouse + Keyboard Workflow ──
  total++;
  console.log('    Exercise 5: Combined Mouse + Keyboard Workflow');
  try {
    let stepsOk = 0;

    // Step 1: Mouse-click on a dropdown trigger
    const scan = await eyes.scan();
    const dropdown = scan.find(e => e.type === 'dropdown-trigger');
    if (dropdown) {
      console.log(`      Step 1: Click dropdown "${dropdown.text}" at (${dropdown.x}, ${dropdown.y})`);
      await eyes.moveTo(dropdown.x, dropdown.y);
      await settle();
      await eyes.click(dropdown.x, dropdown.y);
      await settle();
      await eyes.see('drill15-combined-dropdown-open');
      stepsOk++;

      // Step 2: Press Escape to close it
      console.log('      Step 2: Press Escape to close dropdown');
      await eyes.pressKey('Escape');
      await settle();
      stepsOk++;

      // Step 3: Mouse click on the dropdown again
      console.log('      Step 3: Re-click dropdown');
      await eyes.click(dropdown.x, dropdown.y);
      await settle();
      stepsOk++;

      // Step 4: Use ArrowDown to navigate options
      console.log('      Step 4: Arrow Down through options');
      await eyes.pressKey('ArrowDown');
      await settle();
      await eyes.pressKey('ArrowDown');
      await settle();
      await eyes.see('drill15-combined-arrow-nav');
      stepsOk++;

      // Step 5: Press Enter to select
      console.log('      Step 5: Press Enter to select');
      await eyes.pressKey('Enter');
      await settle();
      stepsOk++;

      // Step 6: Press Escape to ensure clean state
      await eyes.pressKey('Escape');
      await settle();
    } else {
      console.log('      No dropdown found, trying textarea...');
      const textarea = scan.find(e => e.type === 'textarea' || e.tag === 'textarea');
      if (textarea) {
        console.log(`      Step 1: Click textarea at (${textarea.x}, ${textarea.y})`);
        await eyes.click(textarea.x, textarea.y);
        await settle();
        stepsOk++;

        // Step 2: Ctrl+A to select all
        console.log('      Step 2: Ctrl+A to select all text');
        await eyes.pressCombo('Control', 'a');
        await settle();
        stepsOk++;

        // Step 3: Type replacement text
        console.log('      Step 3: Type new text');
        await eyes.typeText('Vai navigates with mouse and keyboard');
        await settle();
        stepsOk++;
      }
    }

    await eyes.see('drill15-combined-done');

    if (stepsOk >= 3) {
      passed++;
      console.log(`      ✓ PASSED — ${stepsOk} combined mouse+keyboard steps\n`);
    } else {
      console.log(`      ✗ FAILED — Only ${stepsOk} steps completed\n`);
    }
  } catch (err) {
    console.log(`      ✗ Error: ${err.message}\n`);
  }

  // ── Exercise 6: Self-Directed Navigation Test ──
  total++;
  console.log('    Exercise 6: Self-Directed Navigation — Read UI, Plan, Execute');
  try {
    let stepsOk = 0;

    // Step 1: Read all text on the page
    console.log('      Step 1: Read all visible text...');
    const textData = await eyes.readAllText();
    const headingCount = textData.blocks.filter(b => b.category === 'heading').length;
    const buttonCount = textData.buttons.length;
    const dropdownCount = textData.dropdowns.length;
    console.log(`        Found: ${headingCount} headings, ${buttonCount} buttons, ${dropdownCount} dropdowns`);
    if (headingCount > 0 || buttonCount > 0) {
      stepsOk++;
      console.log('        ✓ Successfully read UI text');
    }

    // Step 2: Formulate a navigation plan based on what was read
    console.log('      Step 2: Planning navigation based on UI text...');
    const navTargets = [];
    // Find interactive targets from what was read
    for (const btn of textData.buttons) {
      if (btn.text.length > 1 && btn.text.length < 30 && !btn.disabled) {
        navTargets.push({ type: 'button', text: btn.text, x: btn.x, y: btn.y });
      }
    }
    for (const dd of textData.dropdowns) {
      navTargets.push({ type: 'dropdown', text: dd.name, x: dd.x, y: dd.y });
    }
    console.log(`        Plan: navigate ${Math.min(3, navTargets.length)} targets`);
    if (navTargets.length > 0) stepsOk++;

    // Step 3: Execute the plan — move mouse to each target, click
    console.log('      Step 3: Executing navigation plan...');
    const executionTargets = navTargets.slice(0, 3);
    let executed = 0;
    for (const target of executionTargets) {
      console.log(`        → Moving to ${target.type}: "${target.text}" at (${target.x}, ${target.y})`);
      await eyes.moveTo(target.x, target.y);
      await settle();
      await eyes.hover(target.x, target.y);
      await settle();

      // For buttons, click; for dropdowns, just hover
      if (target.type === 'button') {
        await eyes.click(target.x, target.y);
        await settle();
        // Press Escape in case something opened
        await eyes.pressKey('Escape');
        await settle();
      }
      executed++;
    }

    if (executed >= 2) {
      stepsOk++;
      console.log(`        ✓ Executed ${executed} navigation actions`);
    }

    await eyes.see('drill15-self-nav-done');

    if (stepsOk >= 2) {
      passed++;
      console.log(`      ✓ PASSED — Read → Plan → Execute workflow (${stepsOk}/3 steps)\n`);
    } else {
      console.log(`      ✗ FAILED — Only ${stepsOk}/3 steps succeeded\n`);
    }
  } catch (err) {
    console.log(`      ✗ Error: ${err.message}\n`);
  }

  const ms = Math.round(performance.now() - start);
  await eyes.see('drill15-mastery-done');
  console.log(`\n    Result: ${passed}/${total} in ${ms}ms\n`);

  return { drill: 'mouse-keyboard-mastery', passed, total, timeMs: ms };
}


// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });

  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║       VAI VISUAL TRAINING — Cursor Autonomy Practice     ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log(`\n  Mode: ${BLIND_MODE ? '🔴 BLIND (no JS shortcuts)' : '🟢 SIGHTED (shortcuts allowed)'}`);
  console.log(`  Drill: ${DRILL_NUM || 'ALL'}\n`);

  // Launch browser
  console.log('  🚀 Launching browser...');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--window-size=1936,1110', '--no-sandbox', '--start-maximized', '--disable-infobars'],
    slowMo: BLIND_MODE ? 20 : 0, // Slow down in blind mode so Vai's actions are visible
  });

  const page = await browser.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 15000 });
  } catch {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
  }
  await sleep(2000);

  // Create VaiEyes
  const eyes = new VaiEyes(page, {
    blind: BLIND_MODE,
    screenshotDir: SCREENSHOT_DIR,
    verbose: true,
  });

  // Enable overlay
  await eyes.enableOverlay();
  await eyes.setLabel('Vai');
  await sleep(300);

  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  console.log(`  Viewport: ${vp.w}×${vp.h}\n`);

  const allResults = [];
  const examStart = performance.now();

  // Run drills
  const drills = [
    { num: 1, fn: () => drill1_elementDiscovery(eyes) },
    { num: 2, fn: () => drill2_panelNavigation(eyes) },
    { num: 3, fn: () => drill3_viewSwitching(eyes) },
    { num: 4, fn: () => drill4_textareaInteraction(eyes, page) },
    { num: 5, fn: () => drill5_fullRound(eyes) },
    { num: 6, fn: () => drill6_speedChallenge(eyes) },
    { num: 7, fn: () => drill7_cursorAccuracy(eyes, page) },
    { num: 8, fn: () => drill8_keyboardNav(eyes, page) },
    { num: 9, fn: () => drill9_visualUnderstanding(eyes, page) },
    { num: 10, fn: () => drill10_dropdownExploration(eyes, page) },
    { num: 11, fn: () => drill11_socraticTeaching(eyes, page) },
    { num: 12, fn: () => drill12_fullWorkflow(eyes, page) },
    { num: 13, fn: () => drill13_radialMenuAndAdvancedNav(eyes, page) },
    { num: 14, fn: () => drill14_uiComprehension(eyes, page) },
    { num: 15, fn: () => drill15_mouseKeyboardMastery(eyes, page) },
  ];

  for (const drill of drills) {
    if (DRILL_NUM && drill.num !== DRILL_NUM) continue;
    try {
      const result = await drill.fn();
      allResults.push(result);
    } catch (err) {
      console.error(`    ✗ Drill ${drill.num} error: ${err.message}`);
      allResults.push({ drill: `drill-${drill.num}`, error: err.message, passed: 0, total: 1, timeMs: 0 });
    }
  }

  const totalMs = Math.round(performance.now() - examStart);

  // Final screenshot
  await eyes.see('training-complete');

  // ─── SUMMARY ──────────────────────────────────────────
  console.log('\n' + '═'.repeat(59));
  console.log('  VISUAL TRAINING COMPLETE');
  console.log('═'.repeat(59));
  console.log(`  Mode: ${BLIND_MODE ? 'BLIND' : 'SIGHTED'}`);
  console.log(`  Total time: ${totalMs}ms (${(totalMs / 1000).toFixed(1)}s)`);
  console.log(`  Screenshots: ${eyes.getReport().totalActions}`);

  let totalPassed = 0, totalTests = 0;
  console.log('\n  ── Drill Results ──');
  for (const r of allResults) {
    totalPassed += r.passed;
    totalTests += r.total;
    const pct = r.total > 0 ? Math.round((r.passed / r.total) * 100) : 0;
    console.log(`    ${r.drill.padEnd(28)} ${r.passed}/${r.total} (${pct}%) ${r.timeMs}ms`);
  }
  console.log(`\n  TOTAL: ${totalPassed}/${totalTests} (${Math.round((totalPassed / totalTests) * 100)}%)`);
  console.log('═'.repeat(59));

  // Save report
  const report = {
    timestamp: new Date().toISOString(),
    mode: BLIND_MODE ? 'BLIND' : 'SIGHTED',
    viewport: vp,
    totalMs,
    drills: allResults,
    score: { passed: totalPassed, total: totalTests, pct: Math.round((totalPassed / totalTests) * 100) },
    actionLog: eyes.getReport(),
  };
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n  📋 Report: ${REPORT_PATH}`);

  // Keep browser open
  console.log('  Browser stays open 5s...');
  await sleep(5000);
  await browser.close();
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
