/**
 * VeggaAI Dev Logs — VS Code Extension v0.6.0
 *
 * Zero-discipline auto-capture of ALL VS Code activity into VeggaAI Dev Logs:
 * - File edits, creates, deletes (with diff stats)
 * - Terminal commands (via shell integration)
 * - Editor focus / tab switches
 * - Diagnostics changes
 * - Task execution (build, test, lint)
 * - Debug sessions
 * - @vai chat participant (proxied Copilot)
 * - Live webview panel with event-driven updates
 * - FULL conversation capture (user messages, AI responses, thinking, tool calls)
 *
 * v0.6.0 — FULL CONVERSATION CAPTURE:
 * - Captures user messages from `requests` patches (message.text)
 * - Captures assistant response text blocks
 * - Captures AI reasoning/thinking blocks
 * - Captures tool invocations (file edits, terminal commands, searches)
 * - Fallback: tracks inputState.inputText for user message recovery
 * - All content pushed to Dev Logs automatically
 *
 * NO polling. NO manual pushes. Events flow via EventEmitter → flush every 500ms.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { isServerHealthy } from './api.js';
import {
  createSession,
  endSession,
  getActiveSession,
  pushEvent,
  dispose as disposeSession,
  initSessionManager,
  restoreSession,
  attachToSession,
} from './session.js';
import { registerFileWatchers } from './capture-files.js';
import { registerTerminalWatchers } from './capture-terminal.js';
import { registerEditorWatchers } from './capture-editor.js';
import { registerOutputWatchers } from './capture-output.js';
import { registerChatParticipant } from './capture-chat.js';
import { registerStatusBar } from './statusbar.js';
import { openLogsPanel } from './webview.js';
import { exportSessionMarkdown } from './export.js';
import { registerChatHistoryWatcher } from './capture-chat-history.js';

/* ── Runtime Server Auto-Start ─────────────────────────────────── */

let runtimeTerminal: vscode.Terminal | null = null;
let sessionFileWatcher: vscode.FileSystemWatcher | null = null;

async function ensureRuntimeRunning(): Promise<boolean> {
  // Check if already healthy
  if (await isServerHealthy()) return true;

  // Try to start the runtime server
  console.log('[vai] Runtime not reachable — attempting auto-start...');

  // Find workspace folder
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return false;

  // Create or reuse terminal for runtime
  runtimeTerminal = vscode.window.createTerminal({
    name: 'VeggaAI Runtime',
    cwd: workspaceFolder.uri,
    hideFromUser: true, // Runs in background
  });
  runtimeTerminal.sendText('pnpm --filter @vai/runtime dev');

  // Wait for server to come up (check every 2s, max 15s)
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await isServerHealthy()) {
      console.log('[vai] Runtime server started successfully');
      return true;
    }
  }

  console.warn('[vai] Runtime server did not start within 15 seconds');
  return false;
}

/* ── .vai-session File Watcher ─────────────────────────────────── */

interface VaiSessionFile {
  id: string;
  title: string;
  agentName: string;
  modelId: string;
  createdAt: number;
}

/**
 * Read and parse the .vai-session file from workspace root.
 * Returns null if file doesn't exist or is invalid.
 */
function readSessionFile(): VaiSessionFile | null {
  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  if (!wsFolder) return null;

  const filePath = path.join(wsFolder.uri.fsPath, '.vai-session');
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as VaiSessionFile;
    if (!data.id || !data.title) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Try to attach to a session defined in .vai-session.
 * Called on activation and whenever the file changes.
 */
async function tryAttachFromSessionFile(): Promise<boolean> {
  const sessionData = readSessionFile();
  if (!sessionData) return false;

  // Don't re-attach if already on this session
  const current = getActiveSession();
  if (current?.id === sessionData.id) return true;

  const ok = await attachToSession(sessionData.id, sessionData.title);
  if (ok) {
    pushEvent('state-change', `Attached to agent session: ${sessionData.title}`, {
      state: 'attached',
      agentName: sessionData.agentName,
      modelId: sessionData.modelId,
      source: '.vai-session',
    });
    console.log(`[vai] Attached to agent session via .vai-session: ${sessionData.title}`);
  }
  return ok;
}

/**
 * Set up a file system watcher for .vai-session.
 * When an agent creates/updates this file, we auto-attach to their session.
 * When the file is deleted (session ended), we can optionally create a fallback session.
 */
function watchSessionFile(context: vscode.ExtensionContext): void {
  // Watch for .vai-session in ANY workspace folder root
  sessionFileWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(
      vscode.workspace.workspaceFolders![0],
      '.vai-session',
    ),
  );

  sessionFileWatcher.onDidCreate(async () => {
    console.log('[vai] .vai-session created — attaching to agent session');
    await tryAttachFromSessionFile();
  });

  sessionFileWatcher.onDidChange(async () => {
    console.log('[vai] .vai-session updated — re-attaching to agent session');
    await tryAttachFromSessionFile();
  });

  sessionFileWatcher.onDidDelete(() => {
    console.log('[vai] .vai-session deleted — agent session ended');
    // Don't auto-create fallback. The agent ended their session.
    // User can manually start a new one if needed.
  });

  context.subscriptions.push(sessionFileWatcher);
}

/* ── Extension Activate ────────────────────────────────────────── */

export function activate(context: vscode.ExtensionContext) {
  console.log('[vai] VeggaAI Dev Logs v0.6.0 activating...');

  // ── Init Session Manager (for persistence) ──
  initSessionManager(context);

  // ── .vai-session watcher (unified sessions) ──
  if (vscode.workspace.workspaceFolders?.length) {
    watchSessionFile(context);
  }

  // ── Status Bar ──
  registerStatusBar(context);

  // ── Chat Participant (@vai) ──
  registerChatParticipant(context);

  // ── Passive Capture Layers ──
  registerFileWatchers(context);
  registerTerminalWatchers(context);
  registerEditorWatchers(context);
  registerOutputWatchers(context);

  // ── Chat History Auto-Capture (thinking blocks) ──
  registerChatHistoryWatcher(context);

  // ── Commands ──
  context.subscriptions.push(
    vscode.commands.registerCommand('vai.startSession', async () => {
      const title = await vscode.window.showInputBox({
        prompt: 'Session title',
        placeHolder: 'What are you working on?',
      });
      if (!title) return;

      try {
        const healthy = await ensureRuntimeRunning();
        if (!healthy) {
          vscode.window.showErrorMessage('VeggaAI runtime is not running. Start it manually with: pnpm --filter @vai/runtime dev');
          return;
        }
        await createSession(title);
        vscode.window.showInformationMessage(`Dev Logs session started: ${title}`);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to start session: ${err}`);
      }
    }),

    vscode.commands.registerCommand('vai.endSession', async () => {
      const session = getActiveSession();
      if (!session) {
        vscode.window.showInformationMessage('No active session');
        return;
      }
      // endSession() now shows confirmation dialog internally
      await endSession();
    }),

    vscode.commands.registerCommand('vai.sessionStatus', () => {
      const session = getActiveSession();
      if (!session) {
        vscode.window.showInformationMessage('No active session');
        return;
      }
      vscode.window.showInformationMessage(
        `Session: ${session.title}\nID: ${session.id}\nEvents: ${session.eventCount}\nBuffered: ${session.eventBuffer.length}`,
      );
    }),

    vscode.commands.registerCommand('vai.viewLogs', () => {
      openLogsPanel(context);
    }),

    vscode.commands.registerCommand('vai.exportMarkdown', () => {
      void exportSessionMarkdown();
    }),
  );

  // ── Auto-start: Attach to agent session → Restore → Create new ──
  const autoStart = vscode.workspace.getConfiguration('vai').get('autoStartSession', true);
  if (autoStart) {
    setTimeout(async () => {
      // First try to ensure runtime is running
      const healthy = await ensureRuntimeRunning();
      if (!healthy) {
        console.log('[vai] Runtime server not reachable — auto-session skipped');
        return;
      }

      // 1) Priority: Attach to an agent session via .vai-session
      const attached = await tryAttachFromSessionFile();
      if (attached) {
        console.log('[vai] Attached to agent session from .vai-session');
        return;
      }

      // 2) Try to restore a persisted session from previous VS Code window
      const restoredId = await restoreSession();
      if (restoredId) {
        pushEvent('state-change', 'Session restored after VS Code reload', {
          state: 'restored',
          version: '0.6.0',
        });
        console.log(`[vai] Restored session: ${restoredId}`);
        return;
      }

      // 3) No agent session, no restore — create a fresh workspace session
      try {
        const workspaceName = vscode.workspace.name || 'VS Code Session';
        await createSession(workspaceName);
        pushEvent('state-change', 'Extension activated — auto-capture started', {
          state: 'activated',
          version: '0.6.0',
        });
        console.log('[vai] Auto-session started');
      } catch (err) {
        console.error('[vai] Auto-session failed:', err);
      }
    }, 2000);
  }

  console.log('[vai] VeggaAI Dev Logs v0.6.0 activated');
}

export function deactivate() {
  const session = getActiveSession();
  if (session) {
    // DON'T end the session — just flush and disconnect.
    // Session persists in workspaceState and will be restored on next activation.
    pushEvent('state-change', 'Extension deactivating — session preserved for next reload', {
      state: 'deactivating',
    });

    // Synchronous-ish: flush what we can
    // Note: deactivate should be fast, so we just stop the timer.
    if (session.flushTimer) {
      clearInterval(session.flushTimer);
    }
  }
  disposeSession();
}
