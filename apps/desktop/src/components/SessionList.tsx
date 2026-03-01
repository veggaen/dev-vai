import { useEffect, useRef } from 'react';
import {
  Brain,
  Upload,
  Clock,
  MessageSquare,
  FilePlus,
  FileEdit,
  Terminal,
  ListChecks,
  AlertTriangle,
} from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore.js';
import type { AgentSession } from '@vai/core';

/* ── Helpers ───────────────────────────────────────────────────── */

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ms).toLocaleDateString();
}

const STATUS_DOTS: Record<string, string> = {
  active: 'bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.6)]',
  completed: 'bg-emerald-500',
  failed: 'bg-red-500',
};

/* ── Session Card ──────────────────────────────────────────────── */

function SessionCard({
  session,
  isActive,
  onSelect,
}: {
  session: AgentSession;
  isActive: boolean;
  onSelect: () => void;
}) {
  const s = session.stats;

  return (
    <div
      onClick={onSelect}
      className={`cursor-pointer rounded-lg border p-3 transition-all ${
        isActive
          ? 'border-blue-500/40 bg-blue-500/10'
          : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900'
      }`}
    >
      {/* Title row */}
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STATUS_DOTS[session.status]}`} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-zinc-200">{session.title}</h3>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
            <span>{session.agentName}</span>
            <span className="text-zinc-700">·</span>
            <span className="flex items-center gap-0.5">
              <Clock className="h-3 w-3" />
              {formatRelative(session.startedAt)}
            </span>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {s.messageCount > 0 && (
          <MiniStat icon={MessageSquare} value={s.messageCount} color="text-blue-400" />
        )}
        {s.filesCreated > 0 && (
          <MiniStat icon={FilePlus} value={s.filesCreated} color="text-emerald-400" />
        )}
        {s.filesModified > 0 && (
          <MiniStat icon={FileEdit} value={s.filesModified} color="text-amber-400" />
        )}
        {s.terminalCommands > 0 && (
          <MiniStat icon={Terminal} value={s.terminalCommands} color="text-green-400" />
        )}
        {s.todosTotal > 0 && (
          <MiniStat icon={ListChecks} value={`${s.todosCompleted}/${s.todosTotal}`} color="text-indigo-400" />
        )}
        {s.errorsEncountered > 0 && (
          <MiniStat icon={AlertTriangle} value={s.errorsEncountered} color="text-red-400" />
        )}
        {/* Line changes */}
        {(s.linesAdded > 0 || s.linesRemoved > 0) && (
          <span className="text-xs">
            <span className="text-emerald-400/70">+{s.linesAdded}</span>
            {s.linesRemoved > 0 && <span className="text-red-400/70 ml-1">-{s.linesRemoved}</span>}
          </span>
        )}
      </div>

      {/* Tags */}
      {session.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {session.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-500">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniStat({ icon: Icon, value, color }: {
  icon: React.ComponentType<{ className?: string }>;
  value: number | string;
  color: string;
}) {
  return (
    <span className={`flex items-center gap-0.5 text-xs ${color}`}>
      <Icon className="h-3 w-3" />
      {value}
    </span>
  );
}

/* ── Main SessionList ──────────────────────────────────────────── */

export function SessionList() {
  const {
    sessions,
    activeSessionId,
    isLoading,
    statusFilter,
    fetchSessions,
    selectSession,
    setStatusFilter,
    importSession,
  } = useSessionStore();

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSessions();
  }, []);

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const id = await importSession(data);
      if (id) {
        selectSession(id);
      }
    } catch {
      console.error('Invalid session file');
    }
    e.target.value = '';
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-zinc-800 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-purple-400" />
            <h2 className="text-sm font-semibold text-zinc-200">Dev Logs</h2>
            <span className="rounded-full bg-zinc-800 px-1.5 text-xs text-zinc-500">
              {sessions.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleImport}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              title="Import session"
            >
              <Upload className="h-3.5 w-3.5" />
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>

        {/* Status filter tabs */}
        <div className="mt-2 flex gap-1">
          {(['all', 'active', 'completed', 'failed'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded px-2 py-0.5 text-xs capitalize transition-colors ${
                statusFilter === s
                  ? 'bg-zinc-700 text-zinc-200'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Session cards */}
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {isLoading && sessions.length === 0 ? (
          <div className="flex justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-purple-500" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="py-8 text-center">
            <Brain className="mx-auto mb-2 h-8 w-8 text-zinc-700" />
            <p className="text-xs text-zinc-600">No sessions yet</p>
            <p className="mt-1 text-xs text-zinc-700">
              Import a session or capture agent activity
            </p>
          </div>
        ) : (
          sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              onSelect={() => selectSession(session.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
