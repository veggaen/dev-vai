/**
 * Demo session seed — creates a realistic agent session
 * representing a VS Code Copilot/Claude coding session.
 *
 * Run: pnpm -C packages/runtime tsx scripts/seed-demo-session.ts
 * Or: curl -X POST http://localhost:3006/api/sessions/import -H 'Content-Type: application/json' -d @scripts/demo-session.json
 */

import type {
  AgentSession,
  SessionEvent,
  SessionStats,
} from '@vai/core';

const SESSION_ID = 'ses_demo_agent_session_001';
const BASE_TIME = Date.now() - 3_600_000; // 1 hour ago

function t(minOffset: number): number {
  return BASE_TIME + minOffset * 60_000;
}

function evt(
  id: string,
  type: string,
  offsetMin: number,
  content: string,
  meta: Record<string, unknown>,
  durationMs?: number
): SessionEvent {
  return {
    id: `evt_demo_${id}`,
    sessionId: SESSION_ID,
    type: type as SessionEvent['type'],
    timestamp: t(offsetMin),
    durationMs,
    content,
    meta: meta as SessionEvent['meta'],
  };
}

/* ── Events ────────────────────────────────────────────────────── */

const events: SessionEvent[] = [
  // 1. User opens conversation
  evt('001', 'message', 0,
    'I would like to now make some data to my app, like when I speak with copilot or claude here we see from screenshots that it shows me thinking and tasks and working and processing and creating files and todos (3/10) and much more. I want to save all this agent session data into my VeggaAI app.',
    { eventType: 'message', role: 'user' }
  ),

  // 2. Agent starts thinking
  evt('002', 'state-change', 0.5,
    'Agent state changed to Working',
    { eventType: 'state-change', state: 'Working...', detail: 'Analyzing agent session logger requirements' }
  ),

  evt('003', 'thinking', 0.5,
    'The user wants to build an "Agent Session Logger" feature that captures all VS Code agent/AI chat session data into their VeggaAI app. This includes thinking/reasoning blocks, file operations with diffs, terminal commands, todo tracking, state changes, and chat messages.\n\nI need to design:\n1. A data model for sessions and events\n2. SQLite storage service\n3. REST API endpoints\n4. A VS Code-inspired UI\n\nLet me start with the type system...',
    { eventType: 'thinking', label: 'Analyzing requirements...' },
    8500
  ),

  // 3. Todo plan
  evt('004', 'todo-update', 1,
    'Created development plan with 9 tasks',
    { eventType: 'todo-update', todos: [
      { id: 1, title: 'Design session data model', status: 'not-started' },
      { id: 2, title: 'Build SessionService', status: 'not-started' },
      { id: 3, title: 'Add DB migrations', status: 'not-started' },
      { id: 4, title: 'Create API routes', status: 'not-started' },
      { id: 5, title: 'Wire into server', status: 'not-started' },
      { id: 6, title: 'Build sessionStore (Zustand)', status: 'not-started' },
      { id: 7, title: 'Build SessionViewer UI', status: 'not-started' },
      { id: 8, title: 'Build SessionList panel', status: 'not-started' },
      { id: 9, title: 'Create demo session', status: 'not-started' },
    ]}
  ),

  // 4. Search codebase
  evt('005', 'search', 1.5,
    'Searching for existing database and type patterns',
    { eventType: 'search', query: 'VaiDatabase schema types', searchType: 'semantic', resultCount: 8 },
    1200
  ),

  evt('006', 'file-read', 1.8,
    'Reading existing DB client for migration patterns',
    { eventType: 'file-read', filePath: 'packages/core/src/db/client.ts', startLine: 1, endLine: 159 },
    200
  ),

  // 5. Create types
  evt('007', 'state-change', 2,
    'Creating session data model',
    { eventType: 'state-change', state: 'Processing...', detail: 'Building type system' }
  ),

  evt('008', 'file-create', 2.5,
    'Created full type system: AgentSession, SessionEvent, 14 event types, EventMeta discriminated union, SessionStats, EVENT_TYPE_CONFIG',
    { eventType: 'file-create', filePath: 'packages/core/src/sessions/types.ts', linesAdded: 231, language: 'typescript', sizeBytes: 6800 },
    3200
  ),

  evt('009', 'todo-update', 2.8,
    'Completed data model design',
    { eventType: 'todo-update', todos: [
      { id: 1, title: 'Design session data model', status: 'completed' },
      { id: 2, title: 'Build SessionService', status: 'in-progress' },
      { id: 3, title: 'Add DB migrations', status: 'not-started' },
      { id: 4, title: 'Create API routes', status: 'not-started' },
      { id: 5, title: 'Wire into server', status: 'not-started' },
      { id: 6, title: 'Build sessionStore (Zustand)', status: 'not-started' },
      { id: 7, title: 'Build SessionViewer UI', status: 'not-started' },
      { id: 8, title: 'Build SessionList panel', status: 'not-started' },
      { id: 9, title: 'Create demo session', status: 'not-started' },
    ]}
  ),

  // 6. Create service
  evt('010', 'file-create', 3.5,
    'Created SessionService with CRUD operations, stats computation, import/export, and prepared SQLite statements',
    { eventType: 'file-create', filePath: 'packages/core/src/sessions/service.ts', linesAdded: 492, language: 'typescript', sizeBytes: 14200 },
    5800
  ),

  evt('011', 'file-create', 4,
    'Created barrel exports',
    { eventType: 'file-create', filePath: 'packages/core/src/sessions/index.ts', linesAdded: 12, language: 'typescript' },
    400
  ),

  // 7. Update core exports
  evt('012', 'file-edit', 4.5,
    'Added session exports to core package index',
    { eventType: 'file-edit', filePath: 'packages/core/src/index.ts', linesAdded: 15, linesRemoved: 0,
      newString: "// Sessions\nexport { SessionService, SESSION_TABLES_SQL } from './sessions/index.js';\nexport type { AgentSession, SessionEvent, SessionEventType, ... } from './sessions/types.js';" },
    800
  ),

  // 8. DB migration
  evt('013', 'file-edit', 5,
    'Added agent_sessions and session_events tables to migration SQL with 3 indexes',
    { eventType: 'file-edit', filePath: 'packages/core/src/db/client.ts', linesAdded: 28, linesRemoved: 0,
      newString: "CREATE TABLE IF NOT EXISTS agent_sessions (...);\nCREATE TABLE IF NOT EXISTS session_events (...);\nCREATE INDEX IF NOT EXISTS idx_session_events_session ..." },
    1200
  ),

  evt('014', 'todo-update', 5.2,
    'Database migration complete',
    { eventType: 'todo-update', todos: [
      { id: 1, title: 'Design session data model', status: 'completed' },
      { id: 2, title: 'Build SessionService', status: 'completed' },
      { id: 3, title: 'Add DB migrations', status: 'completed' },
      { id: 4, title: 'Create API routes', status: 'in-progress' },
      { id: 5, title: 'Wire into server', status: 'not-started' },
      { id: 6, title: 'Build sessionStore (Zustand)', status: 'not-started' },
      { id: 7, title: 'Build SessionViewer UI', status: 'not-started' },
      { id: 8, title: 'Build SessionList panel', status: 'not-started' },
      { id: 9, title: 'Create demo session', status: 'not-started' },
    ]}
  ),

  // 9. API routes
  evt('015', 'file-create', 6,
    'Created 10 REST endpoints for session CRUD, events, export/import',
    { eventType: 'file-create', filePath: 'packages/runtime/src/routes/sessions.ts', linesAdded: 157, language: 'typescript', sizeBytes: 4800 },
    4200
  ),

  // 10. Wire server
  evt('016', 'file-edit', 7,
    'Added SessionService + registerSessionRoutes imports and wiring to server.ts',
    { eventType: 'file-edit', filePath: 'packages/runtime/src/server.ts', linesAdded: 6, linesRemoved: 1 },
    1500
  ),

  // 11. Frontend store
  evt('017', 'state-change', 8,
    'Moving to frontend implementation',
    { eventType: 'state-change', state: 'Building UI...', detail: 'Creating Zustand store and React components' }
  ),

  evt('018', 'file-create', 8.5,
    'Created Zustand store with session list, selection, CRUD, import/export, and filters',
    { eventType: 'file-create', filePath: 'apps/desktop/src/stores/sessionStore.ts', linesAdded: 155, language: 'typescript', sizeBytes: 4200 },
    2800
  ),

  // 12. SessionViewer component
  evt('019', 'thinking', 9,
    'The SessionViewer needs to be the centerpiece. I want a timeline-based layout similar to VS Code\'s Copilot Chat panel.\n\nKey design decisions:\n- Left timeline with colored icons\n- Expandable/collapsible event cards\n- Thinking blocks in purple with expand/collapse\n- File operations showing paths, line counts, and optional diffs\n- Terminal commands with syntax-highlighted output\n- Todo progress bars with checkbox lists\n- Event type filter bar at top\n- Session header with stats badges',
    { eventType: 'thinking', label: 'Designing UI layout...' },
    4200
  ),

  evt('020', 'file-create', 11,
    'Created VS Code-inspired SessionViewer with timeline layout, 12 event card types, filter bar, stats header, and expandable sections',
    { eventType: 'file-create', filePath: 'apps/desktop/src/components/SessionViewer.tsx', linesAdded: 420, language: 'tsx', sizeBytes: 14500 },
    8500
  ),

  // 13. SessionList
  evt('021', 'file-create', 13,
    'Created SessionList with session cards showing stats badges, status dots, relative timestamps, and import capability',
    { eventType: 'file-create', filePath: 'apps/desktop/src/components/SessionList.tsx', linesAdded: 195, language: 'tsx', sizeBytes: 6200 },
    4000
  ),

  // 14. Layout updates
  evt('022', 'file-edit', 14,
    'Added AppView type and view state to layoutStore for chat/devlogs switching',
    { eventType: 'file-edit', filePath: 'apps/desktop/src/stores/layoutStore.ts', linesAdded: 4, linesRemoved: 0 },
    800
  ),

  evt('023', 'file-edit', 14.5,
    'Added Brain icon and Dev Logs toggle button to Sidebar',
    { eventType: 'file-edit', filePath: 'apps/desktop/src/components/Sidebar.tsx', linesAdded: 12, linesRemoved: 2 },
    1200
  ),

  evt('024', 'file-edit', 15,
    'Updated App.tsx with conditional rendering: chat view (ChatWindow + Builder panel) vs devlogs view (SessionList + SessionViewer)',
    { eventType: 'file-edit', filePath: 'apps/desktop/src/App.tsx', linesAdded: 18, linesRemoved: 4 },
    2000
  ),

  // 15. Final todos
  evt('025', 'todo-update', 15.5,
    'All implementation tasks complete',
    { eventType: 'todo-update', todos: [
      { id: 1, title: 'Design session data model', status: 'completed' },
      { id: 2, title: 'Build SessionService', status: 'completed' },
      { id: 3, title: 'Add DB migrations', status: 'completed' },
      { id: 4, title: 'Create API routes', status: 'completed' },
      { id: 5, title: 'Wire into server', status: 'completed' },
      { id: 6, title: 'Build sessionStore (Zustand)', status: 'completed' },
      { id: 7, title: 'Build SessionViewer UI', status: 'completed' },
      { id: 8, title: 'Build SessionList panel', status: 'completed' },
      { id: 9, title: 'Create demo session', status: 'completed' },
    ]}
  ),

  // 16. Agent response
  evt('026', 'message', 16,
    'The Agent Session Logger is fully built. Here\'s what was created:\n\n**Backend:**\n- Session data model with 14 event types (types.ts)\n- SessionService with full CRUD + stats + import/export (service.ts)\n- 10 REST API endpoints (sessions.ts)\n- SQLite tables with indexes (migration)\n\n**Frontend:**\n- Zustand store with fetching, filtering, CRUD (sessionStore.ts)\n- VS Code-inspired SessionViewer with timeline, expandable cards, filters (SessionViewer.tsx)\n- SessionList with status cards and import (SessionList.tsx)\n- App layout with chat/devlogs view switching\n- Sidebar Brain icon toggle for Dev Logs\n\nClick the Brain icon in the sidebar to access Dev Logs.',
    { eventType: 'message', role: 'assistant', modelId: 'claude-opus-4.6' }
  ),
];

/* ── Session ───────────────────────────────────────────────────── */

const stats: SessionStats = {
  messageCount: 2,
  filesCreated: 7,
  filesModified: 5,
  filesRead: 1,
  terminalCommands: 0,
  thinkingBlocks: 2,
  totalDurationMs: 16 * 60_000,
  linesAdded: 1705,
  linesRemoved: 7,
  todosCompleted: 9,
  todosTotal: 9,
  errorsEncountered: 0,
};

const session: AgentSession = {
  id: SESSION_ID,
  title: 'Agent Session Logger — Full Feature Build',
  description: 'Built the complete Agent Session Logger: data model, storage service, API routes, Zustand store, SessionViewer with timeline UI, SessionList, and App integration.',
  agentName: 'GitHub Copilot',
  modelId: 'claude-opus-4.6',
  startedAt: BASE_TIME,
  endedAt: t(16),
  status: 'completed',
  stats,
  tags: ['feature', 'session-logger', 'ui', 'backend', 'full-stack'],
};

/* ── Export ─────────────────────────────────────────────────────── */

export const DEMO_SESSION = { session, events };

// When run directly, output JSON
if (typeof process !== 'undefined') {
  console.log(JSON.stringify(DEMO_SESSION, null, 2));
}
