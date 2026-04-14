/**
 * TemplateGallery — Component-based stack builder with curated presets.
 *
 * New tier naming:
 *   basic        → "Basic SPA"
 *   solid        → "With Auth"
 *   battle-tested → "Social Platform"
 *   vai          → "Full Commerce"
 *
 * Flow: Choose preset OR pick components → Configure tier → Deploy
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Box, ChevronRight, Lock, Rocket, Sparkles,
  Shield, Zap, Package, ShoppingCart, Users, MessageSquare,
  Image, CreditCard, Check, Plus,
} from 'lucide-react';
import { API_BASE } from '../lib/api.js';

/* ── Types matching backend ── */

interface StackTierInfo {
  id: string;
  tier: string;
  name: string;
  description: string;
  features: string[];
  fileCount: number;
  hasDocker: boolean;
  hasTests: boolean;
  comingSoon: boolean;
}

interface StackInfo {
  id: string;
  name: string;
  tagline: string;
  description: string;
  techStack: string[];
  icon: string;
  color: string;
  templates: StackTierInfo[];
}

interface Props {
  onDeploy: (stackId: string, tier: string, stackName?: string, tierName?: string) => void;
  onTemplate?: (templateId: string, name: string) => void;
  isDeploying: boolean;
}

const QUICK_STARTS = [
  {
    id: 'react-vite',
    label: 'React + Vite',
    description: 'SPA, tool, game, prototype',
    icon: '⚡',
    color: 'from-cyan-500/10 to-cyan-500/3 border-cyan-800/30 hover:border-cyan-600/40',
    iconColor: 'text-cyan-400',
  },
  {
    id: 'nextjs',
    label: 'Next.js 15',
    description: 'Full-stack app with API routes',
    icon: '▲',
    color: 'from-violet-500/10 to-violet-500/3 border-violet-800/30 hover:border-violet-600/40',
    iconColor: 'text-violet-400',
  },
] as const;

/* ── New tier display names & metadata ── */

const TIER_DISPLAY: Record<string, { name: string; description: string; icon: typeof Box; badge: string; badgeClass: string; borderClass: string }> = {
  basic: {
    name: 'Basic SPA',
    description: 'Clean single-page app with Tailwind, icons, and in-memory API',
    icon: Zap,
    badge: 'Starter',
    badgeClass: 'bg-zinc-800 text-zinc-400',
    borderClass: 'border-zinc-700 hover:border-zinc-600',
  },
  solid: {
    name: 'With Auth',
    description: 'Adds authentication, Prisma ORM, Zod validation, and real database',
    icon: Shield,
    badge: 'Recommended',
    badgeClass: 'bg-blue-500/10 text-blue-400',
    borderClass: 'border-blue-800/50 hover:border-blue-600/50',
  },
  'battle-tested': {
    name: 'Social Platform',
    description: 'Auth + social features, messaging, blog, image/video sharing, Docker & CI/CD',
    icon: Users,
    badge: 'Full Social',
    badgeClass: 'bg-amber-500/10 text-amber-400',
    borderClass: 'border-amber-800/50 hover:border-amber-600/50',
  },
  vai: {
    name: 'Full Commerce',
    description: 'Everything + PayPal, Web3 (Reown AppKit), monitoring, error boundaries, health checks',
    icon: ShoppingCart,
    badge: 'Premium',
    badgeClass: 'bg-purple-500/10 text-purple-400',
    borderClass: 'border-purple-800/50 hover:border-purple-600/50',
  },
};

/* ── Component categories for the picker ── */

interface StackComponent {
  id: string;
  name: string;
  category: string;
  icon: typeof Box;
  description: string;
  includedIn: string[];  // tier IDs where this is included
}

const AVAILABLE_COMPONENTS: StackComponent[] = [
  { id: 'spa', name: 'Single-Page App', category: 'Core', icon: Box, description: 'React + Tailwind CSS + Router', includedIn: ['basic', 'solid', 'battle-tested', 'vai'] },
  { id: 'api', name: 'REST API', category: 'Core', icon: Zap, description: 'Express/Next.js API routes', includedIn: ['basic', 'solid', 'battle-tested', 'vai'] },
  { id: 'icons', name: 'Icon Library', category: 'Core', icon: Sparkles, description: 'Lucide React icons', includedIn: ['basic', 'solid', 'battle-tested', 'vai'] },
  { id: 'auth', name: 'Authentication', category: 'Auth', icon: Shield, description: 'JWT/Session auth with secure login', includedIn: ['solid', 'battle-tested', 'vai'] },
  { id: 'db', name: 'Database + ORM', category: 'Data', icon: Package, description: 'Prisma + PostgreSQL/MongoDB', includedIn: ['solid', 'battle-tested', 'vai'] },
  { id: 'validation', name: 'Validation', category: 'Data', icon: Check, description: 'Zod schemas + input validation', includedIn: ['solid', 'battle-tested', 'vai'] },
  { id: 'social', name: 'Social Auth', category: 'Auth', icon: Users, description: 'Google, GitHub, Discord OAuth', includedIn: ['battle-tested', 'vai'] },
  { id: 'messaging', name: 'Messaging', category: 'Social', icon: MessageSquare, description: 'Real-time chat + notifications', includedIn: ['battle-tested', 'vai'] },
  { id: 'blog', name: 'Blog / CMS', category: 'Social', icon: Package, description: 'Blog posts, comments, rich text', includedIn: ['battle-tested', 'vai'] },
  { id: 'media', name: 'Media Sharing', category: 'Social', icon: Image, description: 'Image/video uploads + galleries', includedIn: ['battle-tested', 'vai'] },
  { id: 'docker', name: 'Docker + CI/CD', category: 'DevOps', icon: Box, description: 'Containerized with GitHub Actions', includedIn: ['battle-tested', 'vai'] },
  { id: 'tests', name: 'Testing Suite', category: 'DevOps', icon: Check, description: 'Vitest + E2E tests', includedIn: ['battle-tested', 'vai'] },
  { id: 'payments', name: 'PayPal Payments', category: 'Commerce', icon: CreditCard, description: 'PayPal checkout + subscriptions', includedIn: ['vai'] },
  { id: 'web3', name: 'Web3 (Reown)', category: 'Commerce', icon: Sparkles, description: 'Reown AppKit + wallet connect', includedIn: ['vai'] },
  { id: 'monitoring', name: 'Monitoring', category: 'DevOps', icon: Shield, description: 'Health checks, error boundaries, logging', includedIn: ['vai'] },
];

const STACK_COLORS: Record<string, string> = {
  blue: 'from-blue-500/20 to-blue-500/5 border-blue-800/40 hover:border-blue-600/40',
  green: 'from-emerald-500/20 to-emerald-500/5 border-emerald-800/40 hover:border-emerald-600/40',
  zinc: 'from-zinc-500/20 to-zinc-500/5 border-zinc-700/40 hover:border-zinc-500/40',
  purple: 'from-purple-500/20 to-purple-500/5 border-purple-800/40 hover:border-purple-600/40',
};

/* ── Main Component ── */

export function TemplateGallery({ onDeploy, onTemplate, isDeploying }: Props) {
  const [stacks, setStacks] = useState<StackInfo[]>([]);
  const [selectedStack, setSelectedStack] = useState<StackInfo | null>(null);
  const [selectedTier, setSelectedTier] = useState<string>('basic');
  const [showComponentPicker, setShowComponentPicker] = useState(false);
  const [selectedComponents, setSelectedComponents] = useState<Set<string>>(new Set(['spa', 'api', 'icons']));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/sandbox/stacks`)
      .then((r) => r.json())
      .then((data: StackInfo[]) => { setStacks(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleStackClick = useCallback((stack: StackInfo) => {
    setSelectedStack(stack);
    // Default to best available tier (solid if available, otherwise highest non-comingSoon)
    const available = stack.templates.filter((t) => !t.comingSoon);
    const preferredOrder = ['solid', 'battle-tested', 'vai', 'basic'];
    const best = preferredOrder.find((t) => available.some((a) => a.tier === t)) || 'basic';
    setSelectedTier(best);
    setShowComponentPicker(false);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedStack(null);
    setSelectedTier('basic');
    setShowComponentPicker(false);
  }, []);

  const handleDeploy = useCallback(() => {
    if (!selectedStack) return;
    const tierDisplay = TIER_DISPLAY[selectedTier];
    onDeploy(selectedStack.id, selectedTier, selectedStack.name, tierDisplay?.name ?? selectedTier);
  }, [selectedStack, selectedTier, onDeploy]);

  // Infer best tier from selected components
  const inferTierFromComponents = useCallback((components: Set<string>) => {
    if (components.has('payments') || components.has('web3') || components.has('monitoring')) return 'vai';
    if (components.has('social') || components.has('messaging') || components.has('blog') || components.has('media') || components.has('docker')) return 'battle-tested';
    if (components.has('auth') || components.has('db') || components.has('validation')) return 'solid';
    return 'basic';
  }, []);

  const toggleComponent = useCallback((id: string) => {
    setSelectedComponents(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        // Don't remove core components
        if (['spa', 'api', 'icons'].includes(id)) return prev;
        next.delete(id);
      } else {
        next.add(id);
        // Auto-add dependencies
        if (['social', 'messaging', 'blog', 'media'].includes(id)) {
          next.add('auth');
          next.add('db');
          next.add('validation');
        }
        if (['payments', 'web3'].includes(id)) {
          next.add('auth');
          next.add('db');
          next.add('validation');
        }
        if (id === 'auth') {
          next.add('db');
          next.add('validation');
        }
      }
      const inferred = inferTierFromComponents(next);
      setSelectedTier(inferred);
      return next;
    });
  }, [inferTierFromComponents]);

  // Apply tier preset to component picker
  const applyTierPreset = useCallback((tier: string) => {
    setSelectedTier(tier);
    const comps = new Set<string>();
    for (const c of AVAILABLE_COMPONENTS) {
      if (c.includedIn.includes(tier)) comps.add(c.id);
    }
    setSelectedComponents(comps);
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-violet-500" />
      </div>
    );
  }

  /* ── Tier / Component Selector View ── */
  if (selectedStack) {
    const currentTier = selectedStack.templates.find((t) => t.tier === selectedTier);
    const tierDisplay = TIER_DISPLAY[selectedTier];

    if (showComponentPicker) {
      // Group components by category
      const categories = [...new Set(AVAILABLE_COMPONENTS.map(c => c.category))];

      return (
        <div className="flex h-full flex-col overflow-y-auto p-4">
          <button onClick={() => setShowComponentPicker(false)} className="mb-3 flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to tiers
          </button>

          <h3 className="mb-1 text-sm font-semibold text-zinc-200">Build Your Stack</h3>
          <p className="mb-4 text-[11px] text-zinc-500">Select components — dependencies auto-resolve</p>

          {/* Quick presets */}
          <div className="mb-4 flex flex-wrap gap-1.5">
            {Object.entries(TIER_DISPLAY).map(([tier, display]) => (
              <button
                key={tier}
                onClick={() => applyTierPreset(tier)}
                className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition-all ${
                  selectedTier === tier
                    ? 'bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/30'
                    : 'bg-zinc-800/60 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                }`}
              >
                {display.name}
              </button>
            ))}
          </div>

          {/* Component grid by category */}
          <div className="flex-1 space-y-3">
            {categories.map(cat => (
              <div key={cat}>
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-600">{cat}</p>
                <div className="space-y-1">
                  {AVAILABLE_COMPONENTS.filter(c => c.category === cat).map(comp => {
                    const isSelected = selectedComponents.has(comp.id);
                    const isCore = ['spa', 'api', 'icons'].includes(comp.id);
                    const Icon = comp.icon;
                    return (
                      <button
                        key={comp.id}
                        onClick={() => toggleComponent(comp.id)}
                        disabled={isCore}
                        className={`group/comp flex w-full items-center gap-2.5 rounded-lg border p-2 text-left transition-all ${
                          isSelected
                            ? 'border-violet-500/30 bg-violet-500/5 hover:border-violet-500/40'
                            : 'border-zinc-800/50 bg-zinc-900/30 hover:border-zinc-700 hover:bg-zinc-900/60'
                        } ${isCore ? 'opacity-70' : ''}`}
                      >
                        <div className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
                          isSelected ? 'bg-violet-500/20' : 'bg-zinc-800/80'
                        }`}>
                          {isSelected ? (
                            <Check className="h-3 w-3 text-violet-400" />
                          ) : (
                            <Plus className="h-3 w-3 text-zinc-600 group-hover/comp:text-zinc-400" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <Icon className={`h-3 w-3 ${isSelected ? 'text-violet-400' : 'text-zinc-500'}`} />
                            <span className={`text-xs font-medium ${isSelected ? 'text-zinc-200' : 'text-zinc-400'}`}>{comp.name}</span>
                            {isCore && <span className="text-[9px] text-zinc-600">required</span>}
                          </div>
                          <p className="text-[10px] text-zinc-600 truncate">{comp.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Deploy with selected tier */}
          <div className="mt-3 border-t border-zinc-800 pt-3">
            <p className="mb-2 text-[10px] text-zinc-500">
              Auto-resolved tier: <span className="font-semibold text-zinc-300">{tierDisplay?.name}</span> — {selectedComponents.size} components
            </p>
            <button
              onClick={handleDeploy}
              disabled={isDeploying || !currentTier || currentTier.comingSoon}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-violet-500 hover:shadow-lg hover:shadow-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Rocket className="h-4 w-4" />
              Deploy {tierDisplay?.name ?? ''}
            </button>
          </div>
        </div>
      );
    }

    // Tier selector view
    return (
      <div className="flex h-full flex-col overflow-y-auto p-4">
        <button onClick={handleBack} className="mb-3 flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to stacks
        </button>

        <div className="mb-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">{selectedStack.icon}</span>
            <h3 className="text-sm font-semibold text-zinc-200">{selectedStack.name}</h3>
          </div>
          <p className="mt-1 text-xs text-zinc-500">{selectedStack.description}</p>
        </div>

        {/* Component picker link */}
        <button
          onClick={() => setShowComponentPicker(true)}
          className="mb-3 flex items-center gap-2 rounded-lg border border-dashed border-zinc-700 px-3 py-2 text-xs text-zinc-400 transition-all hover:border-violet-500/40 hover:bg-violet-500/5 hover:text-violet-300"
        >
          <Plus className="h-3.5 w-3.5" />
          Pick individual components
          <ChevronRight className="ml-auto h-3 w-3" />
        </button>

        {/* Tier options */}
        <div className="flex-1 space-y-2">
          {selectedStack.templates.map((tmpl) => {
            const display = TIER_DISPLAY[tmpl.tier];
            if (!display) return null;
            const Icon = display.icon;
            const isSelected = selectedTier === tmpl.tier;

            return (
              <button
                key={tmpl.id}
                onClick={() => !tmpl.comingSoon && setSelectedTier(tmpl.tier)}
                disabled={tmpl.comingSoon || isDeploying}
                className={`group/tier w-full rounded-lg border p-3 text-left transition-all ${
                  tmpl.comingSoon
                    ? 'cursor-not-allowed border-zinc-800/50 opacity-50'
                    : isSelected
                      ? `ring-1 ring-violet-500/30 ${display.borderClass} bg-zinc-900/80`
                      : `${display.borderClass} bg-zinc-900/30 hover:bg-zinc-900/60`
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`rounded-md p-1 ${isSelected ? 'bg-violet-500/20' : 'bg-zinc-800'}`}>
                    {tmpl.comingSoon ? (
                      <Lock className="h-3.5 w-3.5 text-zinc-600" />
                    ) : (
                      <Icon className={`h-3.5 w-3.5 ${isSelected ? 'text-violet-400' : 'text-zinc-400'}`} />
                    )}
                  </div>
                  <div className="flex-1">
                    <span className="text-xs font-medium text-zinc-200">{display.name}</span>
                    <p className="text-[10px] text-zinc-500">{display.description}</p>
                  </div>
                  <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${display.badgeClass}`}>
                    {tmpl.comingSoon ? 'Coming' : display.badge}
                  </span>
                  {isSelected && !tmpl.comingSoon && (
                    <div className="h-2 w-2 rounded-full bg-violet-500" />
                  )}
                </div>

                {!tmpl.comingSoon && tmpl.features.length > 0 && (
                  <ul className="mt-2 space-y-0.5 pl-7">
                    {tmpl.features.slice(0, 4).map((f, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[10px] text-zinc-500">
                        <Check className="mt-0.5 h-2.5 w-2.5 text-zinc-700" />
                        {f}
                      </li>
                    ))}
                  </ul>
                )}

                {!tmpl.comingSoon && (
                  <div className="mt-2 flex items-center gap-3 pl-7 text-[10px] text-zinc-600">
                    <span>{tmpl.fileCount} files</span>
                    {tmpl.hasDocker && <span>🐳 Docker</span>}
                    {tmpl.hasTests && <span>✅ Tests</span>}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <button
          onClick={handleDeploy}
          disabled={isDeploying || !currentTier || currentTier.comingSoon}
          className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-violet-500 hover:shadow-lg hover:shadow-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Rocket className="h-4 w-4" />
          Deploy {tierDisplay?.name ?? ''}
        </button>
      </div>
    );
  }

  /* ── Stack Selector View — main gallery ── */
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full flex-col items-center justify-center p-4 pb-36">
        <div className="w-full max-w-md">
      <div className="mb-4 text-center">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 ring-1 ring-violet-500/20">
          <Rocket className="h-5 w-5 text-violet-400" />
        </div>
        <h3 className="text-sm font-semibold text-zinc-200">Start Building</h3>
        <p className="mt-1 text-[11px] text-zinc-500">
          Quick scaffold or pick a full stack to deploy
        </p>
      </div>

      {/* ── Quick Start — instant scaffolds ── */}
      {onTemplate && (
        <div className="mb-4">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-600">Quick Start</p>
          <div className="grid grid-cols-2 gap-2">
            {QUICK_STARTS.map((qs) => (
              <button
                key={qs.id}
                onClick={() => onTemplate(qs.id, 'Vai App')}
                disabled={isDeploying}
                className={`group/qs rounded-lg border bg-gradient-to-b p-3 text-left transition-all hover:shadow-md hover:shadow-black/20 ${qs.color} disabled:opacity-50`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-base font-bold ${qs.iconColor}`}>{qs.icon}</span>
                  <span className="text-xs font-semibold text-zinc-200">{qs.label}</span>
                </div>
                <p className="text-[10px] leading-tight text-zinc-500">{qs.description}</p>
                <div className="mt-1.5 flex items-center gap-1 text-[9px] text-zinc-600">
                  <Zap className="h-2.5 w-2.5" />
                  Instant scaffold
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-600">Full Stacks</p>

      {/* Stack cards */}
      <div className="grid grid-cols-2 gap-2">
        {stacks.map((stack) => {
          const colorClass = STACK_COLORS[stack.color] ?? STACK_COLORS.blue;
          const availableCount = stack.templates.filter((t) => !t.comingSoon).length;

          return (
            <button
              key={stack.id}
              onClick={() => handleStackClick(stack)}
              disabled={isDeploying}
              className={`group/card rounded-lg border bg-gradient-to-b p-3 text-left transition-all hover:shadow-lg hover:shadow-black/20 ${colorClass} disabled:opacity-50`}
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">{stack.icon}</span>
                <div className="flex-1">
                  <span className="text-xs font-semibold text-zinc-200">{stack.name}</span>
                  <ChevronRight className="ml-1 inline h-3 w-3 text-zinc-600 transition-transform group-hover/card:translate-x-0.5" />
                </div>
              </div>
              <p className="mt-1 text-[10px] leading-tight text-zinc-500">{stack.tagline}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {stack.techStack.map((tech) => (
                  <span key={tech} className="rounded bg-zinc-800/80 px-1 py-0.5 text-[9px] text-zinc-500">
                    {tech}
                  </span>
                ))}
              </div>
              <p className="mt-1.5 text-[9px] text-zinc-600">
                {availableCount} tier{availableCount !== 1 ? 's' : ''} available
              </p>
            </button>
          );
        })}
      </div>

      {/* Tier overview */}
      <div className="mt-4 border-t border-zinc-800 pt-3">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          Available Tiers
        </p>
        <div className="space-y-1.5">
          {Object.entries(TIER_DISPLAY).map(([tier, display]) => {
            const Icon = display.icon;
            return (
              <div key={tier} className="flex items-center gap-2 rounded-md border border-zinc-800/50 bg-zinc-900/30 px-2.5 py-1.5">
                <Icon className="h-3 w-3 text-zinc-500" />
                <span className="text-[11px] font-medium text-zinc-300">{display.name}</span>
                <span className={`ml-auto rounded px-1.5 py-0.5 text-[9px] font-medium ${display.badgeClass}`}>
                  {display.badge}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      </div>
      </div>
    </div>
  );
}
