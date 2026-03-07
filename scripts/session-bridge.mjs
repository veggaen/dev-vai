#!/usr/bin/env node
/**
 * Session Bridge — Push agent events to VeggaAI Dev Logs from CLI.
 *
 * This enables VS Code Copilot, Claude Code, or any external agent to log
 * their activity into the VeggaAI session system via HTTP.
 *
 * UNIFIED SESSION: When `create` is called, a `.vai-session` file is written
 * to the workspace root. The VS Code extension watches for this file and
 * attaches to the same session — no more duplicate sessions.
 *
 * Usage:
 *   node scripts/session-bridge.mjs create "Template Quality Upgrade" "GitHub Copilot" "claude-opus-4.6"
 *   node scripts/session-bridge.mjs push <sessionId> thinking "Analyzing PERN template structure..."
 *   node scripts/session-bridge.mjs push <sessionId> message:user "Fix the dev logs"
 *   node scripts/session-bridge.mjs push <sessionId> message:assistant "I'll fix the session capture..."
 *   node scripts/session-bridge.mjs push <sessionId> file-edit "src/App.tsx" "+15/-3"
 *   node scripts/session-bridge.mjs push <sessionId> terminal "pnpm vitest run" "0" "106 passed"
 *   node scripts/session-bridge.mjs push <sessionId> planning "Fix dev logs" "Auto-create sessions" "step1,step2"
 *   node scripts/session-bridge.mjs push <sessionId> state-change "Building UI" "Writing components"
 *   node scripts/session-bridge.mjs push <sessionId> note "Committed as abc123"
 *   node scripts/session-bridge.mjs title <sessionId> "New Session Title"
 *   node scripts/session-bridge.mjs end <sessionId>
 *   node scripts/session-bridge.mjs list
 *   node scripts/session-bridge.mjs status <sessionId>
 *   node scripts/session-bridge.mjs context [limit]
 *   node scripts/session-bridge.mjs search <query>
 *
 * Environment:
 *   VAI_API_BASE — API base URL (default: http://localhost:3006)
 */

import { writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = join(__dirname, '..');
const SESSION_FILE = join(WORKSPACE_ROOT, '.vai-session');

const API_BASE = process.env.VAI_API_BASE || 'http://localhost:3006';

async function api(path, method = 'GET', body = undefined) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ── Commands ────────────────────────────────────────────────────
const [, , command, ...args] = process.argv;

/**
 * Find the most recent active agent session (tagged vscode-agent).
 * Uses status filter to only get active sessions, with a high limit
 * to avoid missing older sessions that are still active.
 * Returns { id, title } or null.
 */
async function findActiveSession() {
  try {
    const data = await api('/api/sessions?status=active&limit=50');
    const active = data.sessions?.find(
      (s) => s.status === 'active' && s.tags?.includes('vscode-agent'),
    );
    return active ? { id: active.id, title: active.title } : null;
  } catch {
    return null;
  }
}

try {
  switch (command) {
    case 'create': {
      const [title, agentName = 'GitHub Copilot', modelId = 'claude-opus-4.6'] = args;
      if (!title) throw new Error('Usage: create <title> [agentName] [modelId]');

      // ── REUSE: Always reuse active agent session ──
      // The same VS Code chat may call create with different titles.
      // NEVER end an active session just because the title differs.
      // Only --new flag forces a brand-new session.
      const forceNew = process.argv.includes('--new');
      const existing = forceNew ? null : await findActiveSession();
      if (existing) {
        // Always reuse the active session — store agent intent as description, not title
        // The VS Code chat name (from JSONL header) is the canonical title.
        // Agent-provided titles go to description so both are visible.
        if (existing.title !== title) {
          try {
            await api(`/api/sessions/${existing.id}`, 'PATCH', {
              description: `Agent: ${title}`,
            });
            console.log(`📝 Agent intent saved: "${title}" (title kept: "${existing.title}")`);
          } catch { /* description update not critical */ }
        }
        try {
          writeFileSync(SESSION_FILE, JSON.stringify({
            id: existing.id,
            title: title,
            agentName,
            modelId,
            createdAt: Date.now(),
          }, null, 2));
        } catch { /* workspace may be read-only */ }
        console.log(`♻️  Reusing active session: ${existing.id}`);
        console.log(`   Title: ${title}`);
        console.log(`   Use: node scripts/session-bridge.mjs push ${existing.id} ...`);
        break;
      }

      // No active session — create a new one
      const session = await api('/api/sessions', 'POST', {
        title,
        agentName,
        modelId,
        tags: ['vscode-agent'],
      });
      // Write .vai-session so the VS Code extension can attach to this session
      try {
        writeFileSync(SESSION_FILE, JSON.stringify({
          id: session.id,
          title,
          agentName,
          modelId,
          createdAt: Date.now(),
        }, null, 2));
      } catch { /* workspace may be read-only */ }
      console.log(`✅ Session created: ${session.id}`);
      console.log(`   Title: ${title}`);
      console.log(`   Use: node scripts/session-bridge.mjs push ${session.id} ...`);
      break;
    }

    case 'active': {
      // Print the current active agent session ID (if any).
      // Useful for agents to check before creating a new session.
      const active = await findActiveSession();
      if (active) {
        console.log(active.id);
      } else {
        console.log('none');
        process.exitCode = 1;
      }
      break;
    }

    case 'push': {
      const [sessionId, typeRaw, ...rest] = args;
      if (!sessionId || !typeRaw) {
        throw new Error('Usage: push <sessionId> <type> <content...>');
      }

      let event;

      if (typeRaw === 'thinking') {
        event = {
          type: 'thinking',
          content: rest.join(' '),
          meta: { eventType: 'thinking', label: 'Agent Reasoning' },
        };
      } else if (typeRaw === 'planning') {
        const [intent, approach, stepsCSV] = rest;
        event = {
          type: 'planning',
          content: `Planning: ${intent}`,
          meta: {
            eventType: 'planning',
            intent,
            approach: approach || '',
            steps: stepsCSV ? stepsCSV.split(',') : [],
          },
        };
      } else if (typeRaw.startsWith('message:')) {
        const role = typeRaw.split(':')[1];
        event = {
          type: 'message',
          content: rest.join(' '),
          meta: { eventType: 'message', role },
        };
      } else if (typeRaw === 'file-edit') {
        const [filePath, diff] = rest;
        const [added, removed] = (diff || '+0/-0').replace(/[+-]/g, '').split('/').map(Number);
        event = {
          type: 'file-edit',
          content: `Edited ${filePath} (+${added || 0}/-${removed || 0})`,
          meta: { eventType: 'file-edit', filePath, linesAdded: added || 0, linesRemoved: removed || 0 },
        };
      } else if (typeRaw === 'file-create') {
        const [filePath, lines] = rest;
        event = {
          type: 'file-create',
          content: `Created ${filePath}`,
          meta: { eventType: 'file-create', filePath, linesAdded: Number(lines) || 0 },
        };
      } else if (typeRaw === 'terminal') {
        const [cmd, exitCode, output] = rest;
        event = {
          type: 'terminal',
          content: `$ ${cmd}`,
          meta: { eventType: 'terminal', command: cmd, exitCode: Number(exitCode) || 0, output },
        };
      } else if (typeRaw === 'state-change') {
        const [state, detail] = rest;
        event = {
          type: 'state-change',
          content: state,
          meta: { eventType: 'state-change', state, detail },
        };
      } else if (typeRaw === 'note') {
        event = {
          type: 'note',
          content: rest.join(' '),
          meta: { eventType: 'note' },
        };
      } else if (typeRaw === 'todo-update') {
        // Expects JSON array as first rest arg
        const todos = JSON.parse(rest[0] || '[]');
        const completed = todos.filter(t => t.status === 'completed').length;
        event = {
          type: 'todo-update',
          content: `Todos: ${completed}/${todos.length} completed`,
          meta: { eventType: 'todo-update', todos },
        };
      } else if (typeRaw === 'error') {
        event = {
          type: 'error',
          content: rest.join(' '),
          meta: { eventType: 'error', errorType: 'agent' },
        };
      } else if (typeRaw === 'context-gather') {
        event = {
          type: 'context-gather',
          content: rest.join(' '),
          meta: { eventType: 'context-gather', filesRead: [], queriesRun: [], findings: rest.join(' ') },
        };
      } else {
        // Generic
        event = {
          type: typeRaw,
          content: rest.join(' '),
          meta: { eventType: typeRaw },
        };
      }

      await api(`/api/sessions/${sessionId}/events`, 'POST', { events: [event] });
      console.log(`📝 Pushed ${typeRaw} event to session ${sessionId}`);
      break;
    }

    case 'title': {
      const [sessionId, ...titleParts] = args;
      const title = titleParts.join(' ');
      if (!sessionId || !title) throw new Error('Usage: title <sessionId> <new title>');
      await api(`/api/sessions/${sessionId}`, 'PATCH', { title });
      console.log(`✏️  Updated title: "${title}"`);
      break;
    }

    case 'end': {
      const [sessionId] = args;
      if (!sessionId) throw new Error('Usage: end <sessionId>');
      await api(`/api/sessions/${sessionId}/end`, 'POST', { status: 'completed' });
      // Clean up .vai-session file
      try { unlinkSync(SESSION_FILE); } catch { /* may not exist */ }
      console.log(`🏁 Session ${sessionId} ended`);
      break;
    }

    case 'list': {
      const data = await api('/api/sessions?limit=20');
      if (data.sessions.length === 0) {
        console.log('No sessions found.');
      } else {
        for (const s of data.sessions) {
          const age = Math.round((Date.now() - s.startedAt) / 60000);
          const status = s.status === 'active' ? '🟢' : s.status === 'completed' ? '✅' : '❌';
          console.log(`${status} ${s.id}  ${s.title}  (${age}m ago, ${s.stats?.messageCount || 0} msgs)`);
        }
      }
      break;
    }

    case 'status': {
      const [sessionId] = args;
      if (!sessionId) throw new Error('Usage: status <sessionId>');
      const data = await api(`/api/sessions/${sessionId}`);
      console.log(`Session: ${data.session.title}`);
      console.log(`Status:  ${data.session.status}`);
      console.log(`Events:  ${data.eventCount}`);
      console.log(`Stats:`, JSON.stringify(data.session.stats, null, 2));
      break;
    }

    case 'context': {
      const [limit = '5'] = args;
      const ctx = await api(`/api/sessions/context?limit=${limit}`);
      console.log(`\n📋 Context Summary (${ctx.totalSessions} sessions, ${ctx.totalEvents} events)\n`);

      if (ctx.unresolvedNotes.length > 0) {
        console.log('🔴 Unresolved Notes:');
        for (const n of ctx.unresolvedNotes) {
          console.log(`  [${n.category}] ${n.content}`);
        }
        console.log('');
      }

      for (const s of ctx.recentSessions) {
        const status = s.status === 'active' ? '🟢' : s.status === 'completed' ? '✅' : '❌';
        console.log(`${status} ${s.title} (${s.id})`);
        console.log(`   Stats: ${s.stats.messageCount} msgs, ${s.stats.filesModified} edits, ${s.stats.terminalCommands} cmds, ${s.stats.errorsEncountered} errors`);
        if (s.keyDecisions.length > 0) {
          console.log(`   Decisions: ${s.keyDecisions.join(' | ')}`);
        }
        if (s.filesTouched.length > 0) {
          console.log(`   Files: ${s.filesTouched.slice(0, 10).join(', ')}${s.filesTouched.length > 10 ? ` +${s.filesTouched.length - 10} more` : ''}`);
        }
        if (s.errors.length > 0) {
          console.log(`   Errors: ${s.errors.join(' | ')}`);
        }
        console.log('');
      }
      break;
    }

    case 'search': {
      const query = args.join(' ');
      if (!query) throw new Error('Usage: search <query>');
      const data = await api(`/api/sessions/search?q=${encodeURIComponent(query)}&limit=20`);
      console.log(`\n🔍 Search: "${query}" — ${data.total} results\n`);
      for (const r of data.results) {
        const score = Math.round(r.matchScore * 100);
        const time = new Date(r.event.timestamp).toLocaleString();
        console.log(`  [${score}%] [${r.event.type}] ${r.sessionTitle}`);
        console.log(`      ${r.event.content.slice(0, 120)}${r.event.content.length > 120 ? '...' : ''}`);
        console.log(`      ${time}\n`);
      }
      break;
    }

    default:
      console.log(`Session Bridge — VeggaAI Dev Logs CLI

Commands:
  create <title> [agentName] [modelId]    Create or reuse active session
  active                                  Print active session ID (or "none")
  push <id> <type> <content...>           Push an event
  title <id> <new title>                  Update session title
  end <id>                                End/complete a session
  list                                    List recent sessions
  status <id>                             Show session details
  context [limit]                         Get context summary for agents
  search <query>                          Search across all sessions

Event types for push:
  thinking <text>                         Agent reasoning block
  planning <intent> <approach> <steps>    Planning / strategy
  message:user <text>                     User message
  message:assistant <text>                Assistant response
  file-edit <path> "+X/-Y"               File modification
  file-create <path> <lines>             File creation
  terminal <command> <exitCode> [output]  Terminal command
  state-change <state> [detail]          Status update
  context-gather <findings>               Reading/searching code
  note <text>                             Free-form annotation
  error <text>                            Error occurrence
  todo-update '<JSON array>'              Todo list snapshot`);
  }
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}
