/**
 * e2e-audit-suite.mjs — Run curated browser E2E scripts and write an actionable report.
 *
 * Prerequisites (start these first, or use `pnpm dev`):
 *   - Desktop: http://localhost:5173
 *   - Runtime: http://localhost:3006/health
 *
 * Usage:
 *   node scripts/e2e-audit-suite.mjs              # core + extended suites
 *   node scripts/e2e-audit-suite.mjs --quick       # fast subset only
 *   node scripts/e2e-audit-suite.mjs --only=full-visual
 *
 * Outputs:
 *   reports/e2e-audit-latest.json
 *   reports/e2e-audit-latest.md
 *
 * "Cursor / AI" testing: this gives structured pass/fail + hints you can paste into
 * chats for triage. For live exploration use the IDE Browser MCP. For LLM quality
 * (not UI) use scripts like vai-chat-bench.mjs or vai-eval.mjs separately.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const REPORT_DIR = path.join(REPO_ROOT, 'reports');

/** @type {{ id: string, script: string, tier: 'core' | 'extended', timeoutMs: number, improve: string }[]} */
const SUITES = [
  {
    id: 'full-visual',
    script: 'test-full-visual.mjs',
    tier: 'core',
    timeoutMs: 150_000,
    improve:
      'Broadcast strip, IDE/session/model pickers, or extension poll path. See screenshots/full-visual. Re-run after `pnpm dev` with runtime auth off for local QA.',
  },
  {
    id: 'builder-dashboard',
    script: 'test-builder-dashboard-e2e.mjs',
    tier: 'core',
    timeoutMs: 120_000,
    improve:
      'Builder dashboard flow, bootstrap mock, or preview panel. Check scripts/screenshots/builder-dashboard-e2e.',
  },
  {
    id: 'preview-persistence',
    script: 'test-preview-persistence-visual.mjs',
    tier: 'extended',
    timeoutMs: 120_000,
    improve:
      'Preview panel when switching conversations. Inspect ChatWindow/preview state and timeouts in the script.',
  },
  {
    id: 'broadcast-playwright',
    script: 'test-broadcast-e2e-playwright.mjs',
    tier: 'extended',
    timeoutMs: 120_000,
    improve:
      'Alternate broadcast E2E path — compare failures with full-visual to see API vs UI divergence.',
  },
  {
    id: 'layout-mode',
    script: 'test-layout-mode.mjs',
    tier: 'extended',
    timeoutMs: 90_000,
    improve:
      'Compact/open layout switching and CSS variables — see test-layout-mode.mjs.',
  },
];

function parseArgs(argv) {
  const quick = argv.includes('--quick');
  const onlyArg = argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length) : null;
  return { quick, only };
}

async function probe(url, label) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function runNodeScript(scriptRelative, timeoutMs) {
  const scriptPath = path.join(__dirname, scriptRelative);
  return new Promise((resolve) => {
    const chunks = [];
    const errChunks = [];
    const child = spawn(process.execPath, [scriptPath], {
      cwd: REPO_ROOT,
      env: { ...process.env, FORCE_COLOR: '0' },
      shell: false,
    });
    const onChunk = (buf, acc) => {
      acc.push(buf);
      process.stdout.write(buf);
    };
    child.stdout?.on('data', (b) => onChunk(b, chunks));
    child.stderr?.on('data', (b) => onChunk(b, errChunks));

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        code: 124,
        timedOut: true,
        logTail: tail(Buffer.concat(errChunks).toString('utf8'), 6000),
      });
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(chunks).toString('utf8');
      const err = Buffer.concat(errChunks).toString('utf8');
      resolve({
        code: code ?? 1,
        timedOut: false,
        logTail: tail([out, err].filter(Boolean).join('\n'), 8000),
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 1, timedOut: false, logTail: err.message });
    });
  });
}

function tail(s, max) {
  if (s.length <= max) return s;
  return '…\n' + s.slice(-max);
}

function mdEscape(s) {
  return s.replace(/\|/g, '\\|').replace(/\r\n/g, '\n');
}

function filterSuites({ quick, only }) {
  let list = [...SUITES];
  if (only) {
    list = list.filter((s) => s.id === only);
    if (!list.length) {
      console.error(`Unknown suite id: ${only}. Known: ${SUITES.map((s) => s.id).join(', ')}`);
      process.exit(1);
    }
    return list;
  }
  if (quick) {
    return list.filter((s) => s.tier === 'core' && s.id === 'builder-dashboard');
  }
  return list;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const suites = filterSuites(args);

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  Vai E2E audit — structured results for triage            ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const pre = [
    ['Frontend (Vite)', 'http://localhost:5173/'],
    ['Runtime health', 'http://localhost:3006/health'],
  ];
  const preResults = [];
  for (const [label, url] of pre) {
    const r = await probe(url, label);
    preResults.push({ label, url, ...r });
    const status = r.ok ? 'ok' : 'FAIL';
    console.log(`  [${status}] ${label}: ${url}`);
  }

  const preOk = preResults.every((p) => p.ok);
  if (!preOk) {
    console.log('\n  Fix: start `pnpm dev` or ensure @vai/runtime on :3006 and @vai/desktop on :5173.\n');
  }

  const started = new Date().toISOString();
  const rows = [];

  if (!preOk) {
    const summary = {
      started,
      preflight: preResults,
      preflightOk: false,
      quickMode: args.quick,
      only: args.only,
      suites: [],
      passedCount: 0,
      failedCount: 0,
      skipped: 'Preflight failed — suites not run',
    };
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const jsonPath = path.join(REPORT_DIR, 'e2e-audit-latest.json');
    fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf8');
    const mdPath = path.join(REPORT_DIR, 'e2e-audit-latest.md');
    fs.writeFileSync(
      mdPath,
      [
        '# E2E audit report',
        '',
        '**Preflight failed** — fix URLs above, then re-run.',
        '',
        JSON.stringify(preResults, null, 2),
      ].join('\n'),
      'utf8',
    );
    console.log(`\n  Report: ${path.relative(REPO_ROOT, mdPath)}`);
    process.exit(1);
  }

  for (const suite of suites) {
    console.log(`\n── Suite: ${suite.id} (${suite.script}) ──\n`);
    const t0 = Date.now();
    const result = await runNodeScript(suite.script, suite.timeoutMs);
    const ms = Date.now() - t0;
    const passed = !result.timedOut && result.code === 0;
    rows.push({
      id: suite.id,
      tier: suite.tier,
      script: suite.script,
      passed,
      exitCode: result.code,
      timedOut: result.timedOut,
      ms,
      improve: suite.improve,
      logTail: result.logTail,
    });
  }

  const summary = {
    started,
    preflight: preResults,
    preflightOk: preOk,
    quickMode: args.quick,
    only: args.only,
    suites: rows,
    passedCount: rows.filter((r) => r.passed).length,
    failedCount: rows.filter((r) => !r.passed).length,
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const jsonPath = path.join(REPORT_DIR, 'e2e-audit-latest.json');
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf8');

  const failed = rows.filter((r) => !r.passed);
  const md = [
    '# E2E audit report',
    ``,
    `- Generated: ${started}`,
    `- Preflight OK: ${preOk}`,
    `- Suites run: ${rows.length} (${summary.passedCount} passed, ${summary.failedCount} failed)`,
    ``,
    '## Results',
    ``,
    '| Suite | Tier | Pass | ms | Notes |',
    '|-------|------|------|------|-------|',
    ...rows.map((r) =>
      `| ${r.id} | ${r.tier} | ${r.passed ? 'yes' : '**no**'} | ${r.ms} | ${r.timedOut ? 'timeout' : r.passed ? '—' : `exit ${r.exitCode}`} |`,
    ),
    ...(failed.length > 0
      ? [
          '## Failed — what to improve next',
          '',
          ...failed.flatMap((r) => [
            `### ${r.id}`,
            '',
            r.improve,
            '',
            '<details><summary>Log tail</summary>',
            '',
            '```',
            mdEscape(r.logTail || '(empty)'),
            '```',
            '',
            '</details>',
            '',
          ]),
        ]
      : [
          '## All suites passed',
          '',
          'Consider running without `--quick` to include all core + extended suites, or register new scripts in `scripts/e2e-audit-suite.mjs`.',
          '',
        ]),
    '---',
    '',
    '### Using this with Cursor / AI',
    '',
    '- Paste `reports/e2e-audit-latest.json` (or this file) and ask for a prioritized fix plan.',
    '- Use **Browser MCP** for interactive repro when a suite fails.',
    '- UI regressions: compare screenshots under `screenshots/`.',
    '- **LLM / chat quality** is separate: run `pnpm run vai:chat:bench` or `vai:eval`, not this audit.',
    '',
    `Full JSON: \`${path.relative(REPO_ROOT, jsonPath)}\``,
    '',
  ].flat();

  const mdPath = path.join(REPORT_DIR, 'e2e-audit-latest.md');
  fs.writeFileSync(mdPath, md.join('\n'), 'utf8');

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log(`║  DONE — ${summary.passedCount}/${rows.length} passed`.padEnd(61) + '║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\n  Report: ${path.relative(REPO_ROOT, mdPath)}`);
  console.log(`  JSON:   ${path.relative(REPO_ROOT, jsonPath)}\n`);

  if (!preOk || summary.failedCount > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
