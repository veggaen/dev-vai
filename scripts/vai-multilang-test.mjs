/**
 * vai-multilang-test.mjs
 * Tests vai:v0 building projects across multiple languages/frameworks.
 * For non-deployable projects (Rust, C#, C++), validates code quality only.
 * For web projects (Vite, Node/Express), deploys and screenshots.
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(__dirname, '..', 'test-screenshots', 'multilang');
mkdirSync(SHOTS_DIR, { recursive: true });

const RUNTIME = 'http://localhost:3006';

let shotIdx = 0;
const shot = async (page, label) => {
  const f = join(SHOTS_DIR, `${String(shotIdx++).padStart(2,'0')}-${label}.png`);
  await page.screenshot({ path: f, fullPage: false });
  console.log(`  📸 ${label}`);
};

const wait = ms => new Promise(r => setTimeout(r, ms));

async function api(path, opts = {}) {
  const headers = opts.body ? { 'Content-Type': 'application/json', ...(opts.headers ?? {}) } : { ...(opts.headers ?? {}) };
  const res = await fetch(`${RUNTIME}${path}`, { ...opts, headers });
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`API ${path} → ${res.status}: ${t.slice(0,200)}`); }
  return res.json();
}

async function askVai(convId, content) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:3006/api/chat`);
    let out = '';
    const t = setTimeout(() => { ws.close(); reject(new Error('timeout 60s')); }, 60_000);
    ws.on('open', () => ws.send(JSON.stringify({ conversationId: convId, content })));
    ws.on('message', raw => {
      const c = JSON.parse(raw.toString());
      if (c.type === 'text_delta') { process.stdout.write(c.textDelta ?? ''); out += c.textDelta ?? ''; }
      if (c.type === 'done') { clearTimeout(t); ws.close(); resolve(out); }
      if (c.type === 'error') { clearTimeout(t); ws.close(); reject(new Error(c.error)); }
    });
    ws.on('error', e => { clearTimeout(t); reject(e); });
  });
}

const PATH_ATTR_RE = /\b(?:title|path|file|filename)=["']([^"']+)["']/i;
function extractFiles(md) {
  const files = [];
  const re = /```([^\r\n`]*)\r?\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    const info = m[1].trim();
    const pm = info.match(PATH_ATTR_RE);
    if (!pm) continue;
    const path = pm[1].trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '');
    if (!path) continue;
    const content = m[2].trimEnd();
    const idx = files.findIndex(f => f.path === path);
    if (idx >= 0) files[idx] = { path, content };
    else files.push({ path, content });
  }
  return files;
}

async function pollSandbox(projectId, maxMs = 120_000) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < maxMs) {
    const data = await api(`/api/sandbox/${projectId}`).catch(() => null);
    if (!data) { await wait(2000); continue; }
    if (data.status !== last) { console.log(`  [${data.status}] port: ${data.devPort ?? '—'}`); last = data.status; }
    if (data.status === 'running' && data.devPort) return data;
    if (data.status === 'failed') return data;
    await wait(2000);
  }
  return null;
}

// ── Tests ────────────────────────────────────────────────────────────────────

const TESTS = [
  {
    label: 'Rust CLI',
    prompt: 'build me a rust cli tool',
    deploy: false,
    validate: (resp) => ({
      hasCargoToml: resp.includes('Cargo.toml'),
      hasMainRs: resp.includes('main.rs'),
      hasClapDep: resp.includes('clap'),
      hasMatchStmt: resp.includes('match cli.command'),
    }),
  },
  {
    label: 'Rust Web API',
    prompt: 'build a rust web api server',
    deploy: false,
    validate: (resp) => ({
      hasCargoToml: resp.includes('Cargo.toml'),
      hasAxum: resp.includes('axum'),
      hasMainRs: resp.includes('main.rs'),
      hasTokioMain: resp.includes('#[tokio::main]'),
    }),
  },
  {
    label: 'C# Console',
    prompt: 'build a c# console app',
    deploy: false,
    validate: (resp) => ({
      hasCsproj: resp.includes('.csproj'),
      hasProgramCs: resp.includes('Program.cs'),
      hasDotnet8: resp.includes('net8.0'),
      hasConsoleWrite: resp.includes('Console.'),
    }),
  },
  {
    label: 'C++ CLI',
    prompt: 'build a c++ todo app',
    deploy: false,
    validate: (resp) => ({
      hasMainCpp: resp.includes('main.cpp'),
      hasCMake: resp.includes('CMakeLists.txt'),
      hasCpp20: resp.includes('CXX_STANDARD 20'),
      hasVector: resp.includes('std::vector'),
    }),
  },
  {
    label: 'Vite React',
    prompt: 'build me a vite react app',
    deploy: true,
    validate: (resp) => ({
      hasPackageJson: resp.includes('package.json'),
      hasVite: resp.includes('vite'),
      hasIndexHtml: resp.includes('index.html'),
      hasAppJsx: resp.includes('App.'),
    }),
  },
  {
    label: 'Node Express API',
    prompt: 'build a nodejs express crud api',
    deploy: true,
    apiHealthPath: '/health',
    validate: (resp) => ({
      hasPackageJson: resp.includes('package.json'),
      hasExpress: resp.includes('express'),
      hasIndexJs: resp.includes('index.js'),
      hasMapGet: resp.includes('app.get'),
    }),
  },
];

// ── Main ────────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n' + '═'.repeat(64));
  console.log('  Vai Multi-Language Builder Test');
  console.log('═'.repeat(64) + '\n');

  const results = [];
  const browser = await chromium.launch({ headless: false, slowMo: 60, args: ['--window-size=1200,800'] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });

  for (const test of TESTS) {
    console.log(`\n${'─'.repeat(64)}`);
    console.log(`🔨 ${test.label}`);
    console.log('─'.repeat(64));

    const conv = await api('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ modelId: 'vai:v0', mode: 'builder' }),
    });

    process.stdout.write('  Vai: ');
    const resp = await askVai(conv.id, test.prompt);
    console.log();

    const checks = test.validate(resp);
    const passed = Object.values(checks).every(Boolean);
    const checkStr = Object.entries(checks).map(([k,v]) => `${v?'✅':'❌'}${k}`).join(' ');
    console.log(`  Checks: ${checkStr}`);

    const files = extractFiles(resp);
    console.log(`  Files extracted: ${files.length} — ${files.map(f=>f.path).join(', ')}`);

    let deployPort = null;
    if (test.deploy && files.length > 0) {
      const proj = await api('/api/sandbox', { method: 'POST', body: JSON.stringify({ name: test.label.toLowerCase().replace(/\s+/g,'-') }) });
      await api(`/api/sandbox/${proj.id}/files`, {
        method: 'POST',
        body: JSON.stringify({ files: files.map(f => ({ path: f.path, content: f.content })) }),
      });
      console.log(`  Installing...`);
      const install = await api(`/api/sandbox/${proj.id}/install`, { method: 'POST' });
      console.log(`  Install: ${install.success ? '✅' : '❌'}`);
      const start = await api(`/api/sandbox/${proj.id}/start`, { method: 'POST' });
      console.log(`  Start: port ${start.port}`);
      const state = await pollSandbox(proj.id, 90_000);
      if (state?.status === 'running' && state?.devPort) {
        deployPort = state.devPort;
        console.log(`  Running at http://localhost:${deployPort}`);
        const page = await ctx.newPage();
        const url = test.apiHealthPath
          ? `http://localhost:${deployPort}${test.apiHealthPath}`
          : `http://localhost:${deployPort}`;
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 }).catch(e => console.log('  load:', e.message));
        await wait(2000);
        await shot(page, `${test.label.toLowerCase().replace(/\s+/g,'-')}-loaded`);
        await page.close();
      } else {
        console.log(`  ⚠️  Deploy failed: ${state?.status}`);
        if (state?.devStderr?.length) console.log('  stderr:', state.devStderr.slice(-3).join(' | '));
      }
    }

    results.push({ label: test.label, passed, checks, files: files.length, deployed: !!deployPort, deployPort });
  }

  await browser.close();

  // Summary
  console.log('\n' + '═'.repeat(64));
  console.log('  RESULTS');
  console.log('═'.repeat(64));
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    const deploy = r.deployed ? `  🌐 :${r.deployPort}` : r.files > 0 ? '  📄 files only' : '  ⚠️  no files';
    console.log(`${icon} ${r.label.padEnd(20)} ${deploy}`);
  }

  const total = results.length;
  const ok = results.filter(r => r.passed).length;
  console.log(`\n  ${ok}/${total} passed`);
  console.log(`  Screenshots: ${SHOTS_DIR}`);
  console.log('═'.repeat(64) + '\n');
})().catch(err => { console.error('\n❌ Fatal:', err); process.exit(1); });
