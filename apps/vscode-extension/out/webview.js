"use strict";
/**
 * VeggaAI Dev Logs — Webview Panel
 *
 * Shows live session events in a VS Code webview panel.
 * Event-driven updates (no polling) via EventEmitter from session manager.
 * Events displayed newest-first with auto-scroll to top.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.openLogsPanel = openLogsPanel;
const vscode = __importStar(require("vscode"));
const session_js_1 = require("./session.js");
const api_js_1 = require("./api.js");
/* ── Panel State ───────────────────────────────────────────────── */
let panel = null;
let allEvents = [];
/* ── Open/Show Panel ───────────────────────────────────────────── */
function openLogsPanel(context) {
    if (panel) {
        panel.reveal(vscode.ViewColumn.Beside);
        return;
    }
    panel = vscode.window.createWebviewPanel('vaiDevLogs', 'VeggaAI Dev Logs', vscode.ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true,
    });
    panel.iconPath = new vscode.ThemeIcon('radio-tower');
    panel.webview.html = getWebviewHTML();
    // Send existing events
    const session = (0, session_js_1.getActiveSession)();
    if (session) {
        // Load from server
        void loadServerEvents(session.id);
    }
    // Listen for new events (event-driven, no polling!)
    const eventSub = (0, session_js_1.onEventPushed)((event) => {
        allEvents.push(event);
        sendToPanel({ type: 'newEvent', event });
    });
    const sessionSub = (0, session_js_1.onSessionChange)((session) => {
        if (session) {
            sendToPanel({ type: 'sessionStarted', session: { id: session.id, title: session.title } });
            allEvents = [];
        }
        else {
            sendToPanel({ type: 'sessionEnded' });
        }
    });
    // Handle messages from webview
    panel.webview.onDidReceiveMessage((msg) => {
        if (msg.type === 'refresh') {
            const s = (0, session_js_1.getActiveSession)();
            if (s)
                void loadServerEvents(s.id);
        }
        else if (msg.type === 'filterChange') {
            // Filter is handled client-side in the webview
        }
    });
    panel.onDidDispose(() => {
        panel = null;
        eventSub.dispose();
        sessionSub.dispose();
    });
    context.subscriptions.push(panel);
}
/* ── Load Events from Server ───────────────────────────────────── */
async function loadServerEvents(sessionId) {
    try {
        const data = await (0, api_js_1.apiCall)(`/api/sessions/${sessionId}`);
        if (data.events) {
            allEvents = data.events.map((e) => ({
                type: e.type,
                content: e.content,
                meta: e.meta,
                timestamp: e.timestamp,
            }));
            sendToPanel({ type: 'allEvents', events: allEvents });
        }
    }
    catch {
        // Server might be down
    }
}
/* ── Send Message to Panel ─────────────────────────────────────── */
function sendToPanel(message) {
    if (panel) {
        void panel.webview.postMessage(message);
    }
}
/* ── Webview HTML ──────────────────────────────────────────────── */
function getWebviewHTML() {
    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>VeggaAI Dev Logs</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-widget-border, #333);
      --hover: var(--vscode-list-hoverBackground);
      --badge-bg: var(--vscode-badge-background);
      --badge-fg: var(--vscode-badge-foreground);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size, 13px);
      line-height: 1.5;
      padding: 0;
    }

    /* ── Header ── */
    .header {
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--bg);
      border-bottom: 1px solid var(--border);
      padding: 8px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .session-badge {
      background: var(--badge-bg);
      color: var(--badge-fg);
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
    }
    .event-count {
      font-size: 11px;
      opacity: 0.7;
    }
    .recording-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #ef4444;
      animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    /* ── Filters ── */
    .filters {
      display: flex;
      gap: 4px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .filter-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--fg);
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      cursor: pointer;
      opacity: 0.6;
      transition: all 0.15s;
    }
    .filter-btn:hover { opacity: 0.9; }
    .filter-btn.active {
      opacity: 1;
      background: var(--badge-bg);
      color: var(--badge-fg);
      border-color: transparent;
    }

    /* ── Events List ── */
    .events {
      padding: 4px 0;
      overflow-y: auto;
    }
    .event {
      display: flex;
      gap: 8px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--border);
      transition: background 0.1s;
      align-items: flex-start;
    }
    .event:hover { background: var(--hover); }
    .event-icon {
      flex-shrink: 0;
      width: 18px;
      height: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      margin-top: 2px;
    }
    .event-body {
      flex: 1;
      min-width: 0;
    }
    .event-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 2px;
    }
    .event-type {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
      padding: 1px 5px;
      border-radius: 3px;
    }
    .event-time {
      font-size: 10px;
      opacity: 0.5;
      margin-left: auto;
      white-space: nowrap;
    }
    .event-content {
      font-size: 12px;
      word-break: break-word;
      white-space: pre-wrap;
      max-height: 120px;
      overflow-y: auto;
    }
    .event-content.expanded { max-height: none; }
    .event-meta {
      font-size: 10px;
      opacity: 0.5;
      margin-top: 2px;
    }

    /* ── Type Colors ── */
    .type-message .event-icon { color: #60a5fa; }
    .type-message .event-type { background: #60a5fa22; color: #60a5fa; }
    .type-thinking .event-icon { color: #a78bfa; }
    .type-thinking .event-type { background: #a78bfa22; color: #a78bfa; }
    .type-planning .event-icon { color: #8b5cf6; }
    .type-planning .event-type { background: #8b5cf622; color: #8b5cf6; }
    .type-context-gather .event-icon { color: #2dd4bf; }
    .type-context-gather .event-type { background: #2dd4bf22; color: #2dd4bf; }
    .type-file-create .event-icon { color: #34d399; }
    .type-file-create .event-type { background: #34d39922; color: #34d399; }
    .type-file-edit .event-icon { color: #fbbf24; }
    .type-file-edit .event-type { background: #fbbf2422; color: #fbbf24; }
    .type-file-read .event-icon { color: #a1a1aa; }
    .type-file-read .event-type { background: #a1a1aa22; color: #a1a1aa; }
    .type-file-delete .event-icon { color: #f87171; }
    .type-file-delete .event-type { background: #f8717122; color: #f87171; }
    .type-terminal .event-icon { color: #4ade80; }
    .type-terminal .event-type { background: #4ade8022; color: #4ade80; }
    .type-search .event-icon { color: #22d3ee; }
    .type-search .event-type { background: #22d3ee22; color: #22d3ee; }
    .type-todo-update .event-icon { color: #818cf8; }
    .type-todo-update .event-type { background: #818cf822; color: #818cf8; }
    .type-state-change .event-icon { color: #facc15; }
    .type-state-change .event-type { background: #facc1522; color: #facc15; }
    .type-error .event-icon { color: #f87171; }
    .type-error .event-type { background: #f8717122; color: #f87171; }
    .type-tool-call .event-icon { color: #fb923c; }
    .type-tool-call .event-type { background: #fb923c22; color: #fb923c; }
    .type-summary .event-icon { color: #94a3b8; }
    .type-summary .event-type { background: #94a3b822; color: #94a3b8; }
    .type-note .event-icon { color: #f472b6; }
    .type-note .event-type { background: #f472b622; color: #f472b6; }

    /* ── Empty State ── */
    .empty {
      text-align: center;
      padding: 48px 24px;
      opacity: 0.5;
    }
    .empty-icon { font-size: 32px; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <div class="recording-dot" id="recording-dot" style="display:none"></div>
      <span id="session-title" style="font-weight:600;font-size:13px;">No active session</span>
      <span class="event-count" id="event-count"></span>
    </div>
    <span class="session-badge" id="session-badge" style="display:none">—</span>
  </div>

  <div class="filters" id="filters">
    <button class="filter-btn active" data-filter="all">All</button>
    <button class="filter-btn" data-filter="message">💬 Message</button>
    <button class="filter-btn" data-filter="thinking">🧠 Thinking</button>
    <button class="filter-btn" data-filter="state-change">⚡ Status</button>
    <button class="filter-btn" data-filter="todo-update">☑️ Todos</button>
    <button class="filter-btn" data-filter="file-edit">✏️ Edit</button>
    <button class="filter-btn" data-filter="file-create">📄 Create</button>
    <button class="filter-btn" data-filter="terminal">⬛ Terminal</button>
    <button class="filter-btn" data-filter="search">🔍 Search</button>
    <button class="filter-btn" data-filter="error">⚠️ Error</button>
    <button class="filter-btn" data-filter="note">📌 Note</button>
  </div>

  <div class="events" id="events">
    <div class="empty">
      <div class="empty-icon">📡</div>
      <div>No events yet.</div>
      <div style="font-size:11px;margin-top:4px;">Start a session to begin capturing.</div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let events = [];
    let activeFilter = 'all';

    // ── Icon map ──
    const ICONS = {
      'message': '💬',
      'thinking': '🧠',
      'planning': '🧭',
      'context-gather': '📖',
      'file-create': '📄',
      'file-edit': '✏️',
      'file-read': '👁️',
      'file-delete': '🗑️',
      'terminal': '⬛',
      'search': '🔍',
      'todo-update': '☑️',
      'state-change': '⚡',
      'error': '⚠️',
      'tool-call': '🔧',
      'summary': '📝',
      'note': '📌',
    };

    const LABELS = {
      'message': 'Message',
      'thinking': 'Thinking',
      'planning': 'Planning',
      'context-gather': 'Context',
      'file-create': 'Created',
      'file-edit': 'Edited',
      'file-read': 'Read',
      'file-delete': 'Deleted',
      'terminal': 'Terminal',
      'search': 'Search',
      'todo-update': 'Todos',
      'state-change': 'Status',
      'error': 'Error',
      'tool-call': 'Tool',
      'summary': 'Summary',
      'note': 'Note',
    };

    // ── Render ──
    function renderEvents() {
      const container = document.getElementById('events');
      const filtered = activeFilter === 'all'
        ? events
        : events.filter(e => e.type === activeFilter);

      // Newest first
      const sorted = [...filtered].reverse();

      document.getElementById('event-count').textContent =
        filtered.length + '/' + events.length + ' events';

      if (sorted.length === 0) {
        container.innerHTML = '<div class="empty"><div class="empty-icon">📡</div><div>No events' +
          (activeFilter !== 'all' ? ' matching filter' : '') + '.</div></div>';
        return;
      }

      container.innerHTML = sorted.map(e => {
        const time = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '';
        const icon = ICONS[e.type] || '📋';
        const label = LABELS[e.type] || e.type;
        const role = e.meta?.role ? ' (' + e.meta.role + ')' : '';
        const filePath = e.meta?.filePath ? '<div class="event-meta">' + e.meta.filePath + '</div>' : '';

        return '<div class="event type-' + e.type + '">' +
          '<div class="event-icon">' + icon + '</div>' +
          '<div class="event-body">' +
            '<div class="event-header">' +
              '<span class="event-type">' + label + role + '</span>' +
              '<span class="event-time">' + time + '</span>' +
            '</div>' +
            '<div class="event-content">' + escapeHtml(e.content) + '</div>' +
            filePath +
          '</div>' +
        '</div>';
      }).join('');
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text || '';
      return div.innerHTML;
    }

    // ── Filter Buttons ──
    document.getElementById('filters').addEventListener('click', (e) => {
      if (e.target.classList.contains('filter-btn')) {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        activeFilter = e.target.dataset.filter;
        renderEvents();
      }
    });

    // ── Messages from Extension ──
    window.addEventListener('message', (msg) => {
      const data = msg.data;
      switch (data.type) {
        case 'newEvent':
          events.push(data.event);
          renderEvents();
          break;
        case 'allEvents':
          events = data.events || [];
          renderEvents();
          break;
        case 'sessionStarted':
          document.getElementById('session-title').textContent = data.session.title;
          document.getElementById('session-badge').textContent = data.session.id;
          document.getElementById('session-badge').style.display = '';
          document.getElementById('recording-dot').style.display = '';
          events = [];
          renderEvents();
          break;
        case 'sessionEnded':
          document.getElementById('session-title').textContent = 'Session ended';
          document.getElementById('recording-dot').style.display = 'none';
          break;
      }
    });
  </script>
</body>
</html>`;
}
//# sourceMappingURL=webview.js.map