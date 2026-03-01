#!/usr/bin/env node
/**
 * Session Bridge — Push agent events to VeggaAI Dev Logs from CLI.
 *
 * This enables VS Code Copilot, Claude Code, or any external agent to log
 * their activity into the VeggaAI session system via HTTP.
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
 *
 * Environment:
 *   VAI_API_BASE — API base URL (default: http://localhost:3001)
 */

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

try {
  switch (command) {
    case 'create': {
      const [title, agentName = 'GitHub Copilot', modelId = 'claude-opus-4.6'] = args;
      if (!title) throw new Error('Usage: create <title> [agentName] [modelId]');
      const session = await api('/api/sessions', 'POST', {
        title,
        agentName,
        modelId,
        tags: ['vscode-agent'],
      });
      console.log(`✅ Session created: ${session.id}`);
      console.log(`   Title: ${title}`);
      console.log(`   Use: node scripts/session-bridge.mjs push ${session.id} ...`);
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
      await api(`/api/sessions/${sessionId}/end`, 'POST');
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

    default:
      console.log(`Session Bridge — VeggaAI Dev Logs CLI

Commands:
  create <title> [agentName] [modelId]    Create a new session
  push <id> <type> <content...>           Push an event
  title <id> <new title>                  Update session title
  end <id>                                End/complete a session
  list                                    List recent sessions
  status <id>                             Show session details

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
