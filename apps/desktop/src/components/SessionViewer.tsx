import { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react';
import {
  MessageSquare,
  Brain,
  Compass,
  BookOpen,
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
  Radio,
  Pin,
  PinOff,
  Rows3,
  Rows4,
  X,
  User,
  Bot,
  Eye,
  MessageCircle,
  ClipboardCopy,
  Check,
  type LucideIcon,
} from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore.js';
import type {
  SessionEvent,
  SessionEventType,
  MessageMeta,
  ThinkingMeta,
  PlanningMeta,
  ContextGatherMeta,
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
  planning: Compass,
  'context-gather': BookOpen,
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
  planning: 'text-violet-400',
  'context-gather': 'text-teal-400',
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
  planning: 'bg-violet-500/10 border-violet-500/20',
  'context-gather': 'bg-teal-500/10 border-teal-500/20',
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
  planning: 'Planning',
  'context-gather': 'Context Gathering',
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

/**
 * Normalize event types for display.
 * Handles backward-compat types like 'message:user' → 'message'.
 */
function normalizeEventType(type: string): SessionEventType {
  if (type === 'message:user' || type === 'message:assistant') return 'message';
  return type as SessionEventType;
}

/**
 * Check if an event is low-value noise that should be hidden by default.
 * Git fsmonitor cookies, repetitive diagnostics, etc.
 */
function isNoiseEvent(event: SessionEvent): boolean {
  // Git fsmonitor cookie deletions
  if (event.type === 'file-delete' && event.content.includes('.git/fsmonitor')) return true;
  if (event.type === 'file-delete' && event.content.includes('.git\\fsmonitor')) return true;
  // ALL diagnostics are noise — they spam the timeline with 1000+ events
  // Real errors are visible in the editor; diagnostics events add no value
  if (event.type === 'state-change' && (event.meta as unknown as Record<string, unknown>)?.state === 'diagnostics') {
    return true;
  }
  // Extension attach/reattach spam
  if (event.type === 'state-change' && (event.meta as unknown as Record<string, unknown>)?.state === 'attached') {
    return true;
  }
  return false;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function formatSessionAge(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function formatRelativeTime(ms: number): string {
  const now = Date.now();
  const diff = now - ms;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleDateString();
}

function shortPath(p: string | undefined | null): string {
  if (!p) return '(unknown file)';
  const parts = p.replace(/\\/g, '/').split('/');
  return parts.length > 3 ? `.../${parts.slice(-3).join('/')}` : p;
}

/* ── Markdown Formatter for Copy ──────────────────────────────── */

function eventsToMarkdown(events: SessionEvent[], sessionTitle: string): string {
  const lines: string[] = [];
  lines.push(`# ${sessionTitle}`);
  lines.push(`> ${events.length} events · Exported ${new Date().toLocaleString()}`);
  lines.push('');

  for (const event of events) {
    const time = formatTime(event.timestamp);
    const nType = normalizeEventType(event.type);
    const label = LABEL_MAP[nType] ?? event.type;
    const meta = (event.meta as unknown as Record<string, unknown>) ?? {};

    switch (nType) {
      case 'message': {
        const isUser = meta.role === 'user';
        lines.push(`## ${isUser ? '🧑 You' : '🤖 Assistant'} — ${time}`);
        lines.push('');
        lines.push(event.content);
        lines.push('');
        break;
      }
      case 'thinking': {
        lines.push(`### 🧠 Thinking — ${time}`);
        if (event.durationMs) lines.push(`*${formatDuration(event.durationMs)}*`);
        lines.push('');
        lines.push(event.content.length > 2000
          ? event.content.slice(0, 2000) + '\n\n... (truncated)'
          : event.content);
        lines.push('');
        break;
      }
      case 'planning': {
        const pm = meta as Record<string, unknown>;
        lines.push(`### 🧭 Plan — ${time}`);
        if (pm.intent) lines.push(`**Intent:** ${pm.intent}`);
        if (pm.approach) lines.push(`**Approach:** ${pm.approach}`);
        const steps = pm.steps as string[] | undefined;
        if (steps?.length) {
          lines.push('');
          steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
        }
        lines.push('');
        break;
      }
      case 'file-create': {
        lines.push(`📄 **Created** \`${shortPath(meta.filePath as string)}\` — ${time}`);
        if (meta.linesAdded) lines.push(`+${meta.linesAdded} lines`);
        lines.push('');
        break;
      }
      case 'file-edit': {
        const fm = meta as Record<string, unknown>;
        lines.push(`✏️ **Edited** \`${shortPath(fm.filePath as string)}\` — ${time}`);
        const added = fm.linesAdded ?? 0;
        const removed = fm.linesRemoved ?? 0;
        if (added || removed) lines.push(`+${added} -${removed}`);
        if (fm.oldString || fm.newString) {
          lines.push('```diff');
          if (fm.oldString) (fm.oldString as string).split('\n').forEach(l => lines.push(`- ${l}`));
          if (fm.newString) (fm.newString as string).split('\n').forEach(l => lines.push(`+ ${l}`));
          lines.push('```');
        }
        lines.push('');
        break;
      }
      case 'file-read': {
        const fr = meta as Record<string, unknown>;
        const path = shortPath(fr.filePath as string);
        const range = fr.startLine && fr.endLine ? ` lines ${fr.startLine}-${fr.endLine}` : '';
        lines.push(`📖 **Read** \`${path}\`${range} — ${time}`);
        if (event.content && event.content.length > 10) {
          lines.push('');
          const preview = event.content.length > 500 ? event.content.slice(0, 500) + '\n...' : event.content;
          lines.push('```');
          lines.push(preview);
          lines.push('```');
        }
        lines.push('');
        break;
      }
      case 'terminal': {
        const tm = meta as Record<string, unknown>;
        lines.push(`💻 **Terminal** — ${time}`);
        if (tm.command) lines.push(`\`\`\`\n$ ${tm.command}\n\`\`\``);
        if (tm.exitCode !== undefined) lines.push(`Exit: ${tm.exitCode}`);
        if (tm.output) {
          const out = (tm.output as string).length > 500
            ? (tm.output as string).slice(0, 500) + '\n...'
            : tm.output as string;
          lines.push('```');
          lines.push(out);
          lines.push('```');
        }
        lines.push('');
        break;
      }
      case 'search': {
        const sm = meta as Record<string, unknown>;
        lines.push(`🔍 **Search** (${sm.searchType ?? 'unknown'}) — ${time}`);
        lines.push(`Query: \`${sm.query ?? event.content}\``);
        if (sm.resultCount !== undefined) lines.push(`${sm.resultCount} results`);
        if (event.content && event.content !== sm.query && event.content.length > 10) {
          lines.push('');
          const preview = event.content.length > 500 ? event.content.slice(0, 500) + '\n...' : event.content;
          lines.push(preview);
        }
        lines.push('');
        break;
      }
      case 'todo-update': {
        const todos = meta.todos as Array<{ title: string; status: string }> | undefined;
        if (todos?.length) {
          lines.push(`📋 **Todos** — ${time}`);
          for (const t of todos) {
            const icon = t.status === 'completed' ? '✅' : t.status === 'in-progress' ? '🔄' : '⬜';
            lines.push(`${icon} ${t.title}`);
          }
          lines.push('');
        }
        break;
      }
      case 'state-change': {
        lines.push(`⚡ **${meta.state ?? 'Status'}** — ${time}`);
        if (meta.detail) lines.push(String(meta.detail));
        lines.push('');
        break;
      }
      case 'error': {
        lines.push(`❌ **Error** — ${time}`);
        lines.push(event.content);
        lines.push('');
        break;
      }
      case 'tool-call': {
        const tc = meta as Record<string, unknown>;
        lines.push(`🔧 **${tc.toolName ?? tc.toolId ?? 'Tool Call'}** — ${time}`);
        if (event.content) lines.push(event.content);
        if (tc.parameters) {
          lines.push('```json');
          lines.push(JSON.stringify(tc.parameters, null, 2));
          lines.push('```');
        }
        lines.push('');
        break;
      }
      case 'context-gather': {
        const cg = meta as Record<string, unknown>;
        lines.push(`📚 **Context Gather** (${cg.gatherType ?? 'unknown'}) — ${time}`);
        if (event.content) lines.push(event.content);
        lines.push('');
        break;
      }
      case 'note': {
        lines.push(`📝 **Note** — ${time}`);
        lines.push(event.content);
        lines.push('');
        break;
      }
      default: {
        lines.push(`**${label}** — ${time}`);
        if (event.content) lines.push(event.content);
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

function ThinkingCard({ event }: { event: SessionEvent }) {
  const [expanded, setExpanded] = useState(false);
  const meta = event.meta as ThinkingMeta;
  const content = event.content ?? '';
  const PREVIEW_LENGTH = 400;
  const isLong = content.length > PREVIEW_LENGTH;
  const preview = isLong ? content.slice(0, PREVIEW_LENGTH) + '...' : content;
  const generatedTitle = (meta as unknown as Record<string, unknown>)?.generatedTitle as string | undefined;
  const charCount = (meta as unknown as Record<string, unknown>)?.charCount as number | undefined;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-purple-300/70 flex-wrap">
        <Eye className="h-3 w-3 text-purple-400" />
        <span className="font-medium text-purple-300">Agent Reasoning</span>
        {generatedTitle && <span className="italic text-purple-300/60">— {generatedTitle}</span>}
        {meta.label && <span className="italic">{meta.label}</span>}
        {meta.intent && (
          <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-purple-300">
            Intent: {meta.intent}
          </span>
        )}
        {event.durationMs && (
          <span className="text-zinc-500">{formatDuration(event.durationMs)}</span>
        )}
        <span className="ml-auto text-zinc-600">{charCount?.toLocaleString() ?? content.length.toLocaleString()} chars</span>
      </div>
      {meta.constraints && meta.constraints.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {meta.constraints.map((c, i) => (
            <span key={i} className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
              {c}
            </span>
          ))}
        </div>
      )}
      <div
        className="cursor-pointer rounded-md bg-purple-500/5 border border-purple-500/10 p-3 font-mono text-xs text-zinc-300"
        onClick={() => setExpanded(!expanded)}
      >
        <pre className={`whitespace-pre-wrap break-words ${expanded ? 'max-h-[600px] overflow-y-auto' : ''}`}>
          {expanded ? content : preview}
        </pre>
        {isLong && (
          <button className="mt-2 text-purple-400 hover:text-purple-300 font-sans">
            {expanded ? 'Show less' : `Show more (${(charCount ?? content.length).toLocaleString()} chars)`}
          </button>
        )}
      </div>
    </div>
  );
}

function PlanningCard({ event }: { event: SessionEvent }) {
  const [expanded, setExpanded] = useState(false);
  const meta = event.meta as PlanningMeta;

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-violet-300">
        {meta.intent}
      </div>
      <div className="text-xs text-zinc-400">{meta.approach}</div>
      {meta.steps && meta.steps.length > 0 && (
        <div className="space-y-1 pl-2 border-l-2 border-violet-500/30">
          {meta.steps.map((step, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-zinc-300">
              <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full bg-violet-500/20 text-center text-violet-400 text-[10px] leading-4">
                {i + 1}
              </span>
              {step}
            </div>
          ))}
        </div>
      )}
      {meta.decisions && meta.decisions.length > 0 && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-violet-400/70 hover:text-violet-300"
          >
            {expanded ? 'Hide decisions' : `${meta.decisions.length} decision(s)`}
          </button>
          {expanded && (
            <div className="space-y-1">
              {meta.decisions.map((d, i) => (
                <div key={i} className="rounded bg-violet-500/5 px-2 py-1 text-xs text-zinc-400">
                  {d}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {event.content && (
        <div className="text-xs text-zinc-500 whitespace-pre-wrap">{event.content}</div>
      )}
    </div>
  );
}

function ContextGatherCard({ event }: { event: SessionEvent }) {
  const [showFiles, setShowFiles] = useState(false);
  const meta = event.meta as ContextGatherMeta;
  const filesRead = meta.filesRead ?? [];
  const queriesRun = meta.queriesRun ?? [];

  return (
    <div className="space-y-2">
      <div className="text-sm text-zinc-300">{meta.findings ?? ''}</div>
      <div className="flex flex-wrap gap-2">
        {filesRead.length > 0 && (
          <button
            onClick={() => setShowFiles(!showFiles)}
            className="flex items-center gap-1 rounded bg-teal-500/10 px-1.5 py-0.5 text-xs text-teal-400 hover:bg-teal-500/20"
          >
            <FileSearch2 className="h-3 w-3" />
            {filesRead.length} files
          </button>
        )}
        {queriesRun.length > 0 && (
          <span className="flex items-center gap-1 rounded bg-cyan-500/10 px-1.5 py-0.5 text-xs text-cyan-400">
            <Search className="h-3 w-3" />
            {queriesRun.length} queries
          </span>
        )}
      </div>
      {showFiles && (
        <div className="space-y-0.5 pl-2">
          {filesRead.map((f, i) => (
            <div key={i} className="text-xs text-zinc-500">{shortPath(f)}</div>
          ))}
        </div>
      )}
      {queriesRun.length > 0 && (
        <div className="space-y-0.5">
          {queriesRun.map((q, i) => (
            <div key={i} className="rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-400">
              {q}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageCard({ event }: { event: SessionEvent }) {
  const [expanded, setExpanded] = useState(false);
  const meta = event.meta as MessageMeta;
  const content = event.content ?? '';
  const isUser = meta?.role === 'user';
  const PREVIEW_LENGTH = 400;
  const isLong = content.length > PREVIEW_LENGTH;
  const preview = isLong ? content.slice(0, PREVIEW_LENGTH) + '...' : content;

  return (
    <div className={`space-y-1.5 rounded-lg p-3 ${isUser ? 'bg-blue-500/5 border border-blue-500/10' : 'bg-emerald-500/5 border border-emerald-500/10'}`}>
      <div className="flex items-center gap-2">
        {isUser ? <User className="h-3.5 w-3.5 text-blue-400" /> : <Bot className="h-3.5 w-3.5 text-emerald-400" />}
        <span className={`text-xs font-semibold ${isUser ? 'text-blue-400' : 'text-emerald-400'}`}>
          {isUser ? 'You' : 'Assistant'}
        </span>
        {meta?.modelId && <span className="text-xs text-zinc-600">({meta.modelId})</span>}
        {isLong && <span className="text-xs text-zinc-600 ml-auto">{content.length.toLocaleString()} chars</span>}
      </div>
      <div
        className={`text-sm leading-relaxed whitespace-pre-wrap cursor-pointer ${isUser ? 'text-zinc-200' : 'text-zinc-300'}`}
        onClick={() => isLong && setExpanded(!expanded)}
      >
        {expanded ? content : preview}
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className={`text-xs ${isUser ? 'text-blue-400 hover:text-blue-300' : 'text-emerald-400 hover:text-emerald-300'}`}
        >
          {expanded ? 'Show less' : `Show more (${content.length.toLocaleString()} chars)`}
        </button>
      )}
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
  const [showContent, setShowContent] = useState(false);
  const meta = event.meta as FileReadMeta;
  const content = event.content ?? '';
  const hasContent = content.length > 10;
  const lineCount = meta.startLine && meta.endLine ? meta.endLine - meta.startLine + 1 : null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-zinc-200">{shortPath(meta.filePath)}</span>
        {meta.startLine && meta.endLine && (
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-500">
            L{meta.startLine}–{meta.endLine}
          </span>
        )}
        {lineCount && <span className="text-xs text-zinc-600">{lineCount} lines</span>}
        {hasContent && (
          <button
            onClick={() => setShowContent(!showContent)}
            className="ml-auto text-xs text-zinc-500 hover:text-zinc-300"
          >
            {showContent ? 'Hide content' : 'Show content'}
          </button>
        )}
      </div>
      {showContent && hasContent && (
        <pre className="max-h-48 overflow-auto rounded-md bg-zinc-950 border border-zinc-800 p-3 font-mono text-xs text-zinc-400">
          {content.length > 2000 ? content.slice(0, 2000) + '\n... (truncated)' : content}
        </pre>
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
  const [showResults, setShowResults] = useState(false);
  const meta = event.meta as SearchMeta;
  const content = event.content ?? '';
  const hasDetail = content.length > 10 && content !== meta.query;

  const typeColors: Record<string, string> = {
    grep: 'bg-cyan-500/20 text-cyan-300',
    file: 'bg-emerald-500/20 text-emerald-300',
    semantic: 'bg-purple-500/20 text-purple-300',
    subagent: 'bg-teal-500/20 text-teal-300',
  };
  const badgeColor = typeColors[meta.searchType] ?? 'bg-zinc-800 text-cyan-400';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-sm text-zinc-300">
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badgeColor}`}>{meta.searchType}</span>
        <span className="flex-1 truncate font-mono text-xs">{meta.query}</span>
        {meta.resultCount !== undefined && (
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">{meta.resultCount} results</span>
        )}
        {hasDetail && (
          <button
            onClick={() => setShowResults(!showResults)}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            {showResults ? 'Hide' : 'Details'}
          </button>
        )}
      </div>
      {showResults && hasDetail && (
        <pre className="max-h-40 overflow-auto rounded-md bg-zinc-950 border border-zinc-800 p-3 font-mono text-xs text-zinc-400">
          {content.length > 1500 ? content.slice(0, 1500) + '\n... (truncated)' : content}
        </pre>
      )}
    </div>
  );
}

function TodoCard({ event }: { event: SessionEvent }) {
  const meta = event.meta as TodoUpdateMeta;
  const todos = meta.todos ?? [];
  const completed = todos.filter((t: TodoItem) => t.status === 'completed').length;
  const total = todos.length;
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
        {todos.map((todo: TodoItem) => (
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
  const [expanded, setExpanded] = useState(false);
  const meta = event.meta as StateChangeMeta;
  const content = event.content ?? '';
  const isDiagnostics = meta?.state === 'diagnostics';
  const diagMeta = meta as StateChangeMeta & { errors?: number; warnings?: number; filesAffected?: number };
  const hasMultiLineContent = content.includes('\n');

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 animate-pulse rounded-full bg-yellow-400" />
        <span className="text-sm font-medium text-yellow-300">{meta?.state ?? 'unknown'}</span>
        {meta?.detail && <span className="text-xs text-zinc-500">{meta.detail}</span>}
        {isDiagnostics && (diagMeta.errors ?? 0) > 0 && (
          <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-xs text-red-400">
            {diagMeta.errors} errors
          </span>
        )}
        {isDiagnostics && (diagMeta.warnings ?? 0) > 0 && (
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-400">
            {diagMeta.warnings} warnings
          </span>
        )}
        {isDiagnostics && (diagMeta.filesAffected ?? 0) > 0 && (
          <span className="text-xs text-zinc-600">
            {diagMeta.filesAffected} file(s)
          </span>
        )}
        {hasMultiLineContent && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            {expanded ? 'Hide details' : 'Show files'}
          </button>
        )}
      </div>
      {expanded && hasMultiLineContent && (
        <pre className="whitespace-pre-wrap rounded bg-zinc-900/60 px-3 py-2 font-mono text-xs text-zinc-400 border border-zinc-800/50">
          {content.split('\n').slice(1).join('\n')}
        </pre>
      )}
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
  const content = event.content ?? '';
  const hasContent = content.length > 5;
  const toolName = meta.toolName ?? (meta as unknown as Record<string, unknown>).toolId as string ?? 'unknown';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-orange-300">{toolName}</code>
        {event.durationMs && (
          <span className="text-xs text-zinc-500">{formatDuration(event.durationMs)}</span>
        )}
        {(meta.parameters || hasContent) && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="ml-auto text-xs text-zinc-500 hover:text-zinc-300"
          >
            {expanded ? 'Hide details' : 'Show details'}
          </button>
        )}
      </div>
      {hasContent && (
        <div className="text-xs text-zinc-400">
          {content.length > 200 ? content.slice(0, 200) + '...' : content}
        </div>
      )}
      {expanded && meta.parameters && (
        <pre className="mt-1 max-h-32 overflow-auto rounded bg-zinc-950 border border-zinc-800 p-2 font-mono text-xs text-zinc-400">
          {JSON.stringify(meta.parameters, null, 2)}
        </pre>
      )}
    </div>
  );
}

function GenericCard({ event }: { event: SessionEvent }) {
  const content = event.content ?? '';
  return (
    <div className="text-sm text-zinc-300 whitespace-pre-wrap">
      {content.length > 300 ? content.slice(0, 300) + '...' : content}
    </div>
  );
}

/* ── Collapsed Summary — shows key details inline when event is collapsed ── */

function getCollapsedSummary(event: SessionEvent): string | null {
  const type = normalizeEventType(event.type);
  const meta = event.meta as unknown as Record<string, unknown>;

  switch (type) {
    case 'search': {
      const query = (meta?.query ?? event.content ?? '').toString();
      const searchType = meta?.searchType as string | undefined;
      const resultCount = meta?.resultCount as number | undefined;
      const parts: string[] = [];
      if (searchType) parts.push(searchType);
      if (query) parts.push(query.length > 60 ? query.slice(0, 60) + '...' : query);
      if (resultCount !== undefined) parts.push(`${resultCount} results`);
      return parts.join(' — ') || null;
    }
    case 'file-read': {
      const filePath = meta?.filePath as string | undefined;
      const startLine = meta?.startLine as number | undefined;
      const endLine = meta?.endLine as number | undefined;
      if (!filePath) return null;
      const short = shortPath(filePath);
      const range = startLine && endLine ? ` L${startLine}–${endLine}` : '';
      return `${short}${range}`;
    }
    case 'file-edit': {
      const filePath = meta?.filePath as string | undefined;
      const linesAdded = meta?.linesAdded as number | undefined;
      const linesRemoved = meta?.linesRemoved as number | undefined;
      if (!filePath) return null;
      const short = shortPath(filePath);
      const changes: string[] = [];
      if (linesAdded) changes.push(`+${linesAdded}`);
      if (linesRemoved) changes.push(`-${linesRemoved}`);
      return changes.length > 0 ? `${short} ${changes.join(' ')}` : short;
    }
    case 'file-create': {
      const filePath = meta?.filePath as string | undefined;
      return filePath ? shortPath(filePath) : null;
    }
    case 'terminal': {
      const cmd = meta?.command as string | undefined;
      if (!cmd) return null;
      return cmd.length > 70 ? cmd.slice(0, 70) + '...' : cmd;
    }
    case 'tool-call': {
      const toolName = meta?.toolName as string | undefined;
      return toolName || null;
    }
    case 'state-change': {
      const state = meta?.state as string | undefined;
      return state || null;
    }
    case 'message': {
      const role = meta?.role as string | undefined;
      const content = event.content ?? '';
      const prefix = role === 'user' ? 'You: ' : '';
      const text = content.length > 60 ? content.slice(0, 60) + '...' : content;
      return text ? `${prefix}${text}` : null;
    }
    default:
      return null;
  }
}

/* ── Event Row ─────────────────────────────────────────────────── */

interface EventRowProps {
  event: SessionEvent;
  isLast: boolean;
  compact?: boolean;
  isPinned: boolean;
  onTogglePin: () => void;
}

const EventRow = memo(function EventRow({ event, isLast, compact, isPinned, onTogglePin }: EventRowProps) {
  const normalizedType = normalizeEventType(event.type);
  const [collapsed, setCollapsed] = useState(
    compact || normalizedType === 'file-read' || normalizedType === 'search'
  );
  const Icon = ICON_MAP[normalizedType] ?? Activity;
  const color = COLOR_MAP[normalizedType] ?? 'text-zinc-400';
  const bg = BG_MAP[normalizedType] ?? 'bg-zinc-500/10 border-zinc-500/20';
  const label = LABEL_MAP[normalizedType] ?? event.type;

  const handlePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    onTogglePin();
  };

  const renderContent = () => {
    switch (normalizedType) {
      case 'thinking': return <ThinkingCard event={event} />;
      case 'planning': return <PlanningCard event={event} />;
      case 'context-gather': return <ContextGatherCard event={event} />;
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

  // Compact mode: single inline row
  if (compact && collapsed) {
    const summary = getCollapsedSummary(event) ?? (event.content.slice(0, 80) + (event.content.length > 80 ? '...' : ''));
    return (
      <div
        className="flex items-center gap-2 px-1 py-0.5 text-xs hover:bg-zinc-800/50 rounded cursor-pointer group"
        onClick={() => setCollapsed(false)}
      >
        <Icon className={`h-3 w-3 ${color} shrink-0`} />
        <span className={`${color} font-medium w-16 shrink-0`}>{label}</span>
        <span className="text-zinc-500 truncate flex-1">{summary}</span>
        <span className="text-zinc-600 shrink-0">{formatTime(event.timestamp)}</span>
        <button
          onClick={handlePin}
          className={`opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded ${isPinned ? 'text-amber-400' : 'text-zinc-600 hover:text-zinc-400'}`}
        >
          {isPinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
        </button>
      </div>
    );
  }

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
      <div className="flex-1 pb-4 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1 group min-w-0">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex shrink-0 items-center gap-1 text-xs font-medium text-zinc-400 hover:text-zinc-200"
          >
            {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            <span className={color}>{label}</span>
          </button>
          {/* Collapsed summary — inline detail so you see WHAT without expanding */}
          {collapsed && (() => {
            const summary = getCollapsedSummary(event);
            return summary ? (
              <span className="min-w-0 truncate text-xs text-zinc-600 font-mono">{summary}</span>
            ) : null;
          })()}
          <span className="shrink-0 text-xs text-zinc-600">{formatTime(event.timestamp)}</span>
          {event.durationMs && event.durationMs > 100 && (
            <span className="flex shrink-0 items-center gap-0.5 text-xs text-zinc-600">
              <Clock className="h-3 w-3" />
              {formatDuration(event.durationMs)}
            </span>
          )}
          {/* Pin button */}
          <button
            onClick={handlePin}
            className={`ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 ${
              isPinned ? 'text-amber-400 opacity-100' : 'text-zinc-600 hover:text-zinc-400'
            }`}
            title={isPinned ? 'Unpin' : 'Pin this event'}
          >
            {isPinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
          </button>
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
});

/* ── Session Header ────────────────────────────────────────────── */

function SessionHeader() {
  const { activeSession, clearSelection, deleteSession, exportSession, events } = useSessionStore();
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
            <span title={`Started: ${new Date(activeSession.startedAt).toLocaleString()}`}>
              {formatRelativeTime(activeSession.startedAt)}
            </span>
            {activeSession.lastActivityAt && activeSession.lastActivityAt !== activeSession.startedAt && (
              <>
                <span className="text-zinc-700">·</span>
                <span title={`Last activity: ${new Date(activeSession.lastActivityAt).toLocaleString()}`}>
                  {formatSessionAge(Date.now() - activeSession.startedAt)}
                </span>
              </>
            )}
            {!activeSession.lastActivityAt && activeSession.stats.totalDurationMs > 0 && (
              <>
                <span className="text-zinc-700">·</span>
                <span>{formatSessionAge(activeSession.stats.totalDurationMs)}</span>
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

      {/* Stats bar — derived from actual events for consistency with filter bar */}
      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        {(() => {
          // Count from actual events (same source as filter bar) for consistent display
          const meaningful = events.filter(e => !isNoiseEvent(e));
          const counts: Record<string, number> = {};
          for (const e of meaningful) {
            const t = normalizeEventType(e.type);
            counts[t] = (counts[t] || 0) + 1;
          }
          // Find last todo-update event for progress
          const lastTodo = [...events].reverse().find(e => normalizeEventType(e.type) === 'todo-update');
          const todoMeta = lastTodo?.meta as Record<string, unknown> | undefined;
          const todos = (todoMeta?.todos as Array<{ status: string }>) ?? [];
          const todosCompleted = todos.filter(t => t.status === 'completed').length;
          const todosTotal = todos.length;

          return (
            <>
              <StatBadge icon={MessageSquare} label="Messages" value={counts['message'] ?? 0} color="blue" />
              <StatBadge icon={Brain} label="Thinking" value={counts['thinking'] ?? 0} color="purple" />
              <StatBadge icon={FilePlus} label="Created" value={counts['file-create'] ?? 0} color="emerald" />
              <StatBadge icon={FileEdit} label="Edited" value={counts['file-edit'] ?? 0} color="amber" />
              <StatBadge icon={Terminal} label="Commands" value={counts['terminal'] ?? 0} color="green" />
              {(counts['search'] ?? 0) > 0 && (
                <StatBadge icon={Search} label="Searches" value={counts['search'] ?? 0} color="cyan" />
              )}
              {todosTotal > 0 && (
                <StatBadge icon={ListChecks} label="Todos" value={`${todosCompleted}/${todosTotal}`} color="indigo" />
              )}
              {(counts['file-read'] ?? 0) > 0 && (
                <StatBadge icon={FileSearch2} label="Reads" value={counts['file-read'] ?? 0} color="zinc" />
              )}
              {(counts['context-gather'] ?? 0) > 0 && (
                <StatBadge icon={BookOpen} label="Context" value={counts['context-gather'] ?? 0} color="teal" />
              )}
              {(counts['error'] ?? 0) > 0 && (
                <StatBadge icon={AlertTriangle} label="Errors" value={counts['error'] ?? 0} color="red" />
              )}
              {(counts['planning'] ?? 0) > 0 && (
                <StatBadge icon={Compass} label="Planning" value={counts['planning'] ?? 0} color="violet" />
              )}
              {(counts['note'] ?? 0) > 0 && (
                <StatBadge icon={StickyNote} label="Notes" value={counts['note'] ?? 0} color="pink" />
              )}
            </>
          );
        })()}
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
  const { eventTypeFilter, filterPreset, setFilterPreset, toggleEventType, events } = useSessionStore();

  // Filter out noise events before counting
  const meaningfulEvents = useMemo(() => events.filter(e => !isNoiseEvent(e)), [events]);

  const typeCounts = useMemo(() => {
    const counts: Partial<Record<string, number>> = {};
    let userCount = 0;
    let assistantCount = 0;
    for (const e of meaningfulEvents) {
      const nType = normalizeEventType(e.type);
      counts[nType] = (counts[nType] || 0) + 1;
      if (nType === 'message') {
        const role = (e.meta as unknown as Record<string, unknown>)?.role;
        if (role === 'user') userCount++;
        else assistantCount++;
      }
    }
    // Conversation = messages + thinking
    const conversationCount = (counts['message'] || 0) + (counts['thinking'] || 0);
    return { counts, userCount, assistantCount, conversationCount };
  }, [meaningfulEvents]);

  const types = Object.keys(typeCounts.counts) as string[];
  const isPreset = (p: string) => filterPreset === p;
  const isTypeSelected = (type: string) => !filterPreset && eventTypeFilter.has(type);
  const activeCount = eventTypeFilter.size;

  return (
    <div className="flex items-center gap-1 border-b border-zinc-800 px-4 py-2 overflow-x-auto">
      <Filter className="h-3.5 w-3.5 text-zinc-600 mr-1" />
      {/* Presets */}
      <button
        onClick={() => setFilterPreset('all')}
        className={`shrink-0 rounded-md px-2 py-1 text-xs transition-colors ${
          isPreset('all')
            ? 'bg-zinc-700 text-zinc-200'
            : 'text-zinc-500 hover:text-zinc-300'
        }`}
      >
        All ({meaningfulEvents.length})
      </button>
      <button
        onClick={() => setFilterPreset(isPreset('conversation') ? 'all' : 'conversation')}
        className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
          isPreset('conversation')
            ? 'bg-violet-600/30 text-violet-200 ring-1 ring-violet-500/40'
            : 'text-zinc-500 hover:text-zinc-300'
        }`}
      >
        <MessageCircle className="h-3 w-3 text-violet-400" />
        <span>Chat ({typeCounts.conversationCount})</span>
      </button>
      <button
        onClick={() => setFilterPreset(isPreset('message:user') ? 'all' : 'message:user')}
        className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
          isPreset('message:user')
            ? 'bg-blue-600/30 text-blue-200 ring-1 ring-blue-500/40'
            : 'text-zinc-500 hover:text-zinc-300'
        }`}
        title="Your messages only"
      >
        <User className="h-3 w-3 text-blue-400" />
        <span>Me ({typeCounts.userCount})</span>
      </button>

      <div className="h-4 w-px bg-zinc-700 mx-1 shrink-0" />

      {/* Multi-select type filters */}
      {types.map((type) => {
        const t = type as keyof typeof ICON_MAP;
        const Icon = ICON_MAP[t] ?? Activity;
        const color = COLOR_MAP[t] ?? 'text-zinc-400';
        const count = typeCounts.counts[type] ?? 0;
        const isActive = isTypeSelected(type);

        return (
          <button
            key={type}
            onClick={() => toggleEventType(type)}
            className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
              isActive
                ? 'bg-zinc-700 text-zinc-200 ring-1 ring-zinc-500/50'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
            title={`${LABEL_MAP[t as SessionEventType] ?? type} (click to toggle)`}
          >
            <Icon className={`h-3 w-3 ${color}`} />
            <span>{count}</span>
          </button>
        );
      })}

      {/* Clear multi-select */}
      {activeCount > 0 && !filterPreset && (
        <button
          onClick={() => setFilterPreset('all')}
          className="shrink-0 ml-1 flex items-center gap-0.5 rounded-md px-1.5 py-1 text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
          title="Clear filters"
        >
          <X className="h-3 w-3" />
          <span>{activeCount}</span>
        </button>
      )}
    </div>
  );
}

/* ── Search Bar ────────────────────────────────────────────────── */

function SearchBar() {
  const { searchQuery, setSearchQuery, searchEvents, clearSearch, isSearching } = useSessionStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      clearSearch();
      return;
    }
    debounceRef.current = setTimeout(() => {
      void searchEvents(value);
    }, 300);
  }, [setSearchQuery, searchEvents, clearSearch]);

  return (
    <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
      <Search className="h-3.5 w-3.5 text-zinc-600" />
      <input
        ref={inputRef}
        value={searchQuery}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Search events..."
        className="flex-1 bg-transparent text-xs text-zinc-300 placeholder-zinc-600 outline-none"
      />
      {isSearching && (
        <div className="h-3 w-3 animate-spin rounded-full border border-zinc-700 border-t-blue-500" />
      )}
      {searchQuery && (
        <button onClick={clearSearch} className="text-zinc-600 hover:text-zinc-400">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/* ── Pinned Events Panel ───────────────────────────────────────── */

function PinnedPanel() {
  const { pinnedEvents, pinnedNotes, activeSessionId, unpinEvent, resolvePinnedNote, addPinnedNote } = useSessionStore();
  const [expanded, setExpanded] = useState(false);
  const [noteInput, setNoteInput] = useState('');
  const [noteCategory, setNoteCategory] = useState<string>('context');

  const totalPinned = pinnedEvents.length + pinnedNotes.length;
  if (totalPinned === 0) return null;

  const unresolvedNotes = pinnedNotes.filter((n) => !n.resolved);

  return (
    <div className="border-b border-zinc-800">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-2 text-xs text-amber-400 hover:bg-zinc-800/50"
      >
        <Pin className="h-3.5 w-3.5" />
        <span className="font-medium">
          {pinnedEvents.length} pinned event{pinnedEvents.length !== 1 ? 's' : ''}
          {unresolvedNotes.length > 0 && ` · ${unresolvedNotes.length} note${unresolvedNotes.length !== 1 ? 's' : ''}`}
        </span>
        {expanded ? <ChevronDown className="ml-auto h-3 w-3" /> : <ChevronRight className="ml-auto h-3 w-3" />}
      </button>
      {expanded && (
        <div className="max-h-60 overflow-y-auto px-4 pb-3 space-y-2">
          {/* Pinned events */}
          {pinnedEvents.map((event) => {
            const nType = normalizeEventType(event.type);
            const Icon = ICON_MAP[nType] ?? Activity;
            const color = COLOR_MAP[nType] ?? 'text-zinc-400';
            return (
              <div key={event.id} className="flex items-start gap-2 rounded bg-zinc-800/50 p-2 text-xs group">
                <Icon className={`h-3 w-3 mt-0.5 ${color} shrink-0`} />
                <span className="text-zinc-300 truncate flex-1">{event.content.slice(0, 100)}</span>
                <button
                  onClick={() => activeSessionId && unpinEvent(activeSessionId, event.id)}
                  className="text-zinc-600 hover:text-amber-400 opacity-0 group-hover:opacity-100"
                >
                  <PinOff className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          {/* Pinned notes */}
          {unresolvedNotes.map((note) => (
            <div key={note.id} className="flex items-start gap-2 rounded bg-amber-500/5 border border-amber-500/10 p-2 text-xs group">
              <span className="rounded bg-amber-500/20 px-1 py-0.5 text-amber-400 shrink-0">{note.category}</span>
              <span className="text-zinc-300 flex-1">{note.content}</span>
              <button
                onClick={() => resolvePinnedNote(note.id)}
                className="text-zinc-600 hover:text-emerald-400 opacity-0 group-hover:opacity-100 text-[10px]"
              >
                Resolve
              </button>
            </div>
          ))}
          {/* Quick add note */}
          <div className="flex items-center gap-1 pt-1">
            <select
              value={noteCategory}
              onChange={(e) => setNoteCategory(e.target.value)}
              className="rounded bg-zinc-800 px-1.5 py-1 text-[10px] text-zinc-400 border border-zinc-700"
            >
              <option value="context">context</option>
              <option value="decision">decision</option>
              <option value="blocker">blocker</option>
              <option value="breakthrough">breakthrough</option>
              <option value="todo">todo</option>
              <option value="custom">custom</option>
            </select>
            <input
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && noteInput.trim() && activeSessionId) {
                  void addPinnedNote(activeSessionId, noteInput.trim(), noteCategory as never);
                  setNoteInput('');
                }
              }}
              placeholder="Add a note..."
              className="flex-1 rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 placeholder-zinc-600 border border-zinc-700 outline-none focus:border-amber-500/50"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main SessionViewer ────────────────────────────────────────── */

export function SessionViewer() {
  const {
    activeSession,
    events,
    eventTypeFilter,
    filterPreset,
    isLoading,
    isPolling,
    startPolling,
    stopPolling,
    searchQuery,
    compactMode,
    toggleCompactMode,
    pinnedEvents,
    pinEvent,
    unpinEvent,
  } = useSessionStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevEventCount = useRef(0);
  const [copied, setCopied] = useState(false);

  // Memoize pinned event IDs for fast lookup
  const pinnedIds = useMemo(() => new Set(pinnedEvents.map((e) => e.id)), [pinnedEvents]);

  // Stable pin toggle handler factory
  const handleTogglePin = useCallback(
    (eventId: string) => {
      if (!activeSession) return;
      if (pinnedIds.has(eventId)) {
        void unpinEvent(activeSession.id, eventId);
      } else {
        void pinEvent(activeSession.id, eventId);
      }
    },
    [activeSession, pinnedIds, pinEvent, unpinEvent],
  );

  // Auto-start polling when viewing an active session
  useEffect(() => {
    if (activeSession?.status === 'active') {
      startPolling(5000);
    }
    return () => stopPolling();
  }, [activeSession?.id, activeSession?.status, startPolling, stopPolling]);

  // Auto-scroll to top when new events arrive during live polling (newest first)
  useEffect(() => {
    if (events.length > prevEventCount.current && isPolling && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    prevEventCount.current = events.length;
  }, [events.length, isPolling]);

  const filteredEvents = useMemo(() => {
    // First: filter out noise (git fsmonitor cookies, zero-error diagnostics)
    let filtered = events.filter(e => !isNoiseEvent(e));

    // Apply preset filters
    if (filterPreset === 'conversation') {
      filtered = filtered.filter((e) => {
        const nType = normalizeEventType(e.type);
        return nType === 'message' || nType === 'thinking';
      });
    } else if (filterPreset === 'message:user') {
      filtered = filtered.filter((e) => {
        const nType = normalizeEventType(e.type);
        return nType === 'message' && (e.meta as unknown as Record<string, unknown>)?.role === 'user';
      });
    } else if (filterPreset === 'message:assistant') {
      filtered = filtered.filter((e) => {
        const nType = normalizeEventType(e.type);
        return nType === 'message' && (e.meta as unknown as Record<string, unknown>)?.role !== 'user';
      });
    } else if (!filterPreset && eventTypeFilter.size > 0) {
      // Multi-select: only include types in the set
      filtered = filtered.filter((e) => eventTypeFilter.has(normalizeEventType(e.type)));
    }
    // else filterPreset === 'all' → no type filtering

    // If searching within session, further filter by local search (client-side)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((e) =>
        e.content.toLowerCase().includes(q) ||
        JSON.stringify(e.meta).toLowerCase().includes(q)
      );
    }

    // Newest first — reverse chronological order
    return [...filtered].reverse();
  }, [events, eventTypeFilter, filterPreset, searchQuery]);

  // Copy filtered events as markdown
  const handleCopyFiltered = useCallback(async () => {
    if (!activeSession || filteredEvents.length === 0) return;
    // Events are reversed (newest first) — re-reverse for chronological markdown
    const chronological = [...filteredEvents].reverse();
    const md = eventsToMarkdown(chronological, activeSession.title);
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: create textarea
      const ta = document.createElement('textarea');
      ta.value = md;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [activeSession, filteredEvents]);

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

  const hasActiveFilter = filterPreset !== 'all' || eventTypeFilter.size > 0 || searchQuery.trim().length > 0;

  return (
    <div className="flex h-full flex-col">
      <SessionHeader />
      <EventFilter />
      <SearchBar />
      <PinnedPanel />

      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-1.5">
        {/* Compact mode toggle */}
        <button
          onClick={toggleCompactMode}
          className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
            compactMode ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
          }`}
          title={compactMode ? 'Standard view' : 'Compact view'}
        >
          {compactMode ? <Rows3 className="h-3 w-3" /> : <Rows4 className="h-3 w-3" />}
          {compactMode ? 'Compact' : 'Standard'}
        </button>

        {/* Copy filtered as markdown */}
        <button
          onClick={handleCopyFiltered}
          disabled={filteredEvents.length === 0}
          className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
            copied
              ? 'bg-emerald-500/20 text-emerald-300'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed'
          }`}
          title={`Copy ${hasActiveFilter ? 'filtered' : 'all'} events as markdown`}
        >
          {copied ? <Check className="h-3 w-3" /> : <ClipboardCopy className="h-3 w-3" />}
          {copied ? 'Copied!' : `Copy ${hasActiveFilter ? 'filtered' : 'all'}`}
        </button>

        <span className="ml-auto text-xs text-zinc-600">
          {filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''}
          {searchQuery && ` matching "${searchQuery}"`}
        </span>
      </div>

      {/* Live indicator */}
      {isPolling && activeSession?.status === 'active' && (
        <div className="flex items-center gap-2 border-b border-zinc-800 bg-blue-500/5 px-4 py-1.5">
          <Radio className="h-3 w-3 animate-pulse text-blue-400" />
          <span className="text-xs text-blue-400">Live — auto-refreshing every 2s</span>
          <button
            onClick={stopPolling}
            className="ml-auto text-xs text-zinc-500 hover:text-zinc-300"
          >
            Pause
          </button>
        </div>
      )}

      {/* Timeline */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
        {filteredEvents.length === 0 ? (
          <div className="text-center text-sm text-zinc-600">
            No events{hasActiveFilter ? ' matching current filters' : ''} in this session
          </div>
        ) : (
          <div>
            {filteredEvents.map((event, i) => (
              <EventRow
                key={event.id}
                event={event}
                isLast={i === filteredEvents.length - 1}
                compact={compactMode}
                isPinned={pinnedIds.has(event.id)}
                onTogglePin={() => handleTogglePin(event.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
