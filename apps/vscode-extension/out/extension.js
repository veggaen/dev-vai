"use strict";
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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const api_js_1 = require("./api.js");
const session_js_1 = require("./session.js");
const capture_files_js_1 = require("./capture-files.js");
const capture_terminal_js_1 = require("./capture-terminal.js");
const capture_editor_js_1 = require("./capture-editor.js");
const capture_output_js_1 = require("./capture-output.js");
const capture_chat_js_1 = require("./capture-chat.js");
const statusbar_js_1 = require("./statusbar.js");
const webview_js_1 = require("./webview.js");
const export_js_1 = require("./export.js");
const capture_chat_history_js_1 = require("./capture-chat-history.js");
/* ── Runtime Server Auto-Start ─────────────────────────────────── */
let runtimeTerminal = null;
let sessionFileWatcher = null;
async function ensureRuntimeRunning() {
    // Check if already healthy
    if (await (0, api_js_1.isServerHealthy)())
        return true;
    // Try to start the runtime server
    console.log('[vai] Runtime not reachable — attempting auto-start...');
    // Find workspace folder
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder)
        return false;
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
        if (await (0, api_js_1.isServerHealthy)()) {
            console.log('[vai] Runtime server started successfully');
            return true;
        }
    }
    console.warn('[vai] Runtime server did not start within 15 seconds');
    return false;
}
/**
 * Read and parse the .vai-session file from workspace root.
 * Returns null if file doesn't exist or is invalid.
 */
function readSessionFile() {
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (!wsFolder)
        return null;
    const filePath = path.join(wsFolder.uri.fsPath, '.vai-session');
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);
        if (!data.id || !data.title)
            return null;
        return data;
    }
    catch {
        return null;
    }
}
/**
 * Try to attach to a session defined in .vai-session.
 * Called on activation and whenever the file changes.
 */
async function tryAttachFromSessionFile() {
    const sessionData = readSessionFile();
    if (!sessionData)
        return false;
    // Don't re-attach if already on this session
    const current = (0, session_js_1.getActiveSession)();
    if (current?.id === sessionData.id)
        return true;
    const ok = await (0, session_js_1.attachToSession)(sessionData.id, sessionData.title);
    if (ok) {
        (0, session_js_1.pushEvent)('state-change', `Attached to agent session: ${sessionData.title}`, {
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
function watchSessionFile(context) {
    // Watch for .vai-session in ANY workspace folder root
    sessionFileWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.workspace.workspaceFolders[0], '.vai-session'));
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
function activate(context) {
    console.log('[vai] VeggaAI Dev Logs v0.6.0 activating...');
    // ── Init Session Manager (for persistence) ──
    (0, session_js_1.initSessionManager)(context);
    // ── .vai-session watcher (unified sessions) ──
    if (vscode.workspace.workspaceFolders?.length) {
        watchSessionFile(context);
    }
    // ── Status Bar ──
    (0, statusbar_js_1.registerStatusBar)(context);
    // ── Chat Participant (@vai) ──
    (0, capture_chat_js_1.registerChatParticipant)(context);
    // ── Passive Capture Layers ──
    (0, capture_files_js_1.registerFileWatchers)(context);
    (0, capture_terminal_js_1.registerTerminalWatchers)(context);
    (0, capture_editor_js_1.registerEditorWatchers)(context);
    (0, capture_output_js_1.registerOutputWatchers)(context);
    // ── Chat History Auto-Capture (thinking blocks) ──
    (0, capture_chat_history_js_1.registerChatHistoryWatcher)(context);
    // ── Commands ──
    context.subscriptions.push(vscode.commands.registerCommand('vai.startSession', async () => {
        const title = await vscode.window.showInputBox({
            prompt: 'Session title',
            placeHolder: 'What are you working on?',
        });
        if (!title)
            return;
        try {
            const healthy = await ensureRuntimeRunning();
            if (!healthy) {
                vscode.window.showErrorMessage('VeggaAI runtime is not running. Start it manually with: pnpm --filter @vai/runtime dev');
                return;
            }
            await (0, session_js_1.createSession)(title);
            vscode.window.showInformationMessage(`Dev Logs session started: ${title}`);
        }
        catch (err) {
            vscode.window.showErrorMessage(`Failed to start session: ${err}`);
        }
    }), vscode.commands.registerCommand('vai.endSession', async () => {
        const session = (0, session_js_1.getActiveSession)();
        if (!session) {
            vscode.window.showInformationMessage('No active session');
            return;
        }
        // endSession() now shows confirmation dialog internally
        await (0, session_js_1.endSession)();
    }), vscode.commands.registerCommand('vai.sessionStatus', () => {
        const session = (0, session_js_1.getActiveSession)();
        if (!session) {
            vscode.window.showInformationMessage('No active session');
            return;
        }
        vscode.window.showInformationMessage(`Session: ${session.title}\nID: ${session.id}\nEvents: ${session.eventCount}\nBuffered: ${session.eventBuffer.length}`);
    }), vscode.commands.registerCommand('vai.viewLogs', () => {
        (0, webview_js_1.openLogsPanel)(context);
    }), vscode.commands.registerCommand('vai.exportMarkdown', () => {
        void (0, export_js_1.exportSessionMarkdown)();
    }));
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
            const restoredId = await (0, session_js_1.restoreSession)();
            if (restoredId) {
                (0, session_js_1.pushEvent)('state-change', 'Session restored after VS Code reload', {
                    state: 'restored',
                    version: '0.6.0',
                });
                console.log(`[vai] Restored session: ${restoredId}`);
                return;
            }
            // 3) No agent session, no restore — create a fresh workspace session
            try {
                const workspaceName = vscode.workspace.name || 'VS Code Session';
                await (0, session_js_1.createSession)(workspaceName);
                (0, session_js_1.pushEvent)('state-change', 'Extension activated — auto-capture started', {
                    state: 'activated',
                    version: '0.6.0',
                });
                console.log('[vai] Auto-session started');
            }
            catch (err) {
                console.error('[vai] Auto-session failed:', err);
            }
        }, 2000);
    }
    console.log('[vai] VeggaAI Dev Logs v0.6.0 activated');
}
function deactivate() {
    const session = (0, session_js_1.getActiveSession)();
    if (session) {
        // DON'T end the session — just flush and disconnect.
        // Session persists in workspaceState and will be restored on next activation.
        (0, session_js_1.pushEvent)('state-change', 'Extension deactivating — session preserved for next reload', {
            state: 'deactivating',
        });
        // Synchronous-ish: flush what we can
        // Note: deactivate should be fast, so we just stop the timer.
        if (session.flushTimer) {
            clearInterval(session.flushTimer);
        }
    }
    (0, session_js_1.dispose)();
}
//# sourceMappingURL=extension.js.map