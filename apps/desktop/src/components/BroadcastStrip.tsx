/**
 * BroadcastStrip — The broadcast control bar embedded inside the input
 * chrome when broadcast mode is active.
 *
 * Contains:
 *  - Status indicator (broadcasting to N IDEs)
 *  - Target picker (compact multi-select IDE dropdown)
 *  - Chat app picker (which chat interface in the IDE)
 *  - Session picker (which conversation session)
 *  - Model picker (compact searchable dropdown)
 *  - Disconnect button
 */

import { motion } from 'framer-motion';
import { BroadcastModelPicker } from './BroadcastModelPicker.js';
import { BroadcastTargetPicker, type PerIdeConfig } from './BroadcastTargetPicker.js';
import { BroadcastChatAppPicker, type ChatAppInfo } from './BroadcastChatAppPicker.js';
import { BroadcastSessionPicker, type ChatSessionInfo } from './BroadcastSessionPicker.js';
import type { CompanionClientSummary } from '../stores/collabStore.js';

interface ModelInfo {
  family: string;
  label: string;
}

interface BroadcastStripProps {
  /** Number of online IDEs */
  onlineCount: number;
  /** All known companion clients */
  clients: CompanionClientSummary[];
  /** Available models from connected IDEs */
  models: ModelInfo[];
  /** Currently selected model family */
  selectedModel: string;
  /** Called when model changes */
  onModelChange: (family: string) => void;
  /** Currently selected target client IDs */
  targetIds: string[];
  /** Called when target selection changes */
  onTargetChange: (ids: string[]) => void;
  /** Per-IDE chat mode and session configurations */
  perIdeConfigs: PerIdeConfig[];
  /** Called when per-IDE mode/session configuration changes */
  onPerIdeConfigChange: (configs: PerIdeConfig[]) => void;
  /** Available chat apps from connected IDEs */
  chatApps: ChatAppInfo[];
  /** Currently selected chat app ID */
  selectedChatApp: string;
  /** Called when chat app changes */
  onChatAppChange: (appId: string) => void;
  /** Available chat sessions from connected IDEs */
  chatSessions: ChatSessionInfo[];
  /** Currently selected session ID */
  selectedSession: string;
  /** Called when session changes */
  onSessionChange: (sessionId: string) => void;
  /** Called to disconnect / turn off broadcast */
  onDisconnect: () => void;
  /** Called when user clicks "+ Connect IDE" */
  onConnectIde?: () => void;
}

export function BroadcastStrip({
  onlineCount,
  clients,
  models,
  selectedModel,
  onModelChange,
  targetIds,
  onTargetChange,
  perIdeConfigs,
  onPerIdeConfigChange,
  chatApps,
  selectedChatApp,
  onChatAppChange,
  chatSessions,
  selectedSession,
  onSessionChange,
  onDisconnect,
  onConnectIde,
}: BroadcastStripProps) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
      className="overflow-hidden border-b border-blue-500/10 bg-blue-500/5"
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        {/* Pulsing status dot + label */}
        <div className="flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2 py-1">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-40" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-400" />
          </span>
          <span className="text-[10px] font-medium text-blue-300/70">
            {onlineCount} IDE{onlineCount === 1 ? '' : 's'}
          </span>
        </div>

        {/* Separator */}
        <div className="h-3.5 w-px bg-zinc-700/40" />

        {/* Target picker */}
        <BroadcastTargetPicker
          clients={clients}
          value={targetIds}
          onChange={onTargetChange}
          onConnectIde={onConnectIde}
          perIdeConfigs={perIdeConfigs}
          onPerIdeConfigChange={onPerIdeConfigChange}
        />

        {/* Separator */}
        <div className="h-3.5 w-px bg-zinc-700/40" />

        {/* Chat app picker */}
        <BroadcastChatAppPicker
          chatApps={chatApps}
          value={selectedChatApp}
          onChange={onChatAppChange}
        />
        <div className="h-3.5 w-px bg-zinc-700/40" />

        {/* Session picker */}
        <BroadcastSessionPicker
          sessions={chatSessions}
          chatAppFilter={selectedChatApp || undefined}
          value={selectedSession}
          onChange={onSessionChange}
        />
        <div className="h-3.5 w-px bg-zinc-700/40" />

        {/* Model picker */}
        <BroadcastModelPicker
          models={models}
          value={selectedModel}
          onChange={onModelChange}
        />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Disconnect */}
        <button
          onClick={onDisconnect}
          className="rounded-full px-2 py-0.5 text-[10px] text-zinc-600 transition-colors hover:bg-blue-500/10 hover:text-zinc-200"
        >
          ✕
        </button>
      </div>
    </motion.div>
  );
}
