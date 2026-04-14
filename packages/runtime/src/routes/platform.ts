import type { FastifyInstance } from 'fastify';
import { DEFAULT_CONVERSATION_MODE, type ModelRegistry, type VaiConfig } from '@vai/core';
import type { SandboxManager } from '../sandbox/manager.js';
import { getAllStacks } from '../sandbox/stacks/index.js';
import { PlatformAuthService } from '../auth/platform-auth.js';

export function registerPlatformRoutes(
  app: FastifyInstance,
  config: VaiConfig,
  models: ModelRegistry,
  sandbox: SandboxManager,
  auth: PlatformAuthService,
) {
  app.get('/api/platform/bootstrap', async (request) => {
    const viewer = await auth.getViewer(request);
    const stacks = getAllStacks().map((stack) => ({
      id: stack.id,
      name: stack.name,
      tagline: stack.tagline,
      techStack: stack.techStack,
      templates: stack.templates
        .filter((template) => !(template.comingSoon ?? false))
        .map((template) => ({
          id: template.id,
          tier: template.tier,
          name: template.name,
          hasDocker: template.hasDocker,
          hasTests: template.hasTests,
        })),
    }));

    const templates = sandbox.listTemplates().map((template) => ({
      id: template.id,
      name: template.name,
      category: template.category,
    }));

    const ideTargets = [
      {
        id: 'desktop',
        label: 'Vai Desktop',
        directLaunch: true,
        collaborationMode: 'native-shell',
        invitePresets: [
          { peerKey: 'vai:planner', displayName: 'Vai Planner', model: 'Vai', recommended: true },
          { peerKey: 'vai:builder', displayName: 'Vai Builder', model: 'Vai Builder', recommended: false },
        ],
      },
      {
        id: 'vscode',
        label: 'VS Code',
        directLaunch: true,
        collaborationMode: 'extension-uri',
        invitePresets: [
          { peerKey: 'vscode:gpt-5.4', displayName: 'GPT-5.4 in VS Code', model: 'GPT-5.4', recommended: true },
          { peerKey: 'vscode:copilot-agent', displayName: 'Copilot Agent in VS Code', model: 'Copilot Agent', recommended: false },
        ],
      },
      {
        id: 'cursor',
        label: 'Cursor',
        directLaunch: false,
        collaborationMode: 'desktop-launch-profile',
        invitePresets: [
          { peerKey: 'cursor:composer', displayName: 'Composer in Cursor', model: 'Composer', recommended: true },
        ],
      },
      {
        id: 'antigravity',
        label: 'Antigravity',
        directLaunch: false,
        collaborationMode: 'desktop-launch-profile',
        invitePresets: [
          { peerKey: 'antigravity:claude-opus-4.6', displayName: 'Claude Opus 4.6 in Antigravity', model: 'Claude Opus 4.6', recommended: true },
        ],
      },
    ];

    return {
      product: {
        name: 'VeggaAI Platform',
        defaultFrontend: 'vite-web',
        frontendAlternatives: ['vite-web', 'vinext-web'],
        runtime: 'shared-fastify-runtime',
      },
      frontends: [
        {
          id: 'vite-web',
          framework: 'vite',
          role: 'current-primary-web-shell',
          sharesRuntime: true,
        },
        {
          id: 'vinext-web',
          framework: 'vinext',
          role: 'alternate-web-shell',
          sharesRuntime: true,
          backedByStack: 'vinext',
        },
      ],
      models: {
        defaultModelId: config.defaultModelId,
        available: models.list().map((model) => ({
          id: model.id,
          displayName: model.displayName,
          provider: model.provider ?? 'unknown',
          supportsStreaming: model.supportsStreaming,
          supportsToolUse: model.supportsToolUse,
        })),
        providers: Object.values(config.providers).map((provider) => ({
          id: provider.id,
          enabled: provider.enabled,
          defaultModel: provider.defaultModel ?? null,
          registered: models.listByProvider(provider.id).length > 0,
          registeredModelCount: models.listByProvider(provider.id).length,
          byokImplemented: false,
          byokPlanned: provider.id !== 'vai' && provider.id !== 'local',
        })),
        composition: {
          implemented: false,
          planned: true,
          note: 'Today a conversation runs on one model. Hybrid Vai plus external-model orchestration should live above the conversation layer.',
        },
      },
      workflow: {
        defaultMode: DEFAULT_CONVERSATION_MODE,
        modes: ['chat', 'agent', 'builder', 'plan', 'debate'],
        autoSteering: {
          implemented: 'frontend-guided and prompt-guided only',
          planned: 'confidence-based transition from chat to plan with user confirmation',
        },
        phases: [
          { id: 'chat', purpose: 'discover the idea and clarify constraints' },
          { id: 'agent', purpose: 'adapt response depth and actions to the user intent' },
          { id: 'plan', purpose: 'lock assumptions, architecture, and revision intent' },
          { id: 'builder', purpose: 'generate files and prepare sandbox artifacts' },
          { id: 'preview', purpose: 'inspect the generated app in sandbox' },
          { id: 'deploy', purpose: 'promote approved artifacts to deployment flow' },
        ],
      },
      sandbox: {
        maxSandboxes: config.maxSandboxes,
        dockerEnabled: config.sandboxDocker,
        stacks,
        templates,
      },
      auth: {
        ...auth.getPublicConfig(),
        ...viewer,
      },
      collaboration: {
        ideTargets,
        auditPolicy: {
          implemented: true,
          note: 'Audit requests can fan out to invited peers and collect per-peer verdicts. Automatic execution depends on the target IDE integration surface.',
        },
      },
      platformGoals: {
        defaultExperience: 'Vai-first chat that can escalate into plan and sandbox workflows',
        targetExperience: 'Users bring ideas, choose model strategy, converge on a plan, then generate and preview monorepo apps',
      },
    };
  });
}