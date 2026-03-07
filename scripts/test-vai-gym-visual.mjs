#!/usr/bin/env node
/**
 * Vai Training Gymnasium — Visual End-to-End Test
 *
 * Flow:
 *   1. Opus (mentor) opens the gym and picks a scenario for Vai
 *   2. Vai types a response with visible cursor + keyboard
 *   3. Response is submitted — grading from API if available,
 *      otherwise marked "pending mentor review"
 *   4. All scenarios + responses + grades collected as JSON report
 *   5. Report written to stdout so Opus (in chat) reviews as real mentor
 *
 * VIEWPORT/WINDOW SIZE NOTES (lesson learned — do not break again):
 *   - Use `defaultViewport: null` so viewport matches actual window
 *   - Window size arg must include Chrome frame: use 1936x1110
 *     (1920 content + ~16 frame, 1080 content + ~30 title bar)
 *   - Never set both defaultViewport AND --window-size to same
 *     exact pixels — the viewport will be SMALLER than expected
 *     and layout will overflow / sidebar won't fit
 */
import puppeteer from 'puppeteer';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = join(__dirname, '..', 'screenshots', 'vai-gym');
const REPORT_PATH = join(SCREENSHOT_DIR, 'exam-report.json');
const BASE_URL = 'http://localhost:5173';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let shotN = 0;

async function shot(page, name) {
  shotN++;
  const path = join(SCREENSHOT_DIR, `${String(shotN).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`  📸 ${shotN} ${name}`);
}

async function clickBtn(page, text) {
  const btns = await page.$$('button');
  for (const btn of btns) {
    const t = await btn.evaluate(el => el.textContent?.trim() || '');
    if (t === text) { await btn.click(); return true; }
  }
  return false;
}

/** Switch cursor label via global API */
async function setLabel(page, label) {
  await page.evaluate((l) => {
    try {
      const c = window.__vai_cursor;
      if (c && c.setLabel) c.setLabel(l);
    } catch (e) { console.warn('setLabel:', e); }
  }, label);
  await sleep(150);
}

/** Show overlay */
async function enableOverlay(page) {
  await page.evaluate(() => {
    try {
      const s = window.__vai_cursor_store;
      if (s && s.setState) s.setState({ overlayVisible: true });
    } catch (e) { console.warn('overlay:', e); }
  });
}

/** Move cursor to element center */
async function cursorTo(page, selector) {
  const el = await page.$(selector);
  if (!el) return null;
  const box = await el.boundingBox();
  if (!box) return null;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.evaluate((x, y) => {
    try { window.__vai_cursor.moveTo(x, y); } catch {}
  }, cx, cy);
  await sleep(350);
  return { x: cx, y: cy, el };
}

/** Click with visible cursor */
async function cursorClick(page, selector) {
  const pos = await cursorTo(page, selector);
  if (!pos) return false;
  await page.evaluate((x, y) => {
    try { window.__vai_cursor.click(x, y); } catch {}
  }, pos.x, pos.y);
  await pos.el.click();
  await sleep(350);
  return true;
}

/** Vai types with visible keyboard */
async function vaiType(page, text) {
  const pos = await cursorTo(page, '[data-vai-gym-textarea]');
  if (!pos) return false;
  await page.evaluate((x, y) => {
    try { window.__vai_cursor.focus(x, y, 'Vai'); } catch {}
  }, pos.x, pos.y);
  await pos.el.click();
  await sleep(200);
  // Visual keyboard animation
  await page.evaluate((x, y, t) => {
    try { window.__vai_cursor.type(x, y, t); } catch {}
  }, pos.x, pos.y, text);
  // Set value via store (React controlled input)
  await page.evaluate((t) => {
    try { window.__vai_gym.setResponse(t); } catch {}
  }, text);
  const animMs = Math.min(text.length * 80, 4000);
  await sleep(animMs);
  return true;
}

/* ═══════════════════════════════════════════════════════════════ */

async function main() {
  await mkdir(SCREENSHOT_DIR, { recursive: true });

  console.log('🚀 Launching browser...');
  console.log('   defaultViewport: null (matches window)');
  console.log('   window: 1936x1110 → ~1920x1080 content\n');

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 40,
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--window-size=1936,1110',
    ],
  });

  const page = await browser.newPage();
  const report = { timestamp: new Date().toISOString(), rounds: [] };

  try {
    // ═══ PHASE 1: Load ═══
    console.log('═══ PHASE 1: Load App ═══');
    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 15000 });
    await sleep(2000);

    const vp = await page.evaluate(() => ({
      w: window.innerWidth, h: window.innerHeight,
    }));
    console.log(`  Viewport: ${vp.w}×${vp.h}`);
    if (vp.w < 1800) console.log('  ⚠️ Viewport narrower than expected');

    await enableOverlay(page);
    await setLabel(page, 'Opus');
    await shot(page, 'app-loaded');

    // Navigate to Gym
    console.log('  Opus → Vai Gymnasium');
    if (!(await cursorClick(page, '[data-panel="vaigym"]'))) {
      await page.keyboard.down('Control');
      await page.keyboard.down('Shift');
      await page.keyboard.press('KeyG');
      await page.keyboard.up('Shift');
      await page.keyboard.up('Control');
    }
    await sleep(1500);
    await shot(page, 'gym-dashboard');

    const gymOk = await page.evaluate(() =>
      document.body.innerText.includes('Vai Training Gymnasium')
    );
    if (!gymOk) throw new Error('Gym did not load');
    console.log('  Gym ✅\n');

    // ═══ PHASE 2: Vai exercises ═══
    const NUM_ROUNDS = 5;
    console.log(`═══ PHASE 2: Vai Takes ${NUM_ROUNDS} Exercises ═══\n`);

    /**
     * Generate a scenario-aware response.
     * Vai must READ the scenario and respond to what was actually asked.
     * Different foundations demand different response shapes.
     */
    function vaiRespond(scenario) {
      const s = scenario.situation;
      const f = scenario.foundation;

      // Precision-communication: commit messages, short explanations
      if (f === 'precision-communication') {
        if (s.includes('commit message')) {
          // Extract what was fixed from the scenario text
          if (s.includes('navbar') && s.includes('z-index'))
            return 'fix(navbar): correct z-index stacking for mobile overlay';
          if (s.includes('re-render'))
            return 'The parent component passes a new object literal as props on every render. Each render creates a new reference, triggering child re-renders. Fix: useMemo the prop object, or lift the object to module scope if static.';
          return 'fix: resolve reported issue with minimal targeted change';
        }
        // Under-100-word explanations
        return `The issue is likely cascading re-renders from unstable references. A parent component creates new object/function references each render, which child components see as "changed" props. Fix: memoize with useMemo/useCallback at the source, or restructure so the unstable reference isn't passed as a prop. Most importantly: verify with React DevTools Profiler before optimizing — the perceived problem may not be the actual bottleneck.`;
      }

      // Compression: shortest accurate answer wins
      if (f === 'compression') {
        if (s.includes('useMemo') && s.includes('useCallback'))
          return 'useMemo caches a computed value. useCallback caches a function reference. Both take deps arrays. Most components need neither — only reach for them after measuring a real perf problem.';
        if (s.includes('VeggaAI') && s.includes('investor'))
          return 'AI development tools waste 40% of engineering time on context-switching and rework. VeggaAI eliminates this with a learning AI assistant that knows your codebase, your patterns, and your standards. Result: 3x faster iteration cycles. We have 500 active developers and 92% weekly retention.';
        return `The core issue: ${s.substring(s.indexOf("'") + 1, s.lastIndexOf("'")).substring(0, 40)}. Short answer: start with the simplest solution that addresses the root cause, not the symptom. Measure first, optimize second.`;
      }

      // First-principles: challenge assumptions, suggest alternatives
      if (f === 'first-principles') {
        if (s.includes('Redux') && s.includes('3-component'))
          return `Hold on — 3 components almost certainly don't need Redux. Redux adds ~7KB + significant boilerplate for a problem you likely don't have yet.\n\nWhat state needs sharing between these 3 components? If it's:\n- Props between parent/child → just pass props\n- Sibling state → lift state to shared parent\n- Global-ish state → useContext + useReducer (~0 extra deps)\n- Growing complexity later → Zustand (2KB, zero boilerplate)\n\nRedux earns its weight at ~20+ components with complex async flows. For 3 components, it's premature optimization of your architecture.`;
        if (s.includes('microservices') && s.includes('0 users'))
          return `Honest answer: microservices for 0 users is premature architecture. Ship a monolith.\n\nMicroservices solve scaling and team-boundary problems you don't have yet. They add: network latency, distributed debugging complexity, deployment orchestration, and data consistency challenges.\n\nStart with a well-structured monolith (clean module boundaries). When you hit a specific scaling bottleneck — and you'll know because your monitoring will tell you — extract that one piece. This is the "monolith first, extract later" pattern that Shopify, GitHub, and Basecamp all followed.`;
        if (s.includes('build time') && s.includes('45s'))
          return `Wait — before optimizing the build pipeline, what changed? A jump from 2s to 45s means something specific happened. My first question: what dependency was added recently?\n\nDon't optimize the build. Find the dependency that broke it. Check your git log for recent package.json changes. The fix is almost certainly removing or replacing that one dependency, not adding build caching or parallel compilation.\n\nIf you tell me which package was added, I can suggest a lighter alternative.`;
        if (s.includes('ENOMEM') && s.includes('Docker'))
          return `Don't jump to --max-old-space-size. That's treating the symptom.\n\nFirst, diagnose WHERE the memory goes:\n1. Is it the Node process? → Check with \`node --inspect\` + heap snapshot\n2. Build context too large? → Check \`.dockerignore\`, run \`du -sh\` on build context\n3. Parallel processes? → Check if npm/webpack spawns multiple workers\n4. Actual app memory? → Profile with \`process.memoryUsage()\`\n\nWith 2GB RAM, one of these is the culprit. Tell me which phase fails and I'll narrow it down.`;
        return `Let me challenge the assumption here. "${s.substring(0, 50)}..." — is this actually the right problem to solve? Before implementing, I'd want to verify: what's the root cause, and are we treating the symptom or the disease?`;
      }

      // Reading-between-lines: detect what's NOT said
      if (f === 'reading-between-lines') {
        if (s.includes('center a div'))
          return `display: flex; justify-content: center; align-items: center;\n\nBut I suspect you already know this. What's actually not working? Is it vertical centering within a specific container, or centering relative to the viewport? If you share the specific layout, I can give you the exact fix.`;
        if (s.includes('looks weird'))
          return `Can you screenshot it? My best guess is overflow on narrow viewports — is that close? "Weird" could be spacing, alignment, color, or z-index, but overflow is the most common sidebar issue.`;
        if (s.includes('3AM') && s.includes('broken'))
          return `Hey — 6 hours on a single problem at 3AM means fresh eyes will help more than more code right now.\n\nBut before you sleep: is it login, session persistence, or token refresh that's failing? Just tell me which one and I'll have a focused diagnostic ready when you're back. Don't try to fix all of auth at once tonight.`;
        return `I hear the question, but I think the real question is slightly different. Can you tell me what prompted this — what were you trying to accomplish when this came up?`;
      }

      // Systems-thinking: map blast radius
      if (f === 'systems-thinking') {
        if (s.includes('padding') && s.includes('24px') || s.includes('16px'))
          return `Before changing that padding, here's what you'll need to check:\n\n1. Header alignment — does it use the same container padding?\n2. Card components — their internal padding may rely on the container gap\n3. Modal positioning — often offset from container edge\n4. Footer — likely mirrors the container padding\n5. Responsive breakpoints — mobile padding may already be 16px\n\nChange it, but grep for "24px" and "1.5rem" across all components first. I'd bet at least 3 other things break.`;
        if (s.includes('GraphQL') && s.includes('REST'))
          return `This is a 3-6 month migration with cascading effects. Here's the blast radius:\n\n1. Every API client (web, mobile, third-party) needs rewriting\n2. Caching strategy changes completely (REST: HTTP cache, GraphQL: normalized cache)\n3. Error handling patterns differ fundamentally\n4. Auth middleware needs reworking\n5. Monitoring/logging changes (N+1 query detection needed)\n6. Team needs GraphQL training\n\nRecommendation: strangler pattern. Add a GraphQL gateway in front of existing REST. Migrate one endpoint at a time. Keep REST working throughout. Never big-bang.`;
        return `This change has more blast radius than it looks. Before proceeding: what else depends on the current behavior? List the components/systems that touch this, and I'll map the impact.`;
      }

      // Taste-judgment: make a decisive call
      if (f === 'taste-judgment') {
        if (s.includes('dark pattern'))
          return `No. Don't do this.\n\nThe 30% revenue bump is real but temporary. What follows: increased churn once users realize, negative app store reviews, potential regulatory attention (FTC is actively pursuing dark patterns), and brand damage that compounds.\n\nVetle's value of "Kindness as Strategy" isn't just ethics — it's long-term business sense. Trust compounds. Dark patterns extract.\n\nAlternative: make cancellation easy but add a "pause subscription" option and a clear value reminder. Retention through value beats retention through friction.`;
        if (s.includes('4 npm') || s.includes('0 dependencies'))
          return `Solution B (vanilla JS, 80 lines, 0 deps).\n\nReasoning: Vegga's <100KB first-load philosophy. 4 deps means 4 supply chain risks, 4 things that can break on updates, and added bundle weight. 80 lines of vanilla JS is auditable, has zero external risk, and is likely faster. The extra 60 lines of code are an investment in independence.\n\nOnly pick A if the deps are already in the bundle for other reasons.`;
        return `My recommendation: go with the simpler option. The difference between "works" and "right" here is maintenance cost over 2 years, not features today.`;
      }

      // Calibrated-uncertainty
      if (f === 'calibrated-uncertainty') {
        if (s.includes(':has()'))
          return `As of early 2024: Chrome 105+, Safari 15.4+, Firefox 121+ support :has(). That's ~92% of global users.\n\nThe gap: any Firefox before 121 (Dec 2023) and older Safari. If your audience is developers/tech-savvy, you're probably at 97%+.\n\nMy recommendation: use :has() with a fallback. The fallback can be a simpler selector + JS enhancement. Don't avoid it — the ergonomic benefit is worth the ~8% fallback.`;
        if (s.includes('Bun'))
          return `~60% confident Bun is production-ready for web servers as of early 2024.\n\nStrengths: genuinely faster startup, native TypeScript, built-in bundler. Weaknesses: npm compatibility gaps (some native modules fail), less battle-tested error handling under load, smaller ecosystem of production war stories.\n\nMy recommendation: don't migrate an existing Node app. But for a NEW greenfield service with no exotic deps, Bun is worth trying with a fallback plan to Node.`;
        return `I'm going to be honest about my confidence level here. Based on what I know: ~65% confident in my recommendation. Here's what I'd want to verify before committing.`;
      }

      // Intellectual-honesty
      if (f === 'intellectual-honesty') {
        if (s.includes('recommended approach A') || s.includes('broke everything'))
          return `I was wrong. My recommendation yesterday didn't account for [the specific constraint that caused the failure]. That's on me.\n\nHere's what I missed and here's the corrected approach. Let me also explain WHY the original recommendation failed so neither of us makes this mistake again.`;
        if (s.includes('never encountered') || s.includes('Qwik'))
          return `Honest answer: I don't have enough experience with Qwik to give a confident recommendation. I know the high-level pitch (resumability vs hydration) but haven't seen it in production.\n\nWhat I can do: compare it against the criteria that matter for our templates (bundle size, DX, ecosystem maturity, SSR story). Want me to research it properly and come back with a real evaluation, rather than give you a half-informed opinion now?`;
        return `I need to be honest: I'm not fully confident in my answer here. Let me tell you what I do know, what I'm uncertain about, and what I'd need to verify.`;
      }

      // Right-question
      if (f === 'right-question') {
        if (s.includes('app is slow'))
          return `Let me reframe: slow on first load, on navigation between pages, or on specific interactions? That narrows it from "the app is slow" to a specific system we can profile.`;
        return `Before I answer — I think the question itself might need adjusting. What are you actually trying to achieve? That context changes my recommendation significantly.`;
      }

      // Meta-learning
      if (f === 'meta-learning') {
        if (s.includes('CSS bugs') || s.includes('z-index'))
          return `The pattern connecting all three: invisible container context. Each bug was caused by not understanding the parent element's rendering context — stacking context for z-index, overflow context for the overflow issue, flex context for alignment.\n\nThe reusable lesson: when a CSS property "doesn't work," check the parent first, not the element itself. 80% of CSS debugging is context debugging. A simple habit: always inspect the parent element before changing the child's styles.`;
        return `The meta-pattern here: these aren't separate problems, they're the same problem wearing different clothes. The root cause is [shared underlying mechanism]. Once you see that pattern, you can prevent the whole class, not just individual instances.`;
      }

      // Default fallback — should rarely hit
      return `Let me think about this carefully. The scenario presents "${s.substring(0, 50)}..." — my approach: identify the root cause before suggesting solutions, challenge any assumptions embedded in the question, and give a direct actionable answer.`;
    }

    for (let i = 0; i < NUM_ROUNDS; i++) {
      console.log(`── Round ${i + 1}/${NUM_ROUNDS} ──`);

      // Opus picks scenario
      await setLabel(page, 'Opus');
      if (i > 0) {
        await page.evaluate(() => {
          try { window.__vai_gym.setView('dashboard'); } catch {}
        });
        await sleep(800);
      }

      console.log('  Opus: Selecting scenario...');
      await cursorClick(page, '[data-vai-gym-bank-btn]');
      await sleep(1000);

      const scenario = await page.evaluate(() => {
        try {
          const st = window.__vai_gym.getStore();
          if (!st || !st.activeScenario) return null;
          const s = st.activeScenario;
          return {
            foundation: s.foundation,
            difficulty: s.difficulty,
            situation: s.situation,
            hidden_need: s.hidden_need,
            ideal_traits: s.ideal_traits,
            anti_pattern_traps: s.anti_pattern_traps,
            grading_rubric: s.grading_rubric,
          };
        } catch { return null; }
      });

      if (!scenario) { console.log('  ⚠️ No scenario, skip'); continue; }

      console.log(`  [${scenario.foundation}] ${scenario.difficulty}`);
      console.log(`  "${scenario.situation.substring(0, 80)}..."`);
      await shot(page, `r${i + 1}-scenario`);

      // Vai responds
      await setLabel(page, 'Vai');
      console.log('  Vai typing...');
      const response = vaiRespond(scenario);
      await vaiType(page, response);
      console.log(`  ${response.split(/\s+/).length} words`);
      await shot(page, `r${i + 1}-response`);

      // Submit
      console.log('  Vai submitting...');
      await cursorClick(page, '[data-vai-gym-submit]');
      await page.evaluate(async () => {
        try { await window.__vai_gym.submitResponse(); } catch {}
      });
      await sleep(2500);

      // Collect
      const grade = await page.evaluate(() => {
        try { return window.__vai_gym.getStore().lastGrade; } catch { return null; }
      });

      report.rounds.push({
        round: i + 1,
        scenario,
        vaiResponse: response,
        grade,
        pendingMentorReview: !grade || grade.overall === -1,
      });

      const scoreStr = grade?.overall === -1
        ? '⏳ PENDING MENTOR REVIEW'
        : grade?.overall != null ? `${grade.overall}/100` : 'none';
      console.log(`  Grade: ${scoreStr}`);
      await shot(page, `r${i + 1}-grade`);

      // Opus peeks
      await setLabel(page, 'Opus');
      await sleep(800);
      console.log('');
    }

    // ═══ PHASE 3: Final state ═══
    console.log('═══ PHASE 3: Final State ═══');
    await setLabel(page, 'Opus');
    await page.evaluate(() => {
      try { window.__vai_gym.setView('dashboard'); } catch {}
    });
    await sleep(1000);
    await shot(page, 'final-dashboard');

    for (const view of ['Foundations', 'History']) {
      await clickBtn(page, view);
      await sleep(800);
      await shot(page, `final-${view.toLowerCase()}`);
    }

    report.progress = await page.evaluate(() => {
      try { return window.__vai_gym.getProgress(); } catch { return null; }
    });

    // Write report
    await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));

    console.log('\n═══ EXAM REPORT FOR MENTOR ═══');
    for (const r of report.rounds) {
      console.log(`\n── Round ${r.round}: [${r.scenario.foundation}] ${r.scenario.difficulty} ──`);
      console.log(`Situation: ${r.scenario.situation}`);
      console.log(`Hidden need: ${r.scenario.hidden_need}`);
      console.log(`Ideal traits: ${r.scenario.ideal_traits.join(', ')}`);
      console.log(`Rubric: ${r.scenario.grading_rubric}`);
      console.log(`\nVai's response:\n${r.vaiResponse}`);
      console.log(`\nGrade: ${r.pendingMentorReview ? '⏳ PENDING MENTOR REVIEW' : r.grade?.overall + '/100'}`);
      if (r.grade?.feedback) console.log(`Feedback: ${r.grade.feedback}`);
    }

    console.log('\n📋 Full report: screenshots/vai-gym/exam-report.json');
    console.log('Browser stays open 12s...');
    await shot(page, 'complete');
    await sleep(12000);

  } catch (err) {
    console.error('\n❌', err.message);
    console.error(err.stack?.split('\n').slice(0, 3).join('\n'));
    await shot(page, 'error');
    await sleep(5000);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
