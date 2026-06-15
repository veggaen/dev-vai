/**
 * Capture Vai process UI progression — video + timed frames + machine-readable timeline.
 * Gives agents the same progression view a human gets when watching a turn live.
 *
 * Usage:
 *   pnpm capture:process
 *   pnpm capture:process -- --query "Build a todo app"
 *
 * Output (artifacts/process-demo/<run-id>/):
 *   vai-process.webm       — full session video
 *   frames/0001.png …      — screenshot every ~450ms
 *   timeline.json          — structured UI state per frame
 *   timeline.md            — human/agent-readable progression log
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE_OUT = path.join(ROOT, 'artifacts', 'process-demo');

const APP_URL = process.env.VAI_DEMO_URL ?? 'http://127.0.0.1:5173/?devAuthBypass=1';
const QUERY = process.argv.slice(2).find((a) => !a.startsWith('-'))?.trim()
  || process.env.VAI_DEMO_QUERY
  || 'Who is the current prime minister of Norway? Cite an official source.';
const FRAME_MS = Number(process.env.VAI_CAPTURE_FRAME_MS ?? 450);
const MAX_CAPTURE_MS = Number(process.env.VAI_CAPTURE_MAX_MS ?? 600_000);

function runId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function waitForServers() {
  for (const url of ['http://127.0.0.1:5173/', 'http://127.0.0.1:3006/api/agent/introspect']) {
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) throw new Error(`Server not ready: ${url}`);
  }
}

async function readProcessSnapshot(page) {
  return page.evaluate(() => {
    const trees = [...document.querySelectorAll('[data-testid="process-tree"]')];
    const tree = trees.at(-1) ?? null;
    const strip = document.querySelector('[data-testid="composer-process-strip"]');
    const phase = tree?.getAttribute('data-phase') ?? null;
    const live = tree?.getAttribute('data-live') ?? null;

    const timelineRoot = tree?.querySelector('ol.process-tree__timeline')
      ?? document.querySelector('ol.process-tree__timeline');
    const stepLabels = [...(timelineRoot?.querySelectorAll(':scope > li.process-tree__step > button.process-tree__row') ?? [])]
      .map((el) => el.textContent?.replace(/\s+/g, ' ').trim().replace(/\d+\.?\d*(ms|s)$/i, '').trim() ?? '')
      .filter(Boolean)
      .slice(0, 16);

    const stripLabel = strip?.querySelector('.composer-process-strip__label')?.textContent?.trim() ?? null;
    const stripSub = strip?.querySelector('.composer-process-strip__sub')?.textContent?.trim() ?? null;
    const stripMeta = strip?.querySelector('.composer-process-strip__meta')?.textContent?.trim() ?? null;

    const answerPreview = (() => {
      const bubbles = document.querySelectorAll('[data-testid="message-bubble-assistant"], .message-bubble--assistant');
      const last = bubbles[bubbles.length - 1];
      const text = last?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      return text.slice(0, 180);
    })();

    const streaming = Boolean(document.querySelector('button[title="Stop generating"]'));
    const thinking = document.querySelector('[data-testid="thinking-panel"]')?.textContent?.slice(0, 80) ?? null;
    const thinkingVisible = Boolean(document.querySelector('[data-testid="thinking-panel"]'));
    const summaryBtn = tree?.querySelector('button[aria-expanded]') ?? null;
    const summaryExpanded = summaryBtn?.getAttribute('aria-expanded') === 'true';
    const liveTailVisible = Boolean(tree?.querySelector('.process-tree__tail'));

    return {
      phase,
      live,
      stepCount: stepLabels.length,
      steps: stepLabels,
      strip: strip ? { label: stripLabel, sub: stripSub, meta: stripMeta } : null,
      streaming,
      answerPreview: answerPreview || null,
      thinking,
      thinkingVisible,
      summaryExpanded,
      treeBodyVisible,
      liveTailVisible,
    };
  });
}

function writeTimelineMd(outDir, entries) {
  const lines = [
    '# Vai process UI progression',
    '',
    `Query: ${QUERY}`,
    `Frames: ${entries.length} · interval ~${FRAME_MS}ms`,
    '',
  ];

  let prevKey = '';
  for (const entry of entries) {
    const key = JSON.stringify({
      phase: entry.snapshot.phase,
      steps: entry.snapshot.steps,
      strip: entry.snapshot.strip?.label,
      streaming: entry.snapshot.streaming,
    });
    if (key === prevKey) continue;
    prevKey = key;

    lines.push(`## ${entry.elapsed}s (frame ${entry.frame})`);
    lines.push(`- **Phase:** ${entry.snapshot.phase ?? '—'} · live=${entry.snapshot.live ?? '—'} · streaming=${entry.snapshot.streaming}`);
    if (entry.snapshot.strip) {
      lines.push(`- **Composer:** ${entry.snapshot.strip.label}${entry.snapshot.strip.sub ? ` · ${entry.snapshot.strip.sub}` : ''} (${entry.snapshot.strip.meta ?? ''})`);
    }
    if (entry.snapshot?.steps?.length > 0) {
      lines.push('- **Timeline:**');
      for (const step of entry.snapshot.steps) {
        lines.push(`  - ${step.slice(0, 120)}`);
      }
    }
    if (entry.snapshot?.answerPreview) {
      lines.push(`- **Answer:** ${entry.snapshot.answerPreview.slice(0, 120)}…`);
    }
    if (entry.snapshot?.summaryExpanded !== undefined) {
      lines.push(`- **Seed expanded:** ${entry.snapshot.summaryExpanded} · body=${entry.snapshot.treeBodyVisible}`);
    }
    if (entry.frozenHint) {
      lines.push(`- **⚠ Frozen hint:** ${entry.frozenHint}`);
    }
    lines.push('');
  }

  fs.writeFileSync(path.join(outDir, 'timeline.md'), lines.join('\n'), 'utf8');
}

function detectFrozen(entries) {
  let stallMs = 0;
  let stallStart = 0;
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const cur = entries[i];
    const dt = cur.elapsedMs - prev.elapsedMs;
    const sameSteps = JSON.stringify(prev.snapshot?.steps) === JSON.stringify(cur.snapshot?.steps);
    const sameStrip = prev.snapshot?.strip?.label === cur.snapshot?.strip?.label
      && prev.snapshot?.strip?.sub === cur.snapshot?.strip?.sub;
    const samePhase = prev.snapshot?.phase === cur.snapshot?.phase;

    if (cur.snapshot?.streaming && sameSteps && sameStrip && samePhase) {
      stallMs += dt;
      if (!stallStart) stallStart = prev.elapsedMs;
      if (stallMs >= 3000) {
        cur.frozenHint = `No visible change for ${(stallMs / 1000).toFixed(1)}s while streaming (since ${(stallStart / 1000).toFixed(1)}s)`;
      }
    } else {
      stallMs = 0;
      stallStart = 0;
    }
  }
}

await waitForServers();

const id = runId();
const outDir = path.join(BASE_OUT, id);
const framesDir = path.join(outDir, 'frames');
fs.mkdirSync(framesDir, { recursive: true });

console.log(`[capture] run ${id}`);
console.log(`[capture] output → ${outDir}`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: outDir, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();

const startedAt = Date.now();
const timeline = [];
const events = [];
let frame = 0;
let capturing = true;
let prevEventKey = '';

function pushEvent(elapsedMs, type, detail, snapshot) {
  events.push({ elapsedMs, elapsed: (elapsedMs / 1000).toFixed(2), type, detail, snapshot: {
    phase: snapshot?.phase,
    stepCount: snapshot?.stepCount,
    steps: snapshot?.steps,
    streaming: snapshot?.streaming,
    thinkingVisible: snapshot?.thinkingVisible,
  } });
}

const captureLoop = (async () => {
  while (capturing) {
    frame += 1;
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > MAX_CAPTURE_MS) break;

    let snapshot;
    try {
      snapshot = await readProcessSnapshot(page);
    } catch {
      snapshot = { error: 'snapshot failed' };
    }

    const framePath = path.join(framesDir, `${String(frame).padStart(4, '0')}.png`);
    try {
      await page.screenshot({ path: framePath, fullPage: false });
    } catch {
      /* page may be closing */
    }

    timeline.push({
      frame,
      elapsedMs,
      elapsed: (elapsedMs / 1000).toFixed(1),
      snapshot,
      frameFile: `frames/${String(frame).padStart(4, '0')}.png`,
    });

    const eventKey = JSON.stringify({
      phase: snapshot?.phase,
      stepCount: snapshot?.stepCount,
      steps: snapshot?.steps,
      streaming: snapshot?.streaming,
      thinkingVisible: snapshot?.thinkingVisible,
      strip: snapshot?.strip?.label,
    });
    if (eventKey !== prevEventKey) {
      const prev = prevEventKey ? JSON.parse(prevEventKey) : null;
      let type = 'ui-change';
      if (!prev) type = 'start';
      else if (snapshot?.stepCount > (prev.stepCount ?? 0)) type = 'step-added';
      else if (snapshot?.phase === 'settled' && prev.phase !== 'settled') type = 'settled';
      else if (snapshot?.phase === 'settling' && prev.phase === 'live') type = 'settling';
      else if (!snapshot?.streaming && prev.streaming) type = 'stream-end';
      else if (snapshot?.thinkingVisible && !prev.thinkingVisible) type = 'duplicate-thinking-panel';
      pushEvent(elapsedMs, type, snapshot?.steps?.at(-1) ?? snapshot?.strip?.label ?? '', snapshot);
      prevEventKey = eventKey;
    }

    await page.waitForTimeout(FRAME_MS);
  }
})();

console.log(`[capture] navigate → ${APP_URL}`);
await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('textarea', { timeout: 90_000 });
await page.waitForTimeout(1200);

console.log('[capture] send query…');
const textarea = page.locator('textarea').first();
await textarea.click();
await textarea.fill(QUERY);
await page.keyboard.press('Enter');

await page.waitForSelector('[data-testid="process-tree"], [data-testid="composer-process-strip"]', {
  timeout: 25_000,
}).catch(() => {});

console.log('[capture] waiting for stream to start…');
await page.waitForFunction(
  () => Boolean(document.querySelector('button[title="Stop generating"]')),
  { timeout: 90_000 },
).catch(() => {
  console.warn('[capture] stream never showed stop button — continuing anyway');
});

console.log('[capture] waiting for stream to end…');
await page.waitForFunction(() => !document.querySelector('button[title="Stop generating"]'), {
  timeout: 600_000,
  polling: 500,
}).catch(() => {
  console.warn('[capture] timed out waiting for stream end');
});

await page.waitForTimeout(2000);

// Keep capturing through settle + expand regression
await page.locator('[data-testid="process-tree"]').last().scrollIntoViewIfNeeded().catch(() => {});

console.log('[capture] waiting for settled process seed…');
await page.waitForSelector('[data-testid="process-tree"][data-phase="settled"]', { timeout: 45_000 }).catch(() => {
  console.warn('[capture] process tree never reached settled phase');
});
await page.waitForTimeout(900);

// Post-turn: verify collapsed seed expands on click (regression for settled ProcessTree)
let expandRegression = null;
try {
  const settled = page.locator('[data-testid="process-tree"][data-phase="settled"]').last();
  await settled.waitFor({ state: 'visible', timeout: 5000 });
  await settled.scrollIntoViewIfNeeded();
  const beforeExpand = await readProcessSnapshot(page);
  const summary = settled.locator('button[aria-expanded]').first();
  await summary.click({ timeout: 5000 });
  await page.waitForTimeout(500);
  const afterExpand = await readProcessSnapshot(page);
  pushEvent(Date.now() - startedAt, 'post-turn-expand-click', `steps ${beforeExpand.stepCount} → ${afterExpand.stepCount}`, afterExpand);
  if (!afterExpand.summaryExpanded || !afterExpand.treeBodyVisible || afterExpand.stepCount === 0) {
    expandRegression = {
      before: beforeExpand,
      after: afterExpand,
      message: 'Process seed did not expand after click (summaryExpanded/treeBodyVisible/stepCount)',
    };
  }
} catch (err) {
  expandRegression = {
    message: `Post-turn expand check failed: ${err instanceof Error ? err.message : String(err)}`,
  };
}

capturing = false;
await captureLoop;

const video = page.video();
await page.close();
await context.close();

const videoPath = path.join(outDir, 'vai-process.webm');
if (video) {
  try {
    await video.saveAs(videoPath);
    console.log(`[capture] video → ${videoPath}`);
  } catch (err) {
    console.warn(`[capture] video save failed: ${err instanceof Error ? err.message : err}`);
  }
}
await browser.close();

detectFrozen(timeline);
fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify({ query: QUERY, frameMs: FRAME_MS, entries: timeline, events }, null, 2));
fs.writeFileSync(path.join(outDir, 'events.json'), JSON.stringify(events, null, 2));
writeTimelineMd(outDir, timeline);

const frozenCount = timeline.filter((e) => e.frozenHint).length;
const dupThinking = events.filter((e) => e.type === 'duplicate-thinking-panel').length;
console.log(`[capture] frames: ${timeline.length} · events: ${events.length} · frozen hints: ${frozenCount}${dupThinking ? ` · ⚠ duplicate thinking panel: ${dupThinking}` : ''}`);
console.log(`[capture] timeline → ${path.join(outDir, 'timeline.md')}`);

if (expandRegression) {
  fs.writeFileSync(path.join(outDir, 'expand-regression.json'), JSON.stringify(expandRegression, null, 2));
  console.log(`[capture] ⚠ expand regression: ${expandRegression.message}`);
  process.exitCode = 3;
}

if (frozenCount > 0) {
  console.log('[capture] ⚠ progression stalls detected — read timeline.md');
  process.exitCode = 2;
}
