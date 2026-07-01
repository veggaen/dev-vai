import type { FastifyInstance } from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { BRAND_BLUEPRINTS } from '@vai/core';
import type { ModelRegistry } from '@vai/core';

/**
 * Agent introspection — the machine-readable "way" for AI agents to understand
 * Vai before changing it. Pairs with AGENTS.md (the human/agent contract) and
 * docs/vai-improvement-backlog.md (the shared improvement queue).
 *
 * Design rule: Vai is a deterministic engine that EMPLOYS models — so this
 * endpoint reports the institution (pipeline, gates, roster, goals), not just
 * a model list.
 */

export interface AgentIntrospectDeps {
  readonly models: ModelRegistry;
  readonly fallbackChain: readonly string[];
  readonly repoRoot?: string;
}

function readDoc(repoRoot: string, relative: string): string | null {
  const target = path.join(repoRoot, relative);
  try {
    return existsSync(target) ? readFileSync(target, 'utf8') : null;
  } catch {
    return null;
  }
}

function readJsonDoc(repoRoot: string, relative: string): unknown | null {
  const raw = readDoc(repoRoot, relative);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function findVaiRepoRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(dir, 'AGENTS.md')) && existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start, '..', '..');
}

export function registerAgentIntrospectRoutes(app: FastifyInstance, deps: AgentIntrospectDeps): void {
  app.get('/api/agent/introspect', async () => {
    const repoRoot = deps.repoRoot ?? findVaiRepoRoot();
    const localIds = deps.models.listByProvider('local').map((adapter) => adapter.id);
    const councilOrder = [...new Set([...deps.fallbackChain.filter((id) => id !== 'vai:v0'), ...localIds])].slice(0, 3);

    return {
      schemaVersion: 1,
      identity: {
        name: 'Vai (VeggaAI)',
        nature: 'Deterministic, inspectable computer intelligence (vai:v0) that routes, validates, and verifies — and employs local/cloud models as council members and advisors. Vai is NOT an LLM.',
        owner: 'V3gga',
        standingGoal: 'Vai and its agents continuously improve Vai itself; humans must be able to see and steer the process live.',
      },
      models: deps.models.list().map((adapter) => ({
        id: adapter.id,
        provider: adapter.provider ?? null,
        qualityTier: adapter.qualityTier ?? null,
        speedTier: adapter.speedTier ?? null,
      })),
      builderCouncil: {
        memberOrder: councilOrder,
        roles: { architectAndCoderAndStylist: councilOrder[0] ?? null, reviewers: councilOrder.slice(1) },
        freshPipeline: ['architect (spec, blueprint-merged)', 'coder (App.tsx ONLY)', 'validate (tsc syntax+semantic, react-typed)', 'review (blueprint checklist = must-fix)', 'repair (bounded)', 'stylist (CSS generated FOR extracted class list)', 'pair-validate (coverage + richness)', 'assemble (known-good Vite scaffold)'],
        editPipeline: 'Active-sandbox prompts patch current files only (scaffold-owned files forbidden, app identity kept).',
        gates: [
          'imports: react only',
          'no external asset URLs (offline sandbox)',
          'App↔CSS class coverage (mismatch >80% = hard error)',
          'CSS richness: font-family, background, :hover/:focus, ≥10 rules',
          'fallback one-shot arm gated too — honest refusal over junk',
          'render-proof (screenshot) required before PASS — currently external eval, moving into pipeline (see backlog)',
        ],
      },
      brandBlueprints: BRAND_BLUEPRINTS.map((blueprint) => ({
        brand: blueprint.brand,
        featureCount: blueprint.features.length,
        reviewChecklist: blueprint.reviewChecklist,
      })),
      channels: {
        chatWs: '/api/chat (WS; mode builder streams council-* progress stages)',
        directPipe: '\\\\.\\pipe\\vai-grok-direct',
        directTcp: '127.0.0.1:48765',
        evalHarness: 'scripts/council-codegen-eval.mts',
        bootstrap: 'pnpm agent:bootstrap',
      },
      agentTooling: readJsonDoc(repoRoot, path.join('docs', 'agent-tooling-guide.json')),
      keyPaths: {
        chatPolicy: 'packages/core/src/chat/service.ts',
        engine: 'packages/core/src/models/vai-engine.ts',
        councilCodegen: 'packages/core/src/models/builder/council-codegen/',
        sandbox: 'packages/runtime/src/sandbox/',
        liveProcessUi: 'apps/desktop/src/components/ChatWindow.tsx + chat/ThinkingPanel*',
        steering: 'packages/runtime/src/steering/ (being evolved into the improvement loop)',
      },
      docs: {
        agentsGuide: readDoc(repoRoot, 'AGENTS.md'),
        improvementBacklog: readDoc(repoRoot, path.join('docs', 'vai-improvement-backlog.md')),
      },
    };
  });
}
