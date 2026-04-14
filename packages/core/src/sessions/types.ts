/**
 * Agent Session Logger — Data Model
 *
 * Captures everything that happens during an AI agent coding session:
 * - User messages and agent responses
 * - Thinking / reasoning blocks
 * - File operations (create, edit, read) with diffs
 * - Terminal commands and output
 * - Todo / task tracking snapshots
 * - Agent state changes (Working, Processing, Evaluating, etc.)
 *
 * Designed to replay and learn from how agents work.
 */

/* ── Session (top-level container) ─────────────────────────────── */

export interface AgentSession {
  id: string;
  title: string;
  description?: string;
  agentName: string;           // e.g. "GitHub Copilot", "Claude Code", "Augment"
  modelId: string;             // e.g. "claude-opus-4.6", "gpt-5.1"
  startedAt: number;           // epoch ms
  endedAt?: number;            // epoch ms
  lastActivityAt?: number;     // epoch ms — latest event timestamp
  status: 'active' | 'completed' | 'failed';

  /** Aggregate stats computed from events */
  stats: SessionStats;

  /** Tags for filtering/search */
  tags: string[];
}

export interface SessionStats {
  messageCount: number;
  filesCreated: number;
  filesModified: number;
  filesRead: number;
  terminalCommands: number;
  thinkingBlocks: number;
  totalTokensEstimate?: number;
  totalDurationMs: number;
  linesAdded: number;
  linesRemoved: number;
  todosCompleted: number;
  todosTotal: number;
  errorsEncountered: number;
  verificationsRun?: number;
  verificationsPassed?: number;
  recoveriesTriggered?: number;
  recoveriesSucceeded?: number;
  checkpointsRecorded?: number;
  artifactsCaptured?: number;
}

/* ── Session Events (individual actions / log entries) ─────────── */

export type SessionEventType =
  | 'message'        // User or assistant chat message
  | 'thinking'       // Agent reasoning / thinking block
  | 'planning'       // Agent planning / intent analysis
  | 'context-gather' // Reading codebase for context
  | 'checkpoint'     // Builder lifecycle checkpoint
  | 'verification'   // Proof / validation result
  | 'recovery'       // Recovery or rollback attempt
  | 'artifact'       // Durable artifact produced by the workflow
  | 'file-create'    // File created
  | 'file-edit'      // File modified (with diff info)
  | 'file-read'      // File read for context
  | 'file-delete'    // File deleted
  | 'terminal'       // Terminal command executed
  | 'search'         // Code search performed
  | 'todo-update'    // Todo list changed
  | 'state-change'   // Agent state (Working, Processing, Evaluating...)
  | 'error'          // Error / failure
  | 'tool-call'      // Generic tool invocation
  | 'summary'        // Summarization event (conversation was summarized)
  | 'note';          // Free-form annotation

export interface SessionEvent {
  id: string;
  sessionId: string;
  type: SessionEventType;
  timestamp: number;           // epoch ms
  durationMs?: number;         // how long this action took

  /** The primary text content */
  content: string;

  /** Type-specific structured data */
  meta: EventMeta;
}

/* ── Event Meta (type-discriminated) ──────────────────────────── */

export type EventMeta =
  | MessageMeta
  | ThinkingMeta
  | PlanningMeta
  | ContextGatherMeta
  | CheckpointMeta
  | VerificationMeta
  | RecoveryMeta
  | ArtifactMeta
  | FileCreateMeta
  | FileEditMeta
  | FileReadMeta
  | FileDeleteMeta
  | TerminalMeta
  | SearchMeta
  | TodoUpdateMeta
  | StateChangeMeta
  | ErrorMeta
  | ToolCallMeta
  | SummaryMeta
  | NoteMeta;

export interface MessageMeta {
  eventType: 'message';
  role: 'user' | 'assistant';
  modelId?: string;
}

export interface ThinkingMeta {
  eventType: 'thinking';
  label?: string;              // e.g. "Evaluating...", "Analyzing..."
  reasoning?: string;          // Full chain-of-thought reasoning
  intent?: string;             // What the agent intends to do
  constraints?: string[];      // Constraints the agent identified
}

export interface PlanningMeta {
  eventType: 'planning';
  intent: string;              // What the user wants
  approach: string;            // How the agent plans to do it
  steps?: string[];            // Planned steps
  decisions?: string[];        // Key technical decisions made
}

export interface ContextGatherMeta {
  eventType: 'context-gather';
  filesRead: string[];         // Files examined
  queriesRun: string[];        // Search queries executed
  findings: string;            // What was discovered
}

export interface CheckpointMeta {
  eventType: 'checkpoint';
  checkpoint: string;
  status: 'started' | 'completed' | 'failed';
  detail?: string;
  sandboxProjectId?: string;
  conversationId?: string;
  files?: string[];
  port?: number;
}

export interface VerificationMeta {
  eventType: 'verification';
  target: 'dev-server' | 'preview-runtime' | 'template-preview' | 'deploy-preview' | 'sandbox-link';
  status: 'started' | 'passed' | 'failed';
  port?: number;
  timeoutMs?: number;
  evidence?: string[];
}

export interface RecoveryMeta {
  eventType: 'recovery';
  strategy: string;
  status: 'triggered' | 'succeeded' | 'failed';
  attempt?: number;
  maxAttempts?: number;
  reason?: string;
  port?: number;
  files?: string[];
}

export interface ArtifactMeta {
  eventType: 'artifact';
  artifactType: string;
  label?: string;
  value?: string;
  itemCount?: number;
}

export interface FileCreateMeta {
  eventType: 'file-create';
  filePath: string;
  linesAdded: number;
  language?: string;           // file extension / language
  sizeBytes?: number;
}

export interface FileEditMeta {
  eventType: 'file-edit';
  filePath: string;
  linesAdded: number;
  linesRemoved: number;
  /** The old and new strings for this edit */
  oldString?: string;
  newString?: string;
}

export interface FileReadMeta {
  eventType: 'file-read';
  filePath: string;
  startLine?: number;
  endLine?: number;
}

export interface FileDeleteMeta {
  eventType: 'file-delete';
  filePath: string;
}

export interface TerminalMeta {
  eventType: 'terminal';
  command: string;
  exitCode?: number;
  cwd?: string;
  output?: string;             // truncated to keep size manageable
}

export interface SearchMeta {
  eventType: 'search';
  query: string;
  searchType: 'grep' | 'semantic' | 'file' | 'subagent';
  resultCount?: number;
}

export interface TodoUpdateMeta {
  eventType: 'todo-update';
  todos: TodoItem[];
}

export interface TodoItem {
  id: number;
  title: string;
  status: 'not-started' | 'in-progress' | 'completed';
}

export interface StateChangeMeta {
  eventType: 'state-change';
  state: string;               // e.g. "Working...", "Processing...", "Preparing..."
  detail?: string;
}

export interface ErrorMeta {
  eventType: 'error';
  errorType?: string;
  filePath?: string;
  line?: number;
}

export interface ToolCallMeta {
  eventType: 'tool-call';
  toolName: string;
  parameters?: Record<string, unknown>;
  result?: string;             // truncated result
}

export interface SummaryMeta {
  eventType: 'summary';
  originalMessageCount: number;
  compressedTo: number;
}

export interface NoteMeta {
  eventType: 'note';
  author?: string;
}

/* ── Pinned Notes (cross-session decision/blocker tracking) ──── */

export type PinnedNoteCategory =
  | 'decision'
  | 'blocker'
  | 'breakthrough'
  | 'todo'
  | 'context'
  | 'custom';

export interface PinnedNote {
  id: string;
  sessionId: string;
  eventId?: string;           // optional reference to a specific event
  content: string;
  category: PinnedNoteCategory;
  createdAt: number;          // epoch ms
  resolved: boolean;
}

/* ── Context Summary (for agents bootstrapping context) ──────── */

export interface ContextSummary {
  recentSessions: Array<{
    id: string;
    title: string;
    status: string;
    startedAt: number;
    endedAt?: number;
    stats: SessionStats;
    keyDecisions: string[];
    filesTouched: string[];
    errors: string[];
  }>;
  unresolvedNotes: PinnedNote[];
  totalSessions: number;
  totalEvents: number;
  cognitiveContext?: string;
}

/* ── Search Result ──────────────────────────────────────────── */

export interface SearchResult {
  event: SessionEvent;
  sessionTitle: string;
  sessionId: string;
  matchScore: number;         // 0-1 relevance
}

/* ── Helper to create events ──────────────────────────────────── */

let _eventCounter = 0;

export function createEventId(): string {
  return `evt_${Date.now()}_${++_eventCounter}`;
}

export function createSessionId(): string {
  return `ses_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createPinnedNoteId(): string {
  return `pin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ── Icon & color mapping for event types ─────────────────────── */

export const EVENT_TYPE_CONFIG: Record<
  SessionEventType,
  { icon: string; color: string; label: string }
> = {
  message:          { icon: 'MessageSquare', color: 'blue',    label: 'Message'   },
  thinking:         { icon: 'Brain',         color: 'purple',  label: 'Thinking'  },
  planning:         { icon: 'Compass',       color: 'violet',  label: 'Planning'  },
  'context-gather': { icon: 'BookOpen',      color: 'teal',    label: 'Context'   },
  checkpoint:       { icon: 'Flag',          color: 'yellow',  label: 'Checkpoint' },
  verification:     { icon: 'ShieldCheck',   color: 'emerald', label: 'Proof'     },
  recovery:         { icon: 'RotateCcw',     color: 'amber',   label: 'Recovery'  },
  artifact:         { icon: 'Archive',       color: 'pink',    label: 'Artifact'  },
  'file-create':    { icon: 'FilePlus',      color: 'emerald', label: 'Created'   },
  'file-edit':      { icon: 'FileEdit',      color: 'amber',   label: 'Edited'    },
  'file-read':      { icon: 'FileSearch',    color: 'zinc',    label: 'Read'      },
  'file-delete':    { icon: 'FileX',         color: 'red',     label: 'Deleted'   },
  terminal:         { icon: 'Terminal',       color: 'green',   label: 'Terminal'  },
  search:           { icon: 'Search',        color: 'cyan',    label: 'Search'    },
  'todo-update':    { icon: 'ListChecks',    color: 'indigo',  label: 'Todos'     },
  'state-change':   { icon: 'Activity',      color: 'yellow',  label: 'Status'    },
  error:            { icon: 'AlertTriangle', color: 'red',     label: 'Error'     },
  'tool-call':      { icon: 'Wrench',        color: 'orange',  label: 'Tool'      },
  summary:          { icon: 'FileText',      color: 'slate',   label: 'Summary'   },
  note:             { icon: 'StickyNote',    color: 'pink',    label: 'Note'      },
};
