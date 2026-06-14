#!/usr/bin/env node
/**
 * VS Code Session Bridge — bulk-import VS Code Chat, Copilot, and Claude Code sessions
 * for the dev-vai workspace into VeggaAI Dev Logs.
 *
 * Sources (dev-vai only):
 *   1. %APPDATA%/Code/User/workspaceStorage/<hash>/chatSessions/*.jsonl  (vscode-chat)
 *   2. .../GitHub.copilot-chat/transcripts/*.jsonl                       (vscode-copilot, if no chatSessions file)
 *   3. %USERPROFILE%/.claude/projects/c--Users-v3gga-Documents-dev-vai/*.jsonl (vscode-claude)
 *
 * Usage:
 *   node scripts/vscode-session-bridge.mjs sync [sourceKey]
 *   node scripts/vscode-session-bridge.mjs resync [sourceKey]
 *   node scripts/vscode-session-bridge.mjs watch
 *   node scripts/vscode-session-bridge.mjs list
 */

import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
} from 'node:fs';
import { createInterface } from 'node:readline';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = join(__dirname, '..');
const SYNC_STATE_FILE = join(WORKSPACE_ROOT, '.vai-vscode-sync.json');
const API_BASE = process.env.VAI_API_BASE || 'http://localhost:3006';
const MAX_CONTENT = 100_000;
const MIN_FILE_BYTES = 128;

async function api(path, method = 'GET', body = undefined) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

function loadSyncState() {
  try {
    return JSON.parse(readFileSync(SYNC_STATE_FILE, 'utf8'));
  } catch {
    return { sessions: {}, lineCounts: {}, titles: {} };
  }
}

function saveSyncState(state) {
  mkdirSync(dirname(SYNC_STATE_FILE), { recursive: true });
  writeFileSync(SYNC_STATE_FILE, JSON.stringify(state, null, 2));
}

function workspaceTag() {
  return `workspace:${basename(WORKSPACE_ROOT)}`;
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

function findDevVaiWorkspaceStorage() {
  const roots = [
    join(process.env.APPDATA || '', 'Code', 'User', 'workspaceStorage'),
    join(process.env.APPDATA || '', 'Cursor', 'User', 'workspaceStorage'),
  ];
  for (const wsRoot of roots) {
    if (!existsSync(wsRoot)) continue;
    for (const dir of readdirSync(wsRoot, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      try {
        const wsJson = JSON.parse(readFileSync(join(wsRoot, dir.name, 'workspace.json'), 'utf8'));
        if (wsJson.folder?.includes('dev-vai')) {
          return join(wsRoot, dir.name);
        }
      } catch { /* skip */ }
    }
  }
  return null;
}

function claudeProjectDir() {
  const slug = 'c--Users-v3gga-Documents-dev-vai';
  const dir = join(homedir(), '.claude', 'projects', slug);
  return existsSync(dir) ? dir : null;
}

function truncateTitle(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'VS Code session';
  return clean.length <= 72 ? clean : `${clean.slice(0, 69)}…`;
}

function isHumanTitle(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length < 12) return false;
  return !(
    /^<ide_selection>/i.test(clean)
    || /^<ide_opened_file>/i.test(clean)
    || /^You MUST read/i.test(clean)
    || /^\[Image\]/i.test(clean)
    || /^#\s*Files mentioned/i.test(clean)
    || /^#\s*AGENTS\.md/i.test(clean)
    || /^<environment_context>/i.test(clean)
    || /^## My request for Codex:/i.test(clean)
    || /^INSTRUCTIONS\b/i.test(clean)
  );
}

function extractCodexUserTitle(text) {
  const match = text.match(/## My request for Codex:\s*([\s\S]{20,400}?)(?:\.\.\.|'|$|\n\n)/i);
  if (match?.[1]) {
    const candidate = match[1].replace(/\s+/g, ' ').trim();
    if (isHumanTitle(candidate)) return truncateTitle(candidate);
  }
  const stripped = text
    .replace(/^#\s*Files mentioned[\s\S]*?## My request for Codex:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (isHumanTitle(stripped)) return truncateTitle(stripped.slice(0, 120));
  return null;
}

function isIdStubTitle(title, sessionId) {
  if (!title?.trim()) return true;
  const t = title.trim();
  if (t === sessionId.slice(0, 8)) return true;
  if (/^[0-9a-f]{8}$/i.test(t)) return true;
  if (/^Copilot · [0-9a-f]{8}$/i.test(t)) return true;
  if (/^Claude Code · [0-9a-f]{8}$/i.test(t)) return true;
  if (/^VS Code · [0-9a-f]{8}$/i.test(t)) return true;
  if (/^Codex · 20\d{2}-/i.test(t)) return true;
  if (/^Codex · [0-9a-f]{8}$/i.test(t)) return true;
  if (/^Augment · [0-9a-f]{8}$/i.test(t)) return true;
  if (/^#\s*AGENTS\.md/i.test(t)) return true;
  if (/^#\s*Files mentioned/i.test(t)) return true;
  return false;
}

let codexSessionIndexCache = null;

/** Codex desktop stores human thread names in ~/.codex/session_index.jsonl */
function loadCodexSessionIndex() {
  if (codexSessionIndexCache) return codexSessionIndexCache;
  codexSessionIndexCache = new Map();
  const indexPath = join(homedir(), '.codex', 'session_index.jsonl');
  if (!existsSync(indexPath)) return codexSessionIndexCache;
  for (const line of readFileSync(indexPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.id && obj.thread_name) {
        codexSessionIndexCache.set(obj.id, String(obj.thread_name).trim());
      }
    } catch {
      // skip
    }
  }
  return codexSessionIndexCache;
}

function extractCodexUuid(filePath, sessionId) {
  const fromName = basename(filePath).match(/(019[a-f0-9-]{32,36})/i);
  if (fromName?.[1]) return fromName[1];
  const fromId = String(sessionId).match(/(019[a-f0-9-]{32,36})/i);
  return fromId?.[1] ?? null;
}

function codexTitleFromIndex(filePath, sessionId) {
  const uuid = extractCodexUuid(filePath, sessionId);
  if (!uuid) return null;
  const indexed = loadCodexSessionIndex().get(uuid);
  return indexed ? truncateTitle(indexed) : null;
}

/** VS Code chatSessions shell with no requests and no customTitle — skip import. */
function chatSessionHasContent(filePath) {
  try {
    const header = readJsonlHeader(filePath);
    if (!header || header.kind !== 0 || !header.v) return true;
    const { customTitle, requests } = header.v;
    if (customTitle && String(customTitle).trim()) return true;
    if (Array.isArray(requests) && requests.length > 0) return true;
    return false;
  } catch {
    return true;
  }
}

function parseTitleFromJsonlLine(obj) {
  if (obj.type === 'ai-title' && obj.aiTitle) {
    return String(obj.aiTitle).trim();
  }
  if (obj.kind === 0 && obj.v?.customTitle) {
    return String(obj.v.customTitle).trim();
  }
  if (obj.kind === 1 && Array.isArray(obj.k) && obj.k.join('.') === 'customTitle' && obj.v) {
    return String(obj.v).trim();
  }
  return null;
}

function parseFirstUserFromJsonlLine(obj) {
  if (obj.type === 'user.message' && obj.data?.content && isHumanTitle(obj.data.content)) {
    return obj.data.content;
  }
  if (obj.type === 'user' && obj.message?.content) {
    const parts = Array.isArray(obj.message.content)
      ? obj.message.content
      : [{ type: 'text', text: String(obj.message.content) }];
    if (!parts.some((p) => p.type === 'tool_result')) {
      const text = parts.find((p) => p.type === 'text')?.text;
      if (text && isHumanTitle(text)) return text;
    }
  }
  if (obj.kind === 0 && Array.isArray(obj.v?.requests)) {
    for (const req of obj.v.requests) {
      if (req?.message?.text && isHumanTitle(req.message.text)) {
        return req.message.text;
      }
    }
  }
  if (obj.kind === 3 && obj.v?.request?.message && isHumanTitle(obj.v.request.message)) {
    return obj.v.request.message;
  }
  if (obj.type === 'response_item' && obj.payload?.type === 'message' && obj.payload.role === 'user') {
    const text = obj.payload.content?.find((p) => p.type === 'input_text')?.text ?? '';
    const codexTitle = extractCodexUserTitle(text);
    if (codexTitle) return codexTitle;
    if (isHumanTitle(text)) return text;
  }
  return null;
}

/** Scan JSONL for customTitle, Claude ai-title, Codex index, or first real user message. */
function scanTitleFromFile(filePath, source, sessionId, opts = {}) {
  const { deepClaudeScan = false } = opts;
  if (source === 'vscode-codex') {
    const indexed = codexTitleFromIndex(filePath, sessionId);
    if (indexed) return indexed;
  }

  const stat = statSync(filePath);
  let title = null;
  let firstUser = null;
  let linesRead = 0;
  const MAX_TITLE_LINES = deepClaudeScan && source === 'vscode-claude' ? 500_000 : 400;

  const fd = openSync(filePath, 'r');
  try {
    const CHUNK = 512 * 1024;
    let offset = 0;
    let carry = '';
    while (offset < stat.size && linesRead < MAX_TITLE_LINES) {
      const toRead = Math.min(CHUNK, stat.size - offset);
      const buf = Buffer.alloc(toRead);
      readSync(fd, buf, 0, toRead, offset);
      offset += toRead;
      carry += buf.toString('utf8');
      let nl;
      while ((nl = carry.indexOf('\n')) >= 0 && linesRead < MAX_TITLE_LINES) {
        const line = carry.slice(0, nl);
        carry = carry.slice(nl + 1);
        linesRead += 1;
        if (!line.trim()) continue;
        let obj;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        const lineTitle = parseTitleFromJsonlLine(obj);
        if (lineTitle) title = lineTitle;
        if (!firstUser) {
          const user = parseFirstUserFromJsonlLine(obj);
          if (user) firstUser = user;
        }
        if (!deepClaudeScan && title && (source === 'vscode-chat' || source === 'vscode-copilot' || source === 'vscode-augment')) {
          break;
        }
      }
      if (!deepClaudeScan && title && (source === 'vscode-chat' || source === 'vscode-copilot' || source === 'vscode-augment')) {
        break;
      }
    }
  } finally {
    closeSync(fd);
  }

  if (source === 'vscode-codex') {
    const indexed = codexTitleFromIndex(filePath, sessionId);
    if (indexed) return indexed;
  }

  if (title && !isIdStubTitle(title, sessionId)) return truncateTitle(title);
  if (firstUser) return truncateTitle(firstUser);
  if (source === 'vscode-claude') return `Claude Code · ${sessionId.slice(0, 8)}`;
  if (source === 'vscode-codex') return `Codex · ${sessionId.slice(0, 8)}`;
  if (source === 'vscode-augment') return `Augment · ${sessionId.slice(0, 8)}`;
  if (source === 'vscode-copilot') return `Copilot · ${sessionId.slice(0, 8)}`;
  return `VS Code · ${sessionId.slice(0, 8)}`;
}

/** Infer VS Code chat app from extension id embedded in JSONL header. */
function detectChatAppSource(filePath) {
  const stat = statSync(filePath);
  const fd = openSync(filePath, 'r');
  const buf = Buffer.alloc(Math.min(512 * 1024, stat.size));
  readSync(fd, buf, 0, buf.length, 0);
  closeSync(fd);
  const sample = buf.toString('utf8');
  if (/Augment\.vscode-augment/i.test(sample)) return 'vscode-augment';
  if (/openai\.chatgpt|gpt\.codex|codex/i.test(sample) && /extensionId/i.test(sample)) return 'vscode-codex';
  if (/GitHub\.copilot-chat/i.test(sample)) return 'vscode-chat';
  return 'vscode-chat';
}

function listCodexSources() {
  const codexRoot = join(homedir(), '.codex', 'sessions');
  if (!existsSync(codexRoot)) return [];
  const sources = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.jsonl')) {
        const stat = statSync(full);
        if (stat.size < MIN_FILE_BYTES) continue;
        const sessionId = basename(entry.name, '.jsonl').replace(/^rollout-/, '');
        let devVai = false;
        const indexedTitle = codexTitleFromIndex(full, sessionId);
        let title = indexedTitle || `Codex · ${sessionId.slice(0, 8)}`;
        if (indexedTitle) {
          devVai = true;
        } else try {
          const fd = openSync(full, 'r');
          const buf = Buffer.alloc(Math.min(256 * 1024, stat.size));
          readSync(fd, buf, 0, buf.length, 0);
          closeSync(fd);
          for (const line of buf.toString('utf8').split('\n')) {
            if (!line.trim()) continue;
            const obj = JSON.parse(line);
            if (obj.type === 'session_meta' && obj.payload?.cwd?.includes('dev-vai')) {
              devVai = true;
            }
            if (obj.type === 'response_item' && obj.payload?.type === 'message' && obj.payload.role === 'user') {
              const text = obj.payload.content?.find((p) => p.type === 'input_text')?.text ?? '';
              if (text.includes('<environment_context>') && !text.includes('My request for Codex')) continue;
              const codexTitle = extractCodexUserTitle(text);
              if (codexTitle) { title = codexTitle; break; }
              if (isHumanTitle(text)) { title = truncateTitle(text); break; }
            }
          }
        } catch { /* skip */ }
        if (!devVai) continue;
        sources.push({
          key: `vscode-codex:${sessionId}`,
          source: 'vscode-codex',
          sessionId,
          filePath: full,
          title,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
        });
      }
    }
  };
  walk(codexRoot);
  return sources;
}

function readJsonlHeader(filePath) {
  const stat = statSync(filePath);
  if (stat.size === 0) return null;
  const fd = openSync(filePath, 'r');
  try {
    const CHUNK = 256 * 1024;
    const MAX = 8 * 1024 * 1024;
    let accumulated = '';
    let offset = 0;
    while (offset < Math.min(stat.size, MAX)) {
      const toRead = Math.min(CHUNK, stat.size - offset);
      const buf = Buffer.alloc(toRead);
      readSync(fd, buf, 0, toRead, offset);
      accumulated += buf.toString('utf8');
      offset += toRead;
      const nl = accumulated.indexOf('\n');
      if (nl >= 0) return JSON.parse(accumulated.slice(0, nl));
    }
    return accumulated ? JSON.parse(accumulated) : null;
  } finally {
    closeSync(fd);
  }
}

function extractFilePath(msg) {
  const patterns = [
    /(?:Reading|Read|Editing|Edited|Created|Creating)\s+([^\s,]+)/i,
    /file:\/\/\/([^\s#)]+)/i,
    /([a-zA-Z]:[/\\][^\s,)]+\.\w+)/,
  ];
  for (const p of patterns) {
    const m = msg.match(p);
    if (m) return m[1].replace(/%3A/g, ':').replace(/%2F/g, '/');
  }
  return '';
}

function mapToolId(toolId, msg) {
  switch (toolId) {
    case 'copilot_readFile':
    case 'read_file':
      return { type: 'file-read', meta: { eventType: 'file-read', filePath: extractFilePath(msg) } };
    case 'copilot_createFile':
    case 'create_file':
      return { type: 'file-create', meta: { eventType: 'file-create', filePath: extractFilePath(msg) } };
    case 'copilot_replaceString':
    case 'copilot_multiReplaceString':
    case 'replace_string_in_file':
    case 'multi_replace_string_in_file':
      return { type: 'file-edit', meta: { eventType: 'file-edit', filePath: extractFilePath(msg), editType: 'replace' } };
    case 'run_in_terminal':
      return { type: 'terminal', meta: { eventType: 'terminal', command: msg } };
    case 'copilot_findTextInFiles':
    case 'grep_search':
      return { type: 'search', meta: { eventType: 'search', searchType: 'grep', query: msg } };
    case 'copilot_findFiles':
    case 'file_search':
      return { type: 'search', meta: { eventType: 'search', searchType: 'file', query: msg } };
    case 'copilot_searchCodebase':
    case 'semantic_search':
      return { type: 'search', meta: { eventType: 'search', searchType: 'semantic', query: msg } };
    case 'manage_todo_list':
      return { type: 'todo-update', meta: { eventType: 'todo-update' } };
    default:
      return { type: 'tool-call', meta: { eventType: 'tool-call', toolName: toolId || 'unknown' } };
  }
}

function createDeduper() {
  const seen = new Set();
  return (key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

function parseResponseItems(items, lineIndex, dedupe, events, timestamp) {
  if (!Array.isArray(items)) return;
  const textParts = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    if (item.kind === 'thinking' && item.value?.length > 20) {
      const key = `think:${simpleHash(item.value.slice(0, 300))}`;
      if (dedupe(key)) {
        events.push({
          type: 'thinking',
          timestamp,
          content: item.value.slice(0, MAX_CONTENT),
          meta: {
            eventType: 'thinking',
            label: item.generatedTitle || item.value.slice(0, 120),
            sourceLine: lineIndex,
          },
        });
      }
    }
    if (item.kind === 'toolInvocationSerialized') {
      const msg = item.invocationMessage?.value || item.pastTenseMessage?.value || '';
      const clean = msg.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();
      if (clean.length < 5) continue;
      const key = `tool:${item.toolCallId || simpleHash(clean.slice(0, 200))}`;
      if (!dedupe(key)) continue;
      const mapped = mapToolId(item.toolId, clean);
      events.push({
        type: mapped.type,
        timestamp,
        content: clean.slice(0, MAX_CONTENT),
        meta: { ...mapped.meta, toolId: item.toolId, sourceLine: lineIndex },
      });
    }
    if (!('kind' in item) && typeof item.value === 'string' && item.value.length > 30) {
      textParts.push(item.value);
    }
  }
  if (textParts.length > 0) {
    const combined = textParts.join('\n\n');
    const key = `asst:${simpleHash(combined.slice(0, 400))}`;
    if (dedupe(key)) {
      events.push({
        type: 'message',
        timestamp,
        content: combined.slice(0, MAX_CONTENT),
        meta: { eventType: 'message', role: 'assistant', sourceLine: lineIndex },
      });
    }
  }
}

function extractChatSessionEvents(obj, lineIndex, ctx) {
  const events = [];
  const dedupe = ctx.dedupe;
  const ts = ctx.baseTimestamp + lineIndex;

  if (obj.kind === 0 && obj.v && typeof obj.v === 'object') {
    const header = obj.v;
    if (header.customTitle) ctx.title = header.customTitle;
    if (header.sessionId) ctx.sessionId = header.sessionId;
    if (header.responderUsername) ctx.agentName = header.responderUsername;
    if (Array.isArray(header.requests)) {
      for (const req of header.requests) {
        if (req?.message?.text?.length > 4) {
          const text = req.message.text;
          const key = `user:${simpleHash(text.slice(0, 400))}`;
          if (dedupe(key)) {
            events.push({
              type: 'message',
              timestamp: req.timestamp || ts,
              content: text.slice(0, MAX_CONTENT),
              meta: { eventType: 'message', role: 'user', sourceLine: lineIndex },
            });
          }
        }
        if (Array.isArray(req.response)) {
          parseResponseItems(req.response, lineIndex, dedupe, events, req.timestamp || ts);
        }
      }
    }
    return events;
  }

  const keyPath = Array.isArray(obj.k)
    ? obj.k.map((x) => (typeof x === 'number' ? 'N' : x)).join('.')
    : '';

  if (obj.kind === 1 && keyPath === 'customTitle' && obj.v) {
    ctx.title = String(obj.v);
    return events;
  }

  if (obj.kind === 2 && keyPath === 'requests' && Array.isArray(obj.v)) {
    for (const req of obj.v) {
      if (req?.message?.text?.length > 4) {
        const text = req.message.text;
        const key = `user:${simpleHash(text.slice(0, 400))}`;
        if (dedupe(key)) {
          events.push({
            type: 'message',
            timestamp: req.timestamp || ts,
            content: text.slice(0, MAX_CONTENT),
            meta: { eventType: 'message', role: 'user', sourceLine: lineIndex },
          });
        }
      }
      if (Array.isArray(req.response)) {
        parseResponseItems(req.response, lineIndex, dedupe, events, req.timestamp || ts);
      }
    }
    return events;
  }

  if (obj.kind === 2 && keyPath === 'requests.N.response' && Array.isArray(obj.v)) {
    parseResponseItems(obj.v, lineIndex, dedupe, events, ts);
    return events;
  }

  if (obj.kind === 3 && obj.v?.request?.message?.length > 4) {
    const text = obj.v.request.message;
    const key = `user:${simpleHash(text.slice(0, 400))}`;
    if (dedupe(key)) {
      events.push({
        type: 'message',
        timestamp: ts,
        content: text.slice(0, MAX_CONTENT),
        meta: { eventType: 'message', role: 'user', sourceLine: lineIndex },
      });
    }
  }

  return events;
}

function extractCopilotTranscriptEvent(obj, lineIndex, ctx) {
  const events = [];
  const dedupe = ctx.dedupe;
  const ts = obj.timestamp ? Date.parse(obj.timestamp) : ctx.baseTimestamp + lineIndex;

  switch (obj.type) {
    case 'user.message': {
      const text = obj.data?.content;
      if (!text || text.length < 3) break;
      const key = `user:${simpleHash(text.slice(0, 400))}`;
      if (dedupe(key)) {
        events.push({
          type: 'message',
          timestamp: ts,
          content: text.slice(0, MAX_CONTENT),
          meta: { eventType: 'message', role: 'user', sourceLine: lineIndex },
        });
      }
      break;
    }
    case 'assistant.message': {
      const reasoning = obj.data?.reasoningText;
      if (reasoning?.length > 20) {
        const key = `think:${simpleHash(reasoning.slice(0, 300))}`;
        if (dedupe(key)) {
          events.push({
            type: 'thinking',
            timestamp: ts,
            content: reasoning.slice(0, MAX_CONTENT),
            meta: { eventType: 'thinking', label: reasoning.slice(0, 120), sourceLine: lineIndex },
          });
        }
      }
      const content = obj.data?.content;
      if (content?.length > 30) {
        const key = `asst:${simpleHash(content.slice(0, 400))}`;
        if (dedupe(key)) {
          events.push({
            type: 'message',
            timestamp: ts,
            content: content.slice(0, MAX_CONTENT),
            meta: { eventType: 'message', role: 'assistant', sourceLine: lineIndex },
          });
        }
      }
      break;
    }
    case 'tool.execution_start': {
      const toolName = obj.data?.toolName || 'tool';
      const args = JSON.stringify(obj.data?.arguments ?? {}).slice(0, 500);
      const key = `tool:${obj.data?.toolCallId || simpleHash(toolName + args)}`;
      if (dedupe(key)) {
        const mapped = mapToolId(toolName, args);
        events.push({
          type: mapped.type,
          timestamp: ts,
          content: `${toolName}(${args})`.slice(0, MAX_CONTENT),
          meta: { ...mapped.meta, toolName, sourceLine: lineIndex },
        });
      }
      break;
    }
    default:
      break;
  }
  return events;
}

function extractClaudeCodeEvent(obj, lineIndex, ctx) {
  const events = [];
  const dedupe = ctx.dedupe;
  const ts = obj.timestamp ? Date.parse(obj.timestamp) : ctx.baseTimestamp + lineIndex;

  if (obj.type === 'ai-title' && obj.aiTitle) {
    ctx.title = obj.aiTitle;
    return events;
  }

  if (obj.type === 'user' && obj.message?.role === 'user') {
    const parts = Array.isArray(obj.message.content)
      ? obj.message.content
      : [{ type: 'text', text: String(obj.message.content ?? '') }];
    if (parts.some((p) => p.type === 'tool_result')) return events;
    const texts = parts.filter((p) => p.type === 'text' && p.text).map((p) => p.text);
    if (texts.length === 0) return events;
    const text = texts.join('\n\n');
    if (text.length < 3) return events;
    const key = `user:${simpleHash(text.slice(0, 400))}`;
    if (dedupe(key)) {
      events.push({
        type: 'message',
        timestamp: ts,
        content: text.slice(0, MAX_CONTENT),
        meta: { eventType: 'message', role: 'user', sourceLine: lineIndex },
      });
    }
    return events;
  }

  if (obj.type === 'assistant' && obj.message?.role === 'assistant') {
    const parts = obj.message.content;
    if (!Array.isArray(parts)) return events;
    const texts = [];
    for (const part of parts) {
      if (part.type === 'text' && part.text?.length > 10) {
        texts.push(part.text);
      }
      if (part.type === 'tool_use' && part.name) {
        const key = `tool:${part.id || simpleHash(part.name + JSON.stringify(part.input ?? {}))}`;
        if (dedupe(key)) {
          events.push({
            type: 'tool-call',
            timestamp: ts,
            content: `${part.name}(${JSON.stringify(part.input ?? {}).slice(0, 900)})`,
            meta: {
              eventType: 'tool-call',
              toolName: part.name,
              parameters: part.input ?? {},
              sourceLine: lineIndex,
            },
          });
        }
      }
    }
    if (texts.length > 0) {
      const combined = texts.join('\n\n');
      const key = `asst:${simpleHash(combined.slice(0, 400))}`;
      if (dedupe(key)) {
        events.push({
          type: 'message',
          timestamp: ts,
          content: combined.slice(0, MAX_CONTENT),
          meta: { eventType: 'message', role: 'assistant', sourceLine: lineIndex },
        });
      }
    }
  }

  return events;
}

function extractCodexEvent(obj, lineIndex, ctx) {
  const events = [];
  const dedupe = ctx.dedupe;
  const ts = obj.timestamp ? Date.parse(obj.timestamp) : ctx.baseTimestamp + lineIndex;

  if (obj.type === 'session_meta' && obj.payload?.cwd) {
    ctx.cwd = obj.payload.cwd;
    return events;
  }

  if (obj.type === 'response_item' && obj.payload?.type === 'message') {
    const role = obj.payload.role;
    const parts = obj.payload.content ?? [];
    const texts = parts
      .filter((p) => p.type === 'input_text' || p.type === 'output_text' || p.type === 'text')
      .map((p) => p.text)
      .filter(Boolean);
    const combined = texts.join('\n\n').trim();
    if (!combined || combined.length < 3) return events;
    if (role === 'user') {
      if (combined.includes('# AGENTS.md') || combined.includes('<environment_context>')) return events;
      if (!isHumanTitle(combined)) return events;
      const key = `user:${simpleHash(combined.slice(0, 400))}`;
      if (dedupe(key)) {
        events.push({
          type: 'message',
          timestamp: ts,
          content: combined.slice(0, MAX_CONTENT),
          meta: { eventType: 'message', role: 'user', sourceLine: lineIndex },
        });
      }
    } else if (role === 'assistant' && combined.length > 30) {
      const key = `asst:${simpleHash(combined.slice(0, 400))}`;
      if (dedupe(key)) {
        events.push({
          type: 'message',
          timestamp: ts,
          content: combined.slice(0, MAX_CONTENT),
          meta: { eventType: 'message', role: 'assistant', sourceLine: lineIndex },
        });
      }
    }
    return events;
  }

  if (obj.type === 'response_item' && obj.payload?.type === 'function_call') {
    const name = obj.payload.name ?? 'tool';
    const args = obj.payload.arguments ?? '';
    const key = `tool:${obj.payload.call_id || simpleHash(name + args.slice(0, 200))}`;
    if (dedupe(key)) {
      events.push({
        type: 'tool-call',
        timestamp: ts,
        content: `${name}(${String(args).slice(0, 900)})`,
        meta: { eventType: 'tool-call', toolName: name, sourceLine: lineIndex },
      });
    }
  }

  return events;
}

async function readJsonlFromLine(filePath, fromLine, parseLine, ctx) {
  const events = [];
  let lineIndex = 0;
  const rl = createInterface({ input: createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    lineIndex += 1;
    if (lineIndex <= fromLine) continue;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      events.push(...parseLine(obj, lineIndex, ctx));
    } catch {
      // skip malformed lines
    }
  }
  return { events, newLineCount: lineIndex };
}

function listSources(wsStorage, claudeDir) {
  const sources = [];
  const chatSessionIds = new Set();

  if (wsStorage) {
    const chatDir = join(wsStorage, 'chatSessions');
    if (existsSync(chatDir)) {
      for (const file of readdirSync(chatDir).filter((f) => f.endsWith('.jsonl'))) {
        const filePath = join(chatDir, file);
        const stat = statSync(filePath);
        if (stat.size < MIN_FILE_BYTES) continue;
        const sessionId = file.replace(/\.jsonl$/, '');
        chatSessionIds.add(sessionId);
        if (!chatSessionHasContent(filePath)) continue;
        const chatApp = detectChatAppSource(filePath);
        const title = scanTitleFromFile(filePath, chatApp, sessionId);
        sources.push({
          key: `${chatApp}:${sessionId}`,
          source: chatApp,
          sessionId,
          filePath,
          title,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
        });
      }
    }

    const copilotDir = join(wsStorage, 'GitHub.copilot-chat', 'transcripts');
    if (existsSync(copilotDir)) {
      for (const file of readdirSync(copilotDir).filter((f) => f.endsWith('.jsonl'))) {
        const sessionId = file.replace(/\.jsonl$/, '');
        if (chatSessionIds.has(sessionId)) continue;
        const filePath = join(copilotDir, file);
        const stat = statSync(filePath);
        if (stat.size < MIN_FILE_BYTES) continue;
        const title = scanTitleFromFile(filePath, 'vscode-copilot', sessionId);
        sources.push({
          key: `vscode-copilot:${sessionId}`,
          source: 'vscode-copilot',
          sessionId,
          filePath,
          title,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
        });
      }
    }
  }

  if (claudeDir) {
    for (const file of readdirSync(claudeDir).filter((f) => f.endsWith('.jsonl'))) {
      const sessionId = file.replace(/\.jsonl$/, '');
      const filePath = join(claudeDir, file);
      const stat = statSync(filePath);
      if (stat.size < MIN_FILE_BYTES) continue;
      const title = scanTitleFromFile(filePath, 'vscode-claude', sessionId);
      sources.push({
        key: `vscode-claude:${sessionId}`,
        source: 'vscode-claude',
        sessionId,
        filePath,
        title,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    }
  }

  sources.push(...listCodexSources());

  return sources.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function sessionExists(sessionId) {
  try {
    const res = await fetch(`${API_BASE}/api/sessions/${sessionId}`);
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureSession(state, sourceKey, meta) {
  if (state.sessions[sourceKey] && await sessionExists(state.sessions[sourceKey])) {
    if (meta.title && state.titles?.[sourceKey] !== meta.title) {
      await api(`/api/sessions/${state.sessions[sourceKey]}`, 'PATCH', { title: meta.title });
      state.titles[sourceKey] = meta.title;
      saveSyncState(state);
    }
    return state.sessions[sourceKey];
  }
  if (state.sessions[sourceKey]) delete state.sessions[sourceKey];

  const tags = [meta.source, workspaceTag()];
  const agentName = meta.source === 'vscode-claude'
    ? 'Claude Code'
    : meta.source === 'vscode-codex'
      ? 'Codex'
      : meta.source === 'vscode-augment'
        ? 'Augment'
        : meta.source === 'vscode-copilot'
          ? 'GitHub Copilot'
          : (meta.agentName || 'VS Code Chat');

  const session = await api('/api/sessions', 'POST', {
    title: meta.title,
    description: `${agentName} · ${basename(WORKSPACE_ROOT)}`,
    agentName,
    modelId: meta.source,
    tags,
  });
  state.sessions[sourceKey] = session.id;
  state.titles = state.titles || {};
  state.titles[sourceKey] = meta.title;
  saveSyncState(state);
  return session.id;
}

async function pushEvents(sessionId, events) {
  if (events.length === 0) return;
  const BATCH = 60;
  for (let i = 0; i < events.length; i += BATCH) {
    await api(`/api/sessions/${sessionId}/events`, 'POST', { events: events.slice(i, i + BATCH) });
  }
}

async function resetSource(state, sourceKey) {
  const sessionId = state.sessions[sourceKey];
  if (sessionId && await sessionExists(sessionId)) {
    try {
      await api(`/api/sessions/${sessionId}/clear-events`, 'POST', {});
    } catch {
      delete state.sessions[sourceKey];
      saveSyncState(state);
    }
  } else if (sessionId) {
    delete state.sessions[sourceKey];
    saveSyncState(state);
  }
  state.lineCounts[sourceKey] = 0;
  saveSyncState(state);
}

async function syncSource(state, entry, onlyKey, forceFull = false) {
  if (onlyKey && entry.key !== onlyKey) return 0;

  const prevLines = forceFull ? 0 : (state.lineCounts[entry.key] ?? 0);
  const stat = statSync(entry.filePath);
  if (stat.size < MIN_FILE_BYTES) return 0;

  const parseLine = entry.source === 'vscode-claude'
    ? extractClaudeCodeEvent
    : entry.source === 'vscode-codex'
      ? extractCodexEvent
      : entry.source === 'vscode-copilot'
        ? extractCopilotTranscriptEvent
        : extractChatSessionEvents;

  const scannedTitle = scanTitleFromFile(entry.filePath, entry.source, entry.sessionId);
  const ctx = {
    dedupe: createDeduper(),
    baseTimestamp: stat.mtimeMs - 60_000,
    title: scannedTitle,
    sessionId: entry.sessionId,
    agentName: entry.source === 'vscode-chat' ? 'VS Code Chat' : undefined,
  };

  const { events, newLineCount } = await readJsonlFromLine(
    entry.filePath,
    prevLines,
    parseLine,
    ctx,
  );

  const finalTitle = ctx.title || scannedTitle;
  const existingId = state.sessions[entry.key];

  if (newLineCount <= prevLines && !forceFull) {
    if (existingId && await sessionExists(existingId)) {
      if (finalTitle && !isIdStubTitle(finalTitle, entry.sessionId)
        && state.titles?.[entry.key] !== finalTitle) {
        await api(`/api/sessions/${existingId}`, 'PATCH', { title: finalTitle });
        state.titles[entry.key] = finalTitle;
        saveSyncState(state);
      }
    }
    return 0;
  }

  if (events.length === 0) {
    if (existingId && await sessionExists(existingId) && finalTitle
      && !isIdStubTitle(finalTitle, entry.sessionId)) {
      await api(`/api/sessions/${existingId}`, 'PATCH', { title: finalTitle });
      state.titles[entry.key] = finalTitle;
      saveSyncState(state);
    }
    state.lineCounts[entry.key] = newLineCount;
    saveSyncState(state);
    return 0;
  }

  const sessionId = await ensureSession(state, entry.key, {
    title: finalTitle,
    source: entry.source,
    agentName: ctx.agentName,
  });
  await pushEvents(sessionId, events);
  state.lineCounts[entry.key] = newLineCount;
  saveSyncState(state);
  console.log(`✅ ${entry.key} → ${sessionId} (+${events.length} events, ${newLineCount} lines, ${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
  return events.length;
}

async function syncAll(onlyKey, forceFull = false) {
  const wsStorage = findDevVaiWorkspaceStorage();
  const claudeDir = claudeProjectDir();
  if (!wsStorage && !claudeDir) {
    console.error('No dev-vai VS Code workspace or Claude Code project dir found.');
    process.exitCode = 1;
    return;
  }
  const state = loadSyncState();
  const sources = listSources(wsStorage, claudeDir);
  if (sources.length === 0) {
    console.log('No importable VS Code / Claude sessions found.');
    return;
  }
  let total = 0;
  for (const entry of sources) {
    if (forceFull) await resetSource(state, entry.key);
    total += await syncSource(state, entry, onlyKey, forceFull);
  }
  console.log(`Done. ${total} events ingested from ${sources.length} source(s).`);
}

async function retitleAll(onlyKey) {
  const wsStorage = findDevVaiWorkspaceStorage();
  const claudeDir = claudeProjectDir();
  const state = loadSyncState();
  let updated = 0;
  for (const entry of listSources(wsStorage, claudeDir)) {
    if (onlyKey && entry.key !== onlyKey) continue;
    const title = scanTitleFromFile(entry.filePath, entry.source, entry.sessionId, { deepClaudeScan: true });
    if (isIdStubTitle(title, entry.sessionId)) continue;
    const sessionId = state.sessions[entry.key];
    if (!sessionId || !await sessionExists(sessionId)) continue;
    await api(`/api/sessions/${sessionId}`, 'PATCH', { title });
    state.titles = state.titles || {};
    state.titles[entry.key] = title;
    saveSyncState(state);
    console.log(`   ↳ ${entry.key.slice(0, 24)} → "${title}"`);
    updated += 1;
  }
  console.log(`Retitled ${updated} VS Code / Claude session(s).`);
}

async function cleanupStubs() {
  const state = loadSyncState();
  let removed = 0;
  const res = await api('/api/sessions?limit=500');
  const sessions = res.sessions ?? res;
  for (const session of sessions) {
    const tags = Array.isArray(session.tags) ? session.tags : String(session.tags || '').split(/\s+/);
    const isImported = tags.some((t) => t.startsWith('vscode-'));
    if (!isImported) continue;
    const stats = session.stats ?? {};
    const hasEvents = (stats.messageCount ?? 0) > 0
      || (stats.thinkingBlocks ?? 0) > 0
      || (stats.filesRead ?? 0) > 0;
    const titleLooksLikeId = /^[0-9a-f]{8}$/i.test(String(session.title || '').trim());
    if (!hasEvents && titleLooksLikeId) {
      try {
        await api(`/api/sessions/${session.id}`, 'DELETE');
        removed += 1;
        for (const [key, id] of Object.entries(state.sessions)) {
          if (id === session.id) {
            delete state.sessions[key];
            delete state.lineCounts[key];
            delete state.titles?.[key];
          }
        }
        console.log(`   🗑 removed empty stub ${session.title} (${session.id})`);
      } catch (err) {
        console.warn(`   ⚠ failed to remove ${session.id}:`, err instanceof Error ? err.message : err);
      }
    }
  }
  saveSyncState(state);
  console.log(`Removed ${removed} empty ID-stub session(s).`);
}

async function retagAll(onlyKey) {
  const wsStorage = findDevVaiWorkspaceStorage();
  const claudeDir = claudeProjectDir();
  const state = loadSyncState();
  let updated = 0;
  for (const entry of listSources(wsStorage, claudeDir)) {
    if (onlyKey && entry.key !== onlyKey) continue;
    const sessionId = state.sessions[entry.key];
    if (!sessionId || !await sessionExists(sessionId)) continue;
    const tags = [entry.source, workspaceTag()];
    await api(`/api/sessions/${sessionId}`, 'PATCH', { tags });
    updated += 1;
  }
  console.log(`Retagged ${updated} session(s) with source tags.`);
}

async function watch() {
  console.log('Watching VS Code + Claude Code sessions (poll every 10s). Ctrl+C to stop.');
  for (;;) {
    try {
      await syncAll();
    } catch (err) {
      console.error('Sync error:', err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

const [, , command, arg] = process.argv;

try {
  switch (command) {
    case 'resync':
      await syncAll(arg, true);
      break;
    case 'sync':
      await syncAll(arg, false);
      break;
    case 'retag':
      await retagAll(arg);
      break;
    case 'retitle':
      await retitleAll(arg);
      break;
    case 'cleanup-stubs':
      await cleanupStubs();
      break;
    case 'watch':
      await watch();
      break;
    case 'list': {
      const wsStorage = findDevVaiWorkspaceStorage();
      const claudeDir = claudeProjectDir();
      for (const entry of listSources(wsStorage, claudeDir)) {
        const mb = (entry.size / 1024 / 1024).toFixed(1);
        console.log(`${entry.key}  "${entry.title}"  (${mb}MB)`);
      }
      break;
    }
    default:
      console.log(`Usage:
  node scripts/vscode-session-bridge.mjs sync [sourceKey]
  node scripts/vscode-session-bridge.mjs resync [sourceKey]
  node scripts/vscode-session-bridge.mjs retitle [sourceKey]
  node scripts/vscode-session-bridge.mjs cleanup-stubs
  node scripts/vscode-session-bridge.mjs watch
  node scripts/vscode-session-bridge.mjs list`);
      process.exitCode = 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
