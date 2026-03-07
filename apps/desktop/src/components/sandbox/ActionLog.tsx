/**
 * ActionLog — Phase 0 floating action feed for Vai sandbox.
 *
 * Shows a compact, scrolling feed of everything Vai is doing in the
 * sandbox preview: cursor movements, clicks, typing, screenshots,
 * validations, and tool invocations. Anchored bottom-left of the
 * preview panel.
 *
 * Features:
 *   • Auto-scroll with latest at bottom
 *   • Color-coded action types
 *   • Timestamp for each entry
 *   • Collapsible — can be minimized to a small badge
 *   • Screenshot counter badge
 */

import { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  MousePointer2, Keyboard, Camera, ShieldCheck, Navigation,
  ChevronDown, ChevronUp, Activity,
} from 'lucide-react';

/* ── Action types ── */
export type ActionType =
  | 'move'
  | 'click'
  | 'hover'
  | 'type'
  | 'screenshot'
  | 'validate'
  | 'navigate'
  | 'focus'
  | 'scroll'
  | 'tool'
  | 'info';

export interface ActionEntry {
  id: string;
  type: ActionType;
  message: string;
  timestamp: number;
  /** Optional detail for expandable entries */
  detail?: string;
}

const ACTION_ICONS: Record<ActionType, typeof MousePointer2> = {
  move: MousePointer2,
  click: MousePointer2,
  hover: MousePointer2,
  type: Keyboard,
  screenshot: Camera,
  validate: ShieldCheck,
  navigate: Navigation,
  focus: MousePointer2,
  scroll: MousePointer2,
  tool: Activity,
  info: Activity,
};

const ACTION_COLORS: Record<ActionType, string> = {
  move: 'text-zinc-600',
  click: 'text-violet-400',
  hover: 'text-blue-400',
  type: 'text-blue-400',
  screenshot: 'text-pink-400',
  validate: 'text-emerald-400',
  navigate: 'text-amber-400',
  focus: 'text-cyan-400',
  scroll: 'text-zinc-500',
  tool: 'text-violet-400',
  info: 'text-zinc-400',
};

interface ActionLogProps {
  actions: ActionEntry[];
  screenshotCount: number;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function ActionLog({ actions, screenshotCount }: ActionLogProps) {
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new actions
  useEffect(() => {
    if (!collapsed && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [actions.length, collapsed]);

  // Only show last 50 actions
  const visible = actions.slice(-50);

  return (
    <motion.div
      className="pointer-events-auto absolute bottom-3 left-3 z-20 flex flex-col"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
    >
      {/* Header — always visible */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-2 rounded-t-lg border border-zinc-800 bg-zinc-900/90 px-2.5 py-1.5 backdrop-blur-md transition-colors hover:bg-zinc-800/80"
      >
        <Activity className="h-3 w-3 text-violet-400" />
        <span className="text-[10px] font-medium text-zinc-300">Vai Actions</span>

        {/* Screenshot badge */}
        {screenshotCount > 0 && (
          <span className="flex items-center gap-0.5 rounded-full bg-pink-500/15 px-1.5 py-0.5 text-[9px] text-pink-400">
            <Camera className="h-2.5 w-2.5" />
            {screenshotCount}
          </span>
        )}

        {actions.length > 0 && (
          <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">
            {actions.length}
          </span>
        )}

        {collapsed ? (
          <ChevronUp className="h-3 w-3 text-zinc-600" />
        ) : (
          <ChevronDown className="h-3 w-3 text-zinc-600" />
        )}
      </button>

      {/* Log body */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            ref={scrollRef}
            className="w-72 overflow-y-auto overflow-x-hidden rounded-b-lg border border-t-0 border-zinc-800 bg-zinc-950/95 backdrop-blur-md scrollbar-none"
            style={{ maxHeight: 200 }}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {visible.length === 0 ? (
              <div className="px-3 py-4 text-center text-[10px] text-zinc-700">
                No actions yet — Vai will log activity here
              </div>
            ) : (
              <div className="flex flex-col py-1">
                {visible.map((action) => {
                  const Icon = ACTION_ICONS[action.type] || Activity;
                  const color = ACTION_COLORS[action.type] || 'text-zinc-500';

                  return (
                    <div
                      key={action.id}
                      className="flex items-start gap-2 px-2.5 py-1 hover:bg-zinc-800/30"
                    >
                      <Icon className={`mt-0.5 h-3 w-3 shrink-0 ${color}`} />
                      <div className="min-w-0 flex-1">
                        <span className="text-[10px] leading-tight text-zinc-300">
                          {action.message}
                        </span>
                        {action.detail && (
                          <span className="block truncate text-[9px] text-zinc-600">
                            {action.detail}
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 text-[8px] tabular-nums text-zinc-700">
                        {formatTime(action.timestamp)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
