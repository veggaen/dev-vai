#!/usr/bin/env node
/**
 * Visual probe for Vai's improvement loop.
 *
 * First safe "eyes + hands" slice:
 * - opens the real desktop web surface with Playwright
 * - records video evidence
 * - moves the pointer along a curved path
 * - verifies the target is top-layered with elementFromPoint before clicking
 * - types quickly, then clears the composer without sending a turn
 * - writes screenshots + report.json for the corpus/operator trail
 *
 * Usage:
 *   node scripts/improve-loop/visual-probe.mjs
 *   node scripts/improve-loop/visual-probe.mjs --headed
 *   node scripts/improve-loop/visual-probe.mjs --app http://localhost:5173/?devAuthBypass=1 --out C:/tmp/vai-eyes
 */
import fs from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { judgeVisualExcellence } from './visual-rubric.mjs';

const ROOT = process.cwd();
const args = process.argv.slice(2);

function opt(flag, fallback) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function has(flag) {
  return args.includes(flag);
}

const APP_URL = opt('--app', process.env.VAI_APP_URL || 'http://localhost:5173/?devAuthBypass=1');
const OUT_ROOT = path.resolve(ROOT, opt('--out', 'Temporary_files/improve-loop-visual'));
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.join(OUT_ROOT, STAMP);
const VIDEO_DIR = path.join(OUT, 'video');
const REPORT_PATH = path.join(OUT, 'report.json');
const HEADLESS = !has('--headed');
const VIDEO = !has('--no-video');
const WIDTH = Number(opt('--width', '1440'));
const HEIGHT = Number(opt('--height', '900'));
const PROBE_TEXT = opt('--text', 'visual probe: eyes online');
const CHROME_PATH = opt('--chrome', process.env.VAI_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const STREAM_ARG = opt('--stream', null);
const STREAM_STDOUT = has('--stream-stdout');
const STREAM_PATH = STREAM_ARG === 'off' ? null : path.resolve(ROOT, STREAM_ARG ?? path.join(OUT, 'events.ndjson'));
// Live-frame channel: a single fixed-path JPEG the probe overwrites on a cadence WHILE it
// drives, so V3gga + the council can watch the SAME thing in near-real-time on the watch
// page (a true video file only appears after the run; this is the live surface). Default
// path is shared so the watch server always knows where to look.
const LIVE_FRAME_PATH = opt('--live-frame', 'off') === 'off' && !has('--live')
  ? null
  : path.resolve(ROOT, opt('--live-frame', 'Temporary_files/improve-loop-visual/live.jpg'));
const SEND_TURN = has('--send'); // drive a real chat turn so the POPULATED ui is judged
const TURN_PROMPT = opt('--prompt', 'Walk me through how you reach a decision — show the steps, the council, and the gates, organized clearly.');

const report = {
  createdAt: new Date().toISOString(),
  appUrl: APP_URL,
  outDir: path.relative(ROOT, OUT).replaceAll('\\', '/'),
  headless: HEADLESS,
  viewport: { width: WIDTH, height: HEIGHT },
  screenshots: [],
  eventStream: STREAM_PATH ? path.relative(ROOT, STREAM_PATH).replaceAll('\\', '/') : null,
  eventCount: 0,
  videoRequested: VIDEO,
  videoUnavailable: null,
  video: null,
  checks: [],
  pointerTrace: [],
  consoleErrors: [],
  consoleWarnings: [],
  pageErrors: [],
  failedRequests: [],
  blockedExternalResources: [],
  browserExecutable: null,
  signals: null,
  rubric: null,
  turnDriven: false,
  processUi: null,
  processUiFinal: null,
  liveFramePath: LIVE_FRAME_PATH ? path.relative(ROOT, LIVE_FRAME_PATH).replaceAll('\\', '/') : null,
  passed: false,
};

function emitEvent(type, data = {}) {
  if (!STREAM_PATH && !STREAM_STDOUT) return;
  const event = {
    seq: report.eventCount + 1,
    ts: new Date().toISOString(),
    type,
    data,
  };
  report.eventCount = event.seq;
  const line = `${JSON.stringify(event)}\n`;
  if (STREAM_PATH) appendFileSync(STREAM_PATH, line, 'utf8');
  if (STREAM_STDOUT) process.stdout.write(line);
}

function recordCheck(name, passed, detail = '') {
  report.checks.push({ name, passed, detail });
  emitEvent('check', { name, passed, detail });
  process.stdout.write(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}\n`);
}

async function screenshot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  const relative = path.relative(ROOT, file).replaceAll('\\', '/');
  report.screenshots.push(relative);
  emitEvent('vision.snapshot', { name, path: relative, viewport: { width: WIDTH, height: HEIGHT } });
}

// ── Live-frame channel ────────────────────────────────────────────────────────
// Overwrite a single fixed JPEG on a cadence so the watch page (and a human, and the
// council) see what the probe sees in near-real-time. Atomic-ish: write to a temp file
// then rename, so a reader never sees a half-written frame.
let liveFrameCount = 0;
let liveFrameTimer = null;
async function writeLiveFrame(page) {
  if (!LIVE_FRAME_PATH) return;
  try {
    const tmp = `${LIVE_FRAME_PATH}.tmp`;
    await page.screenshot({ path: tmp, type: 'jpeg', quality: 55, fullPage: false });
    await fs.rename(tmp, LIVE_FRAME_PATH);
    liveFrameCount += 1;
    emitEvent('vision.liveframe', { seq: liveFrameCount, path: path.relative(ROOT, LIVE_FRAME_PATH).replaceAll('\\', '/') });
  } catch {
    /* a dropped frame is fine — the next tick recovers */
  }
}
function startLiveFrames(page, intervalMs = 500) {
  if (!LIVE_FRAME_PATH || liveFrameTimer) return;
  const tick = async () => { await writeLiveFrame(page); liveFrameTimer = setTimeout(tick, intervalMs); };
  liveFrameTimer = setTimeout(tick, 0);
}
function stopLiveFrames() {
  if (liveFrameTimer) { clearTimeout(liveFrameTimer); liveFrameTimer = null; }
}
/** Live cache-log line: a step-by-step "what I'm doing now" the human can read in the stream. */
function cacheLog(message) {
  emitEvent('cache.log', { message });
  process.stdout.write(`[cache] ${message}\n`);
}

function curvedPath(from, to, steps = 18) {
  const cp1 = { x: from.x + (to.x - from.x) * 0.28, y: from.y + (to.y - from.y) * 0.08 + 24 };
  const cp2 = { x: from.x + (to.x - from.x) * 0.74, y: from.y + (to.y - from.y) * 0.92 - 18 };
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const inv = 1 - t;
    const x = inv ** 3 * from.x + 3 * inv ** 2 * t * cp1.x + 3 * inv * t ** 2 * cp2.x + t ** 3 * to.x;
    const y = inv ** 3 * from.y + 3 * inv ** 2 * t * cp1.y + 3 * inv * t ** 2 * cp2.y + t ** 3 * to.y;
    points.push({ x: Math.round(x), y: Math.round(y) });
  }
  return points;
}

async function movePointer(page, from, to) {
  const points = curvedPath(from, to);
  for (const point of points) {
    await page.mouse.move(point.x, point.y);
    report.pointerTrace.push(point);
    emitEvent('hand.pointer', point);
    await page.waitForTimeout(8);
  }
}

async function targetAtPoint(page, locator) {
  const box = await locator.boundingBox();
  if (!box) return { ok: false, detail: 'target has no bounding box' };
  const point = {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };
  const result = await locator.evaluate((target, p) => {
    const top = document.elementFromPoint(p.x, p.y);
    const label = (el) => {
      if (!el) return null;
      const id = el.id ? `#${el.id}` : '';
      const classes = typeof el.className === 'string'
        ? `.${el.className.trim().split(/\s+/).filter(Boolean).slice(0, 4).join('.')}`
        : '';
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      return `${el.tagName.toLowerCase()}${id}${classes}${text ? ` "${text}"` : ''}`;
    };
    return {
      targetLabel: label(target),
      topLabel: label(top),
      targetReceivesPointer: target === top || target.contains(top),
    };
  }, point);
  emitEvent('vision.target', { point, ...result });
  return { ok: result.targetReceivesPointer, point, ...result };
}

// Google Fonts are an external, optional decoration. Under a restricted network they
// fail with ERR_NETWORK_ACCESS_DENIED; when the network is open they can still fail a
// CORS preflight because we inject the x-vai-dev-auth-bypass header (which the fonts CDN
// does not allow), surfacing as ERR_FAILED. Neither is a Vai defect — classify both as
// expected optional-resource warnings so the probe doesn't fail on its own injected header.
function isOptionalFontUrl(url) {
  return url.startsWith('https://fonts.googleapis.com/') || url.startsWith('https://fonts.gstatic.com/');
}

function isKnownOptionalBlockedResource(url, error) {
  return isOptionalFontUrl(url) && (error.includes('ERR_NETWORK_ACCESS_DENIED') || error.includes('ERR_FAILED'));
}

function isGenericNetworkConsoleError(text) {
  if (text === 'Failed to load resource: net::ERR_NETWORK_ACCESS_DENIED') return true;
  if (text === 'Failed to load resource: net::ERR_FAILED') return true;
  // CORS preflight rejection of our injected dev-auth-bypass header on the fonts CDN.
  return /has been blocked by CORS policy/.test(text) &&
    /x-vai-dev-auth-bypass/.test(text) && isOptionalFontUrl(text.match(/https?:\/\/\S+/)?.[0] ?? '');
}

/**
 * Measure deterministic visual signals from the LIVE DOM — geometry, computed styles,
 * top-layer hit testing, contrast. No taste judgments here: this only reports what is.
 * The rubric (visual-rubric.mjs) turns these numbers into scores/flaws.
 */
async function gatherVisualSignals(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const parseColor = (v) => {
      const s = v || '';
      // Modern color(srgb r g b / a) — values are 0..1 fractions.
      const cm = s.match(/color\(srgb\s+([^)]+)\)/i);
      if (cm) {
        const parts = cm[1].split('/');
        const rgb = parts[0].trim().split(/\s+/).map((x) => parseFloat(x));
        if (rgb.length >= 3 && rgb.every((n) => !Number.isNaN(n))) {
          const a = parts[1] != null ? parseFloat(parts[1]) : 1;
          return { r: rgb[0] * 255, g: rgb[1] * 255, b: rgb[2] * 255, a: Number.isNaN(a) ? 1 : a };
        }
      }
      const m = s.match(/rgba?\(([^)]+)\)/i);
      if (!m) return null;
      const p = m[1].split(/[,\s/]+/).map((x) => parseFloat(x.trim())).filter((n) => !Number.isNaN(n));
      return p.length >= 3 ? { r: p[0], g: p[1], b: p[2], a: p.length >= 4 ? p[3] : 1 } : null;
    };
    const lum = ({ r, g, b }) => {
      const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const contrast = (fg, bg) => { const a = lum(fg) + 0.05, b = lum(bg) + 0.05; return a > b ? a / b : b / a; };
    // Resolve the effective (opaque) background by walking ancestors until alpha≈1.
    // Returns null when no opaque ancestor bg exists — we must NOT invent white and then
    // report a fake low-contrast flaw (that false positive trains Vai on noise).
    const effectiveBg = (el) => {
      let node = el;
      while (node && node !== document.documentElement) {
        const c = parseColor(getComputedStyle(node).backgroundColor);
        if (c && c.a >= 0.95) return c;
        node = node.parentElement;
      }
      const htmlBg = parseColor(getComputedStyle(document.documentElement).backgroundColor);
      if (htmlBg && htmlBg.a >= 0.95) return htmlBg;
      const bodyBg = parseColor(getComputedStyle(document.body).backgroundColor);
      if (bodyBg && bodyBg.a >= 0.95) return bodyBg;
      return null;
    };
    const sel = (el) => {
      if (!el) return null;
      const id = el.id ? `#${el.id}` : '';
      const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map((c) => `.${c}`).join('') : '';
      return `${el.tagName.toLowerCase()}${id}${cls}`;
    };

    const all = Array.from(document.querySelectorAll('body *')).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });

    // Composition: distinct font sizes, colors, density (painted area / viewport).
    const fontSizes = new Set();
    const colors = new Set();
    const fontFamilies = new Set();
    let glassmorphismCount = 0;
    let purpleGradientCount = 0;
    for (const el of all) {
      const cs = getComputedStyle(el);
      fontSizes.add(cs.fontSize);
      colors.add(cs.color);
      fontFamilies.add(cs.fontFamily);
      const r = el.getBoundingClientRect();
      if ((cs.backdropFilter && cs.backdropFilter !== 'none') || (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none')) glassmorphismCount += 1;
      const bgImg = cs.backgroundImage || '';
      if (/gradient/i.test(bgImg) && /(rgb\(1[23]\d|rgb\([6-9]\d,\s*\d+,\s*2[0-5]\d)|purple|violet|indigo|#[89ab][0-9a-f]f|#7[0-9a-f]{2}f/i.test(bgImg)) {
        if (r.width * r.height > vw * vh * 0.12) purpleGradientCount += 1;
      }
    }
    // Content density = grid-sampled "is something meaningful here" COVERAGE, not summed
    // background area (which double-counts every nested element and always saturates to 1).
    // Sample a 16×10 grid; a cell counts if elementFromPoint there is text/media/control, not
    // a bare layout container. This is a real "how full does the screen feel" estimate.
    const COLS = 16, ROWS = 10;
    let filledCells = 0;
    for (let cx = 0; cx < COLS; cx += 1) {
      for (let cy = 0; cy < ROWS; cy += 1) {
        const px = Math.round(((cx + 0.5) / COLS) * vw);
        const py = Math.round(((cy + 0.5) / ROWS) * vh);
        const hit = document.elementFromPoint(px, py);
        if (!hit) continue;
        const media = /^(img|svg|canvas|video|input|textarea|button|a|select)$/.test(hit.tagName.toLowerCase());
        const ownText = Array.from(hit.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
        // A styled surface (own background or border distinct from the page) also counts as
        // "something is here" — sidebars, cards, and panels are real content, not empty space.
        const cs = getComputedStyle(hit);
        const bg = parseColor(cs.backgroundColor);
        const styledSurface = (bg && bg.a > 0.04) || (parseFloat(cs.borderTopWidth) || 0) > 0;
        if (ownText || media || styledSurface) filledCells += 1;
      }
    }
    const contentDensity = filledCells / (COLS * ROWS);

    // Card nesting depth: how deep do "card-like" containers stack?
    const isCard = (el) => {
      const cs = getComputedStyle(el);
      const radius = parseFloat(cs.borderRadius) || 0;
      const hasBorder = (parseFloat(cs.borderTopWidth) || 0) > 0;
      const hasShadow = cs.boxShadow && cs.boxShadow !== 'none';
      const bg = parseColor(cs.backgroundColor);
      return (radius >= 6 || hasBorder || hasShadow) && bg && bg.a > 0.05;
    };
    let maxCardNestingDepth = 0;
    for (const el of all) {
      if (!isCard(el)) continue;
      let depth = 1; let p = el.parentElement;
      while (p && p !== document.body) { if (isCard(p)) depth += 1; p = p.parentElement; }
      if (depth > maxCardNestingDepth) maxCardNestingDepth = depth;
    }

    // Oversized empty hero: a very large element holding very little text AND few children.
    // Skip the app shell / layout roots (they're legitimately large + sparse-of-direct-text):
    // a real "empty hero" is a leaf-ish block that occupies a big area with almost nothing in it.
    let oversizedEmptyHero = false;
    const rootish = new Set(['html', 'body', 'main']);
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width * r.height <= vw * vh * 0.45) continue;
      if (rootish.has(el.tagName.toLowerCase())) continue;
      if (el.id === 'root' || el.id === 'app' || el === document.body.firstElementChild) continue;
      const txt = (el.innerText || '').trim().length;
      const descendants = el.querySelectorAll('*').length;
      // Genuinely empty hero = big area, < 30 chars of text, and few descendants (not a packed shell).
      if (txt < 30 && descendants < 6) { oversizedEmptyHero = true; break; }
    }

    // Invisible/low-contrast text: sample elements that directly hold text.
    const invisibleText = [];
    const textEls = all.filter((el) => {
      const direct = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
      return direct;
    }).slice(0, 400);
    for (const el of textEls) {
      const cs = getComputedStyle(el);
      // Skip text that is intentionally hidden (visually-hidden a11y spans etc.) — not a flaw.
      if (cs.opacity === '0' || cs.visibility === 'hidden' || cs.display === 'none') continue;
      const fg = parseColor(cs.color);
      // Truly transparent text color = a real invisible-text signal (contrast unmeasurable).
      if (fg && fg.a < 0.1) { invisibleText.push({ selector: sel(el), contrast: 0, fg: cs.color, bg: 'transparent' }); continue; }
      if (!fg) continue; // unparseable color → don't fabricate a verdict
      const bg = effectiveBg(el);
      if (!bg) continue; // background indeterminate → unknown, not a flaw
      const ratio = contrast(fg, bg);
      const size = parseFloat(cs.fontSize) || 16;
      const large = size >= 24 || (size >= 18.66 && (parseInt(cs.fontWeight, 10) || 400) >= 700);
      const min = large ? 3 : 4.5;
      if (ratio < min) invisibleText.push({ selector: sel(el), contrast: ratio, fg: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})` });
    }

    // Unexpected scrollbar (horizontal is the real smell; vertical is often legit).
    const unexpectedScrollbar = document.documentElement.scrollWidth > vw + 1 ? 'x' : null;

    return {
      viewport: { width: vw, height: vh },
      distinctFontSizes: fontSizes.size,
      distinctColors: colors.size,
      usesCustomFont: Array.from(fontFamilies).some((f) => !/^(?:-apple-system|system-ui|sans-serif|serif|monospace|arial|helvetica)/i.test(f.trim())),
      contentDensity,
      glassmorphismCount,
      purpleGradientCount,
      maxCardNestingDepth,
      oversizedEmptyHero,
      invisibleText: invisibleText.slice(0, 12),
      unexpectedScrollbar,
    };
  });
}

/** Measure interaction-feel signals by actually using a control: focus ring presence.
 *  IMPORTANT: leaves the element FOCUSED (re-focus at the end) so the typing pass that
 *  follows still lands in the composer — an earlier version blurred it and broke input. */
async function measureInteractionSignals(page, locator) {
  try {
    return await locator.evaluate((el) => {
      const snapshot = () => {
        const cs = getComputedStyle(el);
        return { outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, boxShadow: cs.boxShadow, border: cs.borderColor };
      };
      const wasActive = document.activeElement === el;
      el.blur();
      const base = snapshot();
      el.focus();
      const focused = snapshot();
      const focusRingVisible = focused.outline !== base.outline || focused.boxShadow !== base.boxShadow || focused.border !== base.border;
      if (!wasActive) { /* keep it focused for the typing pass */ }
      el.focus();
      return { focusRingVisible };
    });
  } catch {
    return { focusRingVisible: null };
  }
}

/** Measure hover style delta + click-target transition timing on a primary button. */
async function measureHoverAndMotion(page) {
  const button = page.locator('button:visible').first();
  if (await button.count() === 0) return { hoverStateDelta: null, primaryTransitionMs: null, primaryEasing: null };
  const before = await button.evaluate((el) => {
    const cs = getComputedStyle(el);
    const dur = (cs.transitionDuration || '0s').split(',')[0].trim();
    const ms = dur.endsWith('ms') ? parseFloat(dur) : parseFloat(dur) * 1000;
    return {
      sig: `${cs.backgroundColor}|${cs.boxShadow}|${cs.transform}|${cs.color}`,
      transitionMs: Number.isFinite(ms) ? Math.round(ms) : null,
      easing: (cs.transitionTimingFunction || '').split(',')[0].trim(),
    };
  }).catch(() => null);
  if (!before) return { hoverStateDelta: null, primaryTransitionMs: null, primaryEasing: null };
  await button.hover().catch(() => undefined);
  await page.waitForTimeout(120);
  const afterSig = await button.evaluate((el) => {
    const cs = getComputedStyle(el);
    return `${cs.backgroundColor}|${cs.boxShadow}|${cs.transform}|${cs.color}`;
  }).catch(() => before.sig);
  return {
    hoverStateDelta: afterSig !== before.sig,
    primaryTransitionMs: before.transitionMs,
    primaryEasing: before.easing,
  };
}

/**
 * Inspect the PROCESS UI (Timeline preferred, ProcessTree fallback) the way V3gga asked:
 * is the ONE in-focus / current-time block, on its own, rich and self-explanatory? Does it
 * carry a title, a summary, a gate/badge, a duration — enough that a human understands what
 * is happening without expanding? Is the focused block visually distinct from the rest? Is it
 * readable, and does it sit calmly (not overflowing/clipped)? All MEASURED, not vibed.
 *
 * Grounded in apps/desktop/src/components/chat/Timeline.tsx: the timeline root is
 * data-testid="turn-timeline" (data-live), rows are <li class="timeline-phase"> inside
 * <ol class="timeline-rail">, the running phase title uses --chat-strong, gates render a
 * badge, and duration renders as tabular-nums text.
 */
async function inspectProcessUi(page) {
  return page.evaluate(() => {
    const tl = document.querySelector('[data-testid="turn-timeline"]');
    const pt = document.querySelector('[data-testid="process-tree"], [data-process-tree]');
    const surfaceEl = tl || pt || document.querySelector('.timeline-rail')?.closest('[data-testid],div') || null;
    const which = tl ? 'timeline' : pt ? 'process-tree' : surfaceEl ? 'timeline-rail' : null;
    if (!surfaceEl) return { present: false, surface: null };

    const rect = (el) => el.getBoundingClientRect();
    const within = (el) => { const r = rect(el); return r.right <= window.innerWidth + 1 && r.left >= -1 && r.width > 0 && r.height > 0; };
    const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

    // All step rows in render order.
    const rows = Array.from(surfaceEl.querySelectorAll('li.timeline-phase, [data-testid="process-row"], li'));
    const live = surfaceEl.getAttribute('data-live') === '1';

    // The FOCUSED / current-time block: a running phase uses --chat-strong on its title and a
    // "thinking" glyph; otherwise fall back to the last row (most recent = current).
    const isRunningRow = (row) => {
      // running title color OR an animated/thinking glyph OR aria-current
      const strong = row.querySelector('[class*="chat-strong"]');
      const thinking = row.querySelector('[data-state="thinking"], .vai-node, svg.animate-spin');
      return !!strong || (live && !!thinking) || row.getAttribute('aria-current') === 'step';
    };
    let focused = rows.find(isRunningRow) || rows[rows.length - 1] || null;

    const describeBlock = (row) => {
      if (!row) return null;
      const r = rect(row);
      // What information does this ONE block carry on its own?
      const title = txt(row.querySelector('span, .font-medium, [class*="chat-body"], [class*="chat-strong"]')) || txt(row).slice(0, 80);
      const fullText = txt(row);
      const hasSummary = fullText.length > (title.length + 4); // text beyond the bare title
      const hasGate = !!row.querySelector('[class*="rounded-full"]') && /approved|best-so-far|council|verify|redraft|%/i.test(fullText);
      const hasDuration = /\b\d+(\.\d+)?\s?(ms|s)\b/.test(fullText);
      const hasGlyph = !!row.querySelector('svg, .vai-node');
      const expandable = !!row.querySelector('button[aria-expanded], [class*="ChevronRight"], svg');
      // self-explanatory score: how many independent cues does the block carry?
      const cues = [Boolean(title && title.length >= 3), hasSummary, hasGate, hasDuration, hasGlyph].filter(Boolean).length;
      return {
        title: title.slice(0, 100),
        textLen: fullText.length,
        hasSummary, hasGate, hasDuration, hasGlyph, expandable,
        selfExplanatoryCues: cues, // 0..5
        box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        clipped: !within(row),
      };
    };

    // Is the focused block visually DISTINCT from the others? Compare computed style deltas.
    let focusDistinct = null;
    if (focused && rows.length > 1) {
      const other = rows.find((r) => r !== focused);
      const fc = getComputedStyle(focused);
      const oc = other ? getComputedStyle(other) : null;
      focusDistinct = oc ? (fc.color !== oc.color || fc.fontWeight !== oc.fontWeight || fc.backgroundColor !== oc.backgroundColor) : null;
    }

    const sr = rect(surfaceEl);
    return {
      present: true,
      surface: which,
      live,
      rowCount: rows.length,
      surfaceClipped: !within(surfaceEl),
      surfaceBox: { w: Math.round(sr.width), h: Math.round(sr.height) },
      focusedBlock: describeBlock(focused),
      focusDistinct,
    };
  });
}

await fs.mkdir(VIDEO_DIR, { recursive: true });
const executablePath = await fs.access(CHROME_PATH).then(() => CHROME_PATH).catch(() => undefined);
report.browserExecutable = executablePath || 'playwright-managed';
emitEvent('probe.start', {
  appUrl: APP_URL,
  outDir: report.outDir,
  eventStream: report.eventStream,
  headless: HEADLESS,
  viewport: report.viewport,
  browserExecutable: report.browserExecutable,
  videoRequested: VIDEO,
});

let browser;
let context;
let page;
let videoHandle;

async function openContextWithOptionalVideo() {
  const base = {
    viewport: { width: WIDTH, height: HEIGHT },
    extraHTTPHeaders: { 'x-vai-dev-auth-bypass': '1' },
  };
  if (!VIDEO) {
    context = await browser.newContext(base);
    page = await context.newPage();
    emitEvent('video.disabled');
    return;
  }
  try {
    context = await browser.newContext({
      ...base,
      recordVideo: { dir: VIDEO_DIR, size: { width: WIDTH, height: HEIGHT } },
    });
    page = await context.newPage();
    videoHandle = page.video();
    emitEvent('video.recording', { dir: path.relative(ROOT, VIDEO_DIR).replaceAll('\\', '/') });
  } catch (error) {
    await context?.close().catch(() => undefined);
    context = null;
    page = null;
    videoHandle = null;
    report.videoUnavailable = String(error).slice(0, 500);
    emitEvent('video.unavailable', { error: report.videoUnavailable });
    context = await browser.newContext(base);
    page = await context.newPage();
  }
}

try {
  browser = await chromium.launch({ headless: HEADLESS, executablePath });
  await openContextWithOptionalVideo();

  page.on('console', (message) => {
    if (message.type() === 'error') {
      const text = message.text().slice(0, 500);
      if (isGenericNetworkConsoleError(text)) {
        report.consoleWarnings.push(text);
        emitEvent('console.warning', { text });
        return;
      }
      report.consoleErrors.push(text);
      emitEvent('console.error', { text });
    }
  });
  page.on('pageerror', (error) => {
    const text = String(error).slice(0, 500);
    report.pageErrors.push(text);
    emitEvent('page.error', { text });
  });
  page.on('requestfailed', (request) => {
    const error = request.failure()?.errorText || '';
    if (error === 'net::ERR_ABORTED') return;
    if (isKnownOptionalBlockedResource(request.url(), error)) {
      const text = `${request.method()} ${request.url()} ${error}`.slice(0, 500);
      report.blockedExternalResources.push(text);
      emitEvent('request.blocked_external', { text });
      return;
    }
    const text = `${request.method()} ${request.url()} ${error}`.slice(0, 500);
    report.failedRequests.push(text);
    emitEvent('request.failed', { text });
  });

  emitEvent('page.goto', { url: APP_URL });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  const pageState = await page.evaluate(() => ({
    title: document.title,
    url: location.href,
    activeTag: document.activeElement?.tagName?.toLowerCase() ?? null,
    bodyTextLength: document.body?.innerText?.length ?? 0,
  }));
  emitEvent('vision.dom', pageState);
  await screenshot(page, '01-loaded');

  // Start the live stream the moment the app is up so V3gga + council watch the SAME frames.
  if (LIVE_FRAME_PATH) { cacheLog(`live stream ON → ${path.relative(ROOT, LIVE_FRAME_PATH).replaceAll('\\', '/')} (watch page shows it)`); startLiveFrames(page, 450); }

  const noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  recordCheck('no horizontal overflow', noHorizontalOverflow);

  const textarea = page.locator('textarea').first();
  await textarea.waitFor({ state: 'visible', timeout: 25_000 });
  recordCheck('composer visible', await textarea.count() > 0);

  const z = await targetAtPoint(page, textarea);
  recordCheck('composer is top-layer click target', z.ok, z.topLabel || z.detail || '');
  if (!z.ok) throw new Error(`composer is covered by ${z.topLabel || 'unknown element'}`);

  // Measure the layout BEFORE interaction so we can detect shift afterward.
  const topBefore = await textarea.evaluate((el) => Math.round(el.getBoundingClientRect().top)).catch(() => null);

  await movePointer(page, { x: 28, y: 28 }, z.point);
  emitEvent('hand.click', z.point);
  await page.mouse.click(z.point.x, z.point.y);

  // Interaction feel: focus ring on the focused composer.
  const interactionSignals = await measureInteractionSignals(page, textarea);

  emitEvent('hand.type', { chars: PROBE_TEXT.length });
  // Input latency: time a single keypress until the value reflects it.
  const latencyStart = Date.now();
  await page.keyboard.type(PROBE_TEXT[0] ?? 'x');
  await textarea.evaluate((el, ch) => el.value.includes(ch), PROBE_TEXT[0] ?? 'x').catch(() => undefined);
  const inputLatencyMs = Date.now() - latencyStart;
  await page.keyboard.type(PROBE_TEXT.slice(1), { delay: 4 });
  await screenshot(page, '02-composer-typed');

  const typedValue = await textarea.inputValue();
  recordCheck('fast keyboard input reached composer', typedValue === PROBE_TEXT, typedValue.slice(0, 80));

  // Hover affordance + transition timing on a primary button.
  const hoverMotion = await measureHoverAndMotion(page);

  // Layout shift: did the composer jump after interaction?
  const topAfter = await textarea.evaluate((el) => Math.round(el.getBoundingClientRect().top)).catch(() => topBefore);
  const layoutShiftPx = topBefore != null && topAfter != null ? Math.abs(topAfter - topBefore) : null;

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  emitEvent('hand.clear');
  const cleared = (await textarea.inputValue()) === '';
  recordCheck('composer cleaned after probe', cleared);
  await screenshot(page, '03-cleared');

  // ── DRIVE A REAL TURN so the POPULATED ui (Timeline/ProcessTree) is what we judge. ──
  if (SEND_TURN) {
    cacheLog(`driving a real turn: "${TURN_PROMPT.slice(0, 60)}…" — watch the stream`);
    await textarea.click();
    await page.keyboard.type(TURN_PROMPT, { delay: 6 });
    emitEvent('hand.type', { chars: TURN_PROMPT.length, sending: true });
    await page.keyboard.press('Enter');
    emitEvent('hand.send', { prompt: TURN_PROMPT.slice(0, 120) });
    cacheLog('turn sent — waiting for the process UI to appear (live frames continue)');

    // Watch the turn stream. The process surface appears first (Timeline or ProcessTree).
    const processSel = '[data-testid="turn-timeline"], [data-testid="process-tree"], [data-streaming], .timeline-rail';
    await page.locator(processSel).first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => cacheLog('process UI did not appear within 30s'));
    report.turnDriven = true;
    await screenshot(page, '04-turn-streaming');

    // Let it run a bit so the focused/current block is genuinely "in flight" when we inspect.
    await page.waitForTimeout(3500);
    report.processUi = await inspectProcessUi(page);
    emitEvent('vision.process_ui', report.processUi);
    await screenshot(page, '05-process-focus');

    // Wait for the turn to settle (streaming flag clears or a stop appears), bounded.
    await page.waitForFunction(() => !document.querySelector('[data-streaming="1"], [data-streaming="true"]'), { timeout: 90_000 })
      .catch(() => cacheLog('turn still streaming after 90s — inspecting current state'));
    cacheLog('turn settled (or bounded out) — capturing final populated UI');
    await screenshot(page, '06-turn-done');
    report.processUiFinal = await inspectProcessUi(page);
    emitEvent('vision.process_ui_final', report.processUiFinal);
  }

  // ── TASTE PASS: measure the DOM, then judge with the evidence-bound rubric. ──
  const domSignals = await gatherVisualSignals(page);
  report.signals = {
    ...domSignals,
    ...interactionSignals,
    ...hoverMotion,
    inputLatencyMs,
    layoutShiftPx,
    focusRingVisible: interactionSignals.focusRingVisible,
  };
  emitEvent('vision.signals', report.signals);
  report.rubric = judgeVisualExcellence(report.signals);
  emitEvent('vision.rubric', {
    overall: report.rubric.overall,
    scores: report.rubric.scores,
    humanAppeal: report.rubric.humanAppeal,
    flawCounts: report.rubric.flawCounts,
    genericFlags: report.rubric.genericFlags,
    tasteLesson: report.rubric.tasteLesson,
    headline: report.rubric.headline,
  });
  for (const flaw of report.rubric.flaws) {
    emitEvent('vision.flaw', flaw);
  }
  process.stdout.write(`\nTASTE ${report.rubric.headline}\n`);
  process.stdout.write(`  human-appeal: first ${report.rubric.humanAppeal.firstImpression}/10 · modern ${report.rubric.humanAppeal.modernPremium}/10 · interaction ${report.rubric.humanAppeal.interaction}/10 · trust ${report.rubric.humanAppeal.trustClarity}/10 · wow ${report.rubric.humanAppeal.wow}/10\n`);
  process.stdout.write(`  taste lesson: ${report.rubric.tasteLesson}\n`);
} catch (error) {
  const text = String(error).slice(0, 500);
  report.pageErrors.push(text);
  emitEvent('probe.error', { text });
  if (page) await screenshot(page, '99-error').catch(() => undefined);
} finally {
  stopLiveFrames();
  if (page && LIVE_FRAME_PATH) await writeLiveFrame(page).catch(() => undefined); // last settled frame
  if (context) await context.close().catch(() => undefined);
  if (videoHandle) {
    try {
      const videoPath = await videoHandle.path();
      report.video = path.relative(ROOT, videoPath).replaceAll('\\', '/');
      emitEvent('video.saved', { path: report.video });
    } catch {
      report.video = null;
    }
  }
  if (browser) await browser.close().catch(() => undefined);
}

report.passed = report.checks.every((check) => check.passed) &&
  report.consoleErrors.length === 0 &&
  report.pageErrors.length === 0;

emitEvent('probe.done', {
  passed: report.passed,
  reportPath: path.relative(ROOT, REPORT_PATH).replaceAll('\\', '/'),
  eventStream: report.eventStream,
  checks: report.checks.length,
  screenshots: report.screenshots.length,
  consoleErrors: report.consoleErrors.length,
  consoleWarnings: report.consoleWarnings.length,
  pageErrors: report.pageErrors.length,
  failedRequests: report.failedRequests.length,
  blockedExternalResources: report.blockedExternalResources.length,
  // Taste verdict travels with the terminal event so packet/status can surface it without
  // re-reading the report. Functional pass/fail and taste score are SEPARATE axes on purpose.
  rubricOverall: report.rubric?.overall ?? null,
  rubricHeadline: report.rubric?.headline ?? null,
  wow: report.rubric?.humanAppeal?.wow ?? null,
  flawCounts: report.rubric?.flawCounts ?? null,
  turnDriven: report.turnDriven,
  processUi: report.processUiFinal ?? report.processUi ?? null,
});

await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

process.stdout.write(`\nvisual probe ${report.passed ? 'PASS' : 'FAIL'}\n`);
const pui = report.processUiFinal ?? report.processUi;
if (pui?.present) {
  const fb = pui.focusedBlock;
  process.stdout.write(`PROCESS UI: ${pui.surface} · ${pui.rowCount} steps · focused block carries ${fb?.selfExplanatoryCues ?? 0}/5 cues (title${fb?.hasSummary ? '+summary' : ''}${fb?.hasGate ? '+gate' : ''}${fb?.hasDuration ? '+duration' : ''}${fb?.hasGlyph ? '+glyph' : ''})${pui.focusDistinct ? ' · focus visually distinct' : ''}${pui.surfaceClipped || fb?.clipped ? ' · ⚠ CLIPPED' : ''}\n`);
  process.stdout.write(`  one-block-tells-the-story: ${(fb?.selfExplanatoryCues ?? 0) >= 3 ? 'YES' : 'WEAK'} — "${fb?.title ?? '(no title)'}"\n`);
} else if (report.turnDriven) {
  process.stdout.write('PROCESS UI: not detected after driving a turn (Timeline flag off and no ProcessTree found)\n');
}
process.stdout.write(`report: ${path.relative(ROOT, REPORT_PATH).replaceAll('\\', '/')}\n`);
if (report.liveFramePath) process.stdout.write(`live frame: ${report.liveFramePath}\n`);
if (report.video) process.stdout.write(`video: ${report.video}\n`);
process.exit(report.passed ? 0 : 1);
