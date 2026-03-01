import { useState, useMemo } from 'react';
import {
  MessageSquare,
  Brain,
  FilePlus,
  FileEdit,
  FileSearch2,
  FileX,
  Terminal,
  Search,
  ListChecks,
  Activity,
  AlertTriangle,
  Wrench,
  FileText,
  StickyNote,
  ChevronDown,
  ChevronRight,
  Clock,
  ArrowLeft,
  Download,
  Trash2,
  Filter,
  type LucideIcon,
} from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore.js';
import type {
  SessionEvent,
  SessionEventType,
  MessageMeta,
  ThinkingMeta,
  FileCreateMeta,
  FileEditMeta,
  FileReadMeta,
  TerminalMeta,
  SearchMeta,
  TodoUpdateMeta,
  StateChangeMeta,
  ErrorMeta,
  ToolCallMeta,
  TodoItem,
} from '@vai/core';

/* ── Icon mapping ─────────────────────────────────────────────── */

const ICON_MAP: Record<SessionEventType, LucideIcon> = {
  message: MessageSquare,
  thinking: Brain,
  'file-create': FilePlus,
  'file-edit': FileEdit,
  'file-read': FileSearch2,
  'file-delete': FileX,
  terminal: Terminal,
  search: Search,
  'todo-update': ListChecks,
  'state-change': Activity,
  error: AlertTriangle,
  'tool-call': Wrench,
  summary: FileText,
  note: StickyNote,
};

const COLOR_MAP: Record<SessionEventType, string> = {
  message: 'text-blue-400',
  thinking: 'text-purple-400',
  'file-create': 'text-emerald-400',
  'file-edit': 'text-amber-400',
  'file-read': 'text-zinc-400',
  'file-delete': 'text-red-400',
  terminal: 'text-green-400',
  search: 'text-cyan-400',
  'todo-update': 'text-indigo-400',
  'state-change': 'text-yellow-400',
  error: 'text-red-400',
  'tool-call': 'text-orange-400',
  summary: 'text-slate-400',
  note: 'text-pink-400',
};

const BG_MAP: Record<SessionEventType, string> = {
  message: 'bg-blue-500/10 border-blue-500/20',
  thinking: 'bg-purple-500/10 border-purple-500/20',
  'file-create': 'bg-emerald-500/10 border-emerald-500/20',
  'file-edit': 'bg-amber-500/10 border-amber-500/20',
  'file-read': 'bg-zinc-500/10 border-zinc-500/20',
  'file-delete': 'bg-red-500/10 border-red-500/20',
  terminal: 'bg-green-500/10 border-green-500/20',
  search: 'bg-cyan-500/10 border-cyan-500/20',
  'todo-update': 'bg-indigo-500/10 border-indigo-500/20',
  'state-change': 'bg-yellow-500/10 border-yellow-500/20',
  error: 'bg-red-500/10 border-red-500/20',
  'tool-call': 'bg-orange-500/10 border-orange-500/20',
  summary: 'bg-slate-500/10 border-slate-500/20',
  note: 'bg-pink-500/10 border-pink-500/20',
};

const LABEL_MAP: Record<SessionEventType, string> = {
  message: 'Message',
  thinking: 'Thinking',
  'file-create': 'Created File',
  'file-edit': 'Edited File',
  'file-read': 'Read File',
  'file-delete': 'Deleted File',
  terminal: 'Terminal',
  search: 'Search',
  'todo-update': 'Todo Update',
  'state-change': 'Status',
  error: 'Error',
  'tool-call': 'Tool Call',
  summary: 'Summary',
  note: 'Note',
};

/* ── Helpers ───────────────────────────────────────────────────── */

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function formatRelativeTime(ms: number): string {
  const now = Date.now();
  const diff = now - ms;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleDateString();
}

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts.length > 3 ? `.../${parts.slice(-3).join('/')}` : p;
}

/* ── Event Card Components ─────────────────────────────────────── */

function ThinkingCard({ event }: { event: SessionEvent }) {
  const [expanded, setExpanded] = useState(false);
  const meta = event.meta as ThinkingMeta;
  const preview = event.content.length > 200
    ? event.content.slice(0, 200) + '...'
    : event.content;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-purple-300/70">
        {meta.label && <span className="italic">{meta.label}</span>}
        {event.durationMs && (
          <span className="text-zinc-500">{formatDuration(event.durationMs)}</span>
        )}
      </div>
      <div
        className="cursor-pointer rounded-md bg-purple-500/5 p-3 font-mono text-xs text-zinc-300"
        onClick={() => setExpanded(!expanded)}
      >
        <pre className="whitespace-pre-wrap break-words">
          {expanded ? event.content : preview}
        </pre>
        {event.content.length > 200 && (
          <button className="mt-2 text-purple-400 hover:text-purple-300">
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  );
}

function MessageCard({ event }: { event: SessionEvent }) {
  const meta = event.meta as MessageMeta;
  return (
    <div className="space-y-1">
      <span className={`text-xs font-medium ${meta.role === 'user' ? 'text-blue-400' : 'text-emerald-400'}`}>
        {meta.role === 'user' ? 'You' : 'Assistant'}
        {meta.modelId && <span className="ml-1 text-zinc-500">({meta.modelId})</span>}
      </span>
      <div className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
        {event.content.length > 500 ? event.content.slice(0, 500) + '...' : event.content}
      </div>
    </div>
  );
}

function FileCreateCard({ event }: { event: SessionEvent }) {
  const meta = event.meta as FileCreateMeta;
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <div className="text-sm font-medium text-zinc-200">{shortPath(meta.filePath)}</div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="text-emerald-400">+{meta.linesAdded} lines</span>
          {meta.language && <span className="rounded bg-zinc-800 px-1.5 py-0.5">{meta.language}</span>}
          {meta.sizeBytes && <span>{(meta.sizeBytes / 1024).toFixed(1)} KB</span>}
        </div>
      </div>
    </div>
  );
}

function FileEditCard({ event }: { event: SessionEvent }) {
  const [showDiff, setShowDiff] = useState(false);
  const meta = event.meta as FileEditMeta;
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="text-sm font-medium text-zinc-200">{shortPath(meta.filePath)}</div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-emerald-400">+{meta.linesAdded}</span>
            <span className="text-red-400">-{meta.linesRemoved}</span>
          </div>
        </div>
        {(meta.oldString || meta.newString) && (
          <button
            onClick={() => setShowDiff(!showDiff)}
            className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            {showDiff ? 'Hide diff' : 'View diff'}
          </button>
        )}
      </div>
      {showDiff && (meta.oldString || meta.newString) && (
        <div className="mt-2 rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs">
          {meta.oldString && (
            <div className="mb-2 text-red-400/80">
              {meta.oldString.split('\n').map((line, i) => (
                <div key={i}>- {line}</div>
              ))}
            </div>
          )}
          {meta.newString && (
            <div className="text-emerald-400/80">
              {meta.newString.split('\n').map((line, i) => (
                <div key={i}>+ {line}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FileReadCard({ event }: { event: SessionEvent }) {
  const meta = event.meta as FileReadMeta;
  return (
    <div className="text-sm text-zinc-300">
      <span className="text-zinc-400">{shortPath(meta.filePath)}</span>
      {meta.startLine && meta.endLine && (
        <span className="ml-2 text-xs text-zinc-500">
          lines {meta.startLine}-{meta.endLine}
        </span>
      )}
    </div>
  );
}

function TerminalCard({ event }: { event: SessionEvent }) {
  const [showOutput, setShowOutput] = useState(false);
  const meta = event.meta as TerminalMeta;
  return (
    <div>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded bg-zinc-900 px-2 py-1 text-xs text-green-300">
          $ {meta.command}
        </code>
        {meta.exitCode !== undefined && (
          <span className={`text-xs ${meta.exitCode === 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            exit {meta.exitCode}
          </span>
        )}
      </div>
      {meta.output && (
        <>
          <button
            onClick={() => setShowOutput(!showOutput)}
            className="mt-1 text-xs text-zinc-500 hover:text-zinc-300"
          >
            {showOutput ? 'Hide output' : 'Show output'}
          </button>
          {showOutput && (
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-zinc-950 p-2 font-mono text-xs text-zinc-400">
              {meta.output}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

function SearchCard({ event }: { event: SessionEvent }) {
  const meta = event.meta as SearchMeta;
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-300">
      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-cyan-400">{meta.searchType}</span>
      <span className="flex-1 truncate">{meta.query}</span>
      {meta.resultCount !== undefined && (
        <span className="text-xs text-zinc-500">{meta.resultCount} results</span>
      )}
    </div>
  );
}

function TodoCard({ event }: { event: SessionEvent }) {
  const meta = event.meta as TodoUpdateMeta;
  const completed = meta.todos.filter((t: TodoItem) => t.status === 'completed').length;
  const total = meta.todos.length;
  const pct = total > 0 ? (completed / total) * 100 : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs font-medium text-indigo-400">
          {completed}/{total}
        </span>
      </div>
      <div className="space-y-1">
        {meta.todos.map((todo: TodoItem) => (
          <div key={todo.id} className="flex items-center gap-2 text-xs">
            <span className={`h-3 w-3 rounded-sm border ${
              todo.status === 'completed'
                ? 'border-emerald-500 bg-emerald-500/30'
                : todo.status === 'in-progress'
                ? 'border-blue-500 bg-blue-500/30'
                : 'border-zinc-600'
            }`} />
            <span className={todo.status === 'completed' ? 'text-zinc-500 line-through' : 'text-zinc-300'}>
              {todo.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StateChangeCard({ event }: { event: SessionEvent }) {
  const meta = event.meta as StateChangeMeta;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-2 animate-pulse rounded-full bg-yellow-400" />
      <span className="text-sm font-medium text-yellow-300">{meta.state}</span>
      {meta.detail && <span className="text-xs text-zinc-500">{meta.detail}</span>}
    </div>
  );
}

function ErrorCard({ event }: { event: SessionEvent }) {
  const meta = event.meta as ErrorMeta;
  return (
    <div className="space-y-1">
      {meta.filePath && (
        <span className="text-xs text-zinc-500">
          {shortPath(meta.filePath)}{meta.line ? `:${meta.line}` : ''}
        </span>
      )}
      <div className="text-sm text-red-300">{event.content}</div>
    </div>
  );
}

function ToolCallCard({ event }: { event: SessionEvent }) {
  const [expanded, setExpanded] = useState(false);
  const meta = event.meta as ToolCallMeta;
  return (
    <div>
      <div className="flex items-center gap-2">
        <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-orange-300">{meta.toolName}</code>
        {event.durationMs && (
          <span className="text-xs text-zinc-500">{formatDuration(event.durationMs)}</span>
        )}
      </div>
      {meta.parameters && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-xs text-zinc-500 hover:text-zinc-300"
        >
          {expanded ? 'Hide params' : 'Show params'}
        </button>
      )}
      {expanded && meta.parameters && (
        <pre className="mt-1 max-h-32 overflow-auto rounded bg-zinc-950 p-2 font-mono text-xs text-zinc-400">
          {JSON.stringify(meta.parameters, null, 2)}
        </pre>
      )}
    </div>
  );
}

function GenericCard({ event }: { event: SessionEvent }) {
  return (
    <div className="text-sm text-zinc-300 whitespace-pre-wrap">
      {event.content.length > 300 ? event.content.slice(0, 300) + '...' : event.content}
    </div>
  );
}

/* ── Event Row ─────────────────────────────────────────────────── */

function EventRow({ event, isLast }: { event: SessionEvent; isLast: boolean }) {
  const [collapsed, setCollapsed] = useState(
    event.type === 'file-read' || event.type === 'search'
  );
  const Icon = ICON_MAP[event.type];
  const color = COLOR_MAP[event.type];
  const bg = BG_MAP[event.type];
  const label = LABEL_MAP[event.type];

  const renderContent = () => {
    switch (event.type) {
      case 'thinking': return <ThinkingCard event={event} />;
      case 'message': return <MessageCard event={event} />;
      case 'file-create': return <FileCreateCard event={event} />;
      case 'file-edit': return <FileEditCard event={event} />;
      case 'file-read': return <FileReadCard event={event} />;
      case 'terminal': return <TerminalCard event={event} />;
      case 'search': return <SearchCard event={event} />;
      case 'todo-update': return <TodoCard event={event} />;
      case 'state-change': return <StateChangeCard event={event} />;
      case 'error': return <ErrorCard event={event} />;
      case 'tool-call': return <ToolCallCard event={event} />;
      default: return <GenericCard event={event} />;
    }
  };

  return (
    <div className="flex gap-3">
      {/* Timeline connector */}
      <div className="flex flex-col items-center">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`z-10 flex h-7 w-7 items-center justify-center rounded-lg border ${bg} transition-colors hover:brightness-125`}
        >
          <Icon className={`h-3.5 w-3.5 ${color}`} />
        </button>
        {!isLast && <div className="w-px flex-1 bg-zinc-800" />}
      </div>

      {/* Content */}
      <div className="flex-1 pb-4">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-zinc-200"
          >
            {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            <span className={color}>{label}</span>
          </button>
          <span className="text-xs text-zinc-600">{formatTime(event.timestamp)}</span>
          {event.durationMs && event.durationMs > 100 && (
            <span className="flex items-center gap-0.5 text-xs text-zinc-600">
              <Clock className="h-3 w-3" />
              {formatDuration(event.durationMs)}
            </span>
          )}
        </div>

        {/* Body */}
        {!collapsed && (
          <div className={`rounded-lg border p-3 ${bg}`}>
            {renderContent()}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Session Header ────────────────────────────────────────────── */

function SessionHeader() {
  const { activeSession, clearSelection, deleteSession, exportSession } = useSessionStore();
  if (!activeSession) return null;

  const handleExport = async () => {
    const data = await exportSession(activeSession.id);
    if (data) {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `session-${activeSession.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleDelete = async () => {
    if (confirm('Delete this session? This cannot be undone.')) {
      await deleteSession(activeSession.id);
    }
  };

  const statusColors = {
    active: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    completed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    failed: 'bg-red-500/20 text-red-400 border-red-500/30',
  };

  return (
    <div className="border-b border-zinc-800 p-4">
      <div className="flex items-start gap-3">
        <button
          onClick={clearSelection}
          className="mt-0.5 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-zinc-100">{activeSession.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span className={`rounded-full border px-2 py-0.5 ${statusColors[activeSession.status]}`}>
              {activeSession.status}
            </span>
            <span>{activeSession.agentName}</span>
            <span className="text-zinc-700">·</span>
            <span>{activeSession.modelId}</span>
            <span className="text-zinc-700">·</span>
            <span>{formatRelativeTime(activeSession.startedAt)}</span>
            {activeSession.stats.totalDurationMs > 0 && (
              <>
                <span className="text-zinc-700">·</span>
                <span>{formatDuration(activeSession.stats.totalDurationMs)}</span>
              </>
            )}
          </div>
          {activeSession.description && (
            <p className="mt-2 text-sm text-zinc-400">{activeSession.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleExport} className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" title="Export JSON">
            <Download className="h-4 w-4" />
          </button>
          <button onClick={handleDelete} className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400" title="Delete">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        <StatBadge icon={MessageSquare} label="Messages" value={activeSession.stats.messageCount} color="blue" />
        <StatBadge icon={Brain} label="Thinking" value={activeSession.stats.thinkingBlocks} color="purple" />
        <StatBadge icon={FilePlus} label="Created" value={activeSession.stats.filesCreated} color="emerald" />
        <StatBadge icon={FileEdit} label="Edited" value={activeSession.stats.filesModified} color="amber" />
        <StatBadge icon={Terminal} label="Commands" value={activeSession.stats.terminalCommands} color="green" />
        {activeSession.stats.todosTotal > 0 && (
          <StatBadge icon={ListChecks} label="Todos" value={`${activeSession.stats.todosCompleted}/${activeSession.stats.todosTotal}`} color="indigo" />
        )}
        {activeSession.stats.errorsEncountered > 0 && (
          <StatBadge icon={AlertTriangle} label="Errors" value={activeSession.stats.errorsEncountered} color="red" />
        )}
      </div>
    </div>
  );
}

function StatBadge({ icon: Icon, label, value, color }: {
  icon: LucideIcon; label: string; value: number | string; color: string;
}) {
  if (value === 0) return null;
  return (
    <div className={`flex items-center gap-1.5 rounded-md bg-${color}-500/10 px-2 py-1`}>
      <Icon className={`h-3 w-3 text-${color}-400`} />
      <span className={`text-${color}-400`}>{value}</span>
      <span className="text-zinc-500">{label}</span>
    </div>
  );
}

/* ── Event Type Filter ─────────────────────────────────────────── */

function EventFilter() {
  const { eventTypeFilter, setEventTypeFilter, events } = useSessionStore();

  const typeCounts = useMemo(() => {
    const counts: Partial<Record<SessionEventType, number>> = {};
    for (const e of events) {
      counts[e.type] = (counts[e.type] || 0) + 1;
    }
    return counts;
  }, [events]);

  const types = Object.keys(typeCounts) as SessionEventType[];

  return (
    <div className="flex items-center gap-1 border-b border-zinc-800 px-4 py-2 overflow-x-auto">
      <Filter className="h-3.5 w-3.5 text-zinc-600 mr-1" />
      <button
        onClick={() => setEventTypeFilter('all')}
        className={`shrink-0 rounded-md px-2 py-1 text-xs transition-colors ${
          eventTypeFilter === 'all'
            ? 'bg-zinc-700 text-zinc-200'
            : 'text-zinc-500 hover:text-zinc-300'
        }`}
      >
        All ({events.length})
      </button>
      {types.map((type) => {
        const Icon = ICON_MAP[type];
        const color = COLOR_MAP[type];
        return (
          <button
            key={type}
            onClick={() => setEventTypeFilter(eventTypeFilter === type ? 'all' : type)}
            className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
              eventTypeFilter === type
                ? 'bg-zinc-700 text-zinc-200'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Icon className={`h-3 w-3 ${color}`} />
            <span>{typeCounts[type]}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Main SessionViewer ────────────────────────────────────────── */

export function SessionViewer() {
  const { activeSession, events, eventTypeFilter, isLoading } = useSessionStore();

  const filteredEvents = useMemo(() => {
    if (eventTypeFilter === 'all') return events;
    return events.filter((e) => e.type === eventTypeFilter);
  }, [events, eventTypeFilter]);

  if (!activeSession) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-600">
        <div className="text-center">
          <Brain className="mx-auto mb-3 h-12 w-12 text-zinc-700" />
          <p className="text-sm">Select a session to view agent activity</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-blue-500" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <SessionHeader />
      <EventFilter />

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredEvents.length === 0 ? (
          <div className="text-center text-sm text-zinc-600">
            No events{eventTypeFilter !== 'all' ? ` of type "${eventTypeFilter}"` : ''} in this session
          </div>
        ) : (
          <div>
            {filteredEvents.map((event, i) => (
              <EventRow
                key={event.id}
                event={event}
                isLast={i === filteredEvents.length - 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
