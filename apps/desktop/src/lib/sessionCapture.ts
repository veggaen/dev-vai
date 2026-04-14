/**
 * Session Capture Utility — VeggaAI Dev Logs
 *
 * Provides a convenient API for capturing agent activity into a session.
 * This is the bridge between agent actions and the session event log.
 *
 * Usage:
 *   const capture = createSessionCapture(sessionId);
 *   capture.thinking('Evaluating approach...', { intent: 'Fix the bug' });
 *   capture.planning('Fix PERN await bug', 'Split async callback', ['Read file', 'Edit', 'Test']);
 *   capture.fileCreate('/src/App.tsx', 45, 'tsx');
 *   capture.terminal('npm run build', 0, 'Build succeeded');
 */

import { useSessionStore } from '../stores/sessionStore.js';
import type {
  SessionEventType,
  MessageMeta,
  ThinkingMeta,
  PlanningMeta,
  ContextGatherMeta,
  CheckpointMeta,
  VerificationMeta,
  RecoveryMeta,
  ArtifactMeta,
  FileCreateMeta,
  FileEditMeta,
  FileReadMeta,
  TerminalMeta,
  SearchMeta,
  TodoUpdateMeta,
  TodoItem,
  StateChangeMeta,
  ErrorMeta,
  ToolCallMeta,
  SummaryMeta,
  NoteMeta,
  EventMeta,
} from '@vai/core/browser';

/* ── Types ─────────────────────────────────────────────────────── */

interface CaptureOptions {
  /** Session ID to write events to */
  sessionId: string;
  /** If true, batch events and flush periodically (default: false) */
  batched?: boolean;
  /** Flush interval in ms when batched (default: 1000) */
  flushInterval?: number;
}

interface PendingEvent {
  type: SessionEventType;
  content: string;
  meta?: EventMeta;
}

/* ── Session Capture Class ─────────────────────────────────────── */

export class SessionCapture {
  private sessionId: string;
  private buffer: PendingEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private batched: boolean;

  constructor(options: CaptureOptions) {
    this.sessionId = options.sessionId;
    this.batched = options.batched ?? false;

    if (this.batched) {
      this.flushTimer = setInterval(
        () => void this.flush(),
        options.flushInterval ?? 1000,
      );
    }
  }

  /* ── Core ──────────────────────────────────────────────────── */

  private push(type: SessionEventType, content: string, meta?: EventMeta) {
    const event: PendingEvent = { type, content, meta };

    if (this.batched) {
      this.buffer.push(event);
    } else {
      void useSessionStore.getState().pushEvents(this.sessionId, [event]);
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = [...this.buffer];
    this.buffer = [];
    await useSessionStore.getState().pushEvents(this.sessionId, batch);
  }

  dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Final flush
    void this.flush();
  }

  /* ── Convenience Capture Methods ───────────────────────────── */

  /** Log a thinking block with optional reasoning context */
  thinking(
    content: string,
    opts: { label?: string; intent?: string; reasoning?: string; constraints?: string[] } = {},
  ) {
    const meta: ThinkingMeta = {
      eventType: 'thinking',
      label: opts.label,
      intent: opts.intent,
      reasoning: opts.reasoning,
      constraints: opts.constraints,
    };
    this.push('thinking', content, meta);
  }

  /** Log agent planning / intent analysis */
  planning(
    intent: string,
    approach: string,
    steps?: string[],
    decisions?: string[],
  ) {
    const meta: PlanningMeta = {
      eventType: 'planning',
      intent,
      approach,
      steps,
      decisions,
    };
    this.push('planning', `Planning: ${intent}`, meta);
  }

  /** Log context gathering (reading files, searching) */
  contextGather(
    findings: string,
    filesRead: string[] = [],
    queriesRun: string[] = [],
  ) {
    const meta: ContextGatherMeta = {
      eventType: 'context-gather',
      filesRead,
      queriesRun,
      findings,
    };
    this.push('context-gather', findings, meta);
  }

  /** Log a builder lifecycle checkpoint */
  checkpoint(
    content: string,
    opts: {
      checkpoint: string;
      status: 'started' | 'completed' | 'failed';
      detail?: string;
      sandboxProjectId?: string;
      conversationId?: string;
      files?: string[];
      port?: number;
    },
  ) {
    const meta: CheckpointMeta = {
      eventType: 'checkpoint',
      checkpoint: opts.checkpoint,
      status: opts.status,
      detail: opts.detail,
      sandboxProjectId: opts.sandboxProjectId,
      conversationId: opts.conversationId,
      files: opts.files,
      port: opts.port,
    };
    this.push('checkpoint', content, meta);
  }

  /** Log the outcome of a verification / proof step */
  verification(
    content: string,
    opts: {
      target: 'dev-server' | 'preview-runtime' | 'template-preview' | 'deploy-preview' | 'sandbox-link';
      status: 'started' | 'passed' | 'failed';
      port?: number;
      timeoutMs?: number;
      evidence?: string[];
    },
  ) {
    const meta: VerificationMeta = {
      eventType: 'verification',
      target: opts.target,
      status: opts.status,
      port: opts.port,
      timeoutMs: opts.timeoutMs,
      evidence: opts.evidence,
    };
    this.push('verification', content, meta);
  }

  /** Log an automatic recovery attempt and its outcome */
  recovery(
    content: string,
    opts: {
      strategy: string;
      status: 'triggered' | 'succeeded' | 'failed';
      attempt?: number;
      maxAttempts?: number;
      reason?: string;
      port?: number;
      files?: string[];
    },
  ) {
    const meta: RecoveryMeta = {
      eventType: 'recovery',
      strategy: opts.strategy,
      status: opts.status,
      attempt: opts.attempt,
      maxAttempts: opts.maxAttempts,
      reason: opts.reason,
      port: opts.port,
      files: opts.files,
    };
    this.push('recovery', content, meta);
  }

  /** Log a durable artifact generated by the builder flow */
  artifact(
    content: string,
    opts: {
      artifactType: string;
      label?: string;
      value?: string;
      itemCount?: number;
    },
  ) {
    const meta: ArtifactMeta = {
      eventType: 'artifact',
      artifactType: opts.artifactType,
      label: opts.label,
      value: opts.value,
      itemCount: opts.itemCount,
    };
    this.push('artifact', content, meta);
  }

  /** Log a chat message */
  message(role: 'user' | 'assistant', content: string, modelId?: string) {
    const meta: MessageMeta = { eventType: 'message', role, modelId };
    this.push('message', content, meta);
  }

  /** Log file creation */
  fileCreate(filePath: string, linesAdded: number, language?: string, sizeBytes?: number) {
    const meta: FileCreateMeta = {
      eventType: 'file-create',
      filePath,
      linesAdded,
      language,
      sizeBytes,
    };
    this.push('file-create', `Created ${filePath}`, meta);
  }

  /** Log file edit with optional diff */
  fileEdit(
    filePath: string,
    linesAdded: number,
    linesRemoved: number,
    oldString?: string,
    newString?: string,
  ) {
    const meta: FileEditMeta = {
      eventType: 'file-edit',
      filePath,
      linesAdded,
      linesRemoved,
      oldString,
      newString,
    };
    this.push('file-edit', `Edited ${filePath} (+${linesAdded}/-${linesRemoved})`, meta);
  }

  /** Log file read */
  fileRead(filePath: string, startLine?: number, endLine?: number) {
    const meta: FileReadMeta = {
      eventType: 'file-read',
      filePath,
      startLine,
      endLine,
    };
    this.push('file-read', `Read ${filePath}`, meta);
  }

  /** Log file deletion */
  fileDelete(filePath: string) {
    this.push('file-delete', `Deleted ${filePath}`, {
      eventType: 'file-delete',
    } as EventMeta);
  }

  /** Log terminal command */
  terminal(command: string, exitCode?: number, output?: string) {
    const meta: TerminalMeta = {
      eventType: 'terminal',
      command,
      exitCode,
      output: output?.slice(0, 5000), // Cap output at 5KB
    };
    this.push('terminal', `$ ${command}`, meta);
  }

  /** Log a code search */
  search(
    query: string,
    searchType: 'grep' | 'semantic' | 'file' | 'subagent',
    resultCount?: number,
  ) {
    const meta: SearchMeta = {
      eventType: 'search',
      query,
      searchType,
      resultCount,
    };
    this.push('search', query, meta);
  }

  /** Log todo list update */
  todoUpdate(todos: TodoItem[]) {
    const completed = todos.filter((t) => t.status === 'completed').length;
    const meta: TodoUpdateMeta = {
      eventType: 'todo-update',
      todos,
    };
    this.push('todo-update', `Todos: ${completed}/${todos.length} completed`, meta);
  }

  /** Log agent state change (status label) */
  stateChange(state: string, detail?: string) {
    const meta: StateChangeMeta = {
      eventType: 'state-change',
      state,
      detail,
    };
    this.push('state-change', state, meta);
  }

  /** Log an error */
  error(message: string, opts: { filePath?: string; line?: number; errorType?: string } = {}) {
    const meta: ErrorMeta = {
      eventType: 'error',
      errorType: opts.errorType,
      filePath: opts.filePath,
      line: opts.line,
    };
    this.push('error', message, meta);
  }

  /** Log a generic tool call */
  toolCall(toolName: string, parameters?: Record<string, unknown>, result?: string) {
    const meta: ToolCallMeta = {
      eventType: 'tool-call',
      toolName,
      parameters,
      result,
    };
    this.push('tool-call', `Tool: ${toolName}`, meta);
  }

  /** Log conversation summary (compaction event) */
  summary(content: string, originalMessageCount?: number, compressedTo?: number) {
    const meta: SummaryMeta = {
      eventType: 'summary',
      originalMessageCount: originalMessageCount ?? 0,
      compressedTo: compressedTo ?? 0,
    };
    this.push('summary', content, meta);
  }

  /** Log a free-form note / annotation */
  note(content: string) {
    const meta: NoteMeta = { eventType: 'note' };
    this.push('note', content, meta);
  }

  /** Update the session title */
  async updateTitle(title: string): Promise<void> {
    await useSessionStore.getState().updateTitle(this.sessionId, title);
  }
}

/* ── Factory ───────────────────────────────────────────────────── */

/**
 * Create a new SessionCapture instance for a given session.
 *
 * @example
 * const capture = createSessionCapture('ses_abc123');
 * capture.thinking('Analyzing the codebase...', { label: 'Evaluating' });
 * capture.planning('Build session logger', 'Add types → capture utility → UI', [
 *   'Expand event types',
 *   'Build capture utility',
 *   'Add live polling',
 * ]);
 */
export function createSessionCapture(
  sessionId: string,
  options?: Omit<CaptureOptions, 'sessionId'>,
): SessionCapture {
  return new SessionCapture({ sessionId, ...options });
}

/* ── Global Capture Singleton ──────────────────────────────────── */

let _activeCapture: SessionCapture | null = null;

/** Get or create the global active session capture */
export function getActiveCapture(): SessionCapture | null {
  return _activeCapture;
}

/** Set the global active session capture */
export function setActiveCapture(capture: SessionCapture | null): void {
  // Dispose previous if exists
  if (_activeCapture && _activeCapture !== capture) {
    _activeCapture.dispose();
  }
  _activeCapture = capture;
}

/** Quick access: start a new session and capture instance */
export async function startSessionCapture(
  title: string,
  agentName: string,
  modelId: string,
  options?: Omit<CaptureOptions, 'sessionId'>,
): Promise<SessionCapture | null> {
  const id = await useSessionStore.getState().createSession(title, agentName, modelId);
  if (!id) return null;

  const capture = createSessionCapture(id, options);
  setActiveCapture(capture);
  return capture;
}
