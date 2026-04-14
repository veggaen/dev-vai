#!/usr/bin/env node
/**
 * Chat + builder quality gate — tiers you can run locally or in CI.
 *
 * What this covers (by design):
 *   - Prompt contracts & structure hints (chat-quality, chat-modes, chat-service)
 *   - File block parsing (same rules as desktop preview apply)
 *   - API / sandbox plumbing (routes + SandboxManager)
 *   - Optional live checks against a running runtime (WebSocket + builder → install → preview)
 *   - Optional UI E2E (Playwright) when dev servers are already up
 *   - Optional Promptfoo LLM evals (slow; needs API keys per config)
 *
 * What nothing in-repo can fully guarantee:
 *   - Subjective “best UI for every domain” — use live preview + Promptfoo + periodic manual review.
 *   - Every stack (Rust, mobile, etc.) — add stack-specific smoke prompts and CI jobs as you ship them.
 *
 * Sandbox template **express-hexa** (hexagonal Express API, rooms/booking sample) appears in GET /api/sandbox/templates.
 *
 * Other repo tools (run separately or wire into CI when relevant):
 *   pnpm test                          — full Vitest matrix (all packages)
 *   pnpm lint && pnpm typecheck        — static correctness
 *   pnpm vai:chat:bench                — heavier chat scenarios (scripts/vai-chat-benchmark.mjs)
 *   pnpm vai:humaneval:lite            — small coding benchmark against runtime
 *   pnpm vai:eval                      — scripts/vai-eval.mjs harness
 *   pnpm eval:chat / eval:chat:external — Promptfoo configs under eval/promptfoo/
 *   pnpm e2e:audit / e2e:audit:quick   — browser E2E suite (desktop + runtime must be up)
 *   pnpm visual:chat:drive             — Playwright chat UI driver + screenshots
 *   node scripts/verify-fitness-e2e.mjs — manual visual builder verification (Chrome)
 *
 * Usage:
 *   node scripts/verify-chat-build-quality.mjs
 *   node scripts/verify-chat-build-quality.mjs --live
 *   node scripts/verify-chat-build-quality.mjs --live --base-url http://127.0.0.1:3006
 *   node scripts/verify-chat-build-quality.mjs --live --skip-pro-app   # faster: no full builder→sandbox run
 *   node scripts/verify-chat-build-quality.mjs --unit-wide              # all @vai/core + @vai/runtime unit tests
 *   node scripts/verify-chat-build-quality.mjs --e2e-quick             # Playwright audit (needs desktop + runtime)
 *   node scripts/verify-chat-build-quality.mjs --promptfoo             # eval/promptfoo (external keys)
 *   node scripts/verify-chat-build-quality.mjs --hexa-api               # gallery template express-hexa → install → API checks (needs runtime)
 *
 * Env:
 *   VAI_API / base-url — runtime for --live
 *   VAI_VERIFY_MODEL, VAI_SMOKE_MODEL — local engine id (default vai:v0)
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

/** Core path for “chat + builder + sandbox” correctness (fast, no network). */
const CHAT_BUILD_UNIT_FILES = [
  'packages/core/__tests__/chat-quality.test.ts',
  'packages/core/__tests__/chat-modes.test.ts',
  'packages/core/__tests__/chat-service.test.ts',
  'packages/core/__tests__/evidence-types.test.ts',
  'packages/core/__tests__/file-extractor.test.ts',
  'packages/core/__tests__/prompt-rewrite.test.ts',
  'packages/runtime/__tests__/chat-routes.test.ts',
  'packages/runtime/__tests__/conversation-routes.test.ts',
  'packages/runtime/__tests__/sandbox-manager.test.ts',
];

function parseArgs(argv) {
  let live = false;
  let skipProApp = false;
  let unitWide = false;
  let e2eQuick = false;
  let promptfoo = false;
  let hexaApi = false;
  let baseUrl = process.env.VAI_API?.trim() || 'http://127.0.0.1:3006';

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--live') live = true;
    else if (a === '--skip-pro-app') skipProApp = true;
    else if (a === '--unit-wide') unitWide = true;
    else if (a === '--e2e-quick') e2eQuick = true;
    else if (a === '--promptfoo') promptfoo = true;
    else if (a === '--hexa-api') hexaApi = true;
    else if (a === '--base-url' && argv[i + 1]) {
      baseUrl = argv[++i].replace(/\/$/, '');
    } else if (/^https?:\/\//i.test(a)) {
      baseUrl = a.replace(/\/$/, '');
    }
  }

  return { live, skipProApp, unitWide, e2eQuick, promptfoo, hexaApi, baseUrl };
}

function runVitest(args, label) {
  console.log(`\n[verify-chat-build-quality] ${label}\n`);
  const r = spawnSync('pnpm', ['exec', 'vitest', 'run', ...args], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: true,
  });
  if (r.status !== 0) {
    console.error(`[verify-chat-build-quality] FAIL: ${label} (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

async function probe(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
}

function runNode(scriptRelative, extraArgs = [], env = {}) {
  const scriptPath = join(REPO_ROOT, scriptRelative);
  console.log(`\n[verify-chat-build-quality] node ${scriptRelative} ${extraArgs.join(' ')}\n`);
  const r = spawnSync(process.execPath, [scriptPath, ...extraArgs], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`Read the header comment in scripts/verify-chat-build-quality.mjs`);
    process.exit(0);
  }

  if (args.unitWide) {
    runVitest(['packages/core', 'packages/runtime'], 'unit tests (@vai/core + @vai/runtime, full)');
  } else {
    runVitest(CHAT_BUILD_UNIT_FILES, 'focused chat/build/sandbox unit tests');
  }

  if (args.hexaApi) {
    const ok = await probe(`${args.baseUrl}/health`);
    if (!ok) {
      console.error(
        `[verify-chat-build-quality] Runtime not reachable at ${args.baseUrl}/health — start it (e.g. pnpm dev:web) or drop --hexa-api.`,
      );
      process.exit(1);
    }
    runNode('scripts/verify-express-hexa-template.mjs', [args.baseUrl], { VAI_API: args.baseUrl });
  }

  if (args.live) {
    const ok = await probe(`${args.baseUrl}/health`);
    if (!ok) {
      console.error(
        `[verify-chat-build-quality] Runtime not reachable at ${args.baseUrl}/health — start it (e.g. pnpm dev:web) or drop --live.`,
      );
      process.exit(1);
    }

    runNode('scripts/vai-chat-smoke.mjs', ['--live-only', '--base-url', args.baseUrl], {
      VAI_API: args.baseUrl,
    });

    if (!args.skipProApp) {
      runNode('scripts/verify-pro-app-chat.mjs', [args.baseUrl], { VAI_API: args.baseUrl });
    }
  }

  if (args.e2eQuick) {
    const runtimeOk = await probe('http://127.0.0.1:3006/health');
    const desktopOk = await probe('http://127.0.0.1:5173/');
    if (!runtimeOk || !desktopOk) {
      console.error(
        '[verify-chat-build-quality] --e2e-quick skipped: need runtime :3006 and desktop :5173 (pnpm dev).',
      );
      process.exit(1);
    }
    runNode('scripts/e2e-audit-suite.mjs', ['--quick']);
  }

  if (args.promptfoo) {
    const r = spawnSync('pnpm', ['exec', 'promptfoo', 'eval', '-c', 'eval/promptfoo/promptfooconfig.yaml', '-j', '1', '--no-cache'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      shell: true,
    });
    if (r.status !== 0) {
      console.error('[verify-chat-build-quality] promptfoo eval failed');
      process.exit(r.status ?? 1);
    }
  }

  console.log('\n[verify-chat-build-quality] DONE — all requested tiers passed.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
