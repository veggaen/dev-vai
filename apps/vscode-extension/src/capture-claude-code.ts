/**
 * VeggaAI — Claude Code Session Capture
 *
 * Watches Claude Code's JSONL session files and pushes all conversation
 * content (user messages, assistant replies, tool calls, thinking) into Dev Logs.
 *
 * Claude Code stores sessions at:
 *   %APPDATA%\Roaming\Claude\projects\<project-slug>\<sessionId>.jsonl
 *   (Windows) C:\Users\<user>\.claude\projects\<hash>\<sessionId>.jsonl
 *
 * Format per line:
 *   { type: "user",      message: { content: [{ type: "text", text: "..." }] }, ... }
 *   { type: "assistant", message: { content: [{ type: "text", text: "..." } | { type: "tool_use", name: "...", input: {...} } | { type: "thinking", thinking: "..." }] }, ... }
 *   { type: "queue-operation" | "file-history-snapshot" | "ai-title" | "system" | "last-prompt" }
 *
 * We capture:
 * 1. User messages (type="user", content[].text)
 * 2. Assistant text replies (type="assistant", content[].type="text")
 * 3. Assistant thinking blocks (type="assistant", content[].type="thinking")
 * 4. Tool calls (type="assistant", content[].type="tool_use") → mapped to file/terminal/search events
 * 5. Session title (type="ai-title")
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pushEvent, getActiveSession, createSession, attachToSession, onSessionChange } from './session.js';
import { apiCall } from './api.js';

/* ── State ─────────────────────────────────────────────────────── */

interface TrackedSession {
  filePath: string;
  bytesRead: number;
  lastModified: number;
  claudeSessionId: string;
  devLogsSessionId?: string;
  title?: string;
}

const trackedSessions = new Map<string, TrackedSession>(); // key = claudeSessionId
let claudeProjectDir: string | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let disposed = false;
const pushedHashes = new Set<string>();
const MAX_HASH_CACHE = 5000;

// Buffer assistant text responses (same pattern as VS Code watcher — combine streaming fragments)
const pendingResponses = new Map<string, { text: string; timer: ReturnType<typeof setTimeout> | null }>();
const RESPONSE_SETTLE_MS = 1500; // Claude Code doesn't stream fragments the same way, 1.5s is enough

/* ── Init ──────────────────────────────────────────────────────── */

export function registerClaudeCodeWatcher(context: vscode.ExtensionContext): void {
  // Derive Claude Code project directory from workspace root
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return;

  // Claude Code uses a hash of the workspace path as the project key
  // Directory: ~/.claude/projects/<normalized-path>/
  const homeDir = os.homedir();
  const normalized = workspaceRoot.replace(/[:\\\/]/g, '-').replace(/^-/, '');
  claudeProjectDir = path.join(homeDir, '.claude', 'projects', normalized);

  if (!fs.existsSync(claudeProjectDir)) {
    // Try alternate normalization: C:\Users\foo\bar → c--Users-foo-bar
    const alt = workspaceRoot.replace(/:/g, '').replace(/[\\\/]/g, '-').replace(/^-/, '');
    const altDir = path.join(homeDir, '.claude', 'projects', alt);
    if (fs.existsSync(altDir)) {
      claudeProjectDir = altDir;
    } else {
      console.log(`[vai:claude-code] Claude Code project dir not found: ${claudeProjectDir}`);
      return;
    }
  }

  console.log(`[vai:claude-code] Watching Claude Code sessions at: ${claudeProjectDir}`);
  startPolling();
  context.subscriptions.push({ dispose: () => stopPolling() });
}

/* ── Polling ────────────────────────────────────────────────────── */

const POLL_MS = 2000; // Poll every 2s — Claude Code writes complete messages, not streaming fragments

function startPolling(): void {
  if (pollInterval) return;
  pollInterval = setInterval(() => {
    if (disposed || !claudeProjectDir) return;
    pollForNewContent();
  }, POLL_MS);
  // Immediate first scan
  pollForNewContent();
}

function stopPolling(): void {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  disposed = true;
  // Flush any buffered responses
  for (const [id, pending] of pendingResponses) {
    if (pending.timer) clearTimeout(pending.timer);
    flushResponse(id, pending.text);
  }
  pendingResponses.clear();
}

function pollForNewContent(): void {
  if (!claudeProjectDir) return;
  try {
    const entries = fs.readdirSync(claudeProjectDir);
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const sessionId = entry.replace('.jsonl', '');
      const filePath = path.join(claudeProjectDir, entry);
      try {
        const stat = fs.statSync(filePath);
        const tracked = trackedSessions.get(sessionId);
        if (!tracked) {
          // New session file — read from start to get title, then track from current position
          trackedSessions.set(sessionId, {
            filePath,
            bytesRead: 0, // Read from start to parse title and recent content
            lastModified: stat.mtimeMs,
            claudeSessionId: sessionId,
          });
          void readNewContent(sessionId);
        } else if (stat.size > tracked.bytesRead) {
          tracked.lastModified = stat.mtimeMs;
          void readNewContent(sessionId);
        }
      } catch { /* file inaccessible */ }
    }
  } catch { /* dir inaccessible */ }
}

/* ── Read Content ───────────────────────────────────────────────── */

async function readNewContent(sessionId: string): Promise<void> {
  const tracked = trackedSessions.get(sessionId);
  if (!tracked || disposed) return;

  try {
    const stat = fs.statSync(tracked.filePath);
    if (stat.size <= tracked.bytesRead) return;

    const newBytes = stat.size - tracked.bytesRead;
    const buf = Buffer.alloc(newBytes);
    const fd = fs.openSync(tracked.filePath, 'r');
    fs.readSync(fd, buf, 0, newBytes, tracked.bytesRead);
    fs.closeSync(fd);
    tracked.bytesRead = stat.size;

    const lines = buf.toString('utf8').split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        await processLine(obj, sessionId);
      } catch { /* partial/malformed line */ }
    }
  } catch (err) {
    console.error('[vai:claude-code] Read error:', err);
  }
}

/* ── Process Line ───────────────────────────────────────────────── */

async function processLine(obj: Record<string, unknown>, sessionId: string): Promise<void> {
  const type = obj.type as string;

  // Session title
  if (type === 'ai-title') {
    const title = obj.title as string | undefined;
    if (title) {
      const tracked = trackedSessions.get(sessionId);
      if (tracked) tracked.title = title;
      await ensureDevLogsSession(sessionId, title);
    }
    return;
  }

  // User message
  if (type === 'user') {
    const content = (obj.message as any)?.content;
    const text = extractTextFromContent(content);
    if (text && text.length >= 5) {
      await ensureDevLogsSession(sessionId, 'Claude Code Session');
      handleUserMessage(text, sessionId);
    }
    return;
  }

  // Assistant message
  if (type === 'assistant') {
    const content = (obj.message as any)?.content;
    if (!Array.isArray(content)) return;
    await ensureDevLogsSession(sessionId, 'Claude Code Session');

    for (const item of content) {
      if (!item || typeof item !== 'object') continue;

      // Text response
      if (item.type === 'text' && typeof item.text === 'string' && item.text.length > 20) {
        bufferResponse(sessionId, item.text);
      }

      // Thinking block
      if (item.type === 'thinking' && typeof item.thinking === 'string' && item.thinking.length > 20) {
        handleThinkingBlock(item.thinking, sessionId);
      }

      // Tool use
      if (item.type === 'tool_use') {
        handleToolUse(item, sessionId);
      }
    }
    return;
  }
}

/* ── Session Management ─────────────────────────────────────────── */

async function ensureDevLogsSession(claudeSessionId: string, title: string): Promise<void> {
  const tracked = trackedSessions.get(claudeSessionId);
  if (!tracked) return;

  // Already mapped
  if (tracked.devLogsSessionId) {
    const current = getActiveSession();
    if (current?.id !== tracked.devLogsSessionId) {
      await attachToSession(tracked.devLogsSessionId, tracked.title ?? title);
    }
    return;
  }

  // Map to existing active session if it's recent
  const existing = getActiveSession();
  const sessionAge = existing ? Date.now() - existing.createdAt : Infinity;
  if (existing && sessionAge < 120_000) {
    tracked.devLogsSessionId = existing.id;
    if (tracked.title && tracked.title !== existing.title) {
      try {
        await apiCall(`/api/sessions/${existing.id}`, 'PATCH', {
          title: tracked.title ?? title,
          description: `Claude Code session: ${claudeSessionId.slice(0, 8)}`,
        });
      } catch { /* silent */ }
    }
    return;
  }

  // Create new
  try {
    const sessionId = await createSession(tracked.title ?? title);
    tracked.devLogsSessionId = sessionId;
    pushEvent('state-change', `Claude Code session started`, {
      state: 'Active',
      detail: `Claude Code: ${claudeSessionId.slice(0, 8)}`,
      source: 'claude-code-watcher',
      claudeSessionId,
    });
  } catch { /* runtime not available */ }
}

/* ── Event Handlers ─────────────────────────────────────────────── */

function handleUserMessage(text: string, _sessionId: string): void {
  const hash = simpleHash(text.slice(0, 300));
  if (pushedHashes.has(hash)) return;
  addHash(hash);
  if (!getActiveSession()) return;

  pushEvent('message', text, {
    eventType: 'message',
    role: 'user',
    source: 'claude-code-watcher',
    charCount: text.length,
    autoCapture: true,
  });

  // Frustration/success signal detection
  const FRUSTRATION_RE = /\b(?:no(?:pe)?|wrong|broken|doesn'?t work|still (?:broken|failing)|that'?s not right|not what I (?:meant|asked)|try again|same (?:issue|error))\b/i;
  const SUCCESS_RE = /\b(?:thanks?|thank you|perfect|great|awesome|works?(?:ing)?|that(?:'s| is) (?:it|right|correct)|exactly|fixed)\b/i;

  if (FRUSTRATION_RE.test(text)) {
    pushEvent('note', `[frustration] ${text.slice(0, 120)}`, {
      eventType: 'note', author: 'user-signal-detector', signalType: 'frustration',
      source: 'claude-code-watcher', autoCapture: true,
    });
  } else if (SUCCESS_RE.test(text)) {
    pushEvent('note', `[success] ${text.slice(0, 120)}`, {
      eventType: 'note', author: 'user-signal-detector', signalType: 'success',
      source: 'claude-code-watcher', autoCapture: true,
    });
  }
}

function bufferResponse(sessionId: string, text: string): void {
  const existing = pendingResponses.get(sessionId);
  if (existing?.timer) clearTimeout(existing.timer);
  const combined = existing ? (existing.text.length >= text.length ? existing.text : text) : text;
  const timer = setTimeout(() => flushResponse(sessionId, combined), RESPONSE_SETTLE_MS);
  pendingResponses.set(sessionId, { text: combined, timer });
}

function flushResponse(sessionId: string, text: string): void {
  pendingResponses.delete(sessionId);
  if (!text || text.length < 50 || !getActiveSession()) return;

  const hash = simpleHash(text.slice(0, 300));
  if (pushedHashes.has(hash)) return;
  addHash(hash);

  pushEvent('message', text.length > 100_000 ? text.slice(0, 100_000) + '\n\n[truncated]' : text, {
    eventType: 'message',
    role: 'assistant',
    source: 'claude-code-watcher',
    charCount: text.length,
    autoCapture: true,
  });

  // Detect plans in response
  detectPlan(text);
}

function handleThinkingBlock(thinking: string, _sessionId: string): void {
  const hash = simpleHash(thinking.slice(0, 200));
  if (pushedHashes.has(hash)) return;
  addHash(hash);
  if (!getActiveSession()) return;

  pushEvent('thinking', thinking, {
    source: 'claude-code-watcher',
    charCount: thinking.length,
    autoCapture: true,
  });
}

// Maps Claude Code tool names → dev-logs event types
const TOOL_MAP: Record<string, string> = {
  Read: 'file-read',
  Write: 'file-create',
  Edit: 'file-edit',
  Bash: 'terminal',
  Grep: 'search',
  Glob: 'search',
  Agent: 'context-gather',
  WebFetch: 'context-gather',
  WebSearch: 'search',
  TodoWrite: 'todo-update',
};

function handleToolUse(item: Record<string, unknown>, _sessionId: string): void {
  if (!getActiveSession()) return;
  const toolName = item.name as string;
  const input = item.input as Record<string, unknown> ?? {};

  const msg = buildToolMessage(toolName, input);
  if (!msg) return;

  const hash = simpleHash(msg.slice(0, 200));
  if (pushedHashes.has(hash)) return;
  addHash(hash);

  const eventType = TOOL_MAP[toolName] ?? 'tool-call';

  const meta: Record<string, unknown> = {
    source: 'claude-code-watcher',
    toolName,
    autoCapture: true,
  };

  // Enrich meta per tool
  if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
    meta.filePath = input.file_path ?? input.path;
  }
  if (toolName === 'Bash') {
    meta.command = input.command;
  }
  if (toolName === 'Grep' || toolName === 'Glob' || toolName === 'WebSearch') {
    meta.query = input.pattern ?? input.query ?? msg;
    meta.searchType = toolName === 'Grep' ? 'grep' : toolName === 'Glob' ? 'file' : 'semantic';
  }
  if (toolName === 'TodoWrite') {
    const todos = (input.todos as Array<{ id: string; content: string; status: string }>) ?? [];
    meta.todos = todos.map(t => ({ id: t.id, title: t.content, status: t.status }));
  }

  pushEvent(eventType as any, msg, meta);
}

function buildToolMessage(toolName: string, input: Record<string, unknown>): string | null {
  switch (toolName) {
    case 'Read': return `Read: ${input.file_path ?? input.path ?? '?'}`;
    case 'Write': return `Write: ${input.file_path ?? '?'}`;
    case 'Edit': return `Edit: ${input.file_path ?? '?'}`;
    case 'Bash': return typeof input.command === 'string' ? input.command.slice(0, 200) : null;
    case 'Grep': return `grep: ${input.pattern ?? '?'} in ${input.path ?? '.'}`;
    case 'Glob': return `glob: ${input.pattern ?? '?'}`;
    case 'Agent': return `Agent: ${(input.description as string ?? input.subagent_type ?? 'sub-agent').slice(0, 80)}`;
    case 'WebFetch': return `Fetch: ${input.url ?? '?'}`;
    case 'WebSearch': return `Search: ${input.query ?? '?'}`;
    case 'TodoWrite': return `Todo update: ${((input.todos as any[]) ?? []).length} items`;
    default: return null;
  }
}

function detectPlan(text: string): void {
  const stepMatches = text.slice(0, 3000).match(/(?:^|\n)\s*\d+\.\s+\S.+/g);
  if (!stepMatches || stepMatches.length < 3) return;
  const steps = stepMatches.map(m => m.match(/\d+\.\s+(.+)/)?.[1]?.trim().slice(0, 120) ?? '').filter(Boolean);
  const planHash = simpleHash(`plan:${steps[0]}:${steps.length}`);
  if (pushedHashes.has(planHash)) return;
  addHash(planHash);
  pushEvent('planning' as any, `Plan: ${steps[0]} (${steps.length} steps)`, {
    intent: steps[0],
    approach: '',
    steps,
    source: 'claude-code-watcher',
    autoCapture: true,
  });
}

/* ── Helpers ────────────────────────────────────────────────────── */

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((c: any) => c?.type === 'text' && typeof c.text === 'string')
    .map((c: any) => c.text)
    .join('\n\n');
}

function simpleHash(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function addHash(hash: string): void {
  if (pushedHashes.size > MAX_HASH_CACHE) {
    const first = pushedHashes.values().next().value;
    if (first) pushedHashes.delete(first);
  }
  pushedHashes.add(hash);
}

/* ── Public: list Claude Code sessions available ─────────────────── */

export function getClaudeCodeSessions(): Array<{ id: string; title?: string; filePath: string }> {
  return [...trackedSessions.values()].map(s => ({
    id: s.claudeSessionId,
    title: s.title,
    filePath: s.filePath,
  }));
}
