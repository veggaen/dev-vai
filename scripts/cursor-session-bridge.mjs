#!/usr/bin/env node
/**
 * Cursor Session Bridge — import Cursor agent transcripts into VeggaAI Dev Logs.
 *
 * Cursor stores chat JSONL under:
 *   %USERPROFILE%\.cursor\projects\<slug>\agent-transcripts\<uuid>\<uuid>.jsonl
 *
 * Each line: { role, message: { content: [{ type, text?, name?, input? }] } }
 * Tool calls in assistant messages become `tool-call` events.
 *
 * Usage:
 *   node scripts/cursor-session-bridge.mjs sync [transcriptId]
 *   node scripts/cursor-session-bridge.mjs resync [transcriptId]  # wipe + full re-import
 *   node scripts/cursor-session-bridge.mjs retitle [transcriptId]
 *   node scripts/cursor-session-bridge.mjs watch
 *   node scripts/cursor-session-bridge.mjs list
 *
 * Environment:
 *   VAI_API_BASE — default http://localhost:3006
 *   CURSOR_TRANSCRIPTS_DIR — override transcript root
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = join(__dirname, '..');
const SYNC_STATE_FILE = join(WORKSPACE_ROOT, '.vai-cursor-sync.json');
const TITLE_OVERRIDES_FILE = join(WORKSPACE_ROOT, '.vai-cursor-titles.json');

const API_BASE = process.env.VAI_API_BASE || 'http://localhost:3006';
const MAX_CONTENT = 32_000;

function defaultTranscriptsDir() {
  if (process.env.CURSOR_TRANSCRIPTS_DIR) return process.env.CURSOR_TRANSCRIPTS_DIR;
  const slug = basename(WORKSPACE_ROOT).toLowerCase();
  const projectPath = join(homedir(), '.cursor', 'projects');
  if (!existsSync(projectPath)) return null;
  const match = readdirSync(projectPath).find((d) => d.includes(slug) || d.includes('dev-vai'));
  if (!match) return null;
  return join(projectPath, match, 'agent-transcripts');
}

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

function loadTitleOverrides() {
  try {
    return JSON.parse(readFileSync(TITLE_OVERRIDES_FILE, 'utf8'));
  } catch {
    return {};
  }
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

function stripUserQuery(text) {
  return text
    .replace(/<\/?user_query>/gi, '')
    .replace(/<\/?[a-z_:-]+>/gi, '')
    .trim();
}

function extractUserQuery(text) {
  const tagged = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
  return stripUserQuery(tagged?.[1] ?? text);
}

/** Cursor often prepends skill/rule injections — not a human session title. */
function isBoilerplateTitle(title) {
  if (!title?.trim()) return true;
  const t = title.trim();
  return (
    /^You MUST read and follow this skill/i.test(t)
    || /^Follow ALL user, tool, system/i.test(t)
    || /^## Core Mandate/i.test(t)
    || /^Assistant/i.test(t)
  );
}

function titleQuality(title) {
  if (isBoilerplateTitle(title)) return 0;
  let score = 1;
  if (title.length <= 72) score += 1;
  if (/\b(sidebar|browser|dev\s*logs|preview|council|vai|workspace)\b/i.test(title)) score += 2;
  if (/^You MUST/i.test(title)) score -= 5;
  return score;
}

function pickBestSentence(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const sentences = clean.split(/(?<=[.!?])\s+/).filter((s) => s.length > 15);
  if (sentences.length === 0) return clean;

  let best = sentences[0];
  let bestScore = -Infinity;
  for (const sentence of sentences) {
    let score = 0;
    if (/\b(sidebar|preview|dev\s*logs|browser|council|vai|workspace|rail|menu)\b/i.test(sentence)) score += 8;
    if (/\b(fix|focus|remove|design|structure|clean|drive|logging)\b/i.test(sentence)) score += 3;
    if (sentence.length >= 35 && sentence.length <= 140) score += 2;
    if (/^You MUST/i.test(sentence)) score -= 20;
    if (/^##/.test(sentence)) score -= 20;
    if (score > bestScore) {
      bestScore = score;
      best = sentence;
    }
  }
  return best;
}

function deriveTitle(text) {
  let clean = extractUserQuery(text);

  // Skill-injection turns bury the real ask — use the last substantive paragraph.
  if (/You MUST read and follow this skill/i.test(clean)) {
    const paragraphs = clean
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 30 && !/^#{1,3}\s/.test(p) && !/^-\s/.test(p));
    if (paragraphs.length > 0) clean = paragraphs[paragraphs.length - 1];
  }

  clean = pickBestSentence(clean).replace(/\s+/g, ' ').trim();
  if (!clean) return 'Cursor agent session';

  const lower = clean.toLowerCase();
  if (
    lower.includes('sidebar')
    && (lower.includes('icon') || lower.includes('route') || lower.includes('structure')
      || lower.includes('spaghetti') || lower.includes('nested') || lower.includes('options'))
  ) {
    return 'Sidebar menu design and structure';
  }

  return clean.length <= 72 ? clean : `${clean.slice(0, 69)}…`;
}

function deriveTitleFromTranscript(lines, transcriptId) {
  const overrides = loadTitleOverrides();
  if (transcriptId && overrides[transcriptId]) {
    return overrides[transcriptId];
  }
  for (const line of lines) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.role !== 'user') continue;
    const { text } = extractTextParts(row.message?.content ?? []);
    if (!text) continue;
    const title = deriveTitle(text);
    if (!isBoilerplateTitle(title)) return title;
  }
  return 'Cursor agent session';
}

function workspaceTag() {
  return `workspace:${basename(WORKSPACE_ROOT)}`;
}

function extractTextParts(content) {
  if (!Array.isArray(content)) return { text: '', tools: [] };
  const texts = [];
  const tools = [];
  for (const part of content) {
    if (part.type === 'text' && part.text) {
      texts.push(part.text);
    } else if (part.type === 'tool_use' && part.name) {
      tools.push({
        name: part.name,
        input: part.input ?? {},
      });
    }
  }
  return { text: texts.join('\n\n').trim(), tools };
}

function visibleUserText(text) {
  return extractUserQuery(text);
}

/** Cursor injects system/reminder lines as role=user — not the human's words. */
function isSystemUserMessage(text) {
  const clean = extractUserQuery(text).replace(/\s+/g, ' ').trim();
  if (!clean) return true;
  return (
    /^You MUST read and follow this skill/i.test(clean)
    || /^Briefly inform the user about the task result/i.test(clean)
    || /^If the available MCP tools do not fully support/i.test(clean)
    || /^You are acting as a world-class/i.test(clean)
    || /^<user_query>\s*<\/user_query>/i.test(clean)
  );
}

/** Real human prompt — strips skill/rule blobs Cursor prepends to user_query. */
function extractHumanUserText(text) {
  let clean = extractUserQuery(text);
  if (isSystemUserMessage(text)) {
    // Skill injection + real ask in one blob: keep only the last substantive paragraph.
    if (/You MUST read and follow this skill/i.test(clean)) {
      const paragraphs = clean
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 30 && !/^#{1,3}\s/.test(p) && !/^-\s/.test(p));
      const last = paragraphs[paragraphs.length - 1];
      if (last && !/^You MUST read/i.test(last)) return last;
    }
    return null;
  }
  return clean.trim() || null;
}

function splitAssistantText(text) {
  const clean = text.trim();
  if (!clean) return { thinking: null, message: null };
  if (clean === '[REDACTED]') {
    return { thinking: 'Agent reasoning (redacted in Cursor export)', message: null };
  }

  const withoutRedacted = clean.replace(/\s*\[REDACTED\]\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.includes('[REDACTED]')) {
    const segments = clean.split('[REDACTED]').map((s) => s.trim()).filter(Boolean);
    const lead = segments[0] ?? '';
    const tail = segments.slice(1).join(' ').trim();
    const isLongAnswer = tail.length > 160 || /^#+ /m.test(tail) || tail.split('\n').length > 5;
    return {
      thinking: lead || withoutRedacted || 'Working…',
      message: isLongAnswer ? tail : null,
    };
  }

  const isLongAnswer =
    clean.length > 220
    || /^#+ /m.test(clean)
    || (clean.split('\n').length > 6 && /\b(##|changed|summary|what was wrong)\b/i.test(clean));

  if (isLongAnswer) return { thinking: null, message: clean };
  return { thinking: clean, message: null };
}

function toolEvent(tool, lineIndex) {
  const name = tool.name;
  const input = tool.input ?? {};
  const stamp = `[step ${lineIndex}] `;

  switch (name) {
    case 'Read': {
      const filePath = String(input.path ?? input.target_file ?? 'unknown');
      return {
        type: 'file-read',
        content: `${stamp}Read ${filePath}`,
        meta: { eventType: 'file-read', filePath },
      };
    }
    case 'Write': {
      const filePath = String(input.path ?? 'unknown');
      return {
        type: 'file-create',
        content: `${stamp}Write ${filePath}`,
        meta: { eventType: 'file-create', filePath, linesAdded: 0 },
      };
    }
    case 'StrReplace':
    case 'EditNotebook': {
      const filePath = String(input.path ?? input.target_notebook ?? 'unknown');
      return {
        type: 'file-edit',
        content: `${stamp}${name} ${filePath}`,
        meta: { eventType: 'file-edit', filePath, linesAdded: 0, linesRemoved: 0 },
      };
    }
    case 'Delete': {
      const filePath = String(input.path ?? 'unknown');
      return {
        type: 'file-delete',
        content: `${stamp}Delete ${filePath}`,
        meta: { eventType: 'file-delete', filePath },
      };
    }
    case 'Grep':
      return {
        type: 'search',
        content: `${stamp}Grep ${input.pattern ?? ''}`,
        meta: {
          eventType: 'search',
          query: String(input.pattern ?? input.path ?? ''),
          searchType: 'grep',
        },
      };
    case 'Glob':
    case 'SemanticSearch':
      return {
        type: 'search',
        content: `${stamp}${name} ${input.glob_pattern ?? input.query ?? ''}`,
        meta: {
          eventType: 'search',
          query: String(input.glob_pattern ?? input.query ?? ''),
          searchType: name === 'SemanticSearch' ? 'semantic' : 'file',
        },
      };
    case 'Shell':
      return {
        type: 'terminal',
        content: `${stamp}${input.command ?? '(shell)'}`,
        meta: {
          eventType: 'terminal',
          command: String(input.command ?? ''),
          cwd: input.working_directory ? String(input.working_directory) : undefined,
        },
      };
    case 'TodoWrite':
      return {
        type: 'todo-update',
        content: `${stamp}Todo update`,
        meta: {
          eventType: 'todo-update',
          todos: Array.isArray(input.todos)
            ? input.todos.map((todo, idx) => ({
              id: idx + 1,
              title: String(todo.content ?? todo.title ?? todo.id ?? 'todo'),
              status: todo.status === 'completed'
                ? 'completed'
                : todo.status === 'in_progress'
                  ? 'in-progress'
                  : 'not-started',
            }))
            : [],
        },
      };
    default:
      return {
        type: 'tool-call',
        content: `${stamp}${name}(${JSON.stringify(input).slice(0, 900)})`,
        meta: {
          eventType: 'tool-call',
          toolName: name,
          parameters: input,
        },
      };
  }
}

function lineToEvents(row, lineIndex, totalLines, syncAnchorMs = Date.now()) {
  const events = [];
  if (!row?.role) return events;
  const timestamp = Math.floor(syncAnchorMs - (totalLines - lineIndex) * 250);
  const { text, tools } = extractTextParts(row.message?.content ?? []);

  if (row.role === 'user') {
    const userText = extractHumanUserText(text);
    if (!userText) return events;
    events.push({
      type: 'message',
      timestamp,
      content: userText.slice(0, MAX_CONTENT),
      meta: { eventType: 'message', role: 'user', transcriptLine: lineIndex },
    });
    return events;
  }

  if (row.role !== 'assistant') return events;

  const { thinking, message } = splitAssistantText(text);
  if (thinking) {
    events.push({
      type: 'thinking',
      timestamp,
      content: `[step ${lineIndex}] ${thinking}`.slice(0, MAX_CONTENT),
      meta: {
        eventType: 'thinking',
        label: thinking.slice(0, 120),
        transcriptLine: lineIndex,
      },
    });
  }
  if (message) {
    events.push({
      type: 'message',
      timestamp,
      content: message.slice(0, MAX_CONTENT),
      meta: { eventType: 'message', role: 'assistant', transcriptLine: lineIndex },
    });
  }

  for (const tool of tools) {
    events.push({
      timestamp: timestamp + 1,
      ...toolEvent(tool, lineIndex),
    });
  }

  return events.filter((e) => Number.isFinite(e.timestamp));
}

function parseNewEvents(lines, fromLine, syncAnchorMs = Date.now()) {
  const events = [];
  const totalLines = lines.length;
  for (let i = fromLine; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    events.push(...lineToEvents(row, i + 1, totalLines, syncAnchorMs));
  }
  return { events, newLineCount: lines.length };
}

function listTranscriptFiles(root) {
  if (!root || !existsSync(root)) return [];
  const out = [];
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const id = dir.name;
    const file = join(root, id, `${id}.jsonl`);
    if (existsSync(file)) out.push({ id, file });
  }
  return out.sort((a, b) => statSync(b.file).mtimeMs - statSync(a.file).mtimeMs);
}

async function maybeUpdateSessionTitle(state, transcriptId, sessionId, title) {
  const prev = state.titles?.[transcriptId] ?? '';
  if (titleQuality(title) <= titleQuality(prev)) return;
  await api(`/api/sessions/${sessionId}`, 'PATCH', { title });
  if (!state.titles) state.titles = {};
  state.titles[transcriptId] = title;
  saveSyncState(state);
  console.log(`   ↳ retitled → "${title}"`);
}

async function ensureSession(state, transcriptId, title) {
  if (state.sessions[transcriptId] && await sessionExists(state.sessions[transcriptId])) {
    const sessionId = state.sessions[transcriptId];
    await maybeUpdateSessionTitle(state, transcriptId, sessionId, title);
    return sessionId;
  }
  if (state.sessions[transcriptId]) {
    delete state.sessions[transcriptId];
  }
  const session = await api('/api/sessions', 'POST', {
    title: title || `Cursor · ${transcriptId.slice(0, 8)}`,
    description: `Cursor Composer · ${basename(WORKSPACE_ROOT)}`,
    agentName: 'Cursor Composer',
    modelId: 'cursor-agent',
    tags: ['cursor-agent', 'cursor-composer', workspaceTag()],
  });
  state.sessions[transcriptId] = session.id;
  if (!state.titles) state.titles = {};
  state.titles[transcriptId] = title;
  saveSyncState(state);
  return session.id;
}

async function pushEvents(sessionId, events) {
  if (events.length === 0) return;
  const BATCH = 80;
  for (let i = 0; i < events.length; i += BATCH) {
    await api(`/api/sessions/${sessionId}/events`, 'POST', { events: events.slice(i, i + BATCH) });
  }
}

async function sessionExists(sessionId) {
  try {
    const res = await fetch(`${API_BASE}/api/sessions/${sessionId}`);
    return res.ok;
  } catch {
    return false;
  }
}

async function resolveSessionId(state, transcriptId, title) {
  const cached = state.sessions[transcriptId];
  if (cached && await sessionExists(cached)) {
    await maybeUpdateSessionTitle(state, transcriptId, cached, title);
    return cached;
  }
  if (cached) {
    delete state.sessions[transcriptId];
    saveSyncState(state);
  }
  return ensureSession(state, transcriptId, title);
}

async function resetTranscript(state, transcriptId) {
  const sessionId = state.sessions[transcriptId];
  if (sessionId && await sessionExists(sessionId)) {
    try {
      await api(`/api/sessions/${sessionId}/clear-events`, 'POST', {});
    } catch {
      // clear-events unavailable — drop stale mapping; full re-import creates a fresh session.
      delete state.sessions[transcriptId];
      saveSyncState(state);
    }
  } else if (sessionId) {
    delete state.sessions[transcriptId];
    saveSyncState(state);
  }
  state.lineCounts[transcriptId] = 0;
  saveSyncState(state);
}

async function resyncTranscript(state, entry, onlyId) {
  if (onlyId && entry.id !== onlyId) return 0;
  await resetTranscript(state, entry.id);
  return syncTranscript(state, entry, onlyId);
}

async function resyncAll(onlyId) {
  const root = defaultTranscriptsDir();
  if (!root) {
    console.error('No Cursor agent-transcripts directory found.');
    process.exitCode = 1;
    return;
  }
  const state = loadSyncState();
  const files = listTranscriptFiles(root);
  let total = 0;
  for (const entry of files) {
    total += await resyncTranscript(state, entry, onlyId);
  }
  console.log(`Resync complete. ${total} events ingested from ${files.length} transcript(s).`);
}

async function syncTranscript(state, { id, file }, onlyId) {
  if (onlyId && id !== onlyId) return 0;
  const raw = readFileSync(file, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  const prevCount = state.lineCounts[id] ?? 0;
  const overrideTitle = loadTitleOverrides()[id];
  const title = overrideTitle || deriveTitleFromTranscript(lines, id);
  const cachedTitle = state.titles?.[id];
  const finalTitle = overrideTitle
    || (cachedTitle && titleQuality(cachedTitle) >= titleQuality(title) ? cachedTitle : title);

  if (lines.length <= prevCount) {
    if (state.sessions[id] && await sessionExists(state.sessions[id])) {
      await maybeUpdateSessionTitle(state, id, state.sessions[id], finalTitle);
    }
    return 0;
  }

  const syncAnchorMs = Date.now();
  const { events, newLineCount } = parseNewEvents(lines, prevCount, syncAnchorMs);
  if (events.length === 0) {
    state.lineCounts[id] = newLineCount;
    saveSyncState(state);
    return 0;
  }

  const sessionId = await resolveSessionId(state, id, finalTitle);
  await pushEvents(sessionId, events);
  state.lineCounts[id] = newLineCount;
  saveSyncState(state);
  console.log(`✅ ${id.slice(0, 8)}… → ${sessionId} (+${events.length} events, ${newLineCount} lines)`);
  return events.length;
}

async function retitleAll(onlyId) {
  const root = defaultTranscriptsDir();
  if (!root) {
    console.error('No Cursor agent-transcripts directory found.');
    process.exitCode = 1;
    return;
  }
  const state = loadSyncState();
  const overrides = loadTitleOverrides();
  const files = listTranscriptFiles(root);
  let updated = 0;
  for (const entry of files) {
    if (onlyId && entry.id !== onlyId) continue;
    const overrideTitle = overrides[entry.id];
    const lines = readFileSync(entry.file, 'utf8').split('\n').filter(Boolean);
    const derived = deriveTitleFromTranscript(lines, entry.id);
    const finalTitle = overrideTitle || derived;
    const sessionId = await resolveSessionId(state, entry.id, finalTitle);
    const prev = state.titles?.[entry.id] ?? '';
    if (finalTitle !== prev) {
      await api(`/api/sessions/${sessionId}`, 'PATCH', { title: finalTitle });
      if (!state.titles) state.titles = {};
      state.titles[entry.id] = finalTitle;
      saveSyncState(state);
      console.log(`   ↳ ${entry.id.slice(0, 8)} → "${finalTitle}"`);
      updated += 1;
    }
  }
  console.log(`Retitled ${updated} session(s).`);
}

async function syncAll(onlyId) {
  const root = defaultTranscriptsDir();
  if (!root) {
    console.error('No Cursor agent-transcripts directory found. Set CURSOR_TRANSCRIPTS_DIR.');
    process.exitCode = 1;
    return;
  }
  const state = loadSyncState();
  const files = listTranscriptFiles(root);
  if (files.length === 0) {
    console.log('No transcript files found.');
    return;
  }
  let total = 0;
  for (const entry of files) {
    total += await syncTranscript(state, entry, onlyId);
  }
  console.log(`Done. ${total} new events ingested from ${files.length} transcript(s).`);
}

async function watch() {
  const root = defaultTranscriptsDir();
  if (!root) {
    console.error('No Cursor agent-transcripts directory found.');
    process.exitCode = 1;
    return;
  }
  console.log(`Watching ${root} (poll every 5s). Ctrl+C to stop.`);
  for (;;) {
    try {
      await syncAll();
    } catch (err) {
      console.error('Sync error:', err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
}

const [, , command, arg] = process.argv;

try {
  switch (command) {
    case 'resync':
      await resyncAll(arg);
      break;
    case 'retitle':
      await retitleAll(arg);
      break;
    case 'sync':
      await syncAll(arg);
      break;
    case 'watch':
      await watch();
      break;
    case 'list': {
      const root = defaultTranscriptsDir();
      if (!root) throw new Error('Transcripts dir not found');
      for (const { id, file } of listTranscriptFiles(root)) {
        const mtime = new Date(statSync(file).mtimeMs).toISOString();
        console.log(`${id}  (${mtime})`);
      }
      break;
    }
    default:
      console.log(`Usage:
  node scripts/cursor-session-bridge.mjs sync [transcriptId]
  node scripts/cursor-session-bridge.mjs resync [transcriptId]
  node scripts/cursor-session-bridge.mjs retitle [transcriptId]
  node scripts/cursor-session-bridge.mjs watch
  node scripts/cursor-session-bridge.mjs list`);
      process.exitCode = 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
