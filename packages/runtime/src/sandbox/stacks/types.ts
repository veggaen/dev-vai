/**
 * Stack template types — the tier-based production template system.
 * Stacks are fullstack app templates (PERN, MERN, Next.js, T3) with
 * progressive complexity tiers (Basic → Solid → Battle-Tested → Vai).
 *
 * Also supports user-defined custom stacks for flexible technology choices.
 */

/** Built-in stack IDs */
export type BuiltinStackId = 'pern' | 'mern' | 'nextjs' | 't3' | 'vinext' | 'game';

/** All stack IDs (built-in + custom) — custom stacks use `custom-{slug}` format */
export type StackId = BuiltinStackId | `custom-${string}`;
export type TierId = 'basic' | 'solid' | 'battle-tested' | 'vai';

export interface StackTemplate {
  /** Unique ID like 'pern-basic' */
  id: string;
  stackId: StackId;
  tier: TierId;
  name: string;
  description: string;
  /** Feature bullets shown in tier selector */
  features: string[];
  /** Files to scaffold */
  files: { path: string; content: string }[];
  /** Whether template includes a Dockerfile */
  hasDocker: boolean;
  /** Whether template includes tests */
  hasTests: boolean;
  /** If true, this tier is not yet available */
  comingSoon?: boolean;
}

export interface StackDefinition {
  id: StackId;
  name: string;
  tagline: string;
  description: string;
  techStack: string[];
  icon: string;
  /** Tailwind color key (blue, green, purple, amber) */
  color: string;
  templates: StackTemplate[];
}

/** Metadata for each tier level */
export const TIER_META: Record<TierId, { name: string; label: string; description: string }> = {
  basic: {
    name: 'Basic Templates',
    label: 'Starter',
    description: 'Clean MVP — zero config, works instantly',
  },
  solid: {
    name: 'Solid Templates',
    label: 'With Auth',
    description: 'Auth + validation + ORM — production patterns',
  },
  'battle-tested': {
    name: 'Battle-Tested Templates',
    label: 'Social Platform',
    description: 'Auth + social features + admin dashboard + Docker + CI/CD',
  },
  vai: {
    name: 'Vai Templates',
    label: 'Premium',
    description: 'Glass UI, BYOK, monitoring, key sharing — feels like a $100M product',
  },
};

/** Deploy pipeline step definition */
export interface DeployStep {
  id: string;
  label: string;
}

export const DEPLOY_STEPS: DeployStep[] = [
  { id: 'scaffold', label: 'Scaffolding project' },
  { id: 'install', label: 'Installing packages' },
  { id: 'build', label: 'Building application' },
  { id: 'docker', label: 'Docker verification' },
  { id: 'test', label: 'Running tests' },
  { id: 'start', label: 'Starting dev server' },
  { id: 'verify', label: 'Health check' },
];

/** Merge file arrays — overrides by path */
export function mergeFiles(
  base: { path: string; content: string }[],
  overrides: { path: string; content: string }[],
): { path: string; content: string }[] {
  const map = new Map(base.map((f) => [f.path, f]));
  for (const f of overrides) map.set(f.path, f);
  return Array.from(map.values());
}

/* ── Custom Stack Support ──────────────────────────────────────── */

/**
 * User-defined custom stack configuration.
 * Users can mix and match technologies to create their own stack.
 *
 * Usage flow:
 * 1. User selects technologies via UI (or Vai suggests them)
 * 2. System generates a CustomStackConfig
 * 3. Config is saved to DB and registered as a StackDefinition
 * 4. Deployed through the same pipeline as built-in stacks
 */
export interface CustomStackConfig {
  /** User-chosen name, e.g. "My SaaS Stack" */
  name: string;
  /** Auto-generated slug from name, e.g. "my-saas-stack" */
  slug: string;
  /** User description */
  description?: string;
  /** Icon emoji chosen by user (default: 🛠) */
  icon?: string;
  /** Color for UI accent (default: 'zinc') */
  color?: string;

  /** Technology selections */
  frontend: {
    framework: 'react' | 'vue' | 'svelte' | 'solid' | 'vanilla';
    styling: 'tailwind' | 'css-modules' | 'styled-components' | 'vanilla-css';
    bundler: 'vite' | 'webpack' | 'turbopack';
  };
  backend: {
    runtime: 'node' | 'bun' | 'deno';
    framework: 'express' | 'fastify' | 'hono' | 'next-api' | 'trpc';
    orm?: 'prisma' | 'drizzle' | 'mongoose' | 'none';
  };
  database?: {
    type: 'postgresql' | 'mysql' | 'sqlite' | 'mongodb' | 'none';
    provider?: string; // e.g. 'neon', 'planetscale', 'supabase'
  };
  extras?: {
    auth?: 'clerk' | 'next-auth' | 'lucia' | 'none';
    testing?: 'vitest' | 'jest' | 'playwright' | 'none';
    docker?: boolean;
    ci?: 'github-actions' | 'none';
  };

  /** Files to scaffold (generated from tech selections or provided directly) */
  files: { path: string; content: string }[];

  /** Created timestamp */
  createdAt?: number;
}

/**
 * Convert a CustomStackConfig into a StackDefinition for the deploy pipeline.
 */
export function customConfigToStack(config: CustomStackConfig): StackDefinition {
  const stackId = `custom-${config.slug}` as StackId;
  const techStack = [
    config.frontend.framework,
    config.frontend.styling === 'tailwind' ? 'Tailwind CSS' : config.frontend.styling,
    config.backend.framework,
    config.database?.type ?? 'no DB',
  ].filter(Boolean);

  return {
    id: stackId,
    name: config.name,
    tagline: config.description || `Custom stack: ${techStack.join(' + ')}`,
    description: config.description || `User-defined stack with ${techStack.join(', ')}`,
    techStack,
    icon: config.icon || '🛠',
    color: config.color || 'zinc',
    templates: [
      {
        id: `${stackId}-basic`,
        stackId,
        tier: 'basic',
        name: `${config.name} — Custom`,
        description: `Custom ${config.name} stack`,
        features: techStack.map((t) => `${t} configured`),
        files: config.files,
        hasDocker: config.extras?.docker ?? false,
        hasTests: config.extras?.testing !== 'none' && config.extras?.testing !== undefined,
      },
    ],
  };
}
