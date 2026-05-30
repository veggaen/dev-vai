#!/usr/bin/env node
/**
 * VAI vs Real-World Showcase
 * --------------------------
 * Builds a curated set of apps (simple -> advanced) with the live VAI builder,
 * runs each in its sandbox, screenshots the preview, then screenshots the
 * real-world public app of the same type, and emits a side-by-side report
 * (index.html + SHOWCASE.md + report.json) with structural "gotchas".
 *
 * Requires the web UI (default http://localhost:5173) and runtime API
 * (default http://127.0.0.1:3006) to be running.
 *
 * Usage:
 *   node scripts/vai-vs-real-showcase.mjs [--only pomodoro,todo] [--app-url URL] [--api-url URL]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const DEV = { 'x-vai-dev-auth-bypass': '1' };
const VIEWPORT = { width: 1280, height: 900 };

/**
 * Each spec: what VAI builds + the real public app we compare against +
 * the checklist of features a real app of this type is expected to have.
 */
const SPECS = [
  {
    slug: 'pomodoro',
    tier: 'simple',
    type: 'Pomodoro focus timer',
    prompt:
      'Build a clean Pomodoro focus timer app I can preview. 25/5 work and break cycles, big mm:ss countdown, Start / Pause / Reset controls, a session counter, and a task label input. Polished, centered, calm visual design.',
    requiredText: ['25', 'Start', 'Reset'],
    real: { name: 'Pomofocus', url: 'https://pomofocus.io/' },
    expectedFeatures: [
      ['big countdown timer', /\b\d{1,2}:\d{2}\b/],
      ['start control', /\bstart\b/i],
      ['pause control', /\bpause\b/i],
      ['reset control', /\breset\b/i],
      ['session / round counter', /\bsession|round|#\s?\d|cycle/i],
      ['task label', /\btask|what are you working|focus on/i],
    ],
  },
  {
    slug: 'todo',
    tier: 'simple',
    type: 'Todo list',
    prompt:
      'Build a simple, polished todo list app I can preview. Add todos via an input, mark complete with a checkbox, delete a todo, filter All / Active / Completed, and show a remaining-items counter.',
    requiredText: ['Add', 'All', 'Active', 'Completed'],
    real: { name: 'TodoMVC (React)', url: 'https://todomvc.com/examples/react/dist/' },
    expectedFeatures: [
      ['new-todo input', /\bwhat needs|add (a )?todo|new todo|add task/i],
      ['active filter', /\bactive\b/i],
      ['completed filter', /\bcompleted\b/i],
      ['all filter', /\ball\b/i],
      ['remaining counter', /\b\d+\s+(items?|left|remaining|todos?)\b/i],
      ['clear/delete affordance', /\bclear|delete|remove|×|✕/i],
    ],
  },
  {
    slug: 'landing',
    tier: 'mid',
    type: 'SaaS conversion landing page',
    prompt:
      "Design a clean, modern, conversion-focused landing page for a SaaS product called 'LedgerFlow'. Minimalist grid: a clean nav bar, a high-impact hero with headline + subhead, a single high-contrast primary CTA labeled 'Start free', a 3-column feature section with iconography (Fast onboarding, Clear pipeline, Trusted reporting), and a footer. Strict palette: #2563eb primary, #f8fafc background, #111827 text. Inter / system-ui. Lots of white space, trustworthy, accessible. Generate complete runnable code.",
    requiredText: ['LedgerFlow', 'Start free'],
    real: { name: 'Linear', url: 'https://linear.app/' },
    expectedFeatures: [
      ['top navigation bar', /\bproduct|features|pricing|docs|log\s?in|sign/i],
      ['hero headline (h1)', /__H1__/],
      ['primary CTA button', /\bstart|get started|try|sign up|free\b/i],
      ['feature trio', /\bfast|clear|trusted|secure|fast onboarding/i],
      ['footer', /__FOOTER__/],
    ],
  },
  {
    slug: 'analytics-dashboard',
    tier: 'advanced',
    type: 'Analytics dashboard',
    prompt:
      'Build an analytics dashboard app I can preview. Include KPI cards (visitors, revenue, conversion, bounce), a "Revenue over time" line/area chart, a "Traffic sources" breakdown, a top-pages table, and a date-range filter. Real-looking seeded data, clean modern data-viz styling.',
    requiredText: ['Revenue', 'Traffic', 'Dashboard'],
    real: { name: 'Plausible (live demo)', url: 'https://plausible.io/plausible.io' },
    expectedFeatures: [
      ['KPI cards', /\bvisitors|revenue|conversion|bounce|users|sessions\b/i],
      ['time-series chart', /__CANVAS_OR_SVG__/],
      ['traffic sources breakdown', /\btraffic|sources|referrer|channels\b/i],
      ['top pages / table', /\btop pages|pages|table|\/[a-z]/i],
      ['date range filter', /\bday|week|month|7d|30d|last|range|date\b/i],
    ],
  },
];

function parseArgs(argv) {
  const o = {
    appUrl: process.env.VAI_APP_URL || 'http://localhost:5173/?devAuthBypass=1',
    apiUrl: (process.env.VAI_API_URL || 'http://127.0.0.1:3006').replace(/\/$/, ''),
    only: [],
    timeoutMs: 200_000,
    outputDir: path.join(ROOT, '.codex-run', `showcase-${new Date().toISOString().replace(/[:.]/g, '-')}`),
    keepProjects: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--app-url' && next) { o.appUrl = next; i += 1; }
    else if (a === '--api-url' && next) { o.apiUrl = next.replace(/\/$/, ''); i += 1; }
    else if (a === '--only' && next) { o.only = next.split(',').map((s) => s.trim()).filter(Boolean); i += 1; }
    else if (a === '--output-dir' && next) { o.outputDir = path.resolve(next); i += 1; }
    else if (a === '--timeout-ms' && next) { o.timeoutMs = Number.parseInt(next, 10) || o.timeoutMs; i += 1; }
    else if (a === '--delete-projects') { o.keepProjects = false; }
  }
  return o;
}

async function maybeApiJson(apiUrl, rel, init) {
  try {
    const r = await fetch(`${apiUrl}${rel}`, { ...init, headers: { ...DEV, ...(init?.headers ?? {}) } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function waitUntil(label, fn, timeoutMs = 60_000, intervalMs = 700) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForStore(page) {
  await waitUntil('chat store', () => page.evaluate('Boolean(window.__vai_chat_store?.getState)'), 30_000, 300);
}

async function getChatState(page) {
  return page.evaluate(() => {
    const s = window.__vai_chat_store.getState();
    return {
      activeConversationId: s.activeConversationId || null,
      isStreaming: Boolean(s.isStreaming),
      messages: s.messages.map((m) => ({ id: String(m.id || ''), role: m.role, content: String(m.content || '') })),
      conversations: s.conversations.map((c) => ({ id: c.id, sandboxProjectId: c.sandboxProjectId || null, mode: c.mode || null })),
    };
  });
}

async function startFreshBuilderChat(page) {
  const conversationId = await page.evaluate(async () => {
    const chat = window.__vai_chat_store?.getState?.();
    if (!chat?.createConversation) throw new Error('createConversation unavailable');
    chat.startNewChat?.();
    return chat.createConversation('vai:v0', 'builder', { sandboxProjectId: null });
  });
  await waitUntil('fresh builder conversation', async () => {
    const s = await getChatState(page);
    const c = s.conversations.find((e) => e.id === conversationId);
    return s.activeConversationId === conversationId && c?.mode === 'builder' ? c : null;
  }, 45_000, 500);
  return conversationId;
}

function isProjectUpdateAssistant(content) {
  return /\bProject update:/i.test(content) || /\[vai-artifact\]/i.test(content) || /\bSandbox:\s+[a-f0-9-]{6,}/i.test(content);
}
function pickLatestBuildAssistant(assistants) {
  for (let i = assistants.length - 1; i >= 0; i -= 1) {
    const c = String(assistants[i]?.content ?? '').trim();
    if (!c || isProjectUpdateAssistant(c)) continue;
    return assistants[i];
  }
  return null;
}

async function sendPrompt(page, prompt, timeoutMs) {
  const before = await getChatState(page);
  const beforeIds = new Set(before.messages.filter((m) => m.role === 'assistant' && m.content.trim()).map((m) => m.id));
  const textarea = page.locator('textarea').first();
  await textarea.waitFor({ timeout: 30_000 });
  await textarea.fill(prompt);
  await textarea.press('Enter');
  return waitUntil('assistant turn', async () => {
    const s = await getChatState(page);
    const assistants = s.messages.filter((m) => m.role === 'assistant' && m.content.trim());
    const fresh = assistants.filter((m) => !beforeIds.has(m.id));
    if (!s.isStreaming && fresh.length > 0) return { state: s, latest: pickLatestBuildAssistant(fresh) ?? assistants.at(-1) };
    return null;
  }, timeoutMs, 800);
}

async function latestSandboxId(apiUrl, page, conversationId) {
  const convs = await maybeApiJson(apiUrl, '/api/conversations?limit=100');
  const apiSb = convs?.find?.((c) => c.id === conversationId)?.sandboxProjectId || null;
  if (apiSb) return apiSb;
  return page.evaluate((id) => {
    const s = window.__vai_chat_store.getState();
    return s.conversations.find((c) => c.id === id)?.sandboxProjectId || null;
  }, conversationId);
}

/**
 * The client auto-sandbox hook first binds a placeholder id, then swaps it for
 * the real built sandbox. So we re-resolve the conversation's sandbox id on
 * every poll and only accept it once that sandbox is actually running.
 */
async function waitForRunningSandbox(apiUrl, page, conversationId, timeoutMs) {
  return waitUntil('running sandbox', async () => {
    const id = await latestSandboxId(apiUrl, page, conversationId);
    if (!id) return null;
    const sb = await maybeApiJson(apiUrl, `/api/sandbox/${id}`);
    if (!sb) return null;
    if (sb.status === 'failed') return { failed: true, sandbox: sb, id };
    if (sb.status === 'running' && sb.devPort) return { ...sb, id };
    return null;
  }, timeoutMs, 1500);
}

/** Shared DOM audit — same metrics for ours and the real app, for honest comparison. */
async function auditDom(page) {
  return page.evaluate(() => {
    const txt = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
    const q = (sel) => document.querySelectorAll(sel).length;
    return {
      title: document.title,
      textLen: txt.length,
      text: txt.slice(0, 6000),
      h1: Array.from(document.querySelectorAll('h1')).map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 6),
      headings: Array.from(document.querySelectorAll('h1,h2,h3')).map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 30),
      buttons: q('button, a[role=button]'),
      links: q('a'),
      inputs: q('input, textarea, select'),
      navs: q('nav'),
      sections: q('main, section, article, aside, form, nav'),
      svg: q('svg'),
      canvas: q('canvas'),
      images: q('img'),
      footer: q('footer') > 0,
      buttonTexts: Array.from(document.querySelectorAll('button, a')).map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 60),
    };
  });
}

function scoreFeatures(spec, dom) {
  const hay = `${dom.text}\n${dom.buttonTexts.join('\n')}\n${dom.headings.join('\n')}`;
  return spec.expectedFeatures.map(([label, rx]) => {
    let present;
    if (rx.source === '__H1__') present = dom.h1.length > 0;
    else if (rx.source === '__FOOTER__') present = dom.footer;
    else if (rx.source === '__CANVAS_OR_SVG__') present = dom.canvas > 0 || dom.svg > 2;
    else present = rx.test(hay);
    return { label, present };
  });
}

async function screenshot(page, file) {
  await page.screenshot({ path: file, fullPage: false });
}

async function captureReal(browser, outDir, spec) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const out = { ok: false };
  try {
    await page.goto(spec.real.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(2600); // let hero / charts settle
    const file = path.join(outDir, `real-${spec.slug}.png`);
    await screenshot(page, file);
    out.screenshot = file;
    out.dom = await auditDom(page);
    out.ok = true;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  } finally {
    await page.close().catch(() => {});
  }
  return out;
}

async function captureOurs(browser, outDir, spec, sandbox) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) consoleErrors.push(m.text()); });
  const out = { ok: false, consoleErrors };
  try {
    await page.goto(`http://127.0.0.1:${sandbox.devPort}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(1800);
    const file = path.join(outDir, `ours-${spec.slug}.png`);
    await screenshot(page, file);
    out.screenshot = file;
    out.dom = await auditDom(page);
    out.ok = true;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  } finally {
    await page.close().catch(() => {});
  }
  return out;
}

function rel(outDir, p) { return p ? path.basename(p) : null; }

function renderHtml(outDir, results, options) {
  const card = (r) => {
    const feat = (r.features || []).map((f) => `<li class="${f.present ? 'y' : 'n'}">${f.present ? '✓' : '✗'} ${f.label}</li>`).join('');
    const m = (label, a, b) => `<tr><td>${label}</td><td>${a}</td><td>${b}</td></tr>`;
    const od = r.ours?.dom ?? {}; const rd = r.real?.dom ?? {};
    return `
    <section class="app">
      <h2>${r.tier.toUpperCase()} · ${r.type}</h2>
      <p class="prompt"><b>VAI prompt:</b> ${r.prompt}</p>
      <div class="cols">
        <figure><figcaption>VAI build ${r.ours?.ok ? '' : '(failed)'}</figcaption>${r.ours?.screenshot ? `<img src="${rel(outDir, r.ours.screenshot)}">` : `<div class="missing">${r.ours?.error || r.error || 'no preview'}</div>`}</figure>
        <figure><figcaption>Real: ${r.realName} <span class="url">${r.realUrl}</span></figcaption>${r.real?.screenshot ? `<img src="${rel(outDir, r.real.screenshot)}">` : `<div class="missing">${r.real?.error || 'no screenshot'}</div>`}</figure>
      </div>
      <div class="cols">
        <div>
          <h3>Real-world feature checklist (scored on VAI build)</h3>
          <ul class="feat">${feat}</ul>
          <p class="score">Coverage: <b>${r.coverage}</b></p>
        </div>
        <div>
          <h3>Structural metrics (VAI vs Real)</h3>
          <table>
            <tr><th>metric</th><th>VAI</th><th>Real</th></tr>
            ${m('headings', od.headings?.length ?? '-', rd.headings?.length ?? '-')}
            ${m('buttons/links', od.buttons ?? '-', rd.buttons ?? '-')}
            ${m('inputs', od.inputs ?? '-', rd.inputs ?? '-')}
            ${m('sections/landmarks', od.sections ?? '-', rd.sections ?? '-')}
            ${m('svg', od.svg ?? '-', rd.svg ?? '-')}
            ${m('canvas', od.canvas ?? '-', rd.canvas ?? '-')}
            ${m('images', od.images ?? '-', rd.images ?? '-')}
            ${m('text length', od.textLen ?? '-', rd.textLen ?? '-')}
          </table>
          ${r.ours?.consoleErrors?.length ? `<p class="err">Console errors: ${r.ours.consoleErrors.slice(0, 3).join(' | ')}</p>` : '<p class="ok">No console errors</p>'}
          ${r.gotchas?.length ? `<h3>Gotchas</h3><ul class="gotchas">${r.gotchas.map((g) => `<li>${g}</li>`).join('')}</ul>` : ''}
        </div>
      </div>
    </section>`;
  };
  return `<!doctype html><html><head><meta charset="utf-8"><title>VAI vs Real-World Showcase</title>
  <style>
   body{font:14px/1.5 system-ui,Inter,sans-serif;margin:0;background:#0b0d12;color:#e6e9ef}
   header{padding:28px 32px;border-bottom:1px solid #222838;background:#11141c}
   h1{margin:0 0 6px}.sub{color:#9aa4b2}
   .app{padding:26px 32px;border-bottom:1px solid #1b2030}
   .prompt{color:#aab3c2;max-width:1100px}
   .cols{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin:14px 0}
   figure{margin:0}figcaption{color:#9aa4b2;margin-bottom:6px}.url{color:#5b6675;font-size:12px}
   img{width:100%;border:1px solid #222838;border-radius:10px;background:#fff}
   .missing{padding:40px;border:1px dashed #3a4252;border-radius:10px;color:#ff6b6b;text-align:center}
   table{border-collapse:collapse;width:100%}td,th{border:1px solid #222838;padding:5px 9px;text-align:left}th{color:#9aa4b2}
   ul.feat,ul.gotchas{list-style:none;padding:0}ul.feat li.y{color:#46d369}ul.feat li.n{color:#ff6b6b}
   .gotchas li{color:#f0b657;margin:3px 0}
   .score{font-size:15px}.err{color:#ff6b6b}.ok{color:#46d369}
   h2{color:#7aa2ff}h3{color:#cdd6e4;margin:14px 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.04em}
  </style></head><body>
  <header><h1>VAI vs Real-World Apps — Side-by-Side Showcase</h1>
  <div class="sub">Generated ${new Date().toISOString()} · ${results.length} apps · left = built live by VAI, right = the real public app of the same type</div></header>
  ${results.map(card).join('')}
  </body></html>`;
}

function renderMarkdown(results) {
  const lines = ['# VAI vs Real-World Apps — Showcase', '', `Generated ${new Date().toISOString()}`, ''];
  for (const r of results) {
    lines.push(`## ${r.tier.toUpperCase()} · ${r.type}`);
    lines.push(`- VAI build: ${r.ours?.ok ? `✓ preview (${rel('', r.ours.screenshot)})` : `✗ ${r.ours?.error || r.error}`}`);
    lines.push(`- Real app: ${r.realName} (${r.realUrl}) ${r.real?.ok ? '✓' : '✗'}`);
    lines.push(`- Real-world feature coverage: **${r.coverage}**`);
    const missing = (r.features || []).filter((f) => !f.present).map((f) => f.label);
    if (missing.length) lines.push(`- Missing vs real-world norm: ${missing.join(', ')}`);
    if (r.gotchas?.length) { lines.push('- Gotchas:'); for (const g of r.gotchas) lines.push(`  - ${g}`); }
    lines.push('');
  }
  return lines.join('\n');
}

function deriveGotchas(spec, ours, real) {
  const g = [];
  const od = ours?.dom; const rd = real?.dom;
  if (!ours?.ok) { g.push('VAI build did not produce a runnable preview.'); return g; }
  if (ours.consoleErrors?.length) g.push(`Runtime console errors in VAI build (${ours.consoleErrors.length}).`);
  if (od && rd) {
    if ((spec.slug === 'analytics-dashboard') && od.svg + od.canvas === 0 && rd.svg + rd.canvas > 0) g.push('Real app renders real chart elements (svg/canvas); VAI build has none — charts may be faked with divs.');
    if (od.inputs === 0 && rd.inputs > 0) g.push('Real app exposes interactive inputs; VAI build has none.');
    if (od.images === 0 && rd.images > 2) g.push('Real app uses imagery/illustration; VAI build is text/box only.');
    if (od.textLen < rd.textLen * 0.25) g.push('VAI build is much sparser in content than the real app.');
    if (!od.footer && rd.footer && (spec.slug === 'landing')) g.push('Real landing has a footer; VAI build is missing one.');
  }
  return g;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await fs.mkdir(options.outputDir, { recursive: true });
  const specs = options.only.length ? SPECS.filter((s) => options.only.includes(s.slug)) : SPECS;

  const browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath() });
  const driver = await browser.newPage({ viewport: { width: 1360, height: 940 } });
  const results = [];
  try {
    await driver.goto(options.appUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForStore(driver);

    for (const spec of specs) {
      const r = { slug: spec.slug, tier: spec.tier, type: spec.type, prompt: spec.prompt, realName: spec.real.name, realUrl: spec.real.url };
      results.push(r);
      const started = Date.now();
      try {
        console.log(`\n[BUILD] ${spec.slug} (${spec.tier}) ...`);
        await startFreshBuilderChat(driver);
        const { state } = await sendPrompt(driver, spec.prompt, options.timeoutMs);
        const conversationId = state.activeConversationId;
        const sb = await waitForRunningSandbox(options.apiUrl, driver, conversationId, options.timeoutMs).catch((e) => {
          r.error = e instanceof Error ? e.message : String(e);
          return null;
        });
        if (sb) {
          r.sandboxId = sb.id;
          if (sb.failed) { r.error = `sandbox failed: ${JSON.stringify((sb.sandbox.logs ?? []).slice(-4))}`; }
          else {
            console.log(`[PREVIEW] ${spec.slug} on :${sb.devPort} (sandbox ${sb.id})`);
            r.ours = await captureOurs(browser, options.outputDir, spec, sb);
          }
        }
      } catch (e) {
        r.error = e instanceof Error ? e.message : String(e);
      }

      console.log(`[REAL] ${spec.slug} -> ${spec.real.url}`);
      r.real = await captureReal(browser, options.outputDir, spec);

      const feats = r.ours?.dom ? scoreFeatures(spec, r.ours.dom) : spec.expectedFeatures.map(([label]) => ({ label, present: false }));
      r.features = feats;
      const have = feats.filter((f) => f.present).length;
      r.coverage = `${have}/${feats.length}`;
      r.gotchas = deriveGotchas(spec, r.ours, r.real);
      r.durationMs = Date.now() - started;
      console.log(`[DONE] ${spec.slug}: coverage ${r.coverage}, ours=${r.ours?.ok ? 'ok' : 'FAIL'}, real=${r.real?.ok ? 'ok' : 'FAIL'} (${r.durationMs}ms)`);
      await fs.writeFile(path.join(options.outputDir, 'report.json'), JSON.stringify({ options, results }, null, 2));
    }
  } finally {
    await driver.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  await fs.writeFile(path.join(options.outputDir, 'index.html'), renderHtml(options.outputDir, results, options));
  await fs.writeFile(path.join(options.outputDir, 'SHOWCASE.md'), renderMarkdown(results));
  console.log(`\nReport: ${path.join(options.outputDir, 'index.html')}`);
  console.log(JSON.stringify(results.map((r) => ({ slug: r.slug, coverage: r.coverage, ours: r.ours?.ok ?? false, real: r.real?.ok ?? false })), null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
