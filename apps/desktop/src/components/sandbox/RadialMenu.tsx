/**
 * RadialMenu — Expandable radial tool menu for Vai agent actions.
 *
 * A circular context menu that appears when Vai needs to pick a tool or
 * when triggered via the agent API. Primary ring with 6 categories,
 * each expandable to reveal sub-tools in a secondary ring.
 *
 * Primary categories:
 *   1. Navigate — DOM traversal, scrolling, element targeting
 *   2. Validate — Assertions, visual checks, accessibility audit
 *   3. Edit     — Click, type, focus, form interaction
 *   4. Screenshot — Capture, compare, vision analysis
 *   5. SubVai   — Spawn worker agents for parallel tasks
 *   6. Tools    — Deploy, debug, inspect, monitor, settings
 *
 * Sub-tools (expanded ring):
 *   Tools → Deploy, Debug Console, File Explorer, Performance, Settings
 *   Validate → A11y Audit, Visual Diff, Schema Check, Lighthouse
 *   SubVai → Test Runner, Code Review, Dependency Scan, Security Audit
 *
 * Features:
 *   • Smooth radial pop animation per item
 *   • Expandable sub-rings on category hover/click
 *   • Active item highlight with glow
 *   • Center hub shows current selection + keyboard hint
 *   • Background blur + dimming
 *   • Keyboard shortcuts (1-6 for categories, Escape to close)
 */

import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Navigation, ShieldCheck, Pencil, Camera, Users, Wrench,
  Rocket, Terminal, FolderTree, Activity, Settings,
  Eye, FileSearch, Gauge, Shield, Bug, Search, Lock,
  Play, Keyboard, Zap, Layers,
} from 'lucide-react';

/* ── Radial items ── */
interface RadialItem {
  id: string;
  label: string;
  icon: typeof Navigation;
  color: string;
  /** Tailwind bg for active glow */
  glow: string;
  /** Sub-tools shown in an expanded ring */
  subTools?: SubTool[];
}

interface SubTool {
  id: string;
  label: string;
  icon: typeof Navigation;
  shortcut?: string;
}

const RADIAL_ITEMS: RadialItem[] = [
  {
    id: 'navigate', label: 'Navigate', icon: Navigation, color: 'text-blue-400', glow: 'bg-blue-500/20',
    subTools: [
      { id: 'nav-scroll', label: 'Scroll', icon: Layers },
      { id: 'nav-focus', label: 'Focus Element', icon: Eye },
      { id: 'nav-search', label: 'Find Element', icon: Search },
      { id: 'nav-tab', label: 'Tab Through', icon: Keyboard },
    ],
  },
  {
    id: 'validate', label: 'Validate', icon: ShieldCheck, color: 'text-emerald-400', glow: 'bg-emerald-500/20',
    subTools: [
      { id: 'val-a11y', label: 'A11y Audit', icon: Eye },
      { id: 'val-visual', label: 'Visual Diff', icon: FileSearch },
      { id: 'val-schema', label: 'Schema Check', icon: Shield },
      { id: 'val-perf', label: 'Lighthouse', icon: Gauge },
    ],
  },
  {
    id: 'edit', label: 'Edit', icon: Pencil, color: 'text-amber-400', glow: 'bg-amber-500/20',
    subTools: [
      { id: 'edit-click', label: 'Click', icon: Zap },
      { id: 'edit-type', label: 'Type Text', icon: Keyboard },
      { id: 'edit-form', label: 'Fill Form', icon: Pencil },
    ],
  },
  {
    id: 'screenshot', label: 'Screenshot', icon: Camera, color: 'text-pink-400', glow: 'bg-pink-500/20',
    subTools: [
      { id: 'ss-capture', label: 'Capture', icon: Camera },
      { id: 'ss-compare', label: 'Compare', icon: FileSearch },
      { id: 'ss-record', label: 'Record', icon: Play },
    ],
  },
  {
    id: 'subvai', label: 'SubVai', icon: Users, color: 'text-violet-400', glow: 'bg-violet-500/20',
    subTools: [
      { id: 'sv-test', label: 'Test Runner', icon: Play },
      { id: 'sv-review', label: 'Code Review', icon: FileSearch },
      { id: 'sv-deps', label: 'Dep Scan', icon: Search },
      { id: 'sv-security', label: 'Security', icon: Lock },
    ],
  },
  {
    id: 'tools', label: 'Tools', icon: Wrench, color: 'text-zinc-300', glow: 'bg-zinc-500/20',
    subTools: [
      { id: 'tool-deploy', label: 'Deploy', icon: Rocket, shortcut: 'D' },
      { id: 'tool-console', label: 'Console', icon: Terminal, shortcut: 'J' },
      { id: 'tool-files', label: 'Files', icon: FolderTree, shortcut: 'E' },
      { id: 'tool-perf', label: 'Performance', icon: Activity },
      { id: 'tool-debug', label: 'Debug', icon: Bug },
      { id: 'tool-settings', label: 'Settings', icon: Settings },
    ],
  },
];

interface RadialMenuProps {
  /** Whether the menu is open */
  visible: boolean;
  /** Center position */
  x: number;
  y: number;
  /** Currently selected item ID or null */
  activeId: string | null;
  /** Called when selecting an item from the API */
  onSelect?: (id: string) => void;
  /** Called to close */
  onClose?: () => void;
}

export function RadialMenu({ visible, x, y, activeId, onSelect, onClose }: RadialMenuProps) {
  const primaryRadius = 80;
  const subRadius = 48;
  const itemCount = RADIAL_ITEMS.length;
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Reset expanded when menu closes
  useEffect(() => {
    if (!visible) setExpandedId(null);
  }, [visible]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!visible) return;
    if (e.key === 'Escape') {
      if (expandedId) setExpandedId(null);
      else onClose?.();
      return;
    }
    // Number keys 1-6 select primary categories
    const num = parseInt(e.key);
    if (num >= 1 && num <= itemCount) {
      const item = RADIAL_ITEMS[num - 1];
      if (item) {
        if (item.subTools?.length) {
          setExpandedId((prev) => (prev === item.id ? null : item.id));
        } else {
          onSelect?.(item.id);
        }
      }
    }
  }, [visible, expandedId, itemCount, onSelect, onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const expandedItem = expandedId ? RADIAL_ITEMS.find((i) => i.id === expandedId) : null;

  return (
    <AnimatePresence>
      {visible && (
        <>
          {/* Background dim */}
          <motion.div
            className="absolute inset-0 z-30 bg-black/30 backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />

          {/* Radial ring */}
          <motion.div
            className="pointer-events-none absolute z-40"
            style={{ left: x, top: y }}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          >
            {/* Center hub */}
            <motion.div
              className="absolute flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 shadow-xl shadow-black/50"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.05, duration: 0.2 }}
            >
              <span className="text-[9px] font-bold text-violet-400">
                {activeId ? RADIAL_ITEMS.find((i) => i.id === activeId)?.label || 'Vai' : 'Vai'}
              </span>
              {expandedItem && (
                <span className="text-[7px] text-zinc-500">{expandedItem.label}</span>
              )}
            </motion.div>

            {/* Primary ring items */}
            {RADIAL_ITEMS.map((item, idx) => {
              const angle = (idx / itemCount) * Math.PI * 2 - Math.PI / 2;
              const ix = Math.cos(angle) * primaryRadius;
              const iy = Math.sin(angle) * primaryRadius;
              const isActive = activeId === item.id;
              const isExpanded = expandedId === item.id;
              const Icon = item.icon;
              const hasSubTools = (item.subTools?.length ?? 0) > 0;

              return (
                <div key={item.id}>
                  {/* Primary button */}
                  <motion.button
                    className={`pointer-events-auto absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border transition-all ${
                      isActive || isExpanded
                        ? `border-zinc-600 ${item.glow} shadow-lg ring-1 ring-white/10`
                        : 'border-zinc-800 bg-zinc-900/90 hover:bg-zinc-800 hover:border-zinc-600'
                    }`}
                    style={{ left: ix, top: iy }}
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0 }}
                    transition={{
                      delay: idx * 0.04,
                      duration: 0.25,
                      type: 'spring',
                      stiffness: 400,
                      damping: 20,
                    }}
                    onClick={() => {
                      if (hasSubTools) {
                        setExpandedId((prev) => (prev === item.id ? null : item.id));
                      } else {
                        onSelect?.(item.id);
                      }
                    }}
                    title={`${item.label} [${idx + 1}]`}
                  >
                    <Icon className={`h-4 w-4 ${item.color}`} />
                    {/* Keyboard hint */}
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-zinc-800 text-[7px] font-bold text-zinc-500 ring-1 ring-zinc-700">
                      {idx + 1}
                    </span>
                    {/* Expand indicator */}
                    {hasSubTools && (
                      <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-violet-500" />
                    )}
                  </motion.button>

                  {/* Sub-tool ring — appears when category is expanded */}
                  <AnimatePresence>
                    {isExpanded && item.subTools && (
                      <>
                        {item.subTools.map((sub, si) => {
                          const subCount = item.subTools!.length;
                          const spread = Math.PI * 0.6; // arc span
                          const baseAngle = angle;
                          const subAngle = baseAngle - spread / 2 + (si / Math.max(1, subCount - 1)) * spread;
                          const sx = Math.cos(subAngle) * (primaryRadius + subRadius);
                          const sy = Math.sin(subAngle) * (primaryRadius + subRadius);
                          const SubIcon = sub.icon;

                          return (
                            <motion.button
                              key={sub.id}
                              className="pointer-events-auto absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/95 shadow-lg transition-all hover:bg-zinc-800 hover:border-zinc-500 hover:shadow-xl"
                              style={{ left: sx, top: sy }}
                              initial={{ opacity: 0, scale: 0 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0 }}
                              transition={{
                                delay: si * 0.03,
                                duration: 0.2,
                                type: 'spring',
                                stiffness: 500,
                                damping: 25,
                              }}
                              onClick={() => onSelect?.(sub.id)}
                              title={sub.label + (sub.shortcut ? ` (${sub.shortcut})` : '')}
                            >
                              <SubIcon className={`h-3.5 w-3.5 ${item.color}`} />
                            </motion.button>
                          );
                        })}

                        {/* Connecting line from category to sub-ring */}
                        <motion.div
                          className="pointer-events-none absolute h-px origin-left"
                          style={{
                            left: ix,
                            top: iy,
                            width: subRadius - 8,
                            transform: `rotate(${angle}rad)`,
                            background: `linear-gradient(90deg, transparent, rgba(139,92,246,0.3))`,
                          }}
                          initial={{ opacity: 0, scaleX: 0 }}
                          animate={{ opacity: 1, scaleX: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15 }}
                        />
                      </>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </motion.div>

          {/* Floating labels for expanded sub-tools */}
          <AnimatePresence>
            {expandedItem?.subTools && (
              <motion.div
                className="pointer-events-none absolute z-50"
                style={{ left: x, top: y + primaryRadius + subRadius + 30 }}
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <div className="flex -translate-x-1/2 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/95 px-3 py-1.5 shadow-xl backdrop-blur-sm">
                  {expandedItem.subTools.map((sub) => (
                    <span key={sub.id} className="text-[9px] text-zinc-500">
                      {sub.label}
                      {sub.shortcut && <kbd className="ml-0.5 rounded bg-zinc-800 px-1 text-[8px] text-zinc-600">{sub.shortcut}</kbd>}
                    </span>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </AnimatePresence>
  );
}
