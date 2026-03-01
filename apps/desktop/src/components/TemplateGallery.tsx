/**
 * TemplateGallery — Stack selector + tier picker for 1-click deployment.
 *
 * Flow: Stack cards → Tier selector → Deploy (handled by parent via onDeploy)
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  Box,
  ChevronRight,
  Lock,
  Rocket,
  Sparkles,
  Shield,
  Zap,
  Package,
} from 'lucide-react';
import { API_BASE } from '../lib/api.js';

/* ── Types matching the backend response ── */

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
  onDeploy: (stackId: string, tier: string) => void;
  isDeploying: boolean;
}

/* ── Tier metadata ── */

const TIER_ICONS: Record<string, typeof Box> = {
  basic: Zap,
  solid: Shield,
  'battle-tested': Rocket,
  vai: Sparkles,
};

const TIER_COLORS: Record<string, string> = {
  basic: 'border-zinc-700 hover:border-zinc-600',
  solid: 'border-blue-800/60 hover:border-blue-600/60',
  'battle-tested': 'border-amber-800/60 hover:border-amber-600/60',
  vai: 'border-purple-800/60 hover:border-purple-600/60',
};

const TIER_BADGES: Record<string, { text: string; className: string }> = {
  basic: { text: 'Starter', className: 'bg-zinc-800 text-zinc-400' },
  solid: { text: 'Recommended', className: 'bg-blue-500/10 text-blue-400' },
  'battle-tested': { text: 'Production', className: 'bg-amber-500/10 text-amber-400' },
  vai: { text: 'Premium', className: 'bg-purple-500/10 text-purple-400' },
};

const STACK_COLORS: Record<string, string> = {
  blue: 'from-blue-500/20 to-blue-500/5 border-blue-800/40 hover:border-blue-600/40',
  green: 'from-emerald-500/20 to-emerald-500/5 border-emerald-800/40 hover:border-emerald-600/40',
  zinc: 'from-zinc-500/20 to-zinc-500/5 border-zinc-700/40 hover:border-zinc-500/40',
  purple: 'from-purple-500/20 to-purple-500/5 border-purple-800/40 hover:border-purple-600/40',
};

/* ── Component ── */

export function TemplateGallery({ onDeploy, isDeploying }: Props) {
  const [stacks, setStacks] = useState<StackInfo[]>([]);
  const [selectedStack, setSelectedStack] = useState<StackInfo | null>(null);
  const [selectedTier, setSelectedTier] = useState<string>('basic');
  const [loading, setLoading] = useState(true);

  // Fetch stacks from API
  useEffect(() => {
    fetch(`${API_BASE}/api/sandbox/stacks`)
      .then((r) => r.json())
      .then((data: StackInfo[]) => {
        setStacks(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleStackClick = useCallback((stack: StackInfo) => {
    setSelectedStack(stack);
    setSelectedTier('basic');
  }, []);

  const handleBack = useCallback(() => {
    setSelectedStack(null);
    setSelectedTier('basic');
  }, []);

  const handleDeploy = useCallback(() => {
    if (!selectedStack) return;
    onDeploy(selectedStack.id, selectedTier);
  }, [selectedStack, selectedTier, onDeploy]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-blue-500" />
      </div>
    );
  }

  /* ── Tier Selector View ── */
  if (selectedStack) {
    const currentTier = selectedStack.templates.find((t) => t.tier === selectedTier);

    return (
      <div className="flex h-full flex-col overflow-y-auto p-5">
        {/* Header with back button */}
        <button
          onClick={handleBack}
          className="mb-4 flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to stacks
        </button>

        <div className="mb-5">
          <div className="flex items-center gap-2">
            <span className="text-lg">{selectedStack.icon}</span>
            <h3 className="text-sm font-semibold text-zinc-200">
              {selectedStack.name} Stack
            </h3>
          </div>
          <p className="mt-1 text-xs text-zinc-500">{selectedStack.description}</p>
        </div>

        {/* Tier options */}
        <div className="flex-1 space-y-2">
          {selectedStack.templates.map((tmpl) => {
            const Icon = TIER_ICONS[tmpl.tier] ?? Box;
            const badge = TIER_BADGES[tmpl.tier];
            const isSelected = selectedTier === tmpl.tier;
            const tierColor = TIER_COLORS[tmpl.tier] ?? '';

            return (
              <button
                key={tmpl.id}
                onClick={() => !tmpl.comingSoon && setSelectedTier(tmpl.tier)}
                disabled={tmpl.comingSoon || isDeploying}
                className={`group w-full rounded-lg border p-3 text-left transition-all ${
                  tmpl.comingSoon
                    ? 'cursor-not-allowed border-zinc-800/50 opacity-50'
                    : isSelected
                      ? `ring-1 ring-blue-500/40 ${tierColor} bg-zinc-900/80`
                      : `${tierColor} bg-zinc-900/30 hover:bg-zinc-900/60`
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`rounded p-1 ${isSelected ? 'bg-blue-500/20' : 'bg-zinc-800'}`}>
                    {tmpl.comingSoon ? (
                      <Lock className="h-3.5 w-3.5 text-zinc-600" />
                    ) : (
                      <Icon className={`h-3.5 w-3.5 ${isSelected ? 'text-blue-400' : 'text-zinc-400'}`} />
                    )}
                  </div>
                  <span className="flex-1 text-xs font-medium text-zinc-200">{tmpl.name}</span>
                  {badge && (
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${badge.className}`}>
                      {tmpl.comingSoon ? 'Coming Soon' : badge.text}
                    </span>
                  )}
                  {isSelected && !tmpl.comingSoon && (
                    <div className="h-2 w-2 rounded-full bg-blue-500" />
                  )}
                </div>

                {!tmpl.comingSoon && tmpl.features.length > 0 && (
                  <ul className="mt-2 space-y-0.5 pl-7">
                    {tmpl.features.slice(0, 5).map((f, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[10px] text-zinc-500">
                        <span className="mt-0.5 text-zinc-700">•</span>
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

        {/* Deploy button */}
        <button
          onClick={handleDeploy}
          disabled={isDeploying || !currentTier || currentTier.comingSoon}
          className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Rocket className="h-4 w-4" />
          Deploy {currentTier?.name ?? ''}
        </button>
      </div>
    );
  }

  /* ── Stack Selector View ── */
  return (
    <div className="flex h-full flex-col overflow-y-auto p-5">
      <div className="mb-5 text-center">
        <Box className="mx-auto mb-2 h-8 w-8 text-zinc-600" />
        <h3 className="text-sm font-semibold text-zinc-200">Deploy a Production Stack</h3>
        <p className="mt-1 text-[11px] text-zinc-500">
          1-click full-stack templates — get started in seconds
        </p>
      </div>

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
              className={`group rounded-lg border bg-gradient-to-b p-3 text-left transition-all ${colorClass} disabled:opacity-50`}
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">{stack.icon}</span>
                <div className="flex-1">
                  <span className="text-xs font-semibold text-zinc-200">{stack.name}</span>
                  <ChevronRight className="ml-1 inline h-3 w-3 text-zinc-600 transition-transform group-hover:translate-x-0.5" />
                </div>
              </div>
              <p className="mt-1 text-[10px] leading-tight text-zinc-500">{stack.tagline}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {stack.techStack.map((tech) => (
                  <span
                    key={tech}
                    className="rounded bg-zinc-800/80 px-1 py-0.5 text-[9px] text-zinc-500"
                  >
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

      {/* Quick start section with legacy templates */}
      <div className="mt-5 border-t border-zinc-800 pt-4">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          Quick Start — Framework Templates
        </p>
        <QuickStartTemplates isDeploying={isDeploying} />
      </div>
    </div>
  );
}

/* ── Quick Start (legacy framework templates) ── */

interface LegacyTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
}

function QuickStartTemplates({ isDeploying: _isDeploying }: { isDeploying: boolean }) {
  const [templates, setTemplates] = useState<LegacyTemplate[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/sandbox/templates`)
      .then((r) => r.json())
      .then(setTemplates)
      .catch(() => {});
  }, []);

  if (templates.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {templates.slice(0, 6).map((t) => (
        <span
          key={t.id}
          className="cursor-default rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1 text-[10px] text-zinc-500"
          title={t.description}
        >
          <Package className="mr-1 inline h-2.5 w-2.5" />
          {t.name}
        </span>
      ))}
    </div>
  );
}
