/**
 * Stack template types — the tier-based production template system.
 * Stacks are fullstack app templates (PERN, MERN, Next.js, T3) with
 * progressive complexity tiers (Basic → Solid → Battle-Tested → Vai).
 */

export type StackId = 'pern' | 'mern' | 'nextjs' | 't3';
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
    description: 'Minimal starter — get running in seconds',
  },
  solid: {
    name: 'Solid Templates',
    label: 'Recommended',
    description: 'Production patterns — auth, validation, ORM',
  },
  'battle-tested': {
    name: 'Battle-Tested Templates',
    label: 'Production',
    description: 'Deployment ready — Docker, tests, CI/CD',
  },
  vai: {
    name: 'Vai Templates',
    label: 'Premium',
    description: "VeggaAI's curated collection — Vegga's patterns & tooling",
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
