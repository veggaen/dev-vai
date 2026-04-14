import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import {
  Brain,
  Upload,
  Clock,
  MessageSquare,
  FilePlus,
  FileEdit,
  ShieldCheck,
  RotateCcw,
  Terminal,
  ListChecks,
  AlertTriangle,
  StopCircle,
  Archive,
  Trash2,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore.js';
import type { AgentSession } from '@vai/core/browser';

/* ── Helpers ───────────────────────────────────────────────────── */

const STALE_THRESHOLD_MS = 2 * 60 * 60_000; // 2 hours

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ms).toLocaleDateString();
}

function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function isStale(session: AgentSession): boolean {
  if (session.status !== 'active') return false;
  const lastActive = session.lastActivityAt ?? session.startedAt;
  return Date.now() - lastActive > STALE_THRESHOLD_MS;
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
  onEnd,
}: {
  session: AgentSession;
  isActive: boolean;
  onSelect: () => void;
  onEnd: (e: React.MouseEvent) => void;
}) {
  const s = session.stats;
  const stale = isStale(session);

  return (
    <div
      onClick={onSelect}
      className={`group cursor-pointer rounded-lg border p-3 transition-all ${
        isActive
          ? 'border-blue-500/40 bg-blue-500/10'
          : stale
            ? 'border-zinc-800/60 bg-zinc-900/30 opacity-60 hover:opacity-80 hover:border-zinc-700'
            : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900'
      }`}
    >
      {/* Title row */}
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
          stale ? 'bg-amber-500/60' : STATUS_DOTS[session.status]
        }`} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-zinc-200">{session.title}</h3>
          {/* Agent description (when VS Code title overrode agent title) */}
          {session.description && (
            <p className="truncate text-[10px] text-zinc-600 italic mt-0.5">
              {session.description}
            </p>
          )}
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
            <span>{session.agentName}</span>
            <span className="text-zinc-700">·</span>
            <span className="flex items-center gap-0.5" title={`Started: ${new Date(session.startedAt).toLocaleString()}`}>
              <Clock className="h-3 w-3" />
              {session.lastActivityAt
                ? formatRelative(session.lastActivityAt)
                : formatRelative(session.startedAt)}
            </span>
            {session.status === 'active' && (
              <>
                <span className="text-zinc-700">·</span>
                <span className={stale ? 'text-amber-500/70' : 'text-zinc-600'}>
                  {formatDuration(Date.now() - session.startedAt)}
                </span>
              </>
            )}
            {stale && (
              <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[9px] text-amber-500 font-medium">
                stale
              </span>
            )}
          </div>
        </div>
        {/* End session button — visible on hover for active sessions */}
        {session.status === 'active' && (
          <button
            onClick={onEnd}
            className="mt-0.5 rounded p-1 text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-zinc-800 hover:text-amber-400"
            title={stale ? 'End stale session' : 'End session'}
          >
            <StopCircle className="h-3.5 w-3.5" />
          </button>
        )}
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
        {(s.verificationsRun ?? 0) > 0 && (
          <MiniStat icon={ShieldCheck} value={`${s.verificationsPassed ?? 0}/${s.verificationsRun ?? 0}`} color="text-emerald-300" />
        )}
        {(s.recoveriesTriggered ?? 0) > 0 && (
          <MiniStat icon={RotateCcw} value={`${s.recoveriesSucceeded ?? 0}/${s.recoveriesTriggered ?? 0}`} color="text-amber-400" />
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

      {/* Source badge */}
      {session.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {session.tags.includes('vscode-agent') && (
            <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-400 font-medium">
              copilot
            </span>
          )}
          {session.tags.includes('auto-capture') && (
            <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-400 font-medium">
              auto
            </span>
          )}
          {session.tags
            .filter(t => t !== 'vscode-agent' && t !== 'auto-capture' && t !== 'vscode-extension')
            .slice(0, 2)
            .map((tag) => (
              <span key={tag} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
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

/* ── Sessions Summary ───────────────────────────────────────── */

function SessionsSummary({ sessions }: { sessions: AgentSession[] }) {
  const stats = useMemo(() => {
    const now = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();

    const todaySessions = sessions.filter(s => s.startedAt >= todayMs);
    const activeSessions = sessions.filter(s => s.status === 'active');

    // Aggregate stats from today's sessions
    let totalMessages = 0;
    let totalEdits = 0;
    let totalCommands = 0;
    let totalErrors = 0;
    let totalLines = 0;

    for (const s of todaySessions) {
      totalMessages += s.stats.messageCount;
      totalEdits += s.stats.filesModified + s.stats.filesCreated;
      totalCommands += s.stats.terminalCommands;
      totalErrors += s.stats.errorsEncountered;
      totalLines += s.stats.linesAdded;
    }

    return {
      todayCount: todaySessions.length,
      activeCount: activeSessions.length,
      totalMessages,
      totalEdits,
      totalCommands,
      totalErrors,
      totalLines,
    };
  }, [sessions]);

  if (stats.todayCount === 0) return null;

  return (
    <div className="rounded-lg border border-zinc-800/50 bg-zinc-900/30 p-2.5 text-xs">
      <div className="flex items-center gap-1.5 text-zinc-400 mb-1.5">
        <Clock className="h-3 w-3" />
        <span className="font-medium">Today</span>
        <span className="text-zinc-600">·</span>
        <span className="text-zinc-500">{stats.todayCount} session{stats.todayCount !== 1 ? 's' : ''}</span>
        {stats.activeCount > 0 && (
          <>
            <span className="text-zinc-600">·</span>
            <span className="text-blue-400">{stats.activeCount} active</span>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {stats.totalMessages > 0 && (
          <span className="flex items-center gap-0.5 text-blue-400/70">
            <MessageSquare className="h-2.5 w-2.5" /> {stats.totalMessages}
          </span>
        )}
        {stats.totalEdits > 0 && (
          <span className="flex items-center gap-0.5 text-amber-400/70">
            <FileEdit className="h-2.5 w-2.5" /> {stats.totalEdits}
          </span>
        )}
        {stats.totalCommands > 0 && (
          <span className="flex items-center gap-0.5 text-green-400/70">
            <Terminal className="h-2.5 w-2.5" /> {stats.totalCommands}
          </span>
        )}
        {stats.totalLines > 0 && (
          <span className="text-emerald-400/70">+{stats.totalLines.toLocaleString()} lines</span>
        )}
        {stats.totalErrors > 0 && (
          <span className="flex items-center gap-0.5 text-red-400/70">
            <AlertTriangle className="h-2.5 w-2.5" /> {stats.totalErrors}
          </span>
        )}
      </div>
    </div>
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
    endSession,
  } = useSessionStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [endingAll, setEndingAll] = useState(false);
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(() => {
      fetchSessions();
    }, 30_000);
    return () => clearInterval(interval);
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

  const handleEndSession = useCallback((e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    void endSession(sessionId);
  }, [endSession]);

  // Count stale active sessions
  const staleSessions = useMemo(
    () => sessions.filter(s => isStale(s)),
    [sessions],
  );

  const handleEndAllStale = useCallback(async () => {
    if (staleSessions.length === 0) return;
    if (!confirm(`End ${staleSessions.length} stale session(s)? (inactive for 2+ hours)`)) return;
    setEndingAll(true);
    for (const s of staleSessions) {
      await endSession(s.id);
    }
    setEndingAll(false);
  }, [staleSessions, endSession]);

  // Status counts for filter tabs
  const statusCounts = useMemo(() => {
    const counts = { all: sessions.length, active: 0, completed: 0, failed: 0 };
    for (const s of sessions) {
      if (s.status === 'active') counts.active++;
      else if (s.status === 'completed') counts.completed++;
      else if (s.status === 'failed') counts.failed++;
    }
    return counts;
  }, [sessions]);

  const sortedSessions = useMemo(
    () => {
      let filtered = [...sessions];
      // Text search across title, description, agent name, model
      if (searchText.trim()) {
        const q = searchText.toLowerCase();
        filtered = filtered.filter(s =>
          s.title.toLowerCase().includes(q) ||
          (s.description ?? '').toLowerCase().includes(q) ||
          s.agentName.toLowerCase().includes(q) ||
          (s.modelId ?? '').toLowerCase().includes(q),
        );
      }
      return filtered.sort((a, b) => {
        const aTime = a.lastActivityAt ?? a.startedAt;
        const bTime = b.lastActivityAt ?? b.startedAt;
        return bTime - aTime;
      });
    },
    [sessions, searchText],
  );

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
              onClick={() => fetchSessions()}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              title="Refresh sessions"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
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
              {s} {statusCounts[s] > 0 && `(${statusCounts[s]})`}
            </button>
          ))}
        </div>

        {/* Session search */}
        <div className="mt-2 relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-600" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search sessions..."
            className="w-full rounded bg-zinc-900 border border-zinc-800 pl-7 pr-2 py-1 text-xs text-zinc-300 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
          />
          {searchText && (
            <button
              onClick={() => setSearchText('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400"
            >
              ×
            </button>
          )}
        </div>

        {/* Stale cleanup banner */}
        {staleSessions.length > 0 && (
          <button
            onClick={handleEndAllStale}
            disabled={endingAll}
            className="mt-2 flex w-full items-center gap-2 rounded-md bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5 text-xs text-amber-400 hover:bg-amber-500/15 transition-colors disabled:opacity-50"
          >
            <Archive className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 text-left">
              {endingAll ? 'Ending...' : `End ${staleSessions.length} stale session${staleSessions.length > 1 ? 's' : ''}`}
            </span>
            <span className="text-amber-500/60 text-[10px]">2h+ inactive</span>
          </button>
        )}
      </div>

      {/* Session cards */}
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {/* Quick stats summary */}
        {sessions.length > 0 && !isLoading && (
          <SessionsSummary sessions={sessions} />
        )}

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
          sortedSessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              onSelect={() => selectSession(session.id)}
              onEnd={(e) => handleEndSession(e, session.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
