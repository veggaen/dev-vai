import type { FastifyInstance } from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { BRAND_BLUEPRINTS } from '@vai/core';
import type { ModelRegistry, VaiOperationalEvidenceSnapshot } from '@vai/core';

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
  /** Same bounded evidence packet supplied to Vai's zero-model self-assessment lane. */
  readonly operationalEvidence?: () => VaiOperationalEvidenceSnapshot;
  /** Chat service for deliberation-trace parity (agents see what the UI shows). */
  readonly chatService?: {
    getConversation(id: string): unknown;
    getMessages(id: string): Array<Record<string, unknown>>;
  };
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
    let operationalEvidence: VaiOperationalEvidenceSnapshot | null = null;
    try {
      operationalEvidence = deps.operationalEvidence?.() ?? null;
    } catch {
      // Introspection stays available if a bounded read fails unexpectedly.
    }

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
      conversationIntelligence: {
        owner: 'vai:v0',
        stateSource: 'Persisted transcript, reconstructed deterministically on every turn',
        pipeline: [
          'identify current speaker and entity kind',
          'preserve named relationships and attributed beliefs',
          'carry values, shared goals, and we/us referents',
          'answer relational recall before generic fallback',
          'answer broad Vai self-assessment from explicit operational-evidence boundaries',
          'reflect on the last completed exchange from measurable evidence',
          'nominate proven gaps to the guarded self-improvement queue',
        ],
        modelPolicy: 'Relational turns are answered by Vai without Council. Optional model arms receive Vai-derived dialogue state; they do not infer or own attribution.',
        safety: 'Reflection nominations cannot edit code directly and remain subject to review, tests, and verification.',
        answerRevisionGate: {
          owner: 'vai:v0',
          policy: 'Council may propose a revision, but Vai compares it with the original before release.',
          checks: [
            'preserve release-critical prompt focus',
            'preserve every already-covered multi-intent deliverable',
            'reject material deterministic answer-quality regressions',
            'keep the original draft when a revision fails integrity',
          ],
          visibility: 'Rejected revisions emit a progress step with the deterministic failure reason.',
        },
      },
      boundedReasoning: {
        owner: 'vai:v0',
        policy: 'Parse a bounded input grammar into an inspectable intermediate representation, execute it, verify its invariants, return explicit ambiguity sets for non-unique results, and contain unsupported grammars instead of guessing.',
        representations: [
          'directed constraint graphs and critical paths',
          'set inclusion/exclusion chains and minimum covers',
          '2x2 controlled-interaction tables and intervention-based belief updates',
          'Bayes, throughput, and recurrence equations',
          'alias state, microtask/timer queues, spatial coordinates, and grouped aggregates',
          'precedence stacks, evidence conflicts, untrusted-record counts, and destructive-action clarification',
          'contrapositive chains, underdetermined systems, expected-value choices, and exact two-worker partitions',
          'per-iteration closure bindings, confounding controls, constructive counterexamples, and corrected event ledgers',
          'linear underdetermination witnesses, expected-cost objectives, count-posterior policy decisions, and Boolean consistency search',
          'finite Boolean model search, quantified unary rules, abduction, CSP witnesses, graph coloring, and bijections',
          'resource/release constrained planning, multi-budget routing, weighted set cover, and minimax regret tables',
          'whitelisted MiniJS heap/closure/iterator/microtask semantics, causal SCMs, and transactional anomaly traces',
          'event-sourced identity, alias chains, scoped settings, posterior policy composition, and explicit ambiguity sets',
        ],
        modelPolicy: 'Verified bounded answers are owned by Vai and bypass Council and response models. Recognized unsupported grammars are contained instead of being hijacked by unrelated high-confidence handlers.',
        competition: {
          suite: 'reasoning-spectrum-v4',
          evaluationPolicy: 'Frozen pack/scorer fingerprints, fresh engine per scenario, shuffled-order determinism, semantic witness checks, attack-bank controls, and first-exposure results kept separate from retired-pack regression.',
          baseFingerprint: '41a4c549d261972e117be3b2f5a09e38182676970652212455ebf0e003bcadaf',
          fresh1Fingerprint: '009cc02f5f8dc8e9c8a7168cd17f8a79fc474f61acef2d4dfa1c3c74e6f4dd76',
          fresh2Fingerprint: '6f27de0f9336597695643cd2968880d4e741d891493fdabfac3af1891ff8c98a',
          fresh3Fingerprint: '6c69fd30eaf209eed7e002bbe7954b5228ca90dfc46a88dd4095813d232c9b4f',
          v3SoundnessFingerprint: 'f7ef13d374be24d9715dba3355b714c7be75c2549620b93363a4d164affb4314',
          v3FrontierFingerprint: '6e2620a5719304fe6f649715e4e33dafa51c33eb829eb959983a5344f077688e',
          v3FreshFingerprint: '3aa253b73d5fc2b04e5a51beadf3cfc648c83b4bd2d5ff6b86028b164c7c4834',
          v4SealedFingerprint: '714abf15e1b457c63a6a10bd40b6fd7b0de0d67f35269a5145158bc342d20786',
          v4Wave2Fingerprint: 'e8e727cd37c1091e1252a8ab78a43cd8f7894a5177aed32957e54128df5cbaaa',
        },
      },
      operationalEvidence,
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
        dialogueState: 'packages/core/src/chat/dialogue-state.ts',
        selfAssessment: 'packages/core/src/chat/vai-self-assessment.ts',
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

  // 1:1 deliberation-trace parity: agents read the EXACT progress steps the human
  // UI renders (same persisted blob rehydrated by getMessages → progressSteps).
  // No re-summarizing, no alternate view — one trace, two audiences.
  app.get<{ Params: { id: string } }>('/api/agent/conversations/:id/trace', async (request, reply) => {
    if (!deps.chatService) {
      reply.code(501);
      return { error: 'trace introspection not wired on this runtime' };
    }
    const conversation = deps.chatService.getConversation(request.params.id);
    if (!conversation) {
      reply.code(404);
      return { error: `Conversation not found: ${request.params.id}` };
    }
    const rows = deps.chatService.getMessages(request.params.id);
    return {
      schemaVersion: 1,
      conversationId: request.params.id,
      renderContract: {
        uiEntryPoint: 'apps/desktop/src/components/chat/TurnProcessSection.tsx',
        phases: 'stage → phase via Timeline.logic.ts phaseForStage(); round via /round-(\\d+)/',
        memberFields: 'councilMembers[]: name, verdict, confidence, note, realIntent, hiddenMeaning, missingCapability, methodLesson, suggestedAction, concerns[], reasoningPreview (live)',
        processLog: 'processLog[]: kind thought|read|action|artifact|feedback|verdict|tool|tool-response — rendered verbatim, in order',
      },
      turns: rows
        .filter((row) => row.role === 'assistant')
        .map((row) => ({
          messageId: row.id,
          createdAt: row.createdAt,
          steps: row.progressSteps ?? [],
        })),
    };
  });
}
