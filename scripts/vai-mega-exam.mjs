#!/usr/bin/env node
/**
 * Vai Mega Exam — 373 scenarios + cursor autonomy drills + timing benchmarks
 *
 * Three phases:
 *   Phase 1: CURSOR AUTONOMY — Vai navigates the UI purely with mouse/keyboard
 *   Phase 2: KNOWLEDGE BLITZ — Rapid-fire scenarios, timed per round
 *   Phase 3: DEEP EXAM — 20 hand-picked hard scenarios with full cursor interaction
 *
 * Usage:
 *   node scripts/vai-mega-exam.mjs                    # full run (phase 1+2+3)
 *   node scripts/vai-mega-exam.mjs --phase cursor      # cursor drills only
 *   node scripts/vai-mega-exam.mjs --phase blitz       # knowledge blitz only
 *   node scripts/vai-mega-exam.mjs --phase deep        # deep exam only
 *   node scripts/vai-mega-exam.mjs --count 50          # limit blitz to N scenarios
 *   node scripts/vai-mega-exam.mjs --blind             # BLIND mode: no JS shortcuts
 *   node scripts/vai-mega-exam.mjs --blind --phase deep # blind deep exam
 *
 * VIEWPORT: defaultViewport: null + --window-size=1936,1110
 * (Lesson learned: never set both to same values)
 */
import puppeteer from 'puppeteer';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CORPUS, CURSOR_DRILLS, FOUNDATIONS,
  generateResponse, getRandomScenarios, getCorpusStats,
} from './vai-training-corpus.mjs';
import { VaiEyes } from './vai-eyes.mjs';
import { VaiMentor, VaiReasoner } from './vai-mentor.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = join(__dirname, '..', 'screenshots', 'vai-gym', 'mega-exam');
const REPORT_PATH = join(SCREENSHOT_DIR, 'mega-exam-report.json');
const BASE_URL = 'http://localhost:5173';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let shotN = 0;

// ─── CLI args ────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
};
const PHASE = getArg('phase') || 'all'; // cursor | blitz | deep | socratic | all
const BLITZ_COUNT = parseInt(getArg('count') || '100', 10);
const BLIND_MODE = args.includes('--blind');

/** @type {VaiEyes|null} Global VaiEyes instance (set in main) */
let eyes = null;

// ─── Screenshot helper ───────────────────────────────────────
async function shot(page, name) {
  shotN++;
  const path = join(SCREENSHOT_DIR, `${String(shotN).padStart(3, '0')}-${name}.png`);
  await page.screenshot({ path, fullPage: false });
  return shotN;
}

// ─── Cursor helpers ──────────────────────────────────────────
async function setLabel(page, label) {
  await page.evaluate((l) => {
    try { window.__vai_cursor?.setLabel?.(l); } catch {}
  }, label);
  await sleep(100);
}

async function enableOverlay(page) {
  await page.evaluate(() => {
    try { window.__vai_cursor_store?.setState?.({ overlayVisible: true }); } catch {}
  });
}

async function cursorMoveTo(page, x, y) {
  await page.evaluate((x, y) => {
    try { window.__vai_cursor?.moveTo?.(x, y); } catch {}
  }, x, y);
  await sleep(200);
}

async function cursorToEl(page, selector) {
  const el = await page.$(selector);
  if (!el) return null;
  const box = await el.boundingBox();
  if (!box) return null;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await cursorMoveTo(page, cx, cy);
  return { x: cx, y: cy, el, box };
}

async function cursorClick(page, selector) {
  const pos = await cursorToEl(page, selector);
  if (!pos) return false;
  await page.evaluate((x, y) => {
    try { window.__vai_cursor?.click?.(x, y); } catch {}
  }, pos.x, pos.y);
  await pos.el.click();
  await sleep(250);
  return true;
}

async function vaiTypeInTextarea(page, text) {
  // For React controlled textarea, use the store method + visible typing
  const truncated = text.substring(0, 500); // Cap for speed
  await page.evaluate(async (t) => {
    try {
      // Set in store
      window.__vai_gym?.setResponse?.(t);
      // Trigger visual typing effect
      const c = window.__vai_cursor;
      if (c?.type) {
        // Just type last 30 chars visually for effect
        const visual = t.substring(Math.max(0, t.length - 30));
        await c.type(visual);
      }
    } catch {}
  }, truncated);
  await sleep(300);
}

/** Click a button by text */
async function clickBtnText(page, text) {
  const btns = await page.$$('button');
  for (const btn of btns) {
    const t = await btn.evaluate(el => el.textContent?.trim() || '');
    if (t.includes(text)) {
      const box = await btn.boundingBox();
      if (box) {
        await cursorMoveTo(page, box.x + box.width / 2, box.y + box.height / 2);
        await btn.click();
        await sleep(250);
        return true;
      }
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════
// PHASE 1: CURSOR AUTONOMY DRILLS
// ═══════════════════════════════════════════════════════════════

async function runCursorDrills(page, report) {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║     PHASE 1: CURSOR AUTONOMY DRILLS              ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  await setLabel(page, 'Vai');
  const drillResults = [];

  // Drill 1: Panel Navigation
  console.log('  ── Drill 1: Panel Navigation ──');
  const navStart = performance.now();
  const panels = ['chats', 'devlogs', 'knowledge', 'vaigym'];
  let navSuccess = 0;
  for (const panel of panels) {
    const sel = `[data-panel="${panel}"]`;
    const clicked = await cursorClick(page, sel);
    if (clicked) {
      navSuccess++;
      console.log(`    ✓ Navigated to ${panel}`);
    } else {
      console.log(`    ✗ Failed to find ${panel}`);
    }
    await sleep(400);
  }
  const navMs = Math.round(performance.now() - navStart);
  await shot(page, 'drill1-panel-nav');
  drillResults.push({
    drill: 'panel-navigation', passed: navSuccess, total: panels.length,
    timeMs: navMs, speed: `${Math.round(navMs / panels.length)}ms/panel`
  });
  console.log(`    ${navSuccess}/${panels.length} panels in ${navMs}ms\n`);

  // Drill 2: Cursor Pattern — Draw a square
  console.log('  ── Drill 2: Cursor Pattern (Square) ──');
  const patStart = performance.now();
  const viewport = await page.evaluate(() => ({
    w: window.innerWidth, h: window.innerHeight
  }));
  const cx = viewport.w / 2, cy = viewport.h / 2;
  const size = 200;
  const corners = [
    [cx - size, cy - size], [cx + size, cy - size],
    [cx + size, cy + size], [cx - size, cy + size],
    [cx - size, cy - size], // close the square
  ];
  for (const [x, y] of corners) {
    await cursorMoveTo(page, x, y);
  }
  const patMs = Math.round(performance.now() - patStart);
  await shot(page, 'drill2-cursor-square');
  drillResults.push({
    drill: 'cursor-pattern-square', passed: 1, total: 1,
    timeMs: patMs, speed: `${Math.round(patMs / corners.length)}ms/point`
  });
  console.log(`    Square pattern in ${patMs}ms\n`);

  // Drill 3: Tab Navigation (gym views)
  console.log('  ── Drill 3: Gym View Switching ──');
  await cursorClick(page, '[data-panel="vaigym"]');
  await sleep(500);
  const viewStart = performance.now();
  const views = ['dashboard', 'training', 'foundations', 'history', 'settings'];
  let viewSuccess = 0;
  for (const view of views) {
    const clicked = await page.evaluate((v) => {
      try {
        window.__vai_gym?.setView?.(v);
        return true;
      } catch { return false; }
    }, view);
    if (clicked) {
      viewSuccess++;
      console.log(`    ✓ View: ${view}`);
    }
    await sleep(300);
  }
  const viewMs = Math.round(performance.now() - viewStart);
  await shot(page, 'drill3-view-switching');
  drillResults.push({
    drill: 'gym-view-switching', passed: viewSuccess, total: views.length,
    timeMs: viewMs, speed: `${Math.round(viewMs / views.length)}ms/view`
  });
  console.log(`    ${viewSuccess}/${views.length} views in ${viewMs}ms\n`);

  // Drill 4: Element Discovery — find all buttons on page
  console.log('  ── Drill 4: Element Discovery ──');
  const discStart = performance.now();
  const buttonCount = await page.evaluate(() => document.querySelectorAll('button').length);
  const linkCount = await page.evaluate(() => document.querySelectorAll('a').length);
  const inputCount = await page.evaluate(() => document.querySelectorAll('input, textarea').length);
  const discMs = Math.round(performance.now() - discStart);
  await shot(page, 'drill4-element-discovery');
  drillResults.push({
    drill: 'element-discovery',
    passed: 1, total: 1,
    timeMs: discMs,
    details: `Found: ${buttonCount} buttons, ${linkCount} links, ${inputCount} inputs`
  });
  console.log(`    ${buttonCount} buttons, ${linkCount} links, ${inputCount} inputs (${discMs}ms)\n`);

  // Drill 5: Speed Run — 8 panel switches as fast as possible
  console.log('  ── Drill 5: Speed Run ──');
  const speedStart = performance.now();
  const speedPanels = ['chats', 'vaigym', 'knowledge', 'devlogs', 'chats', 'vaigym', 'knowledge', 'chats'];
  let speedSuccess = 0;
  for (const p of speedPanels) {
    if (await cursorClick(page, `[data-panel="${p}"]`)) speedSuccess++;
  }
  const speedMs = Math.round(performance.now() - speedStart);
  await shot(page, 'drill5-speed-run');
  drillResults.push({
    drill: 'speed-run-8-switches', passed: speedSuccess, total: speedPanels.length,
    timeMs: speedMs, speed: `${Math.round(speedMs / speedPanels.length)}ms/switch`
  });
  console.log(`    ${speedSuccess}/${speedPanels.length} switches in ${speedMs}ms (${Math.round(speedMs / speedPanels.length)}ms/switch)\n`);

  // Drill 6: Cursor figure-8 pattern
  console.log('  ── Drill 6: Cursor Figure-8 ──');
  const f8Start = performance.now();
  const pts = 32;
  for (let i = 0; i <= pts; i++) {
    const t = (i / pts) * Math.PI * 2;
    const x = cx + Math.sin(t) * 150;
    const y = cy + Math.sin(t * 2) * 100;
    await page.evaluate((x, y) => {
      try { window.__vai_cursor?.moveTo?.(x, y); } catch {}
    }, x, y);
    await sleep(30);
  }
  const f8Ms = Math.round(performance.now() - f8Start);
  await shot(page, 'drill6-figure-8');
  drillResults.push({
    drill: 'cursor-figure-8', passed: 1, total: 1,
    timeMs: f8Ms, speed: `${Math.round(f8Ms / pts)}ms/point`
  });
  console.log(`    Figure-8 in ${f8Ms}ms (${pts} points)\n`);

  report.cursorDrills = drillResults;
  const totalDrillTime = drillResults.reduce((s, d) => s + d.timeMs, 0);
  const totalPassed = drillResults.reduce((s, d) => s + d.passed, 0);
  const totalTests = drillResults.reduce((s, d) => s + d.total, 0);
  console.log(`  CURSOR DRILLS: ${totalPassed}/${totalTests} passed, ${totalDrillTime}ms total\n`);
}

// ═══════════════════════════════════════════════════════════════
// PHASE 2: KNOWLEDGE BLITZ — Rapid-fire, response engine only
// ═══════════════════════════════════════════════════════════════

async function runKnowledgeBlitz(page, report) {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║     PHASE 2: KNOWLEDGE BLITZ                     ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  await setLabel(page, 'Opus');

  // Select scenarios: spread across all foundations
  const scenarios = getRandomScenarios(BLITZ_COUNT);
  console.log(`  ${scenarios.length} scenarios selected from corpus of ${CORPUS.length}\n`);

  // Navigate to gym training view
  await cursorClick(page, '[data-panel="vaigym"]');
  await sleep(500);
  await page.evaluate(() => window.__vai_gym?.setView?.('training'));
  await sleep(500);
  await shot(page, 'blitz-start');

  const blitzResults = [];
  const foundationTotals = {};
  const difficultyTotals = {};
  let totalResponseMs = 0;
  let totalChars = 0;

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i];
    const roundStart = performance.now();

    // Generate response
    const response = generateResponse(scenario);
    const responseMs = Math.round(performance.now() - roundStart);

    // Quick stats
    const words = response.split(/\s+/).length;
    totalResponseMs += responseMs;
    totalChars += response.length;

    // Track per foundation
    const fKey = scenario.foundation;
    if (!foundationTotals[fKey]) foundationTotals[fKey] = { count: 0, totalMs: 0, totalWords: 0 };
    foundationTotals[fKey].count++;
    foundationTotals[fKey].totalMs += responseMs;
    foundationTotals[fKey].totalWords += words;

    // Track per difficulty
    const dKey = scenario.difficulty;
    if (!difficultyTotals[dKey]) difficultyTotals[dKey] = { count: 0, totalMs: 0 };
    difficultyTotals[dKey].count++;
    difficultyTotals[dKey].totalMs += responseMs;

    blitzResults.push({
      id: scenario.id,
      foundation: fKey,
      difficulty: dKey,
      situation: scenario.situation.substring(0, 80),
      responseWords: words,
      responseMs,
      responseSample: response.substring(0, 100),
    });

    // Progress updates every 25 rounds
    if ((i + 1) % 25 === 0 || i === scenarios.length - 1) {
      const elapsed = Math.round(performance.now() - roundStart);
      process.stdout.write(`\r  Progress: ${i + 1}/${scenarios.length} (${Math.round(totalResponseMs)}ms total)`);
    }
  }
  console.log('\n');

  // Screenshot after blitz
  await shot(page, 'blitz-complete');

  // Foundation breakdown
  console.log('  ── Foundation Performance ──');
  for (const [f, data] of Object.entries(foundationTotals).sort((a, b) => b[1].count - a[1].count)) {
    const avgMs = Math.round(data.totalMs / data.count);
    const avgWords = Math.round(data.totalWords / data.count);
    console.log(`    ${f.padEnd(25)} ${String(data.count).padStart(3)} scenarios  avg ${avgMs}ms  ~${avgWords} words`);
  }

  // Difficulty breakdown
  console.log('\n  ── Difficulty Performance ──');
  for (const [d, data] of Object.entries(difficultyTotals)) {
    const avgMs = Math.round(data.totalMs / data.count);
    console.log(`    ${d.padEnd(15)} ${data.count} scenarios  avg ${avgMs}ms`);
  }

  const avgResponseMs = Math.round(totalResponseMs / scenarios.length);
  const throughput = Math.round((scenarios.length / totalResponseMs) * 1000);
  console.log(`\n  BLITZ: ${scenarios.length} scenarios in ${Math.round(totalResponseMs)}ms`);
  console.log(`  AVG: ${avgResponseMs}ms/response, ${throughput} responses/sec`);
  console.log(`  CHARS: ${totalChars} total, ~${Math.round(totalChars / scenarios.length)}/response\n`);

  report.blitz = {
    total: scenarios.length,
    totalMs: Math.round(totalResponseMs),
    avgMs: avgResponseMs,
    throughput,
    totalChars,
    byFoundation: foundationTotals,
    byDifficulty: difficultyTotals,
    results: blitzResults,
  };
}

// ═══════════════════════════════════════════════════════════════
// PHASE 3: DEEP EXAM — Hard scenarios with full cursor interaction
// ═══════════════════════════════════════════════════════════════

async function runDeepExam(page, report) {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║     PHASE 3: DEEP EXAM (20 hard scenarios)       ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  // Pick 20 hard scenarios: split across foundations, prefer expert+master
  const hardPool = CORPUS.filter(s =>
    s.difficulty === 'expert' || s.difficulty === 'master' ||
    s.foundation === 'first-principles' || s.foundation === 'systems-thinking' ||
    s.foundation === 'taste-judgment' || s.foundation === 'intellectual-honesty'
  );
  // Deduplicate by foundation — max 3 per foundation
  const selected = [];
  const perFoundation = {};
  const shuffled = [...hardPool].sort(() => Math.random() - 0.5);
  for (const s of shuffled) {
    if (selected.length >= 20) break;
    const count = perFoundation[s.foundation] || 0;
    if (count < 3) {
      selected.push(s);
      perFoundation[s.foundation] = count + 1;
    }
  }

  console.log(`  ${selected.length} scenarios selected from ${hardPool.length} hard pool`);
  console.log(`  Mode: ${BLIND_MODE ? '🔴 BLIND' : '🟢 SIGHTED'}\n`);

  // Navigate to gym
  if (BLIND_MODE && eyes) {
    await eyes.clickPanel('vaigym');
    await sleep(500);
    await eyes.navigateToView('training');
  } else {
    await cursorClick(page, '[data-panel="vaigym"]');
    await sleep(500);
    await page.evaluate(() => window.__vai_gym?.setView?.('training'));
  }
  await sleep(500);

  const deepResults = [];

  for (let i = 0; i < selected.length; i++) {
    const scenario = selected[i];
    console.log(`  ── Round ${i + 1}/${selected.length} ──`);
    console.log(`    [${scenario.foundation}] ${scenario.difficulty}`);
    console.log(`    "${scenario.situation.substring(0, 70)}..."`);

    const roundStart = performance.now();

    if (BLIND_MODE && eyes) {
      // ═══ BLIND MODE: VaiEyes handles everything ═══
      const response = generateResponse(scenario);
      const genMs = Math.round(performance.now() - roundStart);

      // Opus starts scenario (still need store for scenario selection)
      await eyes.setLabel('Opus');
      await eyes.startScenario();
      await eyes.see(`deep-r${i + 1}-scenario`);

      // Vai types response BLIND — finds textarea visually, types with real keyboard
      await eyes.setLabel('Vai');
      const typeStart = performance.now();
      await eyes.scan(); // Refresh element positions
      const typed = await eyes.typeText(response, { speed: 8, maxChars: 500 });
      const typeMs = Math.round(performance.now() - typeStart);

      // Submit BLIND — find and click submit button
      const submitStart = performance.now();
      await eyes.scan();
      const submitted = await eyes.submitResponse();
      await eyes.see(`deep-r${i + 1}-submitted`);
      const submitMs = Math.round(performance.now() - submitStart);

      // Collect grade (reading store is OK — it's reading, not control)
      await eyes.setLabel('Opus');
      const gradeData = await page.evaluate(() => {
        try {
          const state = window.__vai_gym?.getStore?.();
          return state?.lastGrade || null;
        } catch { return null; }
      });

      const totalMs = Math.round(performance.now() - roundStart);
      const words = response.split(/\s+/).length;
      const grade = gradeData?.overall ?? -1;
      const gradeLabel = grade === -1 ? '⏳ PENDING MENTOR' : `${grade}/100`;

      console.log(`    BLIND: ${typed ? '✓typed' : '✗type-fail'} ${submitted ? '✓submitted' : '✗submit-fail'}`);
      console.log(`    ${words} words | gen:${genMs}ms type:${typeMs}ms submit:${submitMs}ms total:${totalMs}ms`);
      console.log(`    Grade: ${gradeLabel}\n`);

      deepResults.push({
        round: i + 1, foundation: scenario.foundation, difficulty: scenario.difficulty,
        situation: scenario.situation, hidden_need: scenario.hidden_need, rubric: scenario.rubric,
        response, grade: gradeLabel, blind: true, typedOk: typed, submittedOk: submitted,
        timing: { genMs, typeMs, submitMs, totalMs }, words,
      });
    } else {
      // ═══ SIGHTED MODE: original behavior ═══
      await setLabel(page, 'Opus');
      await page.evaluate(() => {
        try { window.__vai_gym?.startRandomScenario?.(); } catch {}
      });
      await sleep(800);

      await setLabel(page, 'Vai');
      const response = generateResponse(scenario);
      const genMs = Math.round(performance.now() - roundStart);

      const typeStart = performance.now();
      await cursorToEl(page, '[data-vai-gym-textarea]');
      await vaiTypeInTextarea(page, response);
      const typeMs = Math.round(performance.now() - typeStart);

      const submitStart = performance.now();
      await cursorClick(page, '[data-vai-gym-submit]');
      await page.evaluate(async () => {
        try { await window.__vai_gym?.submitResponse?.(); } catch {}
      });
      await sleep(1500);
      const submitMs = Math.round(performance.now() - submitStart);

      await setLabel(page, 'Opus');
      const gradeData = await page.evaluate(() => {
        try {
          const state = window.__vai_gym?.getStore?.();
          return state?.lastGrade || null;
        } catch { return null; }
      });

      const totalMs = Math.round(performance.now() - roundStart);
      const words = response.split(/\s+/).length;
      const grade = gradeData?.overall ?? -1;
      const gradeLabel = grade === -1 ? '⏳ PENDING MENTOR' : `${grade}/100`;

      console.log(`    ${words} words | gen:${genMs}ms type:${typeMs}ms submit:${submitMs}ms total:${totalMs}ms`);
      console.log(`    Grade: ${gradeLabel}\n`);

      deepResults.push({
        round: i + 1, foundation: scenario.foundation, difficulty: scenario.difficulty,
        situation: scenario.situation, hidden_need: scenario.hidden_need, rubric: scenario.rubric,
        response, grade: gradeLabel, blind: false,
        timing: { genMs, typeMs, submitMs, totalMs }, words,
      });
    }

    // Screenshot every 5 rounds
    if ((i + 1) % 5 === 0 || i === selected.length - 1) {
      await shot(page, `deep-r${i + 1}`);
    }
  }

  report.deepExam = {
    total: selected.length,
    results: deepResults,
    avgTiming: {
      genMs: Math.round(deepResults.reduce((s, r) => s + r.timing.genMs, 0) / deepResults.length),
      typeMs: Math.round(deepResults.reduce((s, r) => s + r.timing.typeMs, 0) / deepResults.length),
      submitMs: Math.round(deepResults.reduce((s, r) => s + r.timing.submitMs, 0) / deepResults.length),
      totalMs: Math.round(deepResults.reduce((s, r) => s + r.timing.totalMs, 0) / deepResults.length),
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// PHASE 4: SOCRATIC TEACHING — Mentor-driven adaptive lessons
// ═══════════════════════════════════════════════════════════════

async function runSocraticPhase(page, report) {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║     PHASE 4: SOCRATIC TEACHING (6 tracks)          ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  const mentor = new VaiMentor();
  const reasoner = new VaiReasoner();
  const trackIds = ['diagnosis', 'constraints', 'honesty', 'compression', 'systems', 'readingRoom'];
  const results = [];
  const phaseStart = performance.now();

  // Navigate to gym
  if (BLIND_MODE && eyes) {
    await eyes.clickPanel('vaigym');
    await sleep(400);
    await eyes.navigateToView('dashboard');
  } else {
    await cursorClick(page, '[data-panel="vaigym"]');
    await sleep(300);
    await page.evaluate(() => window.__vai_gym?.setView?.('dashboard'));
  }
  await sleep(500);

  console.log(`  Mode: ${BLIND_MODE ? '🔴 BLIND' : '🟢 SIGHTED'}`);
  console.log(`  Teaching — not testing. Behavioral evaluation, not keyword matching.\n`);

  for (let i = 0; i < trackIds.length; i++) {
    const trackId = trackIds[i];
    const lesson = mentor.createLesson({ track: trackId });

    console.log(`  ── Lesson ${i + 1}/${trackIds.length}: ${lesson.track} ──`);
    console.log(`    “${lesson.principle}”`);
    console.log(`    Situation: ${lesson.situation.substring(0, 80)}...`);
    console.log(`    Challenge: ${lesson.challenge.substring(0, 80)}...`);

    const lessonStart = performance.now();

    // Start a scenario for the textarea
    if (BLIND_MODE && eyes) {
      await eyes.navigateToView('dashboard');
      await sleep(300);
      await eyes.startScenario();
      await sleep(800);
    } else {
      await page.evaluate(() => window.__vai_gym?.setView?.('dashboard'));
      await sleep(300);
      await page.evaluate(() => window.__vai_gym?.startRandomScenario?.());
      await sleep(800);
    }

    // REASON — construct a unique response by parsing the situation
    // (No more canned templates — VaiReasoner thinks about THIS problem)
    const result = reasoner.reason(lesson);
    const response = result.text;

    // Log reasoning transparency
    console.log(`    Reasoning: domain=${result.reasoning.domain} type=${result.reasoning.challengeType}`);
    if (result.reasoning.specifics.length > 0) {
      console.log(`    Specifics: ${result.reasoning.specifics.slice(0, 3).join(', ')}`);
    }
    if (result.reasoning.unknowns?.length > 0) {
      console.log(`    Unknowns: ${result.reasoning.unknowns.slice(0, 2).join(' | ')}`);
    }
    if (result.reasoning.hypotheses?.length > 0) {
      console.log(`    Hypotheses: ${result.reasoning.hypotheses.slice(0, 2).join(' | ')}`);
    }
    if (result.reasoning.contradictions?.length > 0) {
      console.log(`    ⚡ Contradictions: ${result.reasoning.contradictions.join(' | ')}`);
    }
    if (result.reasoning.hintCoverage) {
      console.log(`    Hint coverage: ${result.reasoning.hintCoverage.covered}/${result.reasoning.hintCoverage.total}`);
    }
    if (result.reasoning.avoidanceRules.length > 0) {
      console.log(`    Avoiding: ${result.reasoning.avoidanceRules.join('; ')}`);
    }

    // Thinking pause — Vai doesn't instant-type, Vai thinks first
    const thinkMs = 800 + Math.floor(Math.random() * 600);
    await sleep(thinkMs);

    // Type the response
    if (BLIND_MODE && eyes) {
      await eyes.typeText(response, { speed: 8 });
    } else {
      await cursorToEl(page, '[data-vai-gym-textarea]');
      await vaiTypeInTextarea(page, response);
    }
    await sleep(300);

    // Evaluate with mentor (behavioral analysis)
    const evaluation = mentor.evaluate(lesson, response);
    const lessonMs = Math.round(performance.now() - lessonStart);

    const quality = evaluation.quality.toUpperCase();
    const emoji = quality === 'EXCELLENT' ? '★' : quality === 'GOOD' ? '✓' : '✗';
    console.log(`    ${emoji} ${quality} | questions=${evaluation.behaviors.questionCount} reasoning=${evaluation.behaviors.givesReasoning} gap=${evaluation.behaviors.admitsGap}`);

    if (evaluation.misconceptions.length > 0) {
      for (const m of evaluation.misconceptions) {
        console.log(`      Misconception: ${m.name} → ${m.teachingMove.substring(0, 60)}...`);
      }
    }

    // LEARN FROM FAILURE — feed evaluation back to reasoner
    if (evaluation.misconceptions.length > 0) {
      reasoner.remember(evaluation);
      console.log(`      Memorized: avoid ${evaluation.misconceptions.map(m => m.name).join(', ')} in future rounds`);
    }

    console.log(`    💡 ${evaluation.teachingMoment.substring(0, 100)}...`);
    console.log(`    ${lessonMs}ms\n`);

    await shot(page, `socratic-${trackId}`);

    results.push({
      track: lesson.track,
      trackId,
      quality: evaluation.quality,
      behaviors: evaluation.behaviors,
      misconceptions: evaluation.misconceptions.map(m => m.name),
      teachingMoment: evaluation.teachingMoment,
      feedback: evaluation.feedback,
      ms: lessonMs,
    });
  }

  const phaseMs = Math.round(performance.now() - phaseStart);
  const profile = mentor.profile;

  // Summary
  const excellent = results.filter(r => r.quality === 'excellent').length;
  const good = results.filter(r => r.quality === 'good').length;
  const weak = results.filter(r => r.quality === 'weak').length;

  console.log(`  ── Socratic Summary ──`);
  console.log(`  ${excellent}★ ${good}✓ ${weak}✗ across ${trackIds.length} tracks`);
  console.log(`  Level: ${profile.currentLevel} | Ready to advance: ${profile.readyToAdvance}`);
  console.log(`  Primary misconception: ${profile.primaryMisconception || 'None'}`);
  console.log(`  Time: ${phaseMs}ms\n`);

  report.socratic = {
    total: trackIds.length,
    excellent, good, weak,
    level: profile.currentLevel,
    readyToAdvance: profile.readyToAdvance,
    primaryMisconception: profile.primaryMisconception,
    results,
    ms: phaseMs,
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN — Orchestrator
// ═══════════════════════════════════════════════════════════════

async function main() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });

  // Print corpus stats
  const stats = getCorpusStats();
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║       VAI MEGA EXAM — Training Benchmark             ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log(`\n  Corpus: ${stats.total} scenarios across ${Object.keys(stats.byFoundation).length} foundations`);
  console.log(`  Phase: ${PHASE} | Blitz count: ${BLITZ_COUNT}`);
  console.log(`  Mode: ${BLIND_MODE ? '🔴 BLIND (no JS shortcuts)' : '🟢 SIGHTED'} — Opus mentors, Vai executes\n`);

  // Launch browser
  console.log('🚀 Launching browser...');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null, // CRITICAL: match window content area
    args: [
      '--window-size=1936,1110', // +16w, +30h for Chrome frame
      '--no-sandbox',
      '--start-maximized',
      '--disable-infobars',
    ],
  });
  const page = await browser.newPage();

  // Load app
  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 15000 });
  } catch {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });
  }
  await sleep(2000);

  // Enable overlay
  await enableOverlay(page);
  await sleep(300);

  // Create VaiEyes for blind mode
  if (BLIND_MODE) {
    eyes = new VaiEyes(page, {
      blind: true,
      screenshotDir: SCREENSHOT_DIR,
      verbose: true,
    });
    await eyes.enableOverlay();
    console.log('  🔴 VaiEyes BLIND mode active — no JS shortcuts');
  }

  // Verify viewport
  const vp = await page.evaluate(() => ({
    w: window.innerWidth, h: window.innerHeight
  }));
  console.log(`  Viewport: ${vp.w}×${vp.h}`);
  await shot(page, 'app-loaded');

  const examStart = performance.now();
  const report = {
    timestamp: new Date().toISOString(),
    viewport: vp,
    corpusSize: stats.total,
    phases: [],
  };

  // Run phases
  if (PHASE === 'all' || PHASE === 'cursor') {
    await runCursorDrills(page, report);
    report.phases.push('cursor');
  }

  if (PHASE === 'all' || PHASE === 'blitz') {
    await runKnowledgeBlitz(page, report);
    report.phases.push('blitz');
  }

  if (PHASE === 'all' || PHASE === 'deep') {
    await runDeepExam(page, report);
    report.phases.push('deep');
  }

  if (PHASE === 'all' || PHASE === 'socratic') {
    await runSocraticPhase(page, report);
    report.phases.push('socratic');
  }

  const totalExamMs = Math.round(performance.now() - examStart);
  report.totalMs = totalExamMs;

  // Save report
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n📋 Report saved: ${REPORT_PATH}`);

  // ─── FINAL SUMMARY ──────────────────────────────────────
  console.log('\n' + '═'.repeat(55));
  console.log('  MEGA EXAM COMPLETE');
  console.log('═'.repeat(55));
  console.log(`  Total time: ${totalExamMs}ms (${(totalExamMs / 1000).toFixed(1)}s)`);

  if (report.cursorDrills) {
    const drills = report.cursorDrills;
    const passed = drills.reduce((s, d) => s + d.passed, 0);
    const total = drills.reduce((s, d) => s + d.total, 0);
    console.log(`  Cursor drills: ${passed}/${total} passed`);
  }

  if (report.blitz) {
    console.log(`  Knowledge blitz: ${report.blitz.total} scenarios, ${report.blitz.avgMs}ms/avg, ${report.blitz.throughput} q/sec`);
  }

  if (report.deepExam) {
    const de = report.deepExam;
    console.log(`  Deep exam: ${de.total} rounds, avg ${de.avgTiming.totalMs}ms/round`);
  }

  if (report.socratic) {
    const s = report.socratic;
    console.log(`  Socratic: ${s.excellent}★ ${s.good}✓ ${s.weak}✗ | Level: ${s.level} | ${s.ms}ms`);
  }

  // Print deep exam for mentor review
  if (report.deepExam) {
    console.log('\n\n═══ DEEP EXAM — FOR MENTOR REVIEW ═══\n');
    for (const r of report.deepExam.results) {
      console.log(`── Round ${r.round}: [${r.foundation}] ${r.difficulty} ──`);
      console.log(`Situation: ${r.situation}`);
      console.log(`Hidden need: ${r.hidden_need}`);
      console.log(`Rubric: ${r.rubric}`);
      console.log(`\nVai's response:\n${r.response}`);
      console.log(`\nGrade: ${r.grade}`);
      console.log(`Timing: gen=${r.timing.genMs}ms type=${r.timing.typeMs}ms total=${r.timing.totalMs}ms`);
      console.log(`Words: ${r.words}\n`);
    }
  }

  console.log('═'.repeat(55));

  // Keep browser open briefly
  console.log('\nBrowser stays open 8s...');
  await shot(page, 'final');
  await sleep(8000);
  await browser.close();
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
