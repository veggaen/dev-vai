/**
 * Base44-style chat-to-app evaluation for Vai's council codegen.
 *
 * Drives the REAL chat pipeline (ChatService → vai:v0 deterministic arm →
 * satisfaction gate → council codegen arm on local Ollama models) with a set
 * of random new-app briefs, then evaluates each produced artifact:
 *
 *   1. Did the turn produce titled file blocks (the sandbox contract)?
 *   2. Do the extracted files pass the static gate (real tsc syntax check)?
 *   3. Anchor coverage: does the artifact engage the brief's features?
 *   4. Which arm built it (deterministic recipe vs council vs single-model)?
 *   5. With --build: does `npm install && npm run build` (tsc -b && vite build)
 *      succeed on the extracted project? Apps are built SEQUENTIALLY.
 *
 * Usage:  npx tsx scripts/council-codegen-eval.mts [--briefs=N] [--build]
 * Output: c:\tmp\council-eval\<slug>\  +  a summary table on stdout.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

import { createDb } from '../packages/core/src/db/client.js';
import { ModelRegistry } from '../packages/core/src/models/adapter.js';
import { VaiEngine } from '../packages/core/src/models/vai-engine.js';
import { ChatService } from '../packages/core/src/chat/service.js';
import {
  LocalOpenAICompatibleAdapter,
} from '../packages/core/src/models/provider-adapters.js';
import {
  discoverOllamaModels,
  rankDiscoveredModels,
  buildDiscoveredModelProfile,
} from '../packages/core/src/models/ollama-discovery.js';
import { evaluateBuilderRequestSatisfaction, hasBuilderFileBlocks } from '../packages/core/src/chat/builder-satisfaction.js';
import { validateGeneratedApp } from '../packages/core/src/models/builder/council-codegen/validate-app.js';

const OUT_ROOT = 'c:/tmp/council-eval';
const PER_APP_TIMEOUT_MS = 15 * 60 * 1000;

const BRIEFS: ReadonlyArray<{ slug: string; brief: string }> = [
  {
    slug: 'plant-waterer',
    brief: 'build a houseplant watering tracker app where I can add plants with a name and watering interval in days, mark a plant as watered today, and see which plants are overdue',
  },
  {
    slug: 'flashcards',
    brief: 'build a flashcard study app for Norwegian vocabulary with flip cards, a shuffle button, right/wrong scoring, and a final score summary',
  },
  {
    slug: 'trip-splitter',
    brief: 'build an expense splitter app for a road trip with friends where I add expenses with who paid and the amount, and it shows each person\'s balance and who owes who',
  },
  {
    slug: 'recipe-box',
    brief: 'build a recipe box app where I can save recipes with ingredients and cook time, filter them by tag, and mark favorites',
  },
];

const TITLED_BLOCK = /```([^\r\n`]*)\btitle=["']([^"']+)["'][^\r\n`]*\r?\n([\s\S]*?)```/g;

interface AppResult {
  slug: string;
  durationMs: number;
  modelId: string;
  strategy: string;
  councilStages: string[];
  fileCount: number;
  files: string[];
  hasFileBlocks: boolean;
  coverage: number;
  satisfied: boolean;
  staticOk: boolean | null;
  staticErrors: string[];
  buildOk: boolean | null;
  buildError: string;
  error?: string;
}

function extractTitledFiles(text: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const match of text.matchAll(TITLED_BLOCK)) {
    const filePath = (match[2] ?? '').trim();
    const body = match[3] ?? '';
    if (filePath && !files.has(filePath)) files.set(filePath, body);
  }
  return files;
}

async function main() {
  const args = process.argv.slice(2);
  const briefCount = Number(args.find((a) => a.startsWith('--briefs='))?.split('=')[1]) || BRIEFS.length;
  const doBuild = args.includes('--build');
  const briefs = BRIEFS.slice(0, briefCount);

  // ── Bootstrap: in-memory DB + vai:v0 + discovered local council ──
  const db = createDb(':memory:');
  const models = new ModelRegistry();
  const engine = new VaiEngine({ testMode: true });
  models.register(engine as never);

  const discovered = await discoverOllamaModels('http://localhost:11434');
  if (!discovered || discovered.length === 0) {
    console.error('FATAL: Ollama daemon unreachable or no models installed — the council needs local models.');
    process.exit(1);
  }
  const localProvider = { enabled: true, baseUrl: 'http://localhost:11434' } as never;
  const rankedIds: string[] = [];
  for (const model of rankDiscoveredModels(discovered)) {
    const adapter = new LocalOpenAICompatibleAdapter(buildDiscoveredModelProfile(model), localProvider);
    models.register(adapter);
    rankedIds.push(adapter.id);
  }
  console.log(`Council roster (ranked): ${rankedIds.join(' → ')}`);

  const chat = new ChatService(db, models, {
    vaiFallbackChain: rankedIds,
  });

  rmSync(OUT_ROOT, { recursive: true, force: true });
  mkdirSync(OUT_ROOT, { recursive: true });

  const results: AppResult[] = [];

  for (const { slug, brief } of briefs) {
    console.log(`\n━━━ ${slug} ━━━\n${brief}`);
    const startedAt = Date.now();
    const result: AppResult = {
      slug,
      durationMs: 0,
      modelId: '',
      strategy: '',
      councilStages: [],
      fileCount: 0,
      files: [],
      hasFileBlocks: false,
      coverage: 0,
      satisfied: false,
      staticOk: null,
      staticErrors: [],
      buildOk: null,
      buildError: '',
    };

    try {
      const conversationId = chat.createConversation('vai:v0', slug, 'builder');
      let fullText = '';
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`timed out after ${PER_APP_TIMEOUT_MS / 60000} min`)), PER_APP_TIMEOUT_MS).unref();
      });

      const consume = (async () => {
        for await (const chunk of chat.sendMessage(conversationId, brief)) {
          if (chunk.type === 'text_delta' && chunk.textDelta) fullText += chunk.textDelta;
          if (chunk.type === 'progress' && chunk.progress) {
            const { stage, label, status } = chunk.progress;
            if (stage.startsWith('council-')) result.councilStages.push(`${stage}:${status} ${label}`);
            console.log(`  [${stage}] ${label}${chunk.progress.detail ? ` — ${chunk.progress.detail}` : ''}`);
          }
          if (chunk.type === 'done') {
            result.modelId = chunk.modelId ?? '';
            result.strategy = chunk.thinking?.strategy ?? '';
          }
        }
      })();
      await Promise.race([consume, timeout]);

      result.durationMs = Date.now() - startedAt;
      result.hasFileBlocks = hasBuilderFileBlocks(fullText);
      const satisfaction = evaluateBuilderRequestSatisfaction(brief, fullText);
      result.coverage = satisfaction.coverage;
      result.satisfied = satisfaction.satisfied;

      const files = extractTitledFiles(fullText);
      result.fileCount = files.size;
      result.files = [...files.keys()];

      const appDir = path.join(OUT_ROOT, slug);
      mkdirSync(appDir, { recursive: true });
      writeFileSync(path.join(appDir, '_chat-output.md'), fullText, 'utf8');
      for (const [filePath, body] of files) {
        const target = path.join(appDir, filePath);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, body.endsWith('\n') ? body : `${body}\n`, 'utf8');
      }

      const appTsx = files.get('src/App.tsx') ?? null;
      const stylesCss = files.get('src/styles.css') ?? null;
      if (appTsx) {
        const report = await validateGeneratedApp({ appTsx, stylesCss });
        result.staticOk = report.ok;
        result.staticErrors = [...report.errors];
      }

      if (doBuild && files.has('package.json') && appTsx) {
        console.log('  [build] npm install + npm run build (sequential, this takes a while)…');
        try {
          execSync('npm install --no-audit --no-fund --loglevel=error', { cwd: appDir, stdio: 'pipe', timeout: 8 * 60 * 1000 });
          // Not `npm run build`: this machine's npm script-shell is PowerShell
          // 5.1, where the scaffold's `tsc -b && vite build` is a parse error.
          execSync('npx tsc -b', { cwd: appDir, stdio: 'pipe', timeout: 5 * 60 * 1000 });
          execSync('npx vite build', { cwd: appDir, stdio: 'pipe', timeout: 5 * 60 * 1000 });
          result.buildOk = true;
          console.log('  [build] PASS');
        } catch (error) {
          result.buildOk = false;
          const e = error as { stdout?: Buffer; stderr?: Buffer; message?: string };
          result.buildError = [e.stdout?.toString() ?? '', e.stderr?.toString() ?? '', e.message ?? '']
            .join('\n').trim().slice(-2000);
          console.log('  [build] FAIL');
        }
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      result.durationMs = Date.now() - startedAt;
      console.error(`  ERROR: ${result.error}`);
    }

    results.push(result);
    console.log(`  done in ${(result.durationMs / 1000).toFixed(0)}s — model=${result.modelId} files=${result.fileCount} coverage=${(result.coverage * 100).toFixed(0)}% static=${result.staticOk} build=${result.buildOk}`);
  }

  // ── Summary ──
  console.log('\n══════════ COUNCIL CODEGEN EVAL SUMMARY ══════════');
  for (const r of results) {
    const arm = r.councilStages.length > 0 ? 'council' : (r.modelId.startsWith('local:') ? 'single-model' : 'deterministic');
    console.log([
      r.slug.padEnd(14),
      `arm=${arm.padEnd(13)}`,
      `files=${String(r.fileCount).padEnd(2)}`,
      `coverage=${(r.coverage * 100).toFixed(0).padStart(3)}%`,
      `satisfied=${r.satisfied}`,
      `static=${r.staticOk === null ? 'n/a' : r.staticOk}`,
      `build=${r.buildOk === null ? 'skip' : r.buildOk}`,
      `${(r.durationMs / 1000).toFixed(0)}s`,
      r.error ? `ERROR=${r.error}` : '',
    ].join('  '));
    if (r.staticErrors.length > 0) console.log(`    static errors: ${r.staticErrors.slice(0, 3).join(' | ')}`);
    if (r.buildError) console.log(`    build error tail: ${r.buildError.slice(-300).replace(/\r?\n/g, ' ¶ ')}`);
  }
  writeFileSync(path.join(OUT_ROOT, 'summary.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nArtifacts: ${OUT_ROOT}`);

  const ok = results.every((r) => !r.error && r.hasFileBlocks && r.staticOk !== false && r.buildOk !== false);
  process.exit(ok ? 0 : 2);
}

main().catch((error) => {
  console.error('FATAL:', error);
  process.exit(1);
});
