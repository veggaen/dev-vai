import { useEffect, useRef } from 'react';
import { Command } from 'cmdk';
import { AnimatePresence, motion } from 'framer-motion';
import { MessageSquare, Brain, Search, Settings, Clock, Zap } from 'lucide-react';
import { useChatStore } from '../stores/chatStore.js';
import { useLayoutStore } from '../stores/layoutStore.js';
import { useSessionStore } from '../stores/sessionStore.js';
import { useAuthStore } from '../stores/authStore.js';

/* ── Helpers ───────────────────────────────────────────────────── */

function formatRelative(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ── Quick Switch ──────────────────────────────────────────────── */

export function QuickSwitch() {
  const { showQuickSwitch, setShowQuickSwitch, setActivePanel, setSidebarState } = useLayoutStore();
  const { conversations, selectConversation, startNewChat } = useChatStore();
  const sessions = useSessionStore((s) => s.sessions);
  const isOwner = useAuthStore((state) => state.isOwner);
  const ownerFeaturesHidden = useAuthStore((state) => state.ownerFeaturesHidden);
  const inputRef = useRef<HTMLInputElement>(null);
  const showOwnerFeatures = isOwner && !ownerFeaturesHidden;

  // Focus input when opened
  useEffect(() => {
    if (showQuickSwitch) {
      // cmdk handles focus internally, but let's be safe
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [showQuickSwitch]);

  const handleSelectChat = (id: string) => {
    selectConversation(id);
    setActivePanel('chats');
    setSidebarState('expanded');
    setShowQuickSwitch(false);
  };

  const handleSelectSession = (id: string) => {
    useSessionStore.getState().selectSession(id);
    setActivePanel('devlogs');
    setSidebarState('expanded');
    setShowQuickSwitch(false);
  };

  const handleSelectPanel = (panel: 'chats' | 'projects' | 'devlogs' | 'search' | 'settings') => {
    setActivePanel(panel);
    setSidebarState('expanded');
    setShowQuickSwitch(false);
  };

  return (
    <AnimatePresence>
      {showQuickSwitch && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowQuickSwitch(false)}
          />

          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -10 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="fixed left-1/2 top-[20%] z-50 w-full max-w-lg -translate-x-1/2"
          >
            <Command
              className="overflow-hidden rounded-xl border border-zinc-700/50 bg-zinc-900 shadow-2xl shadow-black/50"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setShowQuickSwitch(false);
              }}
            >
              <div className="flex items-center gap-2 border-b border-zinc-800 px-4">
                <Zap className="h-4 w-4 text-violet-400" />
                <Command.Input
                  ref={inputRef}
                  placeholder="Search conversations, logs, actions..."
                  className="flex-1 bg-transparent py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
                />
                <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                  ESC
                </kbd>
              </div>

              <Command.List className="max-h-72 overflow-y-auto p-2">
                <Command.Empty className="py-6 text-center text-sm text-zinc-600">
                  No results found.
                </Command.Empty>

                {/* Quick actions */}
                <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-600">
                  <QuickItem
                    onSelect={() => {
                      startNewChat();
                      setShowQuickSwitch(false);
                    }}
                    icon={<MessageSquare className="h-3.5 w-3.5" />}
                    label="New Chat"
                  />
                  <QuickItem
                    onSelect={() => handleSelectPanel('search')}
                    icon={<Search className="h-3.5 w-3.5" />}
                    label="Search Conversations"
                  />
                  <QuickItem
                    onSelect={() => handleSelectPanel('projects')}
                    icon={<Clock className="h-3.5 w-3.5" />}
                    label="Projects"
                  />
                  <QuickItem
                    onSelect={() => handleSelectPanel('settings')}
                    icon={<Settings className="h-3.5 w-3.5" />}
                    label="Settings"
                  />
                </Command.Group>

                {/* Conversations */}
                {conversations.length > 0 && (
                  <Command.Group heading="Conversations" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-600">
                    {conversations.slice(0, 8).map((conv) => (
                      <QuickItem
                        key={conv.id}
                        onSelect={() => handleSelectChat(conv.id)}
                        icon={<MessageSquare className="h-3.5 w-3.5" />}
                        label={conv.title}
                        meta={[
                          conv.mode && conv.mode !== 'chat' ? conv.mode : null,
                          conv.projectName,
                          formatRelative(conv.updatedAt),
                        ].filter(Boolean).join(' • ')}
                      />
                    ))}
                  </Command.Group>
                )}

                {/* Dev Log Sessions */}
                {showOwnerFeatures && sessions.length > 0 && (
                  <Command.Group heading="Dev Logs" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-zinc-600">
                    {sessions.slice(0, 5).map((session) => (
                      <QuickItem
                        key={session.id}
                        onSelect={() => handleSelectSession(session.id)}
                        icon={<Brain className="h-3.5 w-3.5" />}
                        label={session.title}
                        meta={formatRelative(new Date(session.startedAt).toISOString())}
                      />
                    ))}
                  </Command.Group>
                )}
              </Command.List>

              {/* Footer */}
              <div className="flex items-center gap-3 border-t border-zinc-800 px-4 py-2 text-[10px] text-zinc-600">
                <span className="flex items-center gap-1">
                  <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 text-zinc-500">↑↓</kbd>
                  navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 text-zinc-500">↵</kbd>
                  select
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 text-zinc-500">esc</kbd>
                  close
                </span>
              </div>
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ── Quick Item ────────────────────────────────────────────────── */

function QuickItem({
  onSelect,
  icon,
  label,
  meta,
}: {
  onSelect: () => void;
  icon: React.ReactNode;
  label: string;
  meta?: string;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-zinc-300 transition-colors data-[selected=true]:bg-zinc-800 data-[selected=true]:text-zinc-100"
    >
      <span className="flex-shrink-0 text-zinc-500">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta && (
        <span className="flex-shrink-0 text-[10px] text-zinc-600">{meta}</span>
      )}
    </Command.Item>
  );
}
